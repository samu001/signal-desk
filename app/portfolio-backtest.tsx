import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { PROFILE_MUST } from '@/lib/backtestProfile';
import { fetchDailyCandlesResolved } from '@/lib/candles';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';

const DEFAULT_SYMBOLS = 'AAPL, AMZN, JPM, XOM, FANG, CFG, WSM, DDOG, CROX, DUOL, FIX, IOT, PATH, RKLB';

type SymbolRow = {
  symbol: string;
  source: string;
  bars: number;
  trades: number;
  winRate: number | null;
  totalR: number;
};

type PortfolioTrade = { symbol: string; entryTime: number; exitTime: number; r: number };

type PortfolioSummary = {
  rows: SymbolRow[];
  all: { trades: number; winRate: number | null; totalR: number };
  capped: { trades: number; skipped: number; winRate: number | null; totalR: number };
  concurrency: { max: number; median: number; avg: number; overCapPct: number };
  maxOpen: number;
  warnings: string[];
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function simulate(allTrades: PortfolioTrade[], maxOpen: number) {
  const sorted = [...allTrades].sort((a, b) => a.entryTime - b.entryTime);
  const taken: PortfolioTrade[] = [];
  let skipped = 0;
  for (const t of sorted) {
    const openNow = taken.filter((o) => o.exitTime > t.entryTime).length;
    if (openNow >= maxOpen) {
      skipped += 1;
      continue;
    }
    taken.push(t);
  }
  const wins = taken.filter((t) => t.r > 0).length;
  return {
    trades: taken.length,
    skipped,
    winRate: taken.length ? wins / taken.length : null,
    totalR: taken.reduce((a, t) => a + t.r, 0),
  };
}

function concurrencyStats(allTrades: PortfolioTrade[], maxOpen: number) {
  if (!allTrades.length) return { max: 0, median: 0, avg: 0, overCapPct: 0 };
  const DAY = 86400;
  const minT = Math.min(...allTrades.map((t) => t.entryTime));
  const maxT = Math.max(...allTrades.map((t) => t.exitTime));
  const counts: number[] = [];
  for (let d = minT; d <= maxT; d += DAY) {
    counts.push(allTrades.filter((t) => t.entryTime <= d && t.exitTime > d).length);
  }
  const active = counts.filter((c) => c > 0);
  return {
    max: Math.max(0, ...counts),
    median: median(active),
    avg: active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0,
    overCapPct: active.length ? active.filter((c) => c > maxOpen).length / active.length : 0,
  };
}

export default function PortfolioBacktestScreen() {
  const { settings, setups, updateSettings } = useTrading();
  const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS);
  const [days, setDays] = useState('400');
  const [maxOpen, setMaxOpen] = useState('3');
  const [accountSize, setAccountSize] = useState(String(settings.accountSize));
  const [riskPercent, setRiskPercent] = useState(String(settings.riskPercent));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);

  const run = async () => {
    setLoading(true);
    setSummary(null);
    try {
      // Persist account inputs so the rest of the app sizes positions the same way.
      const acct = Number(accountSize) > 0 ? Number(accountSize) : settings.accountSize;
      const riskPct = Number(riskPercent) > 0 ? Number(riskPercent) : settings.riskPercent;
      updateSettings({ accountSize: acct, riskPercent: riskPct });

      const cap = Math.max(1, Math.round(Number(maxOpen) || 3));
      const symbols = [
        ...new Set(
          symbolsText
            .split(/[,\s]+/)
            .map((s) => s.toUpperCase().trim())
            .filter(Boolean)
        ),
      ];
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        days: Math.max(140, Math.min(Number(days) || 400, 800)),
      };
      const warnings: string[] = [];

      setProgress('Fetching SPY / QQQ…');
      const spy = await fetchDailyCandlesResolved('SPY', keys);
      const qqq = await fetchDailyCandlesResolved('QQQ', keys);
      for (const w of [...spy.warnings, ...qqq.warnings]) {
        if (!warnings.includes(w)) warnings.push(w);
      }

      const rows: SymbolRow[] = [];
      const allTrades: PortfolioTrade[] = [];
      // 10 bps flat slippage: between megacap (5) and small-cap (20) script tiers.
      const costs = { slippagePct: 0.001, commissionPct: 0 };

      for (const symbol of symbols) {
        setProgress(`Backtesting ${symbol} (${rows.length + 1}/${symbols.length})…`);
        const bars = await fetchDailyCandlesResolved(symbol, keys);
        for (const w of bars.warnings) {
          if (!warnings.includes(w)) warnings.push(w);
        }
        if (bars.candles.length < 60) {
          rows.push({
            symbol,
            source: bars.source,
            bars: bars.candles.length,
            trades: 0,
            winRate: null,
            totalR: 0,
          });
          continue;
        }
        const combined = runCombinedPlaybookBacktest({
          symbol,
          setups,
          candles: bars.candles,
          spyCandles: spy.candles,
          qqqCandles: qqq.candles,
          sourceLabel: bars.source,
          profile: { ...PROFILE_MUST, costs },
        });
        for (const t of combined.trades) {
          allTrades.push({ symbol, entryTime: t.entryTime, exitTime: t.exitTime, r: t.rMultiple });
        }
        rows.push({
          symbol,
          source: bars.source,
          bars: bars.candles.length,
          trades: combined.trades.length,
          winRate: combined.winRate,
          totalR: combined.totalR ?? 0,
        });
      }

      const wins = allTrades.filter((t) => t.r > 0).length;
      setSummary({
        rows,
        all: {
          trades: allTrades.length,
          winRate: allTrades.length ? wins / allTrades.length : null,
          totalR: allTrades.reduce((a, t) => a + t.r, 0),
        },
        capped: simulate(allTrades, cap),
        concurrency: concurrencyStats(allTrades, cap),
        maxOpen: cap,
        warnings,
      });
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const riskPerTrade =
    (Number(accountSize) || settings.accountSize) *
    ((Number(riskPercent) || settings.riskPercent) / 100);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Portfolio backtest' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Portfolio backtest"
          subtitle="Runs the combined Playbook across a symbol list with gap-aware fills, then simulates a max-open-positions capital cap. R is converted to dollars using your account settings."
        />

        <Field
          label="Symbols (comma separated)"
          autoCapitalize="characters"
          value={symbolsText}
          onChangeText={setSymbolsText}
          multiline
        />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Field
              label="History (calendar days)"
              keyboardType="number-pad"
              value={days}
              onChangeText={setDays}
            />
          </View>
          <View style={styles.rowItem}>
            <Field
              label="Max open positions"
              keyboardType="number-pad"
              value={maxOpen}
              onChangeText={setMaxOpen}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Field
              label="Account size ($)"
              keyboardType="decimal-pad"
              value={accountSize}
              onChangeText={setAccountSize}
            />
          </View>
          <View style={styles.rowItem}>
            <Field
              label="Risk per trade (%)"
              keyboardType="decimal-pad"
              value={riskPercent}
              onChangeText={setRiskPercent}
            />
          </View>
        </View>
        <Text style={styles.riskNote}>
          1R = ${riskPerTrade.toFixed(0)} per trade at these settings (saved to Settings on run).
        </Text>

        <Button label={loading ? 'Running…' : 'Run portfolio backtest'} onPress={run} disabled={loading} />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>{progress || 'Working…'}</Text>
          </View>
        ) : null}

        {summary ? (
          <View style={styles.results}>
            <SectionTitle title="Portfolio" />
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>All signals</Text>
                <Text style={styles.statValue}>
                  {summary.all.totalR >= 0 ? '+' : ''}
                  {summary.all.totalR.toFixed(1)}R
                </Text>
                <Text style={styles.statSub}>
                  {summary.all.trades} trades ·{' '}
                  {summary.all.winRate == null ? '—' : `${Math.round(summary.all.winRate * 100)}%`} win
                </Text>
              </View>
              <View style={[styles.stat, styles.statPrimary]}>
                <Text style={styles.statLabel}>Max {summary.maxOpen} open (realistic)</Text>
                <Text style={styles.statValue}>
                  {summary.capped.totalR >= 0 ? '+' : ''}
                  {summary.capped.totalR.toFixed(1)}R
                </Text>
                <Text style={styles.statSub}>
                  ≈ ${(summary.capped.totalR * riskPerTrade).toFixed(0)} · {summary.capped.trades} taken ·{' '}
                  {summary.capped.skipped} skipped
                </Text>
              </View>
            </View>

            <View style={styles.noteBox}>
              <Text style={styles.noteItem}>
                • Concurrency without the cap: median {summary.concurrency.median} open, peak{' '}
                {summary.concurrency.max}, above your cap on{' '}
                {Math.round(summary.concurrency.overCapPct * 100)}% of active days.
              </Text>
              <Text style={styles.noteItem}>
                • Dollar figures assume 1R = ${riskPerTrade.toFixed(0)} (account ×  risk %). The capped
                number is the realistic one.
              </Text>
            </View>

            {summary.warnings.length ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>Data / API notes</Text>
                {summary.warnings.slice(0, 6).map((w) => (
                  <Text key={w} style={styles.warnItem}>
                    • {w}
                  </Text>
                ))}
              </View>
            ) : null}

            <SectionTitle title="Per symbol" />
            {summary.rows.length === 0 ? (
              <EmptyState title="No symbols" body="Add tickers above and run again." />
            ) : (
              summary.rows.map((row) => (
                <View key={row.symbol} style={styles.symbolRow}>
                  <View style={styles.symbolHead}>
                    <Text style={styles.symbolName}>{row.symbol}</Text>
                    <Pill label={row.source} tone={row.source === 'demo' ? 'warn' : 'good'} />
                  </View>
                  {row.bars < 60 ? (
                    <Text style={styles.symbolMeta}>Insufficient history ({row.bars} bars) — skipped.</Text>
                  ) : (
                    <Text style={styles.symbolMeta}>
                      {row.bars} bars · {row.trades} trades ·{' '}
                      {row.winRate == null ? '—' : `${Math.round(row.winRate * 100)}%`} win ·{' '}
                      <Text
                        style={{
                          color: row.totalR >= 0 ? palette.leaf : palette.danger,
                          fontWeight: '700',
                        }}>
                        {row.totalR >= 0 ? '+' : ''}
                        {row.totalR.toFixed(1)}R
                      </Text>
                    </Text>
                  )}
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
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  riskNote: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
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
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: palette.sand,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  statPrimary: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  statLabel: { color: palette.muted, fontSize: 12, marginBottom: 4 },
  statValue: { fontFamily: 'SpaceMono', fontSize: 20, color: palette.ink },
  statSub: { color: palette.muted, fontSize: 11, marginTop: 4 },
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
  symbolRow: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  symbolHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbolName: { fontWeight: '700', color: palette.ink, fontSize: 15 },
  symbolMeta: { color: palette.muted, fontSize: 13 },
});
