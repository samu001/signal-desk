import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  FactorList,
  GatePanel,
  RsMeter,
  ScoreBar,
  ScoreDial,
  ZoneStrip,
  stanceTone,
} from '@/components/DeskScorecard';
import { SetupOptionCard } from '@/components/SetupOptionCard';
import { Button, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fetchRecommendationsWithBundle } from '@/lib/fetchRecommendation';
import { userFacingDeskWarnings } from '@/lib/deskWarnings';
import { Recommendation, SetupOption } from '@/lib/recommend';

function formatCap(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return formatMoney(n);
}

function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export default function DeskDetailScreen() {
  const { symbol: rawSymbol, watchlistId } = useLocalSearchParams<{
    symbol?: string;
    watchlistId?: string;
  }>();
  const symbol = (rawSymbol ?? '').toUpperCase().trim();
  const router = useRouter();
  const {
    settings,
    enabledSetups,
    trades,
    marketBundle,
    quotesUpdatedAt,
    ingestMarketBundle,
    applyDeskSignals,
    upsertWatchlistItem,
    watchlist,
  } = useTrading();

  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol) {
      setError('Missing ticker symbol.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { recommendations, bundle, reusedMarket } = await fetchRecommendationsWithBundle(
        [symbol],
        settings,
        {
          setups: enabledSetups,
          trades,
          market: marketBundle,
          marketFetchedAt: quotesUpdatedAt,
        }
      );
      const next = recommendations[0];
      if (!next) throw new Error('Could not build Desk research.');
      if (!reusedMarket) ingestMarketBundle(bundle);
      applyDeskSignals([next]);
      setRec(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Desk research.');
      setRec(null);
    } finally {
      setLoading(false);
    }
  }, [
    symbol,
    settings,
    enabledSetups,
    trades,
    marketBundle,
    quotesUpdatedAt,
    ingestMarketBundle,
    applyDeskSignals,
  ]);

  useEffect(() => {
    void load();
  }, [symbol]);

  const wlItem =
    (watchlistId ? watchlist.find((w) => w.id === watchlistId) : null) ??
    watchlist.find((w) => w.symbol.toUpperCase() === symbol);

  const useSetup = (option: SetupOption) => {
    if (!wlItem || !rec) return;
    upsertWatchlistItem({
      id: wlItem.id,
      symbol: wlItem.symbol,
      thesis: wlItem.thesis,
      entryLow: option.levels.entryLow,
      entryHigh: option.levels.entryHigh,
      stop: option.levels.stop,
      target: option.levels.target,
      setupId: option.setupId,
      notes: wlItem.notes,
      deskTradeable: rec.tradeable,
    });
    if (rec.tradeable) {
      router.push({ pathname: '/trade-plan', params: { watchlistId: wlItem.id } });
    }
  };

  if (!symbol) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: 'Desk' }} />
        <Text style={styles.errorText}>No symbol provided.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const deskWarnings = rec ? userFacingDeskWarnings(rec) : [];

  return (
    <Screen>
      <Stack.Screen options={{ title: `${symbol} Desk` }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading && !rec ? (
          <View style={styles.centeredPad}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>Building Desk scorecard…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Retry" onPress={() => void load()} />
          </View>
        ) : null}

        {rec ? (
          <>
            <View style={styles.hero}>
              <View>
                <Text style={styles.symbol}>{rec.symbol}</Text>
                <Text style={styles.price}>{formatMoney(rec.price)}</Text>
                {rec.fundamentals?.name ? (
                  <Text style={styles.company}>{rec.fundamentals.name}</Text>
                ) : null}
              </View>
              <View style={styles.badges}>
                <Pill label={rec.label} tone={stanceTone(rec.stance)} />
                <Pill
                  label={
                    rec.tradeable
                      ? 'Tradeable Soft/Strong'
                      : rec.researchInteresting
                        ? 'Research only'
                        : 'Stand aside'
                  }
                  tone={
                    rec.tradeable ? 'good' : rec.researchInteresting ? 'warn' : 'neutral'
                  }
                />
              </View>
            </View>

            <Text style={styles.summary}>{rec.summary}</Text>
            <Text style={styles.metaLine}>
              Confidence {rec.confidence}% · candle {rec.candleSource} · quote {rec.quoteSource}
            </Text>

            {deskWarnings.length ? (
              <View style={styles.warnBox}>
                {deskWarnings.map((w) => (
                  <Text key={w} style={styles.warnText}>
                    {w}
                  </Text>
                ))}
              </View>
            ) : null}

            {rec.candleSource === 'none' || rec.label === 'No data' ? (
              <Text style={styles.demoWarn}>
                No live EOD — Desk will not score Soft/Strong. Fix API keys / Yahoo proxy in
                Settings, then retry.
              </Text>
            ) : (
              <>
                <SectionTitle
                  title="Scorecard"
                  subtitle="Overall blends technicals, company, and news. Tick marks on bars are Soft/Strong thresholds."
                />
                <View style={styles.scoreRow}>
                  <ScoreDial score={rec.overallScore} label="Overall" />
                  <View style={styles.scoreBars}>
                    <ScoreBar label="Technical" score={rec.technicalScore} threshold={45} />
                    <ScoreBar label="Company" score={rec.fundamentalScore} threshold={55} />
                    <ScoreBar label="News" score={rec.newsScore} threshold={60} />
                  </View>
                </View>

                <SectionTitle
                  title="Soft / Strong gates"
                  subtitle="Desk only issues Soft or Strong when every gate in that column is met (plus liquidity / market / earnings checks)."
                />
                <GatePanel recommendation={rec} />

                <SectionTitle
                  title="Factors"
                  subtitle="Pass / fail checklist behind the stance."
                />
                <FactorList factors={rec.factors} />

                {rec.reasons.length ? (
                  <>
                    <SectionTitle title="Desk notes" />
                    <View style={styles.reasonsBox}>
                      {rec.reasons.map((r) => (
                        <Text
                          key={r.text}
                          style={[
                            styles.reason,
                            r.tone === 'good' && styles.reasonGood,
                            r.tone === 'bad' && styles.reasonBad,
                            r.tone === 'warn' && styles.reasonWarn,
                          ]}>
                          {r.text}
                        </Text>
                      ))}
                    </View>
                  </>
                ) : null}

                <SectionTitle title="Levels & relative strength" />
                {rec.bestSetupName ? (
                  <View style={styles.levelsBanner}>
                    <Text style={styles.levelsBannerTitle}>
                      Primary · {rec.bestSetupName}
                      {rec.rewardToRisk != null ? ` · ~${rec.rewardToRisk.toFixed(1)}R` : ''}
                    </Text>
                    <Text style={styles.levelsBannerBody}>
                      Buy {formatMoney(rec.levels.entryLow)}–{formatMoney(rec.levels.entryHigh)} ·
                      Stop {formatMoney(rec.levels.stop)} · Target {formatMoney(rec.levels.target)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.setupWarn}>
                    No Playbook setup matched — levels below are structural reference only, not a
                    trade signal.
                  </Text>
                )}
                <ZoneStrip recommendation={rec} />
                <View style={styles.meterRow}>
                  <View style={styles.meterFlex}>
                    <RsMeter value={rec.relativeStrength20d} />
                  </View>
                  <View style={styles.volCard}>
                    <Text style={styles.volEyebrow}>20d $ volume</Text>
                    <Text style={styles.volValue}>
                      {rec.dollarVolume20d != null
                        ? formatCap(rec.dollarVolume20d)
                        : '—'}
                    </Text>
                    {rec.earnings ? (
                      <Text
                        style={[
                          styles.earningsNote,
                          rec.earnings.blocked && styles.earningsBlocked,
                        ]}>
                        Earnings {rec.earnings.date}
                        {rec.earnings.blocked ? ' · blackout' : ` · ~${rec.earnings.daysUntil}d`}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <SectionTitle
                  title={`Playbook signals (${rec.setupOptions.length})`}
                  subtitle="Matched setups, strongest first. Each has its own buy / stop / target."
                />
                {rec.setupOptions.length === 0 ? (
                  <Text style={styles.setupWarn}>No setups currently pass machine checks.</Text>
                ) : (
                  rec.setupOptions.map((option) => (
                    <View key={option.setupId} style={styles.optionWrap}>
                      <SetupOptionCard option={option} />
                      {wlItem ? (
                        <Button
                          label={
                            rec.tradeable
                              ? `Use #${option.rank} levels & act →`
                              : `Use #${option.rank} levels (research only)`
                          }
                          onPress={() => useSetup(option)}
                          variant={option.rank === 1 && rec.tradeable ? 'primary' : 'ghost'}
                        />
                      ) : null}
                    </View>
                  ))
                )}

                {rec.fundamentals ? (
                  <>
                    <SectionTitle title="Company snapshot" />
                    <View style={styles.fundGrid}>
                      <FundCell label="Sector" value={rec.fundamentals.sector ?? '—'} />
                      <FundCell label="Industry" value={rec.fundamentals.industry ?? '—'} />
                      <FundCell label="Mkt cap" value={formatCap(rec.fundamentals.marketCap)} />
                      <FundCell
                        label="P/E"
                        value={
                          rec.fundamentals.pe != null ? rec.fundamentals.pe.toFixed(1) : '—'
                        }
                      />
                      <FundCell
                        label="P/B"
                        value={
                          rec.fundamentals.pb != null ? rec.fundamentals.pb.toFixed(1) : '—'
                        }
                      />
                      <FundCell label="ROE" value={formatPct(rec.fundamentals.roe)} />
                      <FundCell
                        label="Profit margin"
                        value={formatPct(rec.fundamentals.profitMargin)}
                      />
                      <FundCell
                        label="Rev growth"
                        value={formatPct(rec.fundamentals.revenueGrowth)}
                      />
                    </View>
                  </>
                ) : null}

                {rec.news.length ? (
                  <>
                    <SectionTitle title="Recent headlines" />
                    <View style={styles.newsList}>
                      {rec.news.map((n) => (
                        <Pressable
                          key={n.id}
                          style={styles.newsRow}
                          onPress={() => {
                            if (n.url) void Linking.openURL(n.url);
                          }}
                          disabled={!n.url}>
                          <Text style={styles.newsHeadline}>{n.headline}</Text>
                          <Text style={styles.newsMeta}>
                            {n.source}
                            {n.datetime
                              ? ` · ${new Date(n.datetime * 1000).toLocaleDateString()}`
                              : ''}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            )}

            <View style={styles.links}>
              <Link
                href={`/desk-backtest?symbol=${encodeURIComponent(rec.symbol)}`}
                asChild>
                <Pressable>
                  <Text style={styles.linkText}>Backtest Desk on {rec.symbol} →</Text>
                </Pressable>
              </Link>
              <Link href="/lab" asChild>
                <Pressable>
                  <Text style={styles.linkText}>Open Lab →</Text>
                </Pressable>
              </Link>
              <Button label="Refresh scorecard" variant="ghost" onPress={() => void load()} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function FundCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fundCell}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={styles.fundValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 12, padding: spacing.lg },
  centeredPad: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: palette.muted },
  errorBox: { gap: 10 },
  errorText: { color: palette.danger, fontWeight: '600' },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  symbol: { fontFamily: 'SpaceMono', fontSize: 28, color: palette.ink, fontWeight: '700' },
  price: { fontFamily: 'SpaceMono', fontSize: 16, color: palette.muted, marginTop: 2 },
  company: { color: palette.ink, marginTop: 4, fontSize: 14 },
  badges: { gap: 6, alignItems: 'flex-end' },
  summary: { color: palette.ink, lineHeight: 22, fontSize: 15 },
  metaLine: { color: palette.muted, fontSize: 12, marginTop: -8 },
  warnBox: {
    backgroundColor: palette.warnSoft,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  warnText: { color: palette.warn, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  demoWarn: { color: palette.warn, fontWeight: '600', lineHeight: 20 },
  scoreRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    backgroundColor: palette.white,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  scoreBars: { flex: 1, gap: 10 },
  reasonsBox: {
    backgroundColor: palette.white,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: palette.line,
  },
  reason: { color: palette.ink, fontSize: 13, lineHeight: 19 },
  reasonGood: { color: palette.moss },
  reasonBad: { color: palette.danger },
  reasonWarn: { color: palette.warn },
  levelsBanner: {
    backgroundColor: palette.mossSoft,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  levelsBannerTitle: { fontWeight: '700', color: palette.moss },
  levelsBannerBody: { fontFamily: 'SpaceMono', fontSize: 12, color: palette.ink },
  setupWarn: { color: palette.warn, fontWeight: '600', lineHeight: 19 },
  meterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meterFlex: { flexGrow: 1, flexBasis: '55%', minWidth: 180 },
  volCard: {
    flexGrow: 1,
    flexBasis: '35%',
    minWidth: 120,
    backgroundColor: palette.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 6,
    justifyContent: 'center',
  },
  volEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  volValue: { fontFamily: 'SpaceMono', fontSize: 20, fontWeight: '700', color: palette.ink },
  earningsNote: { fontSize: 12, color: palette.muted },
  earningsBlocked: { color: palette.danger, fontWeight: '700' },
  optionWrap: { gap: 8 },
  fundGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fundCell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: palette.white,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 2,
  },
  fundLabel: { fontSize: 11, color: palette.muted, fontWeight: '600', textTransform: 'uppercase' },
  fundValue: { fontSize: 14, color: palette.ink, fontWeight: '600' },
  newsList: { gap: 8 },
  newsRow: {
    backgroundColor: palette.white,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
  },
  newsHeadline: { color: palette.ink, fontWeight: '600', lineHeight: 20 },
  newsMeta: { color: palette.muted, fontSize: 12 },
  links: { gap: 12, marginTop: spacing.sm },
  linkText: { color: palette.moss, fontWeight: '700', fontSize: 14 },
});
