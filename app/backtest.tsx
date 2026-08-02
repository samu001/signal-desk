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

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString();
}

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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const activeSetup = useMemo(
    () => setups.find((s) => s.id === selectedSetupId) ?? setup,
    [setups, selectedSetupId, setup]
  );

  const run = async () => {
    if (!activeSetup) return;
    setLoading(true);
    try {
      const upper = symbol.toUpperCase().trim() || 'AAPL';
      // Short fetch: ~140 calendar days ≈ SMA50 warmup + last ~30 trading days to score.
      // Still one API call per symbol; smaller than the old 800-day pull.
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        days: 140,
      };
      const [symbolBars, spyBars] = await Promise.all([
        fetchDailyCandlesResolved(upper, keys),
        fetchDailyCandlesResolved('SPY', keys),
      ]);

      // Prefer freshly fetched bars; fall back to in-memory cache.
      const useSymbol = symbolBars.candles.length ? symbolBars.candles : candles[upper] ?? [];
      const useSpy = spyBars.candles.length ? spyBars.candles : candles.SPY ?? [];

      const next = runBacktest({
        setup: activeSetup,
        symbol: upper,
        candles: useSymbol,
        spyCandles: useSpy,
        sourceLabel: symbolBars.source,
        warnings: [...symbolBars.warnings, ...spyBars.warnings.filter((w) => w.includes('Finnhub') || w.includes('Alpha'))],
        evalBars: 30,
      });
      setResult(next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Backtest' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Setup backtest (last ~30 trading days)"
          subtitle="Scores only the last ~30 trading days (keeps a little extra history for moving averages). One light API pull per symbol."
        />

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
            <Text style={styles.loadingText}>Fetching bars (sequential to respect rate limits)…</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.results}>
            <View style={styles.resultHead}>
              <Text style={styles.resultTitle}>
                {result.setupName} · {result.symbol}
              </Text>
              <Pill
                label={result.sourceLabel}
                tone={result.sourceLabel === 'demo' ? 'warn' : 'good'}
              />
            </View>

            <Text style={styles.meta}>
              {result.barsUsed} bars · warmup {result.warmupBars} · {result.trades.length} trades
            </Text>

            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Win rate</Text>
                <Text style={styles.statValue}>
                  {result.winRate == null ? '—' : `${Math.round(result.winRate * 100)}%`}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Avg R</Text>
                <Text style={styles.statValue}>
                  {result.avgR == null ? '—' : result.avgR.toFixed(2)}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Max DD (R)</Text>
                <Text style={styles.statValue}>
                  {result.maxDrawdownR == null ? '—' : result.maxDrawdownR.toFixed(2)}
                </Text>
              </View>
            </View>

            {result.warnings.length ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>Data / API notes</Text>
                {result.warnings.map((w) => (
                  <Text key={w} style={styles.warnItem}>
                    • {w}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.noteBox}>
              {result.notes.map((n) => (
                <Text key={n} style={styles.noteItem}>
                  • {n}
                </Text>
              ))}
            </View>

            {result.trades.length === 0 ? (
              <EmptyState
                title="No trades fired"
                body="Rules never reached the pass threshold on this sample, or history is too short."
              />
            ) : (
              result.trades
                .slice()
                .reverse()
                .map((t, idx) => (
                  <View key={`${t.entryTime}-${idx}`} style={styles.trade}>
                    <Text style={styles.tradeTitle}>
                      {formatDate(t.entryTime)} → {formatDate(t.exitTime)} · {t.reason}
                    </Text>
                    <Text style={styles.tradeMeta}>
                      Entry {t.entry.toFixed(2)} · Exit {t.exit.toFixed(2)} · Stop {t.stop.toFixed(2)} ·
                      Target {t.target.toFixed(2)}
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
                ))
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
