import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, formatPct, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { Candidate } from '@/lib/candidates';

function toneFor(status: Candidate['status']) {
  if (status === 'in_zone') return 'good' as const;
  if (status === 'near_zone') return 'warn' as const;
  if (status === 'invalidated') return 'bad' as const;
  return 'neutral' as const;
}

export function CandidateRow({ candidate }: { candidate: Candidate }) {
  const { item, quote, setup, label } = candidate;

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

        {setup ? <Text style={styles.setup}>Setup · {setup.name}</Text> : null}
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
  setup: {
    color: palette.moss,
    fontWeight: '600',
    fontSize: 13,
  },
});
