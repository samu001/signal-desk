import { Link } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SetupOptionCard } from '@/components/SetupOptionCard';
import { formatMoney, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { Recommendation, Stance } from '@/lib/recommend';

function stanceTone(stance: Stance): 'good' | 'warn' | 'bad' | 'neutral' {
  if (stance === 'strong_buy') return 'good';
  if (stance === 'soft_buy') return 'warn';
  if (stance === 'avoid') return 'bad';
  return 'neutral';
}

export function DeskSignalDetail({
  recommendation,
  footer,
}: {
  recommendation: Recommendation;
  footer?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View>
          <Text style={styles.symbol}>{recommendation.symbol}</Text>
          <Text style={styles.price}>{formatMoney(recommendation.price)}</Text>
        </View>
        <View style={styles.badges}>
          <Pill label={recommendation.label} tone={stanceTone(recommendation.stance)} />
          <Pill
            label={recommendation.researchLabel}
            tone={
              recommendation.tradeable
                ? 'good'
                : recommendation.researchInteresting
                  ? 'warn'
                  : 'neutral'
            }
          />
        </View>
      </View>

      <Text style={styles.summary}>{recommendation.summary}</Text>
      <Text style={styles.levels}>
        Entry {formatMoney(recommendation.levels.entryLow)}–
        {formatMoney(recommendation.levels.entryHigh)} · Stop {formatMoney(recommendation.levels.stop)}{' '}
        · Target {formatMoney(recommendation.levels.target)}
      </Text>

      {recommendation.bestSetupName ? (
        <Text style={styles.setup}>
          Top Playbook · {recommendation.bestSetupName}
          {recommendation.setupOptions.length > 1
            ? ` (+${recommendation.setupOptions.length - 1} more)`
            : ''}
        </Text>
      ) : (
        <Text style={styles.setupWarn}>No Playbook setup matched — buys blocked</Text>
      )}

      <Text style={styles.confidence}>
        Confidence {recommendation.confidence}%
        {recommendation.rewardToRisk != null
          ? ` · ~${recommendation.rewardToRisk.toFixed(1)}R primary`
          : ''}
      </Text>

      {recommendation.setupOptions.length > 0 ? (
        <View style={styles.optionsWrap}>
          <Text style={styles.optionsTitle}>
            Setup options ({recommendation.setupOptions.length})
          </Text>
          {recommendation.setupOptions.map((option) => (
            <SetupOptionCard
              key={`${recommendation.symbol}-${option.setupId}`}
              option={option}
            />
          ))}
        </View>
      ) : null}

      <Link href="/lab" asChild>
        <Pressable style={styles.backtestLink}>
          <Text style={styles.backtestText}>Open Lab (all backtests) →</Text>
        </Pressable>
      </Link>
      <Link
        href={`/desk-backtest?symbol=${encodeURIComponent(recommendation.symbol)}`}
        asChild>
        <Pressable style={styles.backtestLink}>
          <Text style={styles.backtestText}>Backtest Desk on {recommendation.symbol} →</Text>
        </Pressable>
      </Link>

      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: 8,
    gap: 8,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  badges: { gap: 6, alignItems: 'flex-end' },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 18,
    color: palette.ink,
  },
  price: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.muted,
    marginTop: 2,
  },
  summary: { color: palette.ink, lineHeight: 21 },
  levels: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.muted,
  },
  setup: { color: palette.moss, fontWeight: '600' },
  setupWarn: { color: palette.warn, fontWeight: '600' },
  confidence: { color: palette.muted, fontSize: 13 },
  optionsWrap: { marginTop: 4, gap: 4 },
  optionsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  backtestLink: { marginTop: 4 },
  backtestText: { color: palette.moss, fontWeight: '700', fontSize: 13 },
});
