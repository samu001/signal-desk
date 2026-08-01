import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandMark, Button, formatMoney, Pill, Screen } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fetchRecommendation } from '@/lib/fetchRecommendation';
import { Recommendation, Stance } from '@/lib/recommend';

const QUICK = ['AAPL', 'NVDA', 'MSFT'];

function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

function ScoreMeter({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterValue}>{value}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.max(4, Math.min(100, value))}%` }]} />
      </View>
    </View>
  );
}

function Sparkline({ recommendation }: { recommendation: Recommendation }) {
  // Lightweight placeholder bars from score pillars — keeps the desk visual without chart deps.
  const bars = [
    recommendation.technicalScore,
    recommendation.fundamentalScore,
    recommendation.newsScore,
    recommendation.overallScore,
  ];
  return (
    <View style={styles.spark}>
      {bars.map((v, i) => (
        <View key={i} style={styles.sparkCol}>
          <View style={[styles.sparkBar, { height: 18 + (v / 100) * 54 }]} />
        </View>
      ))}
      <View style={styles.sparkLegend}>
        <Text style={styles.sparkLegendText}>Tech</Text>
        <Text style={styles.sparkLegendText}>Co.</Text>
        <Text style={styles.sparkLegendText}>News</Text>
        <Text style={styles.sparkLegendText}>All</Text>
      </View>
    </View>
  );
}

export default function DeskScreen() {
  const { ready, settings } = useTrading();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [symbol, setSymbol] = useState('AAPL');
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(nextSymbol?: string) {
    const ticker = (nextSymbol ?? symbol).toUpperCase().trim();
    if (!ticker) {
      setError('Enter a stock ticker first.');
      return;
    }
    setSymbol(ticker);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRecommendation(ticker, settings);
      setRecommendation(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build a recommendation.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    void run('AAPL');
    // Initial demo load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={palette.moss} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.content, wide && styles.contentWide]}>
        <View style={styles.topBar}>
          <BrandMark />
          <Link href="/settings" asChild>
            <Pressable hitSlop={12} style={styles.settingsBtn}>
              <FontAwesome name="cog" size={20} color={palette.ink} />
              <Text style={styles.settingsText}>API keys</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.heroPanel}>
          <Text style={styles.heroEyebrow}>Signal Desk</Text>
          <Text style={styles.heroTitle}>Stock signal dashboard</Text>
          <Text style={styles.heroBody}>
            Type a ticker. Get a Soft buy / Strong buy stance with an entry zone, stop, and target —
            using history, company basics, news, and technical checks. Demo data fills gaps until API
            keys are added.
          </Text>

          <View style={[styles.searchRow, wide && styles.searchRowWide]}>
            <TextInput
              value={symbol}
              onChangeText={(t) => setSymbol(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Ticker e.g. AAPL"
              placeholderTextColor={palette.muted}
              style={styles.searchInput}
              onSubmitEditing={() => void run()}
            />
            <Button label={loading ? 'Reading…' : 'Get signal'} onPress={() => void run()} disabled={loading} />
          </View>

          <View style={styles.quickRow}>
            {QUICK.map((ticker) => (
              <Pressable key={ticker} onPress={() => void run(ticker)} style={styles.quickChip}>
                <Text style={styles.quickChipText}>{ticker}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading && !recommendation ? (
          <View style={styles.centeredPad}>
            <ActivityIndicator color={palette.moss} />
          </View>
        ) : null}

        {recommendation ? (
          <View style={[styles.resultGrid, wide && styles.resultGridWide]}>
            <View style={[styles.mainCol, wide && styles.mainColWide]}>
              <View style={styles.stanceCard}>
                <View style={styles.stanceTop}>
                  <View>
                    <Text style={styles.symbol}>{recommendation.symbol}</Text>
                    <Text style={styles.price}>{formatMoney(recommendation.price)}</Text>
                  </View>
                  <Pill label={recommendation.label} tone={stanceTone(recommendation.stance)} />
                </View>
                <Text style={styles.summary}>{recommendation.summary}</Text>
                <Text style={styles.confidence}>Confidence {recommendation.confidence}%</Text>
                <Sparkline recommendation={recommendation} />
              </View>

              <View style={[styles.levelsRow, wide && styles.levelsRowWide]}>
                <LevelBox
                  label="Entry zone"
                  value={`${formatMoney(recommendation.levels.entryLow)} – ${formatMoney(recommendation.levels.entryHigh)}`}
                  emphasis
                />
                <LevelBox label="Stop (out if wrong)" value={formatMoney(recommendation.levels.stop)} danger />
                <LevelBox
                  label="Target (take profit)"
                  value={formatMoney(recommendation.levels.target)}
                  good
                  footnote={
                    recommendation.rewardToRisk != null
                      ? `About ${recommendation.rewardToRisk.toFixed(1)}R reward/risk`
                      : undefined
                  }
                />
              </View>

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Why this stance</Text>
                {recommendation.reasons.map((reason, i) => (
                  <View key={`${reason.text}-${i}`} style={styles.reasonRow}>
                    <View
                      style={[
                        styles.reasonDot,
                        reason.tone === 'good' && { backgroundColor: palette.leaf },
                        reason.tone === 'bad' && { backgroundColor: palette.danger },
                        reason.tone === 'warn' && { backgroundColor: palette.warn },
                      ]}
                    />
                    <Text style={styles.reasonText}>{reason.text}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.sideCol, wide && styles.sideColWide]}>
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Score breakdown</Text>
                <ScoreMeter label="Technical" value={recommendation.technicalScore} />
                <ScoreMeter label="Company" value={recommendation.fundamentalScore} />
                <ScoreMeter label="News" value={recommendation.newsScore} />
                <ScoreMeter label="Overall" value={recommendation.overallScore} />
              </View>

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Company snapshot</Text>
                {recommendation.fundamentals ? (
                  <>
                    <Text style={styles.companyName}>
                      {recommendation.fundamentals.name ?? recommendation.symbol}
                    </Text>
                    <Text style={styles.companyMeta}>
                      {[recommendation.fundamentals.sector, recommendation.fundamentals.industry]
                        .filter(Boolean)
                        .join(' · ') || 'Sector n/a'}
                    </Text>
                    <View style={styles.fundGrid}>
                      <FundStat
                        label="P/E"
                        value={
                          recommendation.fundamentals.pe != null
                            ? recommendation.fundamentals.pe.toFixed(1)
                            : '—'
                        }
                      />
                      <FundStat
                        label="Margin"
                        value={
                          recommendation.fundamentals.profitMargin != null
                            ? `${(
                                Math.abs(recommendation.fundamentals.profitMargin) <= 1
                                  ? recommendation.fundamentals.profitMargin * 100
                                  : recommendation.fundamentals.profitMargin
                              ).toFixed(1)}%`
                            : '—'
                        }
                      />
                      <FundStat
                        label="ROE"
                        value={
                          recommendation.fundamentals.roe != null
                            ? `${(
                                Math.abs(recommendation.fundamentals.roe) <= 5
                                  ? recommendation.fundamentals.roe * 100
                                  : recommendation.fundamentals.roe
                              ).toFixed(1)}%`
                            : '—'
                        }
                      />
                      <FundStat
                        label="Growth"
                        value={
                          recommendation.fundamentals.revenueGrowth != null
                            ? `${(
                                Math.abs(recommendation.fundamentals.revenueGrowth) <= 5
                                  ? recommendation.fundamentals.revenueGrowth * 100
                                  : recommendation.fundamentals.revenueGrowth
                              ).toFixed(1)}%`
                            : '—'
                        }
                      />
                    </View>
                    {recommendation.fundamentals.source === 'demo' ? (
                      <Text style={styles.demoNote}>Demo company data</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.muted}>No company data.</Text>
                )}
              </View>

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Recent headlines</Text>
                {recommendation.news.length ? (
                  recommendation.news.map((item) => (
                    <View key={item.id} style={styles.newsItem}>
                      <Text style={styles.newsHeadline}>{item.headline}</Text>
                      <Text style={styles.newsSource}>{item.source}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.muted}>No headlines.</Text>
                )}
              </View>

              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Data source</Text>
                <Text style={styles.muted}>
                  Candles: {recommendation.candleSource} · Quote: {recommendation.quoteSource}
                </Text>
                {recommendation.warnings.slice(0, 4).map((w) => (
                  <Text key={w} style={styles.warningLine}>
                    • {w}
                  </Text>
                ))}
                <Link href="/settings" asChild>
                  <Pressable style={styles.linkBtn}>
                    <Text style={styles.linkBtnText}>Add API keys for live data →</Text>
                  </Pressable>
                </Link>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.disclaimer}>
          Suggestions only — not financial advice. You still decide whether to trade.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function LevelBox({
  label,
  value,
  emphasis,
  danger,
  good,
  footnote,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  danger?: boolean;
  good?: boolean;
  footnote?: string;
}) {
  return (
    <View
      style={[
        styles.levelBox,
        emphasis && styles.levelBoxEmphasis,
        danger && styles.levelBoxDanger,
        good && styles.levelBoxGood,
      ]}>
      <Text style={styles.levelLabel}>{label}</Text>
      <Text style={styles.levelValue}>{value}</Text>
      {footnote ? <Text style={styles.levelFoot}>{footnote}</Text> : null}
    </View>
  );
}

function FundStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fundStat}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={styles.fundValue}>{value}</Text>
    </View>
  );
}

const fontDisplay = Platform.select({
  web: 'Fraunces, Georgia, serif',
  default: 'System',
});
const fontBody = Platform.select({
  web: 'IBM Plex Sans, Helvetica, sans-serif',
  default: 'System',
});

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 64,
  },
  contentWide: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredPad: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  settingsText: {
    color: palette.muted,
    fontFamily: fontBody,
    fontWeight: '600',
  },
  heroPanel: {
    backgroundColor: palette.mist,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.line,
    // Subtle atmospheric wash for web-first desk.
    ...(Platform.OS === 'web'
      ? ({
          backgroundImage: `linear-gradient(135deg, ${palette.mist} 0%, ${palette.sand} 55%, ${palette.mossSoft} 100%)`,
        } as object)
      : null),
  },
  heroEyebrow: {
    fontFamily: fontBody,
    color: palette.moss,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  heroTitle: {
    fontFamily: fontDisplay,
    fontSize: 34,
    color: palette.ink,
    letterSpacing: -0.6,
  },
  heroBody: {
    fontFamily: fontBody,
    color: palette.muted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 720,
  },
  searchRow: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  searchRowWide: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontFamily: 'SpaceMono',
    color: palette.ink,
    letterSpacing: 1,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  quickChip: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  quickChipText: {
    fontFamily: 'SpaceMono',
    color: palette.ink,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: palette.dangerSoft,
    padding: spacing.md,
    borderRadius: 12,
  },
  errorText: {
    color: palette.danger,
    fontFamily: fontBody,
  },
  resultGrid: {
    gap: spacing.md,
  },
  resultGridWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainCol: {
    gap: spacing.md,
    flex: 1,
  },
  mainColWide: {
    flex: 1.4,
  },
  sideCol: {
    gap: spacing.md,
    flex: 1,
  },
  sideColWide: {
    flex: 1,
    maxWidth: 380,
  },
  stanceCard: {
    backgroundColor: palette.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  stanceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 28,
    color: palette.ink,
  },
  price: {
    fontFamily: fontDisplay,
    fontSize: 36,
    color: palette.ink,
    marginTop: 2,
  },
  summary: {
    fontFamily: fontBody,
    fontSize: 16,
    lineHeight: 24,
    color: palette.ink,
  },
  confidence: {
    fontFamily: fontBody,
    color: palette.muted,
    fontWeight: '600',
  },
  spark: {
    marginTop: spacing.sm,
    height: 96,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 8,
  },
  sparkCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sparkBar: {
    width: '70%',
    maxWidth: 48,
    borderRadius: 8,
    backgroundColor: palette.moss,
    opacity: 0.85,
  },
  sparkLegend: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -2,
    flexDirection: 'row',
  },
  sparkLegendText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: palette.muted,
    fontFamily: fontBody,
  },
  levelsRow: {
    gap: spacing.sm,
  },
  levelsRowWide: {
    flexDirection: 'row',
  },
  levelBox: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    padding: spacing.md,
    gap: 4,
    flex: 1,
  },
  levelBoxEmphasis: {
    borderColor: palette.moss,
    backgroundColor: palette.mossSoft,
  },
  levelBoxDanger: {
    borderColor: '#E8B4B0',
    backgroundColor: palette.dangerSoft,
  },
  levelBoxGood: {
    borderColor: '#A9D8C0',
    backgroundColor: '#EFF8F3',
  },
  levelLabel: {
    fontFamily: fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  levelValue: {
    fontFamily: 'SpaceMono',
    fontSize: 18,
    color: palette.ink,
  },
  levelFoot: {
    fontFamily: fontBody,
    color: palette.muted,
    fontSize: 13,
  },
  panel: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelTitle: {
    fontFamily: fontDisplay,
    fontSize: 20,
    color: palette.ink,
  },
  reasonRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  reasonDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    marginTop: 6,
    backgroundColor: palette.line,
  },
  reasonText: {
    flex: 1,
    fontFamily: fontBody,
    color: palette.ink,
    lineHeight: 21,
  },
  meter: {
    gap: 6,
    marginBottom: 8,
  },
  meterHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meterLabel: {
    fontFamily: fontBody,
    color: palette.muted,
    fontWeight: '600',
  },
  meterValue: {
    fontFamily: 'SpaceMono',
    color: palette.ink,
  },
  meterTrack: {
    height: 8,
    borderRadius: 99,
    backgroundColor: palette.mist,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    backgroundColor: palette.moss,
    borderRadius: 99,
  },
  companyName: {
    fontFamily: fontBody,
    fontWeight: '700',
    fontSize: 16,
    color: palette.ink,
  },
  companyMeta: {
    fontFamily: fontBody,
    color: palette.muted,
    marginBottom: 4,
  },
  fundGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fundStat: {
    width: '47%',
    backgroundColor: palette.mist,
    borderRadius: 10,
    padding: 10,
  },
  fundLabel: {
    fontFamily: fontBody,
    fontSize: 11,
    color: palette.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fundValue: {
    fontFamily: 'SpaceMono',
    fontSize: 16,
    color: palette.ink,
    marginTop: 2,
  },
  demoNote: {
    fontFamily: fontBody,
    color: palette.warn,
    fontSize: 13,
  },
  newsItem: {
    gap: 2,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  newsHeadline: {
    fontFamily: fontBody,
    color: palette.ink,
    lineHeight: 20,
  },
  newsSource: {
    fontFamily: fontBody,
    color: palette.muted,
    fontSize: 12,
  },
  muted: {
    fontFamily: fontBody,
    color: palette.muted,
    lineHeight: 20,
  },
  warningLine: {
    fontFamily: fontBody,
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  linkBtn: {
    marginTop: 4,
    paddingVertical: 8,
  },
  linkBtnText: {
    fontFamily: fontBody,
    color: palette.moss,
    fontWeight: '700',
  },
  disclaimer: {
    fontFamily: fontBody,
    color: palette.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
