import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

function startOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function JournalScreen() {
  const { trades, getSetup, setupExpectancy, setups } = useTrading();

  const stats = useMemo(() => {
    const weekStart = startOfWeek();
    const weekTrades = trades.filter((t) => new Date(t.openedAt) >= weekStart);
    const closed = trades.filter((t) => t.status === 'closed' && t.exitPrice != null);
    const wins = closed.filter((t) => (t.exitPrice ?? 0) > t.entry);
    const planFollowed = trades.filter((t) => t.followedPlan === true).length;
    const planBroken = trades.filter((t) => t.followedPlan === false).length;
    const realized = closed.reduce((sum, t) => {
      const pnl = ((t.exitPrice ?? t.entry) - t.entry) * t.shares;
      return sum + pnl;
    }, 0);

    return {
      weekCount: weekTrades.length,
      closedCount: closed.length,
      winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
      planFollowed,
      planBroken,
      realized,
    };
  }, [trades]);

  const rankedSetups = useMemo(() => {
    const names = Object.fromEntries(setups.map((s) => [s.id, s.name]));
    return [...setupExpectancy].sort((a, b) => b.score - a.score).map((e) => ({
      ...e,
      name: names[e.setupId] ?? e.setupId,
    }));
  }, [setupExpectancy, setups]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Journal"
          subtitle="Review what you traded, whether you followed the plan, and this week’s pulse."
        />

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>This week</Text>
            <Text style={styles.statValue}>{stats.weekCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Win rate</Text>
            <Text style={styles.statValue}>
              {stats.winRate == null ? '—' : `${stats.winRate}%`}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Realized</Text>
            <Text
              style={[
                styles.statValue,
                { color: stats.realized >= 0 ? palette.leaf : palette.danger },
              ]}>
              {formatMoney(stats.realized, 0)}
            </Text>
          </View>
        </View>

        <Text style={styles.planLine}>
          Plan followed {stats.planFollowed} · broken {stats.planBroken}
        </Text>

        <SectionTitle
          title="Setup edge"
          subtitle="Expectancy from closed trades feeds Today’s ranking."
        />
        {rankedSetups.map((edge) => (
          <View key={edge.setupId} style={styles.edgeRow}>
            <Text style={styles.edgeName}>{edge.name}</Text>
            <Text style={styles.edgeMeta}>
              {edge.sampleSize === 0
                ? 'No closed sample yet'
                : `${edge.avgR?.toFixed(2) ?? '—'}R · win ${
                    edge.winRate == null ? '—' : `${Math.round(edge.winRate * 100)}%`
                  } · n=${edge.sampleSize}`}
            </Text>
          </View>
        ))}

        {trades.length === 0 ? (
          <EmptyState
            title="No trades logged"
            body="Build a trade plan from Today or Watchlist. Closed trades show up here for weekly review."
          />
        ) : (
          trades.map((trade) => {
            const setup = getSetup(trade.setupId);
            const pnl =
              trade.exitPrice != null
                ? (trade.exitPrice - trade.entry) * trade.shares
                : null;
            return (
              <Link key={trade.id} href={{ pathname: '/trade-detail', params: { id: trade.id } }} asChild>
                <Pressable style={styles.card}>
                  <View style={styles.top}>
                    <Text style={styles.symbol}>{trade.symbol}</Text>
                    <Pill
                      label={trade.status}
                      tone={
                        trade.status === 'closed'
                          ? pnl != null && pnl >= 0
                            ? 'good'
                            : 'bad'
                          : trade.status === 'open'
                            ? 'warn'
                            : 'neutral'
                      }
                    />
                  </View>
                  <Text style={styles.meta}>
                    {trade.shares} sh · entry {formatMoney(trade.entry)} · stop{' '}
                    {formatMoney(trade.stop)} · target {formatMoney(trade.target)}
                  </Text>
                  {setup ? <Text style={styles.setup}>{setup.name}</Text> : null}
                  {pnl != null ? (
                    <Text style={{ color: pnl >= 0 ? palette.leaf : palette.danger, fontFamily: 'SpaceMono' }}>
                      P&L {formatMoney(pnl)}
                    </Text>
                  ) : null}
                  {trade.followedPlan != null ? (
                    <Text style={styles.followed}>
                      {trade.followedPlan ? 'Followed plan' : 'Broke plan'}
                    </Text>
                  ) : null}
                </Pressable>
              </Link>
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
  stats: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: palette.sand,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  statLabel: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: 6,
  },
  statValue: {
    fontFamily: 'SpaceMono',
    fontSize: 18,
    color: palette.ink,
  },
  planLine: {
    color: palette.muted,
    marginBottom: spacing.md,
  },
  edgeRow: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  edgeName: {
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 4,
  },
  edgeMeta: {
    color: palette.muted,
    fontFamily: 'SpaceMono',
    fontSize: 12,
  },
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 6,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 20,
    color: palette.ink,
  },
  meta: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.muted,
  },
  setup: { color: palette.moss, fontWeight: '600' },
  followed: { color: palette.ink, fontWeight: '600' },
});
