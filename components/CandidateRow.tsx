import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, formatPct, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { Candidate } from '@/lib/candidates';

function toneFor(status: Candidate['status']) {
  if (status === 'ready') return 'good' as const;
  if (status === 'in_zone') return 'good' as const;
  if (status === 'near_zone') return 'warn' as const;
  if (status === 'stop_threatened' || status === 'invalidated') return 'bad' as const;
  return 'neutral' as const;
}

function verdictMark(verdict: 'pass' | 'fail' | 'unknown') {
  if (verdict === 'pass') return '✓';
  if (verdict === 'fail') return '✕';
  return '·';
}

export function CandidateRow({ candidate }: { candidate: Candidate }) {
  const { item, quote, setup, label, rules, passRate, expectancy } = candidate;
  const topRules = rules.slice(0, 4);

  return (
    <Link
      href={{ pathname: '/trade-plan', params: { watchlistId: item.id } }}
      asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
        <View style={styles.top}>
          <Text style={styles.symbol}>{item.symbol}</Text>
          <Pill label={label} tone={toneFor(candidate.status)} />
        </View>

        <Text style={styles.thesis} numberOfLines={2}>
          {item.thesis}
        </Text>

        <View style={styles.meta}>
          <View>
            <Text style={styles.metaLabel}>Last</Text>
            <Text style={styles.metaValue}>
              {quote ? formatMoney(quote.price) : '—'}
            </Text>
            {quote ? (
              <Text
                style={[
                  styles.change,
                  { color: quote.change >= 0 ? palette.leaf : palette.danger },
                ]}>
                {formatPct(quote.percentChange)}
              </Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.metaLabel}>Buy zone</Text>
            <Text style={styles.metaValue}>
              {formatMoney(item.entryLow, 0)}–{formatMoney(item.entryHigh, 0)}
            </Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Get out</Text>
            <Text style={styles.metaValue}>Stop {formatMoney(item.stop, 0)}</Text>
            <Text style={styles.metaSub}>Target {formatMoney(item.target, 0)}</Text>
          </View>
        </View>

        <View style={styles.scoreRow}>
          <Text style={styles.setup}>
            {setup ? setup.name : 'Custom'} · rules {Math.round(passRate * 100)}%
          </Text>
          {expectancy && expectancy.sampleSize > 0 ? (
            <Text style={styles.expectancy}>
              Edge {expectancy.avgR == null ? '—' : `${expectancy.avgR.toFixed(2)}R`} · n=
              {expectancy.sampleSize}
            </Text>
          ) : (
            <Text style={styles.expectancy}>Edge learning…</Text>
          )}
        </View>

        <View style={styles.rules}>
          {topRules.map((rule) => (
            <Text
              key={rule.id}
              style={[
                styles.rule,
                rule.verdict === 'pass' && styles.rulePass,
                rule.verdict === 'fail' && styles.ruleFail,
              ]}
              numberOfLines={1}>
              {verdictMark(rule.verdict)} {rule.label}
            </Text>
          ))}
          {rules.length > 4 ? (
            <Text style={styles.ruleMore}>+{rules.length - 4} more checks</Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 10,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 22,
    color: palette.ink,
  },
  thesis: {
    color: palette.ink,
    lineHeight: 20,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  metaLabel: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: 2,
  },
  metaValue: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
  },
  metaSub: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.muted,
    marginTop: 2,
  },
  change: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    marginTop: 2,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  setup: {
    color: palette.moss,
    fontWeight: '600',
    fontSize: 13,
  },
  expectancy: {
    color: palette.muted,
    fontSize: 12,
  },
  rules: {
    gap: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: palette.mist,
  },
  rule: {
    fontSize: 12,
    color: palette.muted,
  },
  rulePass: {
    color: palette.moss,
  },
  ruleFail: {
    color: palette.danger,
  },
  ruleMore: {
    fontSize: 12,
    color: palette.muted,
    fontStyle: 'italic',
  },
});
