import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fetchDailyCandlesResolved } from '@/lib/candles';
import { DeskBacktestResult, runDeskBacktest } from '@/lib/deskBacktest';
import { Stance } from '@/lib/recommend';

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString();
}

function stanceLabel(stance: Stance) {
  switch (stance) {
    case 'strong_buy':
      return 'Strong buy';
    case 'soft_buy':
      return 'Soft buy';
    case 'avoid':
      return 'Avoid';
    default:
      return 'Wait';
  }
}

function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

export default function DeskBacktestScreen() {
  const { symbol: symbolParam } = useLocalSearchParams<{ symbol?: string }>();
  const { settings, candles } = useTrading();
  const [symbol, setSymbol] = useState((symbolParam || 'AAPL').toUpperCase());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeskBacktestResult | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const upper = symbol.toUpperCase().trim() || 'AAPL';
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
      const useSymbol = symbolBars.candles.length ? symbolBars.candles : candles[upper] ?? [];
      const useSpy = spyBars.candles.length ? spyBars.candles : candles.SPY ?? [];
      const next = runDeskBacktest({
        symbol: upper,
        candles: useSymbol,
        spyCandles: useSpy,
        sourceLabel: symbolBars.source,
        warnings: symbolBars.warnings,
        evalBars: 30,
      });
      setResult(next);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Desk backtest' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Desk signal backtest"
          subtitle="Replays Soft/Strong buy over the last ~30 trading days using technicals + levels. Company/news are neutralized historically."
        />

        <Field
          label="Symbol"
          autoCapitalize="characters"
          autoCorrect={false}
          value={symbol}
          onChangeText={(t) => setSymbol(t.toUpperCase())}
        />

        <Button label={loading ? 'Running…' : 'Run Desk backtest'} onPress={() => void run()} disabled={loading} />

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={palette.moss} />
          </View>
        ) : null}

        {result ? (
          <View style={styles.results}>
            <View style={styles.summaryRow}>
              <Text style={styles.symbol}>{result.symbol}</Text>
              <Pill label={`Source: ${result.sourceLabel}`} />
            </View>

            <View style={styles.statGrid}>
              <Stat label="Trades" value={String(result.trades.length)} />
              <Stat
                label="Win rate"
                value={result.winRate == null ? '—' : `${(result.winRate * 100).toFixed(0)}%`}
              />
              <Stat label="Avg R" value={result.avgR == null ? '—' : result.avgR.toFixed(2)} />
              <Stat
                label="Max DD R"
                value={result.maxDrawdownR == null ? '—' : result.maxDrawdownR.toFixed(2)}
              />
            </View>

            <Text style={styles.blockTitle}>Daily stance counts (eval window)</Text>
            <View style={styles.signalRow}>
              {(Object.keys(result.signals) as Stance[]).map((stance) => (
                <View key={stance} style={styles.signalChip}>
                  <Pill label={stanceLabel(stance)} tone={stanceTone(stance)} />
                  <Text style={styles.signalCount}>{result.signals[stance]}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.blockTitle}>Results by entry stance</Text>
            {result.byStance.filter((row) => row.trades > 0).length ? (
              result.byStance
                .filter((row) => row.trades > 0)
                .map((row) => (
                  <View key={row.stance} style={styles.stanceRow}>
                    <Pill label={stanceLabel(row.stance)} tone={stanceTone(row.stance)} />
                    <Text style={styles.stanceMeta}>
                      {row.trades} trades · win{' '}
                      {row.winRate == null ? '—' : `${(row.winRate * 100).toFixed(0)}%`} · avg R{' '}
                      {row.avgR == null ? '—' : row.avgR.toFixed(2)}
                    </Text>
                  </View>
                ))
            ) : (
              <EmptyState
                title="No Soft/Strong entries"
                body="In this window Desk stayed mostly Wait/Avoid, or never got near an entry zone."
              />
            )}

            <Text style={styles.blockTitle}>Trades</Text>
            {result.trades.length ? (
              result.trades.map((t, i) => (
                <View key={`${t.entryTime}-${i}`} style={styles.tradeRow}>
                  <View style={styles.tradeTop}>
                    <Pill label={stanceLabel(t.stance)} tone={stanceTone(t.stance)} />
                    <Text style={styles.tradeR}>
                      {t.rMultiple >= 0 ? '+' : ''}
                      {t.rMultiple.toFixed(2)}R · {t.reason}
                    </Text>
                  </View>
                  <Text style={styles.tradeDates}>
                    {formatDate(t.entryTime)} → {formatDate(t.exitTime)}
                  </Text>
                  <Text style={styles.tradePx}>
                    entry {t.entry.toFixed(2)} · exit {t.exit.toFixed(2)} · stop {t.stop.toFixed(2)} ·
                    target {t.target.toFixed(2)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>No completed Desk trades in this window.</Text>
            )}

            <Text style={styles.blockTitle}>Notes</Text>
            {result.notes.map((n) => (
              <Text key={n} style={styles.note}>
                • {n}
              </Text>
            ))}
            {result.warnings.slice(0, 5).map((w) => (
              <Text key={w} style={styles.warn}>
                • {w}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: 48,
  },
  centered: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  results: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 28,
    color: palette.ink,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stat: {
    width: '47%',
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: 12,
  },
  statLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: 'SpaceMono',
    fontSize: 20,
    color: palette.ink,
    marginTop: 4,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
    marginTop: 4,
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  signalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signalCount: {
    fontFamily: 'SpaceMono',
    color: palette.ink,
  },
  stanceRow: {
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  stanceMeta: {
    color: palette.muted,
  },
  tradeRow: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  tradeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  tradeR: {
    fontFamily: 'SpaceMono',
    color: palette.ink,
    fontSize: 13,
  },
  tradeDates: {
    color: palette.ink,
    fontWeight: '600',
  },
  tradePx: {
    color: palette.muted,
    fontSize: 13,
  },
  muted: {
    color: palette.muted,
  },
  note: {
    color: palette.muted,
    lineHeight: 20,
  },
  warn: {
    color: palette.warn,
    lineHeight: 20,
  },
});
