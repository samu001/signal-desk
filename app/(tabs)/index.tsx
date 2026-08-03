import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CandidateRow } from '@/components/CandidateRow';
import { BrandMark, EmptyState, formatMoney, formatPct, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function TodayScreen() {
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
  } = useTrading();

  const openTrades = trades.filter((t) => t.status === 'open' || t.status === 'planned');
  const spy = quotes.SPY;
  const readyCount = candidates.filter((c) => c.status === 'ready').length;

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
          <Text style={styles.greeting}>What to buy · when · when to get out</Text>
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
              <Text style={{ color: spy.change >= 0 ? palette.leaf : palette.danger, fontFamily: 'SpaceMono' }}>
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
            body="Add tickers on Watchlist and Get signals, then wait for price to enter Desk zones with rules passing."
          />
        ) : (
          actionable.map((c) => <CandidateRow key={c.item.id} candidate={c} />)
        )}

        <View style={styles.spacer} />
        <SectionTitle
          title="Full desk"
          subtitle="Every name ranked by readiness (zone + auto rules + journal edge)."
        />
        {candidates.map((c) => (
          <CandidateRow key={`all-${c.item.id}`} candidate={c} />
        ))}

        <View style={styles.spacer} />
        <SectionTitle
          title="Open plans"
          subtitle={`${openTrades.length} planned or live trade${openTrades.length === 1 ? '' : 's'}.`}
        />
        {openTrades.length === 0 ? (
          <EmptyState
            title="No open trade plans"
            body="Open a watchlist name and build a sized plan with your checklist."
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

        <View style={styles.spacer} />
        <Link href="/trade-plan" asChild>
          <Pressable style={styles.cta}>
            <Text style={styles.ctaText}>New trade plan</Text>
          </Pressable>
        </Link>
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
    marginBottom: spacing.lg,
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
    fontSize: 18,
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
  spacer: { height: spacing.lg },
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
  cta: {
    backgroundColor: palette.moss,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
