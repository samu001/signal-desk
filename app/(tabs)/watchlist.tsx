import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SetupOptionCard } from '@/components/SetupOptionCard';
import { Button, EmptyState, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { isAwaitingDeskSignal } from '@/constants/watchlist';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fundamentalFlags } from '@/lib/fmp';
import { fetchRecommendations } from '@/lib/fetchRecommendation';
import { Recommendation, Stance } from '@/lib/recommend';

function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

export default function WatchlistScreen() {
  const {
    watchlist,
    getSetup,
    removeWatchlistItem,
    addWatchlistSymbol,
    applyDeskSignals,
    quotes,
    fundamentals,
    settings,
    setups,
    trades,
  } = useTrading();

  const [symbolDraft, setSymbolDraft] = useState('');
  const [signals, setSignals] = useState<Recommendation[] | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);

  const signalsBySymbol = useMemo(() => {
    if (!signals) return {} as Record<string, Recommendation>;
    return Object.fromEntries(signals.map((r) => [r.symbol.toUpperCase(), r]));
  }, [signals]);

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
        Alert.alert('Already on watchlist', `${ticker.toUpperCase()} is already saved.`);
      }
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const getSignals = async () => {
    if (!watchlist.length) {
      Alert.alert('Watchlist empty', 'Add a ticker first.');
      return;
    }
    setLoadingSignals(true);
    setSignalError(null);
    try {
      const recs = await fetchRecommendations(
        watchlist.map((w) => w.symbol),
        settings,
        { setups, trades }
      );
      // Tradeable / stronger stances first, then by overall score.
      const ranked = [...recs].sort((a, b) => {
        const rank: Record<Stance, number> = {
          strong_buy: 0,
          soft_buy: 1,
          wait: 2,
          avoid: 3,
        };
        const byStance = rank[a.stance] - rank[b.stance];
        if (byStance !== 0) return byStance;
        return b.overallScore - a.overallScore;
      });
      setSignals(ranked);
      applyDeskSignals(ranked);
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : 'Could not build recommendations.');
    } finally {
      setLoadingSignals(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Watchlist"
          subtitle="Add tickers you care about. Get signals runs Desk across every Playbook setup."
        />

        <View style={styles.addRow}>
          <TextInput
            value={symbolDraft}
            onChangeText={(t) => setSymbolDraft(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Ticker e.g. AAPL"
            placeholderTextColor={palette.muted}
            style={styles.addInput}
            onSubmitEditing={addTicker}
            returnKeyType="done"
          />
          <Button label="Add" onPress={addTicker} />
        </View>

        <View style={styles.signalCta}>
          <Button
            label={loadingSignals ? 'Reading Playbook…' : 'Get signals for all'}
            onPress={() => void getSignals()}
            disabled={loadingSignals || watchlist.length === 0}
          />
        </View>

        {signalError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{signalError}</Text>
          </View>
        ) : null}

        {loadingSignals ? (
          <View style={styles.loadingPad}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>Checking all setups for each ticker…</Text>
          </View>
        ) : null}

        {signals && signals.length > 0 ? (
          <View style={styles.signalBlock}>
            <SectionTitle
              title="Desk signals"
              subtitle={`${signals.length} recommendation${signals.length === 1 ? '' : 's'} — levels saved to your list.`}
            />
            {signals.map((rec) => (
              <View key={rec.symbol} style={styles.signalCard}>
                <View style={styles.signalTop}>
                  <View>
                    <Text style={styles.symbol}>{rec.symbol}</Text>
                    <Text style={styles.price}>{formatMoney(rec.price)}</Text>
                  </View>
                  <Pill label={rec.label} tone={stanceTone(rec.stance)} />
                </View>
                <Text style={styles.summary}>{rec.summary}</Text>
                <Text style={styles.levels}>
                  Entry {formatMoney(rec.levels.entryLow)}–{formatMoney(rec.levels.entryHigh)} · Stop{' '}
                  {formatMoney(rec.levels.stop)} · Target {formatMoney(rec.levels.target)}
                </Text>
                {rec.bestSetupName ? (
                  <Text style={styles.setup}>
                    Top Playbook · {rec.bestSetupName}
                    {rec.setupOptions.length > 1 ? ` (+${rec.setupOptions.length - 1} more)` : ''}
                  </Text>
                ) : (
                  <Text style={styles.setupWarn}>No Playbook setup matched — buys blocked</Text>
                )}
                <Text style={styles.confidence}>
                  Confidence {rec.confidence}%
                  {rec.rewardToRisk != null ? ` · ~${rec.rewardToRisk.toFixed(1)}R primary` : ''}
                </Text>
                {rec.setupOptions.length > 0 ? (
                  <View style={styles.optionsWrap}>
                    <Text style={styles.optionsTitle}>
                      Setup options ({rec.setupOptions.length})
                    </Text>
                    {rec.setupOptions.map((option) => (
                      <SetupOptionCard key={`${rec.symbol}-${option.setupId}`} option={option} />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.listHead}>
          <SectionTitle title="Your tickers" subtitle="Saved in this account. Edit anytime." />
        </View>

        {watchlist.length === 0 ? (
          <EmptyState
            title="Watchlist is empty"
            body="Type a ticker above and add it. Then Get signals for Desk recommendations."
          />
        ) : (
          watchlist.map((item) => {
            const setup = getSetup(item.setupId);
            const quote = quotes[item.symbol];
            const fund = fundamentals[item.symbol.toUpperCase()];
            const flags = fundamentalFlags(fund);
            const rec = signalsBySymbol[item.symbol.toUpperCase()];
            const pending = isAwaitingDeskSignal(item.thesis) || !(item.entryHigh > 0);
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.top}>
                  <Text style={styles.symbol}>{item.symbol}</Text>
                  <View style={styles.actions}>
                    {rec ? <Pill label={rec.label} tone={stanceTone(rec.stance)} /> : null}
                    <Link href={{ pathname: '/watchlist-form', params: { id: item.id } }} asChild>
                      <Pressable hitSlop={8}>
                        <FontAwesome name="pencil" size={18} color={palette.moss} />
                      </Pressable>
                    </Link>
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        Alert.alert('Remove symbol?', item.symbol, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => removeWatchlistItem(item.id),
                          },
                        ])
                      }>
                      <FontAwesome name="trash-o" size={18} color={palette.danger} />
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.thesis}>
                  {pending && !rec ? 'Awaiting Desk signal' : item.thesis}
                </Text>
                {item.entryHigh > 0 ? (
                  <Text style={styles.levels}>
                    Buy {formatMoney(item.entryLow)}–{formatMoney(item.entryHigh)} · Stop{' '}
                    {formatMoney(item.stop)} · Target {formatMoney(item.target)}
                  </Text>
                ) : (
                  <Text style={styles.levels}>Levels fill when you Get signals</Text>
                )}
                {quote ? (
                  <Text style={styles.quote}>Last {formatMoney(quote.price)}</Text>
                ) : null}
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
                {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
                <Link href={{ pathname: '/trade-plan', params: { watchlistId: item.id } }} asChild>
                  <Pressable style={styles.planLink}>
                    <Text style={styles.planLinkText}>Build trade plan →</Text>
                  </Pressable>
                </Link>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
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
  errorBox: {
    marginTop: spacing.sm,
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: palette.danger, lineHeight: 20 },
  loadingPad: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.lg,
  },
  loadingText: { color: palette.muted },
  signalBlock: { marginTop: spacing.md },
  signalCard: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 8,
  },
  signalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  summary: { color: palette.ink, lineHeight: 21 },
  confidence: { color: palette.muted, fontSize: 13 },
  setupWarn: { color: palette.warn, fontWeight: '600' },
  optionsWrap: { marginTop: 6, gap: 4 },
  optionsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  listHead: { marginTop: spacing.lg },
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
  actions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 22,
    color: palette.ink,
  },
  price: {
    fontFamily: 'SpaceMono',
    fontSize: 14,
    color: palette.muted,
    marginTop: 2,
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
  notes: { color: palette.muted, fontStyle: 'italic' },
  planLink: { marginTop: 4 },
  planLinkText: { color: palette.moss, fontWeight: '700' },
});
