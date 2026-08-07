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
import { fetchDailyCandlesResolved, isLiveCandleSource } from '@/lib/candles';
import { DeskBacktestResult, runDeskBacktest } from '@/lib/deskBacktest';
import { fetchEarningsDates } from '@/lib/finnhub';
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
  const { settings, enabledSetups } = useTrading();
  const [symbol, setSymbol] = useState((symbolParam || 'AAPL').toUpperCase());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeskBacktestResult | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const upper = symbol.toUpperCase().trim() || 'AAPL';
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        tiingoProxyUrl: settings.tiingoProxyUrl || undefined,
        tiingoProxyToken: settings.tiingoProxyToken || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        yahooProxyUrl: settings.yahooProxyUrl || undefined,
        yahooProxyToken: settings.yahooProxyToken || undefined,
        days: 140,
      };
      const [symbolBars, spyBars, qqqBars] = await Promise.all([
        fetchDailyCandlesResolved(upper, keys),
        fetchDailyCandlesResolved('SPY', keys),
        fetchDailyCandlesResolved('QQQ', keys),
      ]);
      const useSymbol = symbolBars.candles;
      const useSpy = spyBars.candles;
      const useQqq = qqqBars.candles;

      if (!isLiveCandleSource(symbolBars.source) || useSymbol.length < 60) {
        setResult({
          symbol: upper,
          sourceLabel: symbolBars.source,
          warnings: [
            ...symbolBars.warnings,
            'No data — live EOD unavailable. Desk backtest will not run on synthetic bars.',
          ],
          notes: ['No data — refused to backtest without live daily history.'],
          barsUsed: useSymbol.length,
          warmupBars: 55,
          evalBars: 30,
          signals: { strong_buy: 0, soft_buy: 0, wait: 0, avoid: 0 },
          trades: [],
          winRate: null,
          avgR: null,
          expectancyR: null,
          maxDrawdownR: null,
          byStance: [],
        });
        return;
      }

      const first = useSymbol[0]?.time;
      const last = useSymbol[useSymbol.length - 1]?.time;
      const from = first
        ? new Date(first * 1000).toISOString().slice(0, 10)
        : new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      const to = last
        ? new Date(last * 1000 + 2 * 86400000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const earnings = await fetchEarningsDates(
        upper,
        settings.finnhubApiKey || undefined,
        from,
        to,
        settings.fmpApiKey || undefined,
        settings.alphaVantageApiKey || undefined,
        settings.yahooProxyUrl?.trim()
          ? { url: settings.yahooProxyUrl, token: settings.yahooProxyToken || undefined }
          : undefined
      );
      const next = runDeskBacktest({
        symbol: upper,
        candles: useSymbol,
        spyCandles: useSpy,
        qqqCandles: useQqq,
        earningsDates: earnings.dates,
        sourceLabel: symbolBars.source,
        warnings: [
          ...symbolBars.warnings,
          ...(earnings.status !== 'ok' ? [earnings.detail] : []),
        ],
        evalBars: 30,
        setups: enabledSetups,
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
          subtitle="Replays Soft/Strong buy over the last ~30 trading days. Buys still need Playbook confirmation. Company/news are neutralized historically."
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
              <Pill
                label={`Source: ${result.sourceLabel}`}
                tone={
                  result.sourceLabel === 'demo' || result.sourceLabel === 'none'
                    ? 'warn'
                    : 'neutral'
                }
              />
            </View>

            {result.sourceLabel === 'demo' || result.sourceLabel === 'none' ? (
              <View style={styles.demoBox}>
                <Text style={styles.demoTitle}>No data — backtest not run</Text>
                <Text style={styles.demoBody}>
                  Live EOD was unavailable for this symbol. Synthetic demo bars are disabled.
                  Fix your data keys / Yahoo proxy in Settings and re-run.
                </Text>
              </View>
            ) : null}

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
  demoBox: {
    backgroundColor: palette.warnSoft,
    borderWidth: 1,
    borderColor: palette.warn,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  demoTitle: { fontWeight: '700', color: palette.warn },
  demoBody: { color: palette.ink, lineHeight: 18, fontSize: 13 },
});
