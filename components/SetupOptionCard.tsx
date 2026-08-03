import { StyleSheet, Text, View } from 'react-native';

import { formatMoney, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { SetupOption } from '@/lib/recommend';

function zoneTone(option: SetupOption): 'good' | 'warn' | 'neutral' {
  if (option.inEntry) return 'good';
  if (option.nearEntry) return 'warn';
  return 'neutral';
}

export function SetupOptionCard({ option }: { option: SetupOption }) {
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titleCol}>
          <Text style={styles.rank}>#{option.rank}</Text>
          <Text style={styles.name}>{option.setupName}</Text>
        </View>
        <Pill label={option.priceVsZone} tone={zoneTone(option)} />
      </View>

      {option.summary ? <Text style={styles.summary}>{option.summary}</Text> : null}

      <View style={styles.levels}>
        <Level
          label="Get in"
          value={`${formatMoney(option.levels.entryLow)} – ${formatMoney(option.levels.entryHigh)}`}
        />
        <Level label="Get out (stop)" value={formatMoney(option.levels.stop)} danger />
        <Level
          label="Take profit"
          value={formatMoney(option.levels.target)}
          good
          footnote={
            option.rewardToRisk != null ? `~${option.rewardToRisk.toFixed(1)}R` : undefined
          }
        />
      </View>

      <Text style={styles.meta}>
        Rules {Math.round(option.passRate * 100)}%
        {option.expectancyScore !== 0
          ? ` · edge score ${option.expectancyScore.toFixed(2)}`
          : ' · edge n/a'}
      </Text>

      {option.passedChecks.length || option.failedChecks.length ? (
        <View style={styles.checkRow}>
          {option.passedChecks.slice(0, 3).map((c) => (
            <Pill key={`p-${c}`} label={`✓ ${c}`} tone="good" />
          ))}
          {option.failedChecks.slice(0, 2).map((c) => (
            <Pill key={`f-${c}`} label={`✕ ${c}`} tone="bad" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Level({
  label,
  value,
  danger,
  good,
  footnote,
}: {
  label: string;
  value: string;
  danger?: boolean;
  good?: boolean;
  footnote?: string;
}) {
  return (
    <View
      style={[
        styles.levelBox,
        danger && styles.levelDanger,
        good && styles.levelGood,
      ]}>
      <Text style={styles.levelLabel}>{label}</Text>
      <Text style={styles.levelValue}>{value}</Text>
      {footnote ? <Text style={styles.levelFoot}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    gap: 10,
    marginBottom: spacing.sm,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  titleCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rank: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.moss,
    fontWeight: '700',
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: palette.ink,
    flexShrink: 1,
  },
  summary: {
    color: palette.muted,
    lineHeight: 20,
    fontSize: 14,
  },
  levels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  levelBox: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  levelDanger: {
    backgroundColor: '#FDECEC',
  },
  levelGood: {
    backgroundColor: palette.mossSoft,
  },
  levelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  levelValue: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
  },
  levelFoot: {
    fontSize: 11,
    color: palette.moss,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    color: palette.muted,
  },
  checkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
