import { Stack, useLocalSearchParams } from 'expo-router';
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
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { BacktestResult, runBacktest } from '@/lib/backtest';
import { fetchDailyCandlesResolved } from '@/lib/candles';
import { fetchEarningsDates } from '@/lib/finnhub';
import { CombinedPlaybookResult, runCombinedPlaybookBacktest } from '@/lib/playbookCombined';

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString();
}

type Mode = 'setup' | 'combined';

export default function BacktestScreen() {
  const { setupId, symbol: symbolParam } = useLocalSearchParams<{
    setupId?: string;
    symbol?: string;
  }>();
  const { setups, watchlist, settings, candles } = useTrading();

  const setup = setups.find((s) => s.id === setupId) ?? setups[0];
  const defaultSymbol = symbolParam || watchlist[0]?.symbol || 'AAPL';
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [selectedSetupId, setSelectedSetupId] = useState(setup?.id ?? '');
  const [mode, setMode] = useState<Mode>('combined');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [combined, setCombined] = useState<CombinedPlaybookResult | null>(null);

  const activeSetup = useMemo(
    () => setups.find((s) => s.id === selectedSetupId) ?? setup,
    [setups, selectedSetupId, setup]
  );

  const run = async () => {
    if (mode === 'setup' && !activeSetup) return;
    setLoading(true);
    setResult(null);
    setCombined(null);
    try {
      const upper = symbol.toUpperCase().trim() || 'AAPL';
      // Short fetch: ~140 calendar days ≈ SMA50 warmup + last ~30 trading days to score.
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        days: 140,
      };
      const [symbolBars, spyBars, qqqBars] = await Promise.all([
        fetchDailyCandlesResolved(upper, keys),
        fetchDailyCandlesResolved('SPY', keys),
        fetchDailyCandlesResolved('QQQ', keys),
      ]);

      const useSymbol = symbolBars.candles.length ? symbolBars.candles : candles[upper] ?? [];
      const useSpy = spyBars.candles.length ? spyBars.candles : candles.SPY ?? [];
      const useQqq = qqqBars.candles.length ? qqqBars.candles : candles.QQQ ?? [];

      const first = useSymbol[0]?.time;
      const last = useSymbol[useSymbol.length - 1]?.time;
      const from = first
        ? new Date(first * 1000).toISOString().slice(0, 10)
        : new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      const to = last
        ? new Date(last * 1000 + 2 * 86400000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const earningsDates = await fetchEarningsDates(
        upper,
        settings.finnhubApiKey || undefined,
        from,
        to
      );

      const warnings = [
        ...symbolBars.warnings,
        ...spyBars.warnings.filter((w) => w.includes('Finnhub') || w.includes('Alpha')),
        ...qqqBars.warnings.filter((w) => w.includes('Finnhub') || w.includes('Alpha')),
      ];
      if (!earningsDates.length && settings.finnhubApiKey) {
        warnings.push('No earnings dates returned for this window (blackout unchecked).');
      } else if (!settings.finnhubApiKey) {
        warnings.push('Add a Finnhub key to enable earnings blackout in backtests.');
      }

      if (mode === 'combined') {
        setCombined(
          runCombinedPlaybookBacktest({
            symbol: upper,
            setups,
            candles: useSymbol,
            spyCandles: useSpy,
            qqqCandles: useQqq,
            earningsDates,
            sourceLabel: symbolBars.source,
            warnings,
            evalBars: 30,
          })
        );
      } else if (activeSetup) {
        setResult(
          runBacktest({
            setup: activeSetup,
            symbol: upper,
            candles: useSymbol,
            spyCandles: useSpy,
            qqqCandles: useQqq,
            earningsDates,
            sourceLabel: symbolBars.source,
            warnings,
            evalBars: 30,
          })
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const displayTrades = combined?.trades ?? result?.trades ?? [];
  const displayWin = combined?.winRate ?? result?.winRate ?? null;
  const displayAvg = combined?.avgR ?? result?.avgR ?? null;
  const displayDd = result?.maxDrawdownR ?? null;
  const displayNotes = combined?.notes ?? result?.notes ?? [];
  const displayWarnings = combined?.warnings ?? result?.warnings ?? [];
  const displayTitle = combined
    ? `Combined playbook · ${combined.symbol}`
    : result
      ? `${result.setupName} · ${result.symbol}`
      : '';
  const displaySource = combined?.sourceLabel ?? result?.sourceLabel ?? '';
  const displayMeta = combined
    ? `${combined.trades.length} trades · ${combined.skippedOverlaps} overlaps · ${combined.skippedCooldown} cooldown skips`
    : result
      ? `${result.barsUsed} bars · warmup ${result.warmupBars} · ${result.trades.length} trades`
      : '';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Backtest' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Setup backtest (last ~30 trading days)"
          subtitle="Last ~30 trading days with regime + earnings gates, fill costs, and post-stop cooldown. Combined mode keeps one best setup per day."
        />

        <Text style={styles.fieldLabel}>Mode</Text>
        <View style={styles.setupRow}>
          <Pressable
            onPress={() => setMode('combined')}
            style={[styles.chip, mode === 'combined' && styles.chipOn]}>
            <Text style={[styles.chipText, mode === 'combined' && styles.chipTextOn]}>
              Combined (de-duped)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('setup')}
            style={[styles.chip, mode === 'setup' && styles.chipOn]}>
            <Text style={[styles.chipText, mode === 'setup' && styles.chipTextOn]}>
              Single setup
            </Text>
          </Pressable>
        </View>

        {mode === 'setup' ? (
          <>
            <Text style={styles.fieldLabel}>Setup</Text>
            <View style={styles.setupRow}>
              {setups.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setSelectedSetupId(s.id)}
                  style={[styles.chip, selectedSetupId === s.id && styles.chipOn]}>
                  <Text style={[styles.chipText, selectedSetupId === s.id && styles.chipTextOn]}>
                    {s.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Field
          label="Symbol"
          autoCapitalize="characters"
          value={symbol}
          onChangeText={setSymbol}
        />

        <Button label={loading ? 'Running…' : 'Run backtest'} onPress={run} disabled={loading} />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>
              Fetching bars + earnings (SPY/QQQ regime checks)…
            </Text>
          </View>
        ) : null}

        {result || combined ? (
          <View style={styles.results}>
            <View style={styles.resultHead}>
              <Text style={styles.resultTitle}>{displayTitle}</Text>
              <Pill
                label={displaySource}
                tone={displaySource === 'demo' ? 'warn' : 'good'}
              />
            </View>

            <Text style={styles.meta}>{displayMeta}</Text>

            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Win rate</Text>
                <Text style={styles.statValue}>
                  {displayWin == null ? '—' : `${Math.round(displayWin * 100)}%`}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Avg R</Text>
                <Text style={styles.statValue}>
                  {displayAvg == null ? '—' : displayAvg.toFixed(2)}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>
                  {combined ? 'Skipped' : 'Max DD (R)'}
                </Text>
                <Text style={styles.statValue}>
                  {combined
                    ? String(combined.skippedOverlaps)
                    : displayDd == null
                      ? '—'
                      : displayDd.toFixed(2)}
                </Text>
              </View>
            </View>

            {displayWarnings.length ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>Data / API notes</Text>
                {displayWarnings.map((w) => (
                  <Text key={w} style={styles.warnItem}>
                    • {w}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.noteBox}>
              {displayNotes.map((n) => (
                <Text key={n} style={styles.noteItem}>
                  • {n}
                </Text>
              ))}
            </View>

            {displayTrades.length === 0 ? (
              <EmptyState
                title="No trades fired"
                body="Rules never reached the pass threshold on this sample, or history is too short."
              />
            ) : (
              displayTrades
                .slice()
                .reverse()
                .map((t, idx) => {
                  const setupName =
                    'setupName' in t && typeof t.setupName === 'string' ? t.setupName : null;
                  return (
                    <View key={`${t.entryTime}-${idx}`} style={styles.trade}>
                      <Text style={styles.tradeTitle}>
                        {formatDate(t.entryTime)} → {formatDate(t.exitTime)} · {t.reason}
                        {setupName ? ` · ${setupName}` : ''}
                      </Text>
                      <Text style={styles.tradeMeta}>
                        Entry {t.entry.toFixed(2)} · Exit {t.exit.toFixed(2)} · Stop{' '}
                        {t.stop.toFixed(2)} · Target {t.target.toFixed(2)}
                      </Text>
                      <Text
                        style={[
                          styles.tradeR,
                          { color: t.rMultiple >= 0 ? palette.leaf : palette.danger },
                        ]}>
                        {t.rMultiple >= 0 ? '+' : ''}
                        {t.rMultiple.toFixed(2)}R
                      </Text>
                    </View>
                  );
                })
            )}
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
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  setupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  chipText: { color: palette.ink, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: palette.moss },
  loading: {
    marginTop: spacing.md,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: { color: palette.muted },
  results: {
    marginTop: spacing.lg,
    gap: 10,
  },
  resultHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.ink,
    flex: 1,
  },
  meta: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.muted,
  },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: palette.sand,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  statLabel: { color: palette.muted, fontSize: 12, marginBottom: 4 },
  statValue: { fontFamily: 'SpaceMono', fontSize: 18, color: palette.ink },
  warnBox: {
    backgroundColor: palette.warnSoft,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  warnTitle: { fontWeight: '700', color: palette.warn },
  warnItem: { color: palette.ink, lineHeight: 18, fontSize: 13 },
  noteBox: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  noteItem: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  trade: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  tradeTitle: { fontWeight: '700', color: palette.ink },
  tradeMeta: { fontFamily: 'SpaceMono', fontSize: 11, color: palette.muted },
  tradeR: { fontFamily: 'SpaceMono', fontWeight: '700' },
});
