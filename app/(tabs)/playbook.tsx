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
          subtitle="Machine auto-checks that score Dashboard readiness. Lab runs backtests."
        />

        <Link href="/lab" asChild>
          <Pressable style={styles.labCta}>
            <Text style={styles.labCtaTitle}>Lab</Text>
            <Text style={styles.labCtaBody}>
              Setup, Desk, and portfolio backtests in one place →
            </Text>
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
                  <Text style={styles.count}>{setup.entryChecks.length} machine checks</Text>
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
  labCta: {
    backgroundColor: palette.ink,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: spacing.lg,
    gap: 4,
  },
  labCtaTitle: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 18,
  },
  labCtaBody: {
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
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
