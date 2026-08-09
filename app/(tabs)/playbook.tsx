import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { EmptyState, Screen, SectionTitle } from '@/components/ui';
import { retiredSetupIds } from '@/constants/seed';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { Setup } from '@/types/trading';

export default function PlaybookScreen() {
  const { setups, enabledSetups, setupExpectancy, setSetupEnabled } = useTrading();
  const expectancyById = Object.fromEntries(setupExpectancy.map((e) => [e.setupId, e]));

  const active = setups.filter((s) => s.enabled !== false);
  const inactive = setups.filter((s) => s.enabled === false);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Playbook"
          subtitle={`${enabledSetups.length} on · Desk and Dashboard only score enabled setups. Lab can still backtest any row.`}
        />

        <Link href="/lab" asChild>
          <Pressable style={styles.labCta}>
            <Text style={styles.labCtaTitle}>Lab</Text>
            <Text style={styles.labCtaBody}>
              Universe scan, backtests, and parameter lab →
            </Text>
          </Pressable>
        </Link>

        {setups.length === 0 ? (
          <EmptyState title="No setups yet" body="Seed data should load on first launch." />
        ) : (
          <>
            <Text style={styles.groupLabel}>On ({active.length})</Text>
            {active.length === 0 ? (
              <Text style={styles.groupHint}>Turn on at least one setup for Desk Soft/Strong.</Text>
            ) : (
              active.map((setup) => (
                <SetupCard
                  key={setup.id}
                  setup={setup}
                  edge={expectancyById[setup.id]}
                  onToggle={(on) => setSetupEnabled(setup.id, on)}
                />
              ))
            )}

            {inactive.length ? (
              <>
                <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>
                  Off ({inactive.length})
                </Text>
                <Text style={styles.groupHint}>
                  Optional / formerly retired setups — enable to include them in Desk matching.
                </Text>
                {inactive.map((setup) => (
                  <SetupCard
                    key={setup.id}
                    setup={setup}
                    edge={expectancyById[setup.id]}
                    onToggle={(on) => setSetupEnabled(setup.id, on)}
                    dimmed
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SetupCard({
  setup,
  edge,
  onToggle,
  dimmed,
}: {
  setup: Setup;
  edge?: { avgR: number | null; winRate: number | null; sampleSize: number };
  onToggle: (enabled: boolean) => void;
  dimmed?: boolean;
}) {
  const optional = retiredSetupIds.has(setup.id);
  return (
    <View style={[styles.card, dimmed && styles.cardDimmed]}>
      <View style={styles.cardTop}>
        <View style={styles.titleCol}>
          <Text style={[styles.name, dimmed && styles.nameDimmed]}>{setup.name}</Text>
          {optional ? <Text style={styles.optionalTag}>Optional</Text> : null}
        </View>
        <Switch
          value={setup.enabled !== false}
          onValueChange={onToggle}
          trackColor={{ false: palette.line, true: palette.mossSoft }}
          thumbColor={setup.enabled !== false ? palette.moss : palette.muted}
          accessibilityLabel={`${setup.enabled !== false ? 'Disable' : 'Enable'} ${setup.name}`}
        />
      </View>
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
  groupLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  groupLabelSpaced: {
    marginTop: spacing.lg,
  },
  groupHint: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
    marginTop: -4,
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
  cardDimmed: {
    backgroundColor: palette.sand,
    opacity: 0.95,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleCol: { flex: 1, gap: 4 },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: palette.ink,
  },
  nameDimmed: {
    color: palette.muted,
  },
  optionalTag: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    color: palette.warn,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
