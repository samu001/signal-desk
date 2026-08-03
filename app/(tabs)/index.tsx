import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CandidateRow } from '@/components/CandidateRow';
import { DeskSignalDetail } from '@/components/DeskSignalDetail';
import {
  BrandMark,
  Button,
  EmptyState,
  formatMoney,
  formatPct,
  Pill,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { hasWatchlistLevels, isAwaitingDeskSignal } from '@/constants/watchlist';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fundamentalFlags } from '@/lib/fmp';
import { fetchRecommendation, fetchRecommendations } from '@/lib/fetchRecommendation';
import { Recommendation, Stance } from '@/lib/recommend';

function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

function confirmRemove(symbol: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`Remove ${symbol} from watchlist?`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert('Remove symbol?', symbol, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

export default function DashboardScreen() {
  const {
    ready,
    settings,
    candidates,
    actionable,
    quotes,
    quotesLoading,
    refreshQuotes,
    trades,
    session,
    dataSource,
    watchlist,
    getSetup,
    removeWatchlistItem,
    addWatchlistSymbol,
    applyDeskSignals,
    fundamentals,
    setups,
    signalsStale,
  } = useTrading();

  const [symbolDraft, setSymbolDraft] = useState('');
  const [signals, setSignals] = useState<Recommendation[] | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [signalingSymbol, setSignalingSymbol] = useState<string | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [researchLoadingId, setResearchLoadingId] = useState<string | null>(null);

  const openTrades = trades.filter((t) => t.status === 'open' || t.status === 'planned');
  const spy = quotes.SPY;
  const readyCount = candidates.filter((c) => c.status === 'ready').length;

  const signalsBySymbol = useMemo(() => {
    if (!signals) return {} as Record<string, Recommendation>;
    return Object.fromEntries(signals.map((r) => [r.symbol.toUpperCase(), r]));
  }, [signals]);

  const candidatesById = useMemo(
    () => Object.fromEntries(candidates.map((c) => [c.item.id, c])),
    [candidates]
  );

  const mergeSignals = (recs: Recommendation[]) => {
    setSignals((prev) => {
      const bySymbol = Object.fromEntries((prev ?? []).map((r) => [r.symbol.toUpperCase(), r]));
      for (const rec of recs) {
        bySymbol[rec.symbol.toUpperCase()] = rec;
      }
      const merged = Object.values(bySymbol);
      const rank: Record<Stance, number> = {
        strong_buy: 0,
        soft_buy: 1,
        wait: 2,
        avoid: 3,
      };
      return merged.sort((a, b) => {
        const byStance = rank[a.stance] - rank[b.stance];
        if (byStance !== 0) return byStance;
        return b.overallScore - a.overallScore;
      });
    });
  };

  const signalSymbols = async (symbols: string[]) => {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
    if (!unique.length) return;
    setLoadingSignals(true);
    setSignalError(null);
    if (unique.length === 1) setSignalingSymbol(unique[0]);
    try {
      const recs = await fetchRecommendations(unique, settings, { setups, trades });
      mergeSignals(recs);
      applyDeskSignals(recs);
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : 'Could not build recommendations.');
    } finally {
      setLoadingSignals(false);
      setSignalingSymbol(null);
    }
  };

  const addTicker = () => {
    const ticker = symbolDraft.trim();
    if (!ticker) {
      Alert.alert('Symbol required', 'Enter a ticker like AAPL.');
      return;
    }
    try {
      const { created } = addWatchlistSymbol(ticker);
      setSymbolDraft('');
      if (!created) {
        Alert.alert('Already on list', `${ticker.toUpperCase()} is already saved.`);
        return;
      }
      void signalSymbols([ticker]);
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const refreshSignals = async () => {
    if (!watchlist.length) {
      Alert.alert('List empty', 'Add a ticker first.');
      return;
    }
    await signalSymbols(watchlist.map((w) => w.symbol));
  };

  const toggleResearch = async (itemId: string, symbol: string) => {
    if (expandedId === itemId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(itemId);
    const upper = symbol.toUpperCase();
    if (signalsBySymbol[upper]) return;

    setResearchLoadingId(itemId);
    try {
      const rec = await fetchRecommendation(symbol, settings, { setups, trades });
      mergeSignals([rec]);
      applyDeskSignals([rec]);
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : 'Could not load Desk research.');
    } finally {
      setResearchLoadingId(null);
    }
  };

  if (!ready) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={palette.moss} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={quotesLoading} onRefresh={refreshQuotes} tintColor={palette.moss} />
        }>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <BrandMark />
            <Link href="/settings" asChild>
              <Pressable hitSlop={12}>
                <FontAwesome name="cog" size={22} color={palette.ink} />
              </Pressable>
            </Link>
          </View>
          <Text style={styles.greeting}>Dashboard</Text>
          <Text style={styles.bias}>{settings.marketBias}</Text>

          <View style={styles.sessionRow}>
            <Pill
              label={session.label}
              tone={session.tradable ? 'good' : session.phase === 'rth' ? 'warn' : 'neutral'}
            />
            <Text style={styles.sessionDetail} numberOfLines={2}>
              {session.detail}
            </Text>
          </View>

          <View style={styles.spyRow}>
            <Text style={styles.spyLabel}>SPY</Text>
            <Text style={styles.spyPrice}>{spy ? formatMoney(spy.price) : '—'}</Text>
            {spy ? (
              <Text
                style={{
                  color: spy.change >= 0 ? palette.leaf : palette.danger,
                  fontFamily: 'SpaceMono',
                }}>
                {formatPct(spy.percentChange)}
              </Text>
            ) : null}
            <Text style={styles.quoteSource}>
              {dataSource === 'tiingo'
                ? 'Tiingo EOD'
                : dataSource === 'fmp'
                  ? 'FMP EOD'
                  : dataSource === 'finnhub'
                    ? 'Live Finnhub'
                    : dataSource === 'alphavantage'
                      ? 'Alpha Vantage bars'
                      : dataSource === 'mixed'
                        ? 'Mixed data'
                        : 'Demo data'}
            </Text>
          </View>
        </View>

        <View style={styles.addRow}>
          <TextInput
            value={symbolDraft}
            onChangeText={(t) => setSymbolDraft(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Add ticker e.g. AAPL"
            placeholderTextColor={palette.muted}
            style={styles.addInput}
            onSubmitEditing={addTicker}
            returnKeyType="done"
          />
          <Button label="Add" onPress={addTicker} disabled={loadingSignals} />
        </View>

        <View style={styles.signalCta}>
          <Button
            label={loadingSignals ? 'Refreshing signals…' : 'Refresh signals'}
            onPress={() => void refreshSignals()}
            disabled={loadingSignals || watchlist.length === 0}
          />
        </View>

        {signalsStale && !loadingSignals ? (
          <View style={styles.staleBox}>
            <Text style={styles.staleText}>
              Quotes updated — Desk levels may be stale. Tap Refresh signals.
            </Text>
          </View>
        ) : null}

        {signalError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{signalError}</Text>
          </View>
        ) : null}

        {loadingSignals ? (
          <View style={styles.loadingPad}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>
              {signalingSymbol
                ? `Getting Desk signal for ${signalingSymbol}…`
                : 'Checking Playbook setups for each ticker…'}
            </Text>
          </View>
        ) : null}

        <SectionTitle
          title="Act now"
          subtitle={
            readyCount
              ? `${readyCount} name${readyCount === 1 ? '' : 's'} with buy zone + rules mostly passing.`
              : 'In/near your zones, ranked by rule pass-rate and setup edge.'
          }
        />
        {actionable.length === 0 ? (
          <EmptyState
            title="No actionable setups"
            body="Add tickers below and wait for price to enter Desk zones with rules passing."
          />
        ) : (
          actionable.map((c) => <CandidateRow key={c.item.id} candidate={c} />)
        )}

        <View style={styles.spacer} />
        <SectionTitle
          title="Your names"
          subtitle="Tap Research for Desk detail. Levels update when you Refresh signals."
        />

        {watchlist.length === 0 ? (
          <EmptyState
            title="No tickers yet"
            body="Add a ticker above — Desk fills levels automatically."
          />
        ) : (
          watchlist.map((item) => {
            const setup = getSetup(item.setupId);
            const quote = quotes[item.symbol];
            const fund = fundamentals[item.symbol.toUpperCase()];
            const flags = fundamentalFlags(fund);
            const rec = signalsBySymbol[item.symbol.toUpperCase()];
            const candidate = candidatesById[item.id];
            const pending = isAwaitingDeskSignal(item.thesis) || !(item.entryHigh > 0);
            const levelsReady = hasWatchlistLevels(item);
            const signalingThis =
              signalingSymbol === item.symbol.toUpperCase() ||
              (loadingSignals && !signalingSymbol && pending);
            const expanded = expandedId === item.id;
            const researching = researchLoadingId === item.id;

            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.top}>
                  <View style={styles.symbolCol}>
                    <Text style={styles.symbol}>{item.symbol}</Text>
                    {candidate ? (
                      <Pill label={candidate.label} tone={candidate.status === 'ready' || candidate.status === 'in_zone' ? 'good' : candidate.status === 'near_zone' ? 'warn' : 'neutral'} />
                    ) : rec ? (
                      <Pill label={rec.label} tone={stanceTone(rec.stance)} />
                    ) : null}
                  </View>
                  <View style={styles.actions}>
                    <Pressable hitSlop={8} onPress={() => void toggleResearch(item.id, item.symbol)}>
                      <Text style={styles.researchBtn}>{expanded ? 'Hide' : 'Research'}</Text>
                    </Pressable>
                    <Link href={{ pathname: '/watchlist-form', params: { id: item.id } }} asChild>
                      <Pressable hitSlop={8}>
                        <FontAwesome name="pencil" size={18} color={palette.moss} />
                      </Pressable>
                    </Link>
                    <Pressable
                      hitSlop={8}
                      onPress={() => confirmRemove(item.symbol, () => removeWatchlistItem(item.id))}>
                      <FontAwesome name="trash-o" size={18} color={palette.danger} />
                    </Pressable>
                  </View>
                </View>

                <Text style={styles.thesis}>
                  {pending && !rec ? 'Awaiting Desk signal' : item.thesis}
                </Text>

                {levelsReady ? (
                  <Text style={styles.levels}>
                    Buy {formatMoney(item.entryLow)}–{formatMoney(item.entryHigh)} · Stop{' '}
                    {formatMoney(item.stop)} · Target {formatMoney(item.target)}
                  </Text>
                ) : (
                  <Text style={styles.levels}>
                    {signalingThis ? 'Getting Desk levels…' : 'Levels pending — tap Refresh signals'}
                  </Text>
                )}

                {quote ? <Text style={styles.quote}>Last {formatMoney(quote.price)}</Text> : null}
                {setup ? <Text style={styles.setup}>Setup · {setup.name}</Text> : null}
                {fund?.sector ? (
                  <Text style={styles.fundMeta}>
                    {fund.sector}
                    {fund.industry ? ` · ${fund.industry}` : ''}
                  </Text>
                ) : null}
                {flags.length ? (
                  <View style={styles.flagRow}>
                    {flags.map((f) => (
                      <Pill key={f.label} label={f.label} tone={f.tone} />
                    ))}
                  </View>
                ) : null}

                {expanded ? (
                  researching ? (
                    <View style={styles.researchPad}>
                      <ActivityIndicator color={palette.moss} />
                    </View>
                  ) : rec ? (
                    <DeskSignalDetail recommendation={rec} />
                  ) : (
                    <Text style={styles.levels}>Could not load Desk research.</Text>
                  )
                ) : null}

                {levelsReady ? (
                  <Link href={{ pathname: '/trade-plan', params: { watchlistId: item.id } }} asChild>
                    <Pressable style={styles.planLink}>
                      <Text style={styles.planLinkText}>Act from Desk →</Text>
                    </Pressable>
                  </Link>
                ) : (
                  <Text style={styles.planBlocked}>Refresh Desk levels before acting</Text>
                )}
              </View>
            );
          })
        )}

        <View style={styles.spacer} />
        <SectionTitle
          title="Open positions"
          subtitle={`${openTrades.length} planned or live trade${openTrades.length === 1 ? '' : 's'} from Desk.`}
        />
        {openTrades.length === 0 ? (
          <EmptyState
            title="No open positions"
            body="Act on an Act now name — Desk levels and risk settings size the trade."
          />
        ) : (
          openTrades.map((t) => (
            <Link key={t.id} href={{ pathname: '/trade-detail', params: { id: t.id } }} asChild>
              <Pressable style={styles.tradeRow}>
                <Text style={styles.tradeSymbol}>{t.symbol}</Text>
                <Text style={styles.tradeMeta}>
                  {t.status.toUpperCase()} · {t.shares} sh · entry {formatMoney(t.entry)}
                </Text>
              </Pressable>
            </Link>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  hero: {
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 8,
  },
  bias: {
    color: palette.muted,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  sessionRow: {
    gap: 8,
    marginBottom: spacing.md,
  },
  sessionDetail: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  spyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  spyLabel: {
    fontFamily: 'SpaceMono',
    fontWeight: '700',
    color: palette.moss,
  },
  spyPrice: {
    fontFamily: 'SpaceMono',
    color: palette.ink,
  },
  quoteSource: {
    marginLeft: 'auto',
    color: palette.muted,
    fontSize: 12,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: 'SpaceMono',
    color: palette.ink,
  },
  signalCta: {
    marginBottom: spacing.sm,
  },
  staleBox: {
    marginBottom: spacing.md,
    backgroundColor: palette.warnSoft,
    borderRadius: 12,
    padding: 12,
  },
  staleText: {
    color: palette.warn,
    lineHeight: 20,
    fontWeight: '600',
  },
  errorBox: {
    marginBottom: spacing.sm,
    backgroundColor: palette.dangerSoft,
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: palette.danger, lineHeight: 20 },
  loadingPad: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  loadingText: { color: palette.muted },
  spacer: { height: spacing.lg },
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbolCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  actions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  researchBtn: {
    color: palette.moss,
    fontWeight: '700',
    fontSize: 13,
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 22,
    color: palette.ink,
  },
  thesis: { color: palette.ink, lineHeight: 21 },
  levels: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.muted,
  },
  quote: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
  },
  setup: { color: palette.moss, fontWeight: '600' },
  fundMeta: { color: palette.muted, fontSize: 13 },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  researchPad: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  planLink: { marginTop: 4 },
  planLinkText: { color: palette.moss, fontWeight: '700' },
  planBlocked: { marginTop: 4, color: palette.muted, fontSize: 13 },
  tradeRow: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tradeSymbol: {
    fontFamily: 'SpaceMono',
    fontSize: 18,
    color: palette.ink,
  },
  tradeMeta: {
    color: palette.muted,
    marginTop: 4,
  },
});
