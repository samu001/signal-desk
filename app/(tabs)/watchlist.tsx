import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fundamentalFlags } from '@/lib/fmp';

export default function WatchlistScreen() {
  const { watchlist, getSetup, removeWatchlistItem, quotes, fundamentals } = useTrading();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Watchlist"
          subtitle="Thesis, buy zone, stop, and target for every name you care about."
        />

        <Link href="/watchlist-form" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>Add symbol</Text>
          </Pressable>
        </Link>

        {watchlist.length === 0 ? (
          <EmptyState
            title="Watchlist is empty"
            body="Add a ticker with your thesis and levels so Today can rank buy zones."
          />
        ) : (
          watchlist.map((item) => {
            const setup = getSetup(item.setupId);
            const quote = quotes[item.symbol];
            const fund = fundamentals[item.symbol.toUpperCase()];
            const flags = fundamentalFlags(fund);
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.top}>
                  <Text style={styles.symbol}>{item.symbol}</Text>
                  <View style={styles.actions}>
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
                <Text style={styles.thesis}>{item.thesis}</Text>
                <Text style={styles.levels}>
                  Buy {formatMoney(item.entryLow, 0)}–{formatMoney(item.entryHigh, 0)} · Stop{' '}
                  {formatMoney(item.stop, 0)} · Target {formatMoney(item.target, 0)}
                </Text>
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
  actions: { flexDirection: 'row', gap: 16 },
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
  notes: { color: palette.muted, fontStyle: 'italic' },
  planLink: { marginTop: 4 },
  planLinkText: { color: palette.moss, fontWeight: '700' },
  cta: {
    backgroundColor: palette.moss,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ctaText: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
