import { Link } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompactDeskScorecard, stanceTone } from '@/components/DeskScorecard';
import { SetupOptionCard } from '@/components/SetupOptionCard';
import { Button, formatMoney, Pill } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { Recommendation, SetupOption } from '@/lib/recommend';

/**
 * Consolidated Desk view: overall stance + compact scorecard + ranked Playbook signals.
 * Full factor / gate breakdown lives on the Desk detail route.
 */
export function DeskSignalDetail({
  recommendation,
  watchlistId,
  onUseSetup,
  footer,
}: {
  recommendation: Recommendation;
  /** When set, full Desk can apply setup levels back onto this watchlist row. */
  watchlistId?: string;
  /** Apply this setup's levels onto the watchlist row (and optionally act). */
  onUseSetup?: (option: SetupOption) => void;
  footer?: ReactNode;
}) {
  const deskHref = {
    pathname: '/desk-detail' as const,
    params: {
      symbol: recommendation.symbol,
      ...(watchlistId ? { watchlistId } : {}),
    },
  };

  return (
    <View style={styles.card}>
      <Text style={styles.sectionEyebrow}>Desk verdict</Text>
      <View style={styles.top}>
        <View>
          <Text style={styles.symbol}>{recommendation.symbol}</Text>
          <Text style={styles.price}>{formatMoney(recommendation.price)}</Text>
        </View>
        <View style={styles.badges}>
          <Pill label={recommendation.label} tone={stanceTone(recommendation.stance)} />
          <Pill
            label={
              recommendation.tradeable
                ? 'Tradeable Soft/Strong'
                : recommendation.researchInteresting
                  ? 'Research only'
                  : 'Stand aside'
            }
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
      <Text style={styles.confidence}>
        Confidence {recommendation.confidence}%
        {recommendation.bestSetupName && recommendation.rewardToRisk != null
          ? ` · ~${recommendation.rewardToRisk.toFixed(1)}R on primary`
          : ''}
      </Text>

      {recommendation.candleSource === 'none' || recommendation.label === 'No data' ? (
        <Text style={styles.demoWarn}>
          No data — live daily history unavailable. Desk will not issue Soft/Strong. Check API keys
          / Yahoo proxy in Settings, then Refresh signals.
        </Text>
      ) : null}

      <CompactDeskScorecard recommendation={recommendation} />

      {recommendation.candleSource !== 'none' && recommendation.label !== 'No data' ? (
        <Link href={deskHref} asChild>
          <Pressable style={styles.fullDeskLink}>
            <Text style={styles.fullDeskText}>Open full Desk scorecard →</Text>
          </Pressable>
        </Link>
      ) : null}

      {/* Primary levels only when a Playbook setup matched — otherwise Desk still
          computes generic structure levels internally, but they are not a signal. */}
      {recommendation.candleSource !== 'none' &&
      recommendation.label !== 'No data' &&
      recommendation.bestSetupName ? (
        <View style={styles.primaryBox}>
          <Text style={styles.sectionEyebrow}>Primary levels (strongest signal)</Text>
          <Text style={styles.levels}>
            Buy {formatMoney(recommendation.levels.entryLow)}–
            {formatMoney(recommendation.levels.entryHigh)} · Stop{' '}
            {formatMoney(recommendation.levels.stop)} · Target{' '}
            {formatMoney(recommendation.levels.target)}
          </Text>
          <Text style={styles.setup}>From · {recommendation.bestSetupName}</Text>
        </View>
      ) : null}

      {recommendation.candleSource === 'none' || recommendation.label === 'No data' ? null : (
        <>
          <Text style={styles.sectionEyebrow}>
            Playbook signals · strongest first ({recommendation.setupOptions.length})
          </Text>
          <Text style={styles.sectionHint}>
            Each matched setup has its own buy zone, stop, and target. Pick one to size a trade.
          </Text>

          {recommendation.setupOptions.length === 0 ? (
            <View style={styles.blockerBox}>
              <Text style={styles.setupWarn}>No setups currently pass machine checks.</Text>
              {recommendation.playbookBlockers.length ? (
                <>
                  <Text style={styles.blockerTitle}>What blocked the Playbook</Text>
                  {recommendation.playbookBlockers.slice(0, 2).map((blocker) => (
                    <Text key={`${blocker.label}-${blocker.detail}`} style={styles.blockerText}>
                      • {blocker.label}: {blocker.detail}
                    </Text>
                  ))}
                </>
              ) : null}
            </View>
          ) : (
            recommendation.setupOptions.map((option) => (
              <View key={`${recommendation.symbol}-${option.setupId}`} style={styles.optionWrap}>
                <SetupOptionCard option={option} />
                {onUseSetup ? (
                  <Button
                    label={
                      recommendation.tradeable
                        ? `Use #${option.rank} levels & act →`
                        : `Use #${option.rank} levels (research only)`
                    }
                    onPress={() => onUseSetup(option)}
                    variant={option.rank === 1 && recommendation.tradeable ? 'primary' : 'ghost'}
                  />
                ) : null}
              </View>
            ))
          )}
        </>
      )}

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
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  sectionHint: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -4,
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
  primaryBox: {
    backgroundColor: palette.white,
    borderRadius: 10,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: palette.line,
  },
  levels: {
    fontFamily: 'SpaceMono',
    fontSize: 12,
    color: palette.ink,
  },
  demoWarn: {
    color: palette.warn,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  setup: { color: palette.moss, fontWeight: '600', fontSize: 13 },
  setupWarn: { color: palette.warn, fontWeight: '600' },
  blockerBox: {
    backgroundColor: palette.warnSoft,
    borderRadius: 10,
    padding: spacing.sm,
    gap: 4,
  },
  blockerTitle: { color: palette.ink, fontSize: 12.5, fontWeight: '700', marginTop: 2 },
  blockerText: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  confidence: { color: palette.muted, fontSize: 13 },
  optionWrap: {
    gap: 8,
    marginBottom: 4,
  },
  fullDeskLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  fullDeskText: { color: palette.moss, fontWeight: '700', fontSize: 14 },
  backtestLink: { marginTop: 4 },
  backtestText: { color: palette.moss, fontWeight: '700', fontSize: 13 },
});
