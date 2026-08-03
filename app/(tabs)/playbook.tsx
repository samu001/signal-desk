import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function PlaybookScreen() {
  const { setups, setupExpectancy } = useTrading();
  const expectancyById = Object.fromEntries(setupExpectancy.map((e) => [e.setupId, e]));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Playbook"
          subtitle="Your rules for what to buy, when to enter, and when to get out — with auto-checks on Today."
        />

        <Link href="/backtest" asChild>
          <Pressable style={styles.backtestCta}>
            <Text style={styles.backtestCtaText}>Run setup backtest →</Text>
          </Pressable>
        </Link>

        <Link href="/portfolio-backtest" asChild>
          {/* Link asChild + array style crashes on web (expo#31352); keep it flattened. */}
          <Pressable style={StyleSheet.flatten([styles.backtestCta, styles.portfolioCta])}>
            <Text style={styles.backtestCtaText}>Portfolio backtest (with position cap) →</Text>
          </Pressable>
        </Link>

        {setups.length === 0 ? (
          <EmptyState title="No setups yet" body="Seed data should load on first launch." />
        ) : (
          setups.map((setup) => {
            const edge = expectancyById[setup.id];
            return (
              <View key={setup.id} style={styles.card}>
                <Text style={styles.name}>{setup.name}</Text>
                <Text style={styles.summary}>{setup.summary}</Text>
                <View style={styles.counts}>
                  <Text style={styles.count}>{setup.entryRules.length} entry rules</Text>
                  <Text style={styles.count}>{setup.entryChecks.length} auto-checks</Text>
                  <Text style={styles.count}>{setup.exitRules.length} exit rules</Text>
                </View>
                <Text style={styles.edge}>
                  {edge && edge.sampleSize > 0
                    ? `Journal edge ${edge.avgR?.toFixed(2) ?? '—'}R · win ${
                        edge.winRate == null ? '—' : `${Math.round(edge.winRate * 100)}%`
                      } · n=${edge.sampleSize}`
                    : 'Journal edge: not enough closed trades yet'}
                </Text>
                <View style={styles.actions}>
                  <Link href={{ pathname: '/setup-detail', params: { id: setup.id } }} asChild>
                    <Pressable style={styles.actionBtn}>
                      <Text style={styles.actionText}>Edit</Text>
                    </Pressable>
                  </Link>
                  <Link href={{ pathname: '/backtest', params: { setupId: setup.id } }} asChild>
                    {/* Link asChild + array style crashes on web (expo#31352). */}
                    <Pressable style={StyleSheet.flatten([styles.actionBtn, styles.actionPrimary])}>
                      <Text style={[styles.actionText, styles.actionPrimaryText]}>Backtest</Text>
                    </Pressable>
                  </Link>
                </View>
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
  backtestCta: {
    backgroundColor: palette.moss,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  backtestCtaText: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 15,
  },
  portfolioCta: {
    backgroundColor: palette.ink,
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
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: palette.ink,
  },
  summary: {
    color: palette.muted,
    lineHeight: 21,
  },
  counts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  count: {
    color: palette.moss,
    fontWeight: '600',
    fontSize: 13,
  },
  edge: {
    color: palette.ink,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  actionPrimary: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  actionText: {
    color: palette.ink,
    fontWeight: '700',
  },
  actionPrimaryText: {
    color: palette.moss,
  },
});
