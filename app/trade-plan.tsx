import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { hasWatchlistLevels } from '@/constants/watchlist';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { calculatePositionSize, rewardToRisk } from '@/lib/positionSize';
import { ruleCheckLabel } from '@/lib/rules';

/**
 * Machine-guided action confirm: Desk levels + risk sizing.
 * No freeform levels, setup chips, or human checklists.
 */
export default function ActFromDeskScreen() {
  const router = useRouter();
  const { watchlistId } = useLocalSearchParams<{ watchlistId?: string }>();
  const { watchlist, settings, quotes, addTrade, getSetup, candidates } = useTrading();

  const item = watchlist.find((w) => w.id === watchlistId);
  const candidate = candidates.find((c) => c.item.id === watchlistId);
  const setup = getSetup(item?.setupId);
  const levelsReady = item ? hasWatchlistLevels(item) : false;

  const entry = item ? (item.entryLow + item.entryHigh) / 2 : 0;
  const stop = item?.stop ?? 0;
  const target = item?.target ?? 0;
  const quote = item ? quotes[item.symbol.toUpperCase()] : undefined;

  const sizing = useMemo(
    () =>
      calculatePositionSize({
        accountSize: settings.accountSize,
        riskPercent: settings.riskPercent,
        entry,
        stop,
      }),
    [settings.accountSize, settings.riskPercent, entry, stop]
  );

  const rr = rewardToRisk(entry, stop, target);
  const canAct = Boolean(item && levelsReady && sizing.valid);

  const save = (status: 'planned' | 'open') => {
    if (!item || !levelsReady) {
      Alert.alert('Desk levels required', 'Refresh signals on Dashboard first.');
      return;
    }
    if (!sizing.valid) {
      Alert.alert('Position size invalid', sizing.reason);
      return;
    }

    const machineChecks = (candidate?.rules ?? []).map((r) => ({
      label: r.label || ruleCheckLabel(r.id),
      checked: r.verdict === 'pass',
    }));

    const id = addTrade({
      symbol: item.symbol,
      setupId: item.setupId,
      side: 'long',
      entry,
      stop,
      target,
      shares: sizing.shares,
      riskAmount: sizing.riskAmount,
      checklist: machineChecks,
      notes: item.thesis || '',
      status,
      followedPlan: null,
      openedAt: new Date().toISOString(),
      closedAt: null,
      exitPrice: null,
    });

    router.replace({ pathname: '/trade-detail', params: { id } });
  };

  if (!watchlistId || !item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Act from Desk', presentation: 'modal' }} />
        <View style={styles.centered}>
          <SectionTitle
            title="Pick a Desk name"
            subtitle="Open this from Dashboard Act now or Your names — Desk must already have levels."
          />
          <Button label="Back to Dashboard" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Act from Desk', presentation: 'modal' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title={item.symbol}
          subtitle="Desk wrote the levels. Confirm size from your risk settings — no manual plan rewrite."
        />

        {!levelsReady ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              No Desk levels yet. Return to Dashboard and Refresh signals.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.symbol}>{item.symbol}</Text>
            {candidate ? (
              <Pill
                label={candidate.label}
                tone={
                  candidate.status === 'ready' || candidate.status === 'in_zone'
                    ? 'good'
                    : candidate.status === 'near_zone'
                      ? 'warn'
                      : 'neutral'
                }
              />
            ) : null}
          </View>
          {quote ? (
            <Text style={styles.meta}>Last {formatMoney(quote.price)}</Text>
          ) : null}
          {setup ? <Text style={styles.setup}>Playbook · {setup.name}</Text> : null}
          {item.thesis ? <Text style={styles.thesis}>{item.thesis}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Desk levels</Text>
          <Text style={styles.levels}>
            Buy {formatMoney(item.entryLow)}–{formatMoney(item.entryHigh)}
          </Text>
          <Text style={styles.levels}>
            Sized entry {formatMoney(entry)} · Stop {formatMoney(stop)} · Target{' '}
            {formatMoney(target)}
          </Text>
          <Text style={styles.meta}>
            R:R {rr == null || Number.isNaN(rr) ? '—' : `${rr.toFixed(2)}R`}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Machine size</Text>
          <Text style={styles.levels}>
            Risk {settings.riskPercent}% of {formatMoney(settings.accountSize, 0)} ={' '}
            {formatMoney(sizing.riskAmount)}
          </Text>
          <Text style={styles.levels}>
            Shares: {sizing.valid ? sizing.shares : '—'} · Position{' '}
            {sizing.valid ? formatMoney(sizing.positionValue, 0) : '—'}
          </Text>
          {!sizing.valid && sizing.reason ? (
            <Text style={styles.sizeWarn}>{sizing.reason}</Text>
          ) : null}
        </View>

        {candidate && candidate.rules.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>Machine checks</Text>
              <Pill
                label={`${Math.round(candidate.passRate * 100)}% pass`}
                tone={candidate.passRate >= 0.7 ? 'good' : candidate.passRate >= 0.4 ? 'warn' : 'bad'}
              />
            </View>
            {candidate.rules.map((rule) => (
              <Text
                key={rule.id}
                style={[
                  styles.checkLine,
                  rule.verdict === 'pass' && styles.checkPass,
                  rule.verdict === 'fail' && styles.checkFail,
                ]}>
                {rule.verdict === 'pass' ? '✓' : rule.verdict === 'fail' ? '✕' : '·'}{' '}
                {rule.label || ruleCheckLabel(rule.id)}
              </Text>
            ))}
          </View>
        ) : null}

        <Button
          label="Queue as planned"
          onPress={() => save('planned')}
          disabled={!canAct}
        />
        <View style={{ height: spacing.sm }} />
        <Button label="Mark open now" onPress={() => save('open')} disabled={!canAct} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  warnBox: {
    backgroundColor: palette.warnSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: spacing.md,
  },
  warnText: {
    color: palette.warn,
    lineHeight: 20,
  },
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 24,
    color: palette.ink,
  },
  cardTitle: {
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 2,
  },
  meta: {
    color: palette.muted,
    fontFamily: 'SpaceMono',
    fontSize: 13,
  },
  setup: {
    color: palette.moss,
    fontWeight: '600',
  },
  thesis: {
    color: palette.ink,
    lineHeight: 20,
  },
  levels: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
  },
  sizeWarn: { color: palette.danger, marginTop: 4 },
  checkLine: {
    fontSize: 13,
    color: palette.muted,
    lineHeight: 20,
  },
  checkPass: { color: palette.moss },
  checkFail: { color: palette.danger },
});
