import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import {
  CURATED_UNIVERSES,
  UNIVERSE_PRESET_GROUPS,
  matchingUniversePresetId,
  normalizeSymbolList,
  symbolsToField,
} from '@/constants/universes';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fetchDailyCandlesResolved, isLiveCandleSource } from '@/lib/candles';
import { fetchEarningsDates } from '@/lib/finnhub';
import {
  historyDaysForPlaybookScan,
  liveEarningsWindow,
  minBarsForPlaybookScan,
  scanUniverseAgainstPlaybook,
  UniverseScanResult,
  UniverseScanTicker,
} from '@/lib/universeScan';

type SkippedTicker = { symbol: string; reason: string };

export default function UniverseScanScreen() {
  const { enabledSetups, settings, setupExpectancy, watchlist, liveBehavior } = useTrading();
  const [symbolsText, setSymbolsText] = useState(
    symbolsToField(CURATED_UNIVERSES.find((u) => u.id === 'full')!.symbols)
  );
  const [earningsBlackout, setEarningsBlackout] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<UniverseScanResult | null>(null);
  const [skipped, setSkipped] = useState<SkippedTicker[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [expandedQuietSymbol, setExpandedQuietSymbol] = useState<string | null>(null);

  const activePresetId = matchingUniversePresetId(symbolsText);
  const watchlistSymbols = useMemo(
    () =>
      [
        ...new Set(
          watchlist.map((w) => w.symbol.toUpperCase().trim()).filter(Boolean)
        ),
      ],
    [watchlist]
  );
  const watchlistActive =
    watchlistSymbols.length > 0 &&
    normalizeSymbolList(symbolsText) === normalizeSymbolList(symbolsToField(watchlistSymbols));

  const historyDays = useMemo(
    () => historyDaysForPlaybookScan(enabledSetups),
    [enabledSetups]
  );
  const minBars = useMemo(() => minBarsForPlaybookScan(enabledSetups), [enabledSetups]);

  const expectancy = useMemo(
    () => Object.fromEntries(setupExpectancy.map((e) => [e.setupId, e])),
    [setupExpectancy]
  );

  const applyPreset = (symbols: string[]) => {
    setSymbolsText(symbolsToField(symbols));
  };

  const run = async () => {
    const symbols = [
      ...new Set(
        symbolsText
          .split(/[,\s]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
    if (!symbols.length || !enabledSetups.length) return;

    setLoading(true);
    setResult(null);
    setSkipped([]);
    setRanAt(null);
    setShowUnmatched(false);
    setExpandedQuietSymbol(null);

    try {
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        tiingoProxyUrl: settings.tiingoProxyUrl || undefined,
        tiingoProxyToken: settings.tiingoProxyToken || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        yahooProxyUrl: settings.yahooProxyUrl || undefined,
        yahooProxyToken: settings.yahooProxyToken || undefined,
        days: historyDays,
      };

      setProgress('Fetching SPY / QQQ…');
      const [spy, qqq] = await Promise.all([
        fetchDailyCandlesResolved('SPY', keys),
        fetchDailyCandlesResolved('QQQ', keys),
      ]);

      const tickers: UniverseScanTicker[] = [];
      const skippedRows: SkippedTicker[] = [];
      const earnWindow = liveEarningsWindow();

      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        setProgress(`Candles ${symbol} (${i + 1}/${symbols.length})…`);
        const bars = await fetchDailyCandlesResolved(symbol, keys);
        if (!isLiveCandleSource(bars.source) || bars.candles.length < minBars) {
          skippedRows.push({
            symbol,
            reason: !isLiveCandleSource(bars.source)
              ? `No live EOD (${bars.source}) — demo bars are refused here.`
              : `Only ${bars.candles.length} bars from ${bars.source} — need ≥${minBars}.`,
          });
          continue;
        }

        const row: UniverseScanTicker = { symbol, candles: bars.candles };
        if (earningsBlackout) {
          setProgress(`Earnings ${symbol} (${i + 1}/${symbols.length})…`);
          const earnings = await fetchEarningsDates(
            symbol,
            settings.finnhubApiKey || undefined,
            earnWindow.fromDate,
            earnWindow.toDate,
            settings.fmpApiKey || undefined,
            settings.alphaVantageApiKey || undefined,
            settings.yahooProxyUrl?.trim()
              ? { url: settings.yahooProxyUrl, token: settings.yahooProxyToken || undefined }
              : undefined
          );
          row.earningsDates = earnings.dates;
          row.earningsCalendarStatus = earnings.status;
        }
        tickers.push(row);
      }

      if (!tickers.length) {
        setSkipped(skippedRows);
        return;
      }

      setProgress(`Matching ${tickers.length} tickers × ${enabledSetups.length} setups…`);
      const scan = scanUniverseAgainstPlaybook({
        setups: enabledSetups,
        tickers,
        spyCandles: spy.candles,
        qqqCandles: qqq.candles,
        earningsBlackout,
        gates: liveBehavior.gates,
        expectancy,
      });
      setResult(scan);
      setSkipped(skippedRows);
      setRanAt(new Date().toLocaleTimeString());
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const matchedRows = result?.rows.filter((r) => r.passed.length > 0) ?? [];
  const unmatchedRows = result?.rows.filter((r) => r.passed.length === 0) ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Universe scan' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Universe scan"
          subtitle="Given a ticker list, show which symbols match enabled Playbook setups right now. No Desk Soft/Strong — rules only."
        />

        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>API thrift</Text>
          <Text style={styles.noteItem}>
            • Fetches ~{historyDays} calendar days of EOD per symbol (more only if 52-Week High
            Pullback is enabled), plus SPY/QQQ once.
          </Text>
          <Text style={styles.noteItem}>
            • Matching is local CPU across all enabled setups — setup count does not add API
            calls.
          </Text>
          <Text style={styles.noteItem}>
            • Earnings blackout uses a ±14 day window (not multi-year history). Turn it off to
            skip those calls entirely.
          </Text>
        </View>

        <Field
          label="Universe (comma separated)"
          autoCapitalize="characters"
          value={symbolsText}
          onChangeText={setSymbolsText}
          multiline
        />

        {UNIVERSE_PRESET_GROUPS.map((group) => (
          <View key={group.id} style={styles.presetGroup}>
            <Text style={styles.presetGroupLabel}>{group.label}</Text>
            <View style={styles.presetRow}>
              {group.presets.map((preset) => {
                const active = activePresetId === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => applyPreset(preset.symbols)}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${preset.label} universe, ${preset.symbols.length} symbols`}>
                    <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                      {preset.label} · {preset.symbols.length}
                    </Text>
                  </Pressable>
                );
              })}
              {group.id === 'size' && watchlistSymbols.length > 0 ? (
                <Pressable
                  onPress={() => applyPreset(watchlistSymbols)}
                  style={[styles.presetChip, watchlistActive && styles.presetChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: watchlistActive }}
                  accessibilityLabel={`Watchlist universe, ${watchlistSymbols.length} symbols`}>
                  <Text
                    style={[
                      styles.presetChipText,
                      watchlistActive && styles.presetChipTextActive,
                    ]}>
                    Watch · {watchlistSymbols.length}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        <Pressable
          onPress={() => setEarningsBlackout((v) => !v)}
          style={styles.toggleRow}
          accessibilityRole="switch"
          accessibilityState={{ checked: earningsBlackout }}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Earnings blackout</Text>
            <Text style={styles.toggleBody}>
              Live Playbook gate (±1 day). Off = fewer API calls, technical match only.
            </Text>
          </View>
          <Pill label={earningsBlackout ? 'On' : 'Off'} tone={earningsBlackout ? 'good' : 'neutral'} />
        </Pressable>

        <Text style={styles.metaInline}>
          {enabledSetups.length} enabled setup{enabledSetups.length === 1 ? '' : 's'} · ≥{minBars}{' '}
          bars required
        </Text>

        <Button
          label={loading ? 'Scanning…' : 'Scan universe'}
          onPress={run}
          disabled={loading || !enabledSetups.length}
        />
        {progress ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        ) : null}

        {!enabledSetups.length ? (
          <EmptyState
            title="No setups enabled"
            body="Turn on at least one Playbook setup, then scan again."
          />
        ) : null}

        {!loading && !result && skipped.length > 0 ? (
          <EmptyState
            title="No live data"
            body="Every symbol was refused (no live EOD or too few bars). Add API keys in Settings — this scan will not run on synthetic demo bars."
          />
        ) : null}

        {result ? (
          <View style={styles.results}>
            <Text style={styles.meta}>
              {result.matchedCount} matched · {result.unmatchedCount} quiet ·{' '}
              {result.setupsUsed.length} setups · ~{result.historyDays}d history
              {result.earningsBlackout ? ' · earnings on' : ' · earnings off'}
              {ranAt ? ` · ran ${ranAt}` : ''}
            </Text>

            {matchedRows.length === 0 ? (
              <EmptyState
                title="No matches today"
                body="None of the scanned symbols passed an enabled Playbook setup on the latest bars."
              />
            ) : (
              matchedRows.map((row) => (
                <View key={row.symbol} style={styles.matchCard}>
                  <View style={styles.matchHead}>
                    <Text style={styles.symbol}>{row.symbol}</Text>
                    <Pill
                      label={`${row.passed.length} setup${row.passed.length === 1 ? '' : 's'}`}
                      tone="good"
                    />
                  </View>
                  {row.topSetupName ? (
                    <Text style={styles.topSetup}>
                      Top: {row.topSetupName}
                      {row.topPassRate != null
                        ? ` · ${(row.topPassRate * 100).toFixed(0)}% checks`
                        : ''}
                    </Text>
                  ) : null}
                  {row.passed.map((m) => (
                    <Text key={m.setupId} style={styles.setupLine}>
                      • {m.setupName}
                      {m.passedChecks.length
                        ? ` — ${m.passedChecks.slice(0, 3).join(', ')}${
                            m.passedChecks.length > 3 ? '…' : ''
                          }`
                        : ''}
                    </Text>
                  ))}
                </View>
              ))
            )}

            {unmatchedRows.length ? (
              <View style={styles.quietCard}>
                <Pressable onPress={() => setShowUnmatched((v) => !v)}>
                  <Text style={styles.quietTitle}>
                    Quiet symbols ({unmatchedRows.length}) {showUnmatched ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {showUnmatched
                  ? unmatchedRows.map((row) => {
                      const expanded = expandedQuietSymbol === row.symbol;
                      const blockers = row.matches
                        .flatMap((match) => match.failedCheckDetails)
                        .filter((detail, index, details) => details.indexOf(detail) === index);
                      return (
                        <Pressable
                          key={row.symbol}
                          onPress={() => setExpandedQuietSymbol(expanded ? null : row.symbol)}
                          style={styles.quietRow}>
                          <Text style={styles.quietSymbol}>
                            {row.symbol} · {expanded ? '▾' : '▸'}
                          </Text>
                          {expanded ? (
                            blockers.length ? (
                              blockers.slice(0, 4).map((detail) => (
                                <Text key={detail} style={styles.quietReason}>
                                  • {detail}
                                </Text>
                              ))
                            ) : (
                              <Text style={styles.quietReason}>
                                No shared hard filter was identified; open the Desk detail for the
                                per-setup checks.
                              </Text>
                            )
                          ) : null}
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            ) : null}

            {skipped.length ? (
              <View style={styles.skippedCard}>
                <Text style={styles.skippedTitle}>Skipped symbols</Text>
                {skipped.map((row) => (
                  <Text key={row.symbol} style={styles.skippedRow}>
                    {row.symbol}: {row.reason}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text style={styles.footnote}>
              This is a Playbook rules check on recent daily bars — not Desk confirmation, not a
              backtest. Re-run after the next EOD close for a fresh read.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
    gap: spacing.sm,
  },
  noteBox: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
    gap: 6,
  },
  noteTitle: { fontWeight: '700', color: palette.ink, fontSize: 13 },
  noteItem: { color: palette.muted, fontSize: 12.5, lineHeight: 18 },
  presetGroup: {
    gap: 6,
    marginTop: -2,
  },
  presetGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
  },
  presetChipActive: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.muted,
  },
  presetChipTextActive: {
    color: palette.moss,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: palette.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
  },
  toggleCopy: { flex: 1, gap: 2 },
  toggleTitle: { fontWeight: '700', color: palette.ink, fontSize: 14 },
  toggleBody: { color: palette.muted, fontSize: 12.5, lineHeight: 17 },
  metaInline: { color: palette.muted, fontSize: 12.5 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: { color: palette.muted, fontSize: 13 },
  results: { gap: spacing.md, marginTop: spacing.sm },
  meta: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  matchCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
    gap: 6,
  },
  matchHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  symbol: { fontSize: 18, fontWeight: '700', color: palette.ink },
  topSetup: { fontSize: 13, fontWeight: '600', color: palette.moss },
  setupLine: { fontSize: 12.5, color: palette.muted, lineHeight: 18 },
  quietCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
    gap: 4,
  },
  quietTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  quietRow: { gap: 3, paddingVertical: 2 },
  quietSymbol: { fontSize: 12.5, color: palette.ink, fontWeight: '600', lineHeight: 18 },
  quietReason: { fontSize: 12, color: palette.muted, lineHeight: 17 },
  skippedCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
    gap: 4,
  },
  skippedTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  skippedRow: { fontSize: 12.5, color: palette.muted, lineHeight: 18 },
  footnote: { marginTop: spacing.xs, fontSize: 12, color: palette.muted, lineHeight: 17 },
});
