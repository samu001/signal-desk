import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Field, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { calculatePositionSize, rewardToRisk } from '@/lib/positionSize';

export default function TradePlanScreen() {
  const router = useRouter();
  const { watchlistId } = useLocalSearchParams<{ watchlistId?: string }>();
  const { watchlist, setups, settings, quotes, addTrade, getSetup } = useTrading();

  const seed = watchlist.find((w) => w.id === watchlistId);

  const [symbol, setSymbol] = useState(seed?.symbol ?? '');
  const [entry, setEntry] = useState(seed ? String(seed.entryLow) : '');
  const [stop, setStop] = useState(seed ? String(seed.stop) : '');
  const [target, setTarget] = useState(seed ? String(seed.target) : '');
  const [setupId, setSetupId] = useState<string | null>(seed?.setupId ?? setups[0]?.id ?? null);
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [checks, setChecks] = useState<{ label: string; checked: boolean }[]>([]);

  const setup = getSetup(setupId);

  useEffect(() => {
    if (!setup) {
      setChecks([]);
      return;
    }
    setChecks(setup.checklist.map((label) => ({ label, checked: false })));
  }, [setupId]);

  useEffect(() => {
    if (!seed) return;
    setSymbol(seed.symbol);
    setEntry(String(seed.entryLow));
    setStop(String(seed.stop));
    setTarget(String(seed.target));
    setSetupId(seed.setupId);
    setNotes(seed.notes);
  }, [seed?.id]);

  const entryN = Number(entry);
  const stopN = Number(stop);
  const targetN = Number(target);
  const quote = quotes[symbol.toUpperCase()];

  const sizing = useMemo(
    () =>
      calculatePositionSize({
        accountSize: settings.accountSize,
        riskPercent: settings.riskPercent,
        entry: entryN,
        stop: stopN,
      }),
    [settings.accountSize, settings.riskPercent, entryN, stopN]
  );

  const rr = rewardToRisk(entryN, stopN, targetN);
  const allChecked = checks.length > 0 && checks.every((c) => c.checked);

  const save = (status: 'planned' | 'open') => {
    if (!symbol.trim()) {
      Alert.alert('Symbol required');
      return;
    }
    if (!sizing.valid) {
      Alert.alert('Position size invalid', sizing.reason);
      return;
    }
    if (checks.length && !allChecked) {
      Alert.alert('Checklist incomplete', 'Confirm every item before saving a live plan.');
      return;
    }

    const id = addTrade({
      symbol: symbol.toUpperCase().trim(),
      setupId,
      side: 'long',
      entry: entryN,
      stop: stopN,
      target: targetN,
      shares: sizing.shares,
      riskAmount: sizing.riskAmount,
      checklist: checks,
      notes,
      status,
      followedPlan: null,
      openedAt: new Date().toISOString(),
      closedAt: null,
      exitPrice: null,
    });

    router.replace({ pathname: '/trade-detail', params: { id } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Trade plan', presentation: 'modal' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="What · when · exit"
          subtitle="Size the trade from your risk rules, then clear the checklist before you act."
        />

        <Field label="Symbol" autoCapitalize="characters" value={symbol} onChangeText={setSymbol} />
        {quote ? (
          <Text style={styles.quoteHint}>
            Last {formatMoney(quote.price)} ({quote.source === 'finnhub' ? 'Finnhub' : 'demo'})
          </Text>
        ) : null}

        <Field
          label="Entry"
          keyboardType="decimal-pad"
          value={entry}
          onChangeText={setEntry}
        />
        <Field label="Stop (get out)" keyboardType="decimal-pad" value={stop} onChangeText={setStop} />
        <Field label="Target" keyboardType="decimal-pad" value={target} onChangeText={setTarget} />

        <Text style={styles.fieldLabel}>Setup</Text>
        <View style={styles.setupRow}>
          {setups.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setSetupId(s.id)}
              style={[styles.setupChip, setupId === s.id && styles.setupChipOn]}>
              <Text style={[styles.setupChipText, setupId === s.id && styles.setupChipTextOn]}>
                {s.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sizeBox}>
          <Text style={styles.sizeTitle}>Position size</Text>
          <Text style={styles.sizeLine}>
            Risk {settings.riskPercent}% of {formatMoney(settings.accountSize, 0)} ={' '}
            {formatMoney(sizing.riskAmount)}
          </Text>
          <Text style={styles.sizeLine}>
            Shares: {sizing.valid ? sizing.shares : '—'} · Position{' '}
            {sizing.valid ? formatMoney(sizing.positionValue, 0) : '—'}
          </Text>
          <Text style={styles.sizeLine}>R:R {rr == null || Number.isNaN(rr) ? '—' : `${rr.toFixed(2)}R`}</Text>
          {!sizing.valid && sizing.reason ? <Text style={styles.sizeWarn}>{sizing.reason}</Text> : null}
        </View>

        {checks.length > 0 ? (
          <View style={styles.checkBox}>
            <View style={styles.checkHead}>
              <Text style={styles.sizeTitle}>Pre-trade checklist</Text>
              <Pill label={allChecked ? 'Ready' : 'Incomplete'} tone={allChecked ? 'good' : 'warn'} />
            </View>
            {checks.map((item, idx) => (
              <Pressable
                key={`${item.label}-${idx}`}
                style={styles.checkRow}
                onPress={() =>
                  setChecks((prev) =>
                    prev.map((c, i) => (i === idx ? { ...c, checked: !c.checked } : c))
                  )
                }>
                <View style={[styles.box, item.checked && styles.boxOn]}>
                  {item.checked ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Field
          label="Notes"
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="Catalyst, invalidation reminder, session plan…"
        />

        <Button label="Save as planned" onPress={() => save('planned')} />
        <View style={{ height: spacing.sm }} />
        <Button label="Mark open now" onPress={() => save('open')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  quoteHint: {
    marginTop: -8,
    marginBottom: spacing.md,
    color: palette.muted,
    fontFamily: 'SpaceMono',
    fontSize: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  setupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.md,
  },
  setupChip: {
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  setupChipOn: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  setupChipText: { color: palette.ink, fontWeight: '600', fontSize: 13 },
  setupChipTextOn: { color: palette.moss },
  sizeBox: {
    backgroundColor: palette.sand,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
    marginBottom: spacing.md,
    gap: 4,
  },
  sizeTitle: {
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 4,
  },
  sizeLine: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
  },
  sizeWarn: { color: palette.danger, marginTop: 6 },
  checkBox: {
    backgroundColor: palette.white,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
    marginBottom: spacing.md,
    gap: 10,
  },
  checkHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  checkRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: {
    backgroundColor: palette.moss,
    borderColor: palette.moss,
  },
  tick: { color: palette.white, fontWeight: '700', fontSize: 12 },
  checkLabel: { flex: 1, color: palette.ink, lineHeight: 20 },
});
