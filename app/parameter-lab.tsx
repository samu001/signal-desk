import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { PROFILE_MUST } from '@/lib/backtestProfile';
import { fetchDailyCandlesResolved, isLiveCandleSource } from '@/lib/candles';
import {
  LabTicker,
  ParameterLabResult,
  ParamVerdictTone,
  runParameterLab,
} from '@/lib/parameterLab';

const DEFAULT_SYMBOLS = 'AAPL, AMZN, JPM, XOM, FANG, CFG, WSM, DDOG, CROX, DUOL, FIX, IOT, PATH, RKLB';

type SkippedTicker = { symbol: string; reason: string };

function verdictTone(tone: ParamVerdictTone): 'good' | 'warn' | 'bad' | 'neutral' {
  if (tone === 'edge') return 'good';
  if (tone === 'fragile') return 'warn';
  if (tone === 'insufficient') return 'bad';
  return 'neutral';
}

function verdictLabel(tone: ParamVerdictTone): string {
  if (tone === 'edge') return 'Robust edge';
  if (tone === 'fragile') return 'Fragile — likely luck';
  if (tone === 'insufficient') return 'Too few trades';
  return 'Flat — keep production';
}

function fmtR(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}R`;
}

export default function ParameterLabScreen() {
  const { enabledSetups, settings } = useTrading();
  const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS);
  const [days, setDays] = useState('400');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ParameterLabResult | null>(null);
  const [skipped, setSkipped] = useState<SkippedTicker[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const run = async () => {
    const symbols = [
      ...new Set(
        symbolsText
          .split(/[,\s]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
    if (!symbols.length) return;
    setLoading(true);
    setResult(null);
    setSkipped([]);
    setRanAt(null);
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
        days: Math.max(140, Math.min(Number(days) || 400, 800)),
      };

      setProgress('Fetching SPY / QQQ…');
      const [spy, qqq] = await Promise.all([
        fetchDailyCandlesResolved('SPY', keys),
        fetchDailyCandlesResolved('QQQ', keys),
      ]);

      const tickers: LabTicker[] = [];
      const skippedRows: SkippedTicker[] = [];
      for (let s = 0; s < symbols.length; s++) {
        const symbol = symbols[s];
        setProgress(`Fetching ${symbol} (${s + 1}/${symbols.length})…`);
        const bars = await fetchDailyCandlesResolved(symbol, keys);
        if (!isLiveCandleSource(bars.source) || bars.candles.length < 60) {
          skippedRows.push({
            symbol,
            reason: !isLiveCandleSource(bars.source)
              ? `No live EOD (${bars.source}) — demo bars are refused here.`
              : `Only ${bars.candles.length} bars from ${bars.source} — need ≥60.`,
          });
          continue;
        }
        tickers.push({ symbol, candles: bars.candles });
      }

      if (!tickers.length) {
        setSkipped(skippedRows);
        return;
      }

      setProgress(`Sweeping parameters across ${tickers.length} tickers…`);
      const lab = runParameterLab({
        setups: enabledSetups,
        tickers,
        spyCandles: spy.candles,
        qqqCandles: qqq.candles,
        gates: PROFILE_MUST.gates,
        costs: { slippagePct: 0.001, commissionPct: 0 },
      });
      setResult(lab);
      setSkipped(skippedRows);
      setRanAt(new Date().toLocaleTimeString());
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Parameter lab' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Parameter lab"
          subtitle="Replays the same signals with a small grid of complete exit packages (take-profit × stop policy). A setting only counts as better if it wins across tickers AND across time, not just pooled."
        />

        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>What this screen is (and isn't)</Text>
          <Text style={styles.noteItem}>
            • Research tool: it judges whether a stop/target setting is robustly better than
            production. To keep the statistics honest it pools every setup's signals — no
            same-day dedup, no stop cooldown, no max-open cap.
          </Text>
          <Text style={styles.noteItem}>
            • Totals here are deliberately larger than reality and will not match Portfolio
            backtest, which answers the other half of the question: what you actually keep
            after capacity limits and trade picking.
          </Text>
          <Text style={styles.noteItem}>
            • Workflow: if a setting earns a "Robust edge" badge here, validate it in
            Portfolio backtest → Exit tuning (same basket) before adopting it. Flat or
            fragile means keep production.
          </Text>
        </View>

        <Field
          label="Symbols (comma separated)"
          autoCapitalize="characters"
          value={symbolsText}
          onChangeText={setSymbolsText}
          multiline
        />
        <Field
          label="History (calendar days)"
          keyboardType="number-pad"
          value={days}
          onChangeText={setDays}
        />
        <Button
          label={loading ? 'Working…' : 'Run parameter lab'}
          onPress={run}
          disabled={loading}
        />
        {progress ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        ) : null}

        {!loading && !result && skipped.length > 0 ? (
          <EmptyState
            title="No live data"
            body="Every symbol was refused (no live EOD or under 60 bars). Add API keys in Settings — the lab will not run on synthetic demo bars."
          />
        ) : null}

        {result ? (
          <View style={styles.results}>
            <Text style={styles.meta}>
              {result.universe.length} tickers · {result.setupsUsed.length} playbooks · same
              entries for every setting (exits-only sweep)
              {ranAt ? ` · ran ${ranAt}` : ''}
            </Text>

            {result.knobs.map(({ knob, variants, verdict }) => {
              const sorted = [...variants].sort((a, b) => b.totalR - a.totalR);
              return (
                <View key={knob} style={styles.knobCard}>
                  <View style={styles.knobHead}>
                    <Text style={styles.knobTitle}>{verdict.headline}</Text>
                    <Pill label={verdictLabel(verdict.tone)} tone={verdictTone(verdict.tone)} />
                  </View>

                  {sorted.map((v) => {
                    const isWinner = verdict.winnerId === v.variant.id;
                    return (
                      <View
                        key={v.variant.id}
                        style={[styles.variantRow, v.variant.isProduction && styles.variantProd]}>
                        <View style={styles.variantLeft}>
                          <Text style={styles.variantLabel}>
                            {v.variant.label}
                            {isWinner && sorted.length > 1 ? ' ★' : ''}
                          </Text>
                          <Text style={styles.variantSub}>
                            {v.trades} trades
                            {v.winRate != null ? ` · ${(v.winRate * 100).toFixed(0)}% win` : ''}
                            {v.avgR != null ? ` · ${fmtR(v.avgR)} avg` : ''}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.variantR,
                            v.totalR > 0 ? styles.pos : v.totalR < 0 ? styles.neg : null,
                          ]}>
                          {fmtR(v.totalR)}
                        </Text>
                      </View>
                    );
                  })}

                  {verdict.bullets.map((bullet) => (
                    <Text key={bullet} style={styles.bullet}>
                      → {bullet}
                    </Text>
                  ))}
                </View>
              );
            })}

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
              How to read this: a ★ winner with a "fragile" badge means the pooled edge flips
              sign depending on which tickers or which half of history you look at — treat it
              as luck, not an improvement. Only a "robust edge" badge is worth considering, and
              even then confirm on out-of-sample data before changing production levels.
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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: { color: palette.muted, fontSize: 13 },
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
  results: { gap: spacing.md, marginTop: spacing.sm },
  meta: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  knobCard: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.md,
    gap: 8,
  },
  knobHead: { gap: 6 },
  knobTitle: { fontSize: 15, fontWeight: '700', color: palette.ink, lineHeight: 21 },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  variantProd: { backgroundColor: palette.paper },
  variantLeft: { gap: 2, flexShrink: 1 },
  variantLabel: { fontSize: 14, fontWeight: '600', color: palette.ink },
  variantSub: { fontSize: 12, color: palette.muted },
  variantR: { fontSize: 15, fontWeight: '700', color: palette.ink },
  pos: { color: palette.moss },
  neg: { color: palette.danger },
  bullet: { fontSize: 12.5, color: palette.muted, lineHeight: 18 },
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
