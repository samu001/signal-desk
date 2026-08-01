import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function WatchlistFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { watchlist, setups, upsertWatchlistItem } = useTrading();
  const existing = watchlist.find((w) => w.id === id);

  const [symbol, setSymbol] = useState(existing?.symbol ?? '');
  const [thesis, setThesis] = useState(existing?.thesis ?? '');
  const [entryLow, setEntryLow] = useState(existing ? String(existing.entryLow) : '');
  const [entryHigh, setEntryHigh] = useState(existing ? String(existing.entryHigh) : '');
  const [stop, setStop] = useState(existing ? String(existing.stop) : '');
  const [target, setTarget] = useState(existing ? String(existing.target) : '');
  const [setupId, setSetupId] = useState<string | null>(existing?.setupId ?? setups[0]?.id ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');

  useEffect(() => {
    if (!existing) return;
    setSymbol(existing.symbol);
    setThesis(existing.thesis);
    setEntryLow(String(existing.entryLow));
    setEntryHigh(String(existing.entryHigh));
    setStop(String(existing.stop));
    setTarget(String(existing.target));
    setSetupId(existing.setupId);
    setNotes(existing.notes);
  }, [existing?.id]);

  const save = () => {
    if (!symbol.trim()) {
      Alert.alert('Symbol required');
      return;
    }
    const low = Number(entryLow);
    const high = Number(entryHigh);
    const stopN = Number(stop);
    const targetN = Number(target);
    if (![low, high, stopN, targetN].every((n) => n > 0)) {
      Alert.alert('Levels required', 'Enter buy zone, stop, and target.');
      return;
    }
    if (low > high) {
      Alert.alert('Buy zone invalid', 'Low must be ≤ high.');
      return;
    }

    upsertWatchlistItem({
      id: existing?.id,
      symbol,
      thesis: thesis.trim() || 'No thesis yet',
      entryLow: low,
      entryHigh: high,
      stop: stopN,
      target: targetN,
      setupId,
      notes,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? 'Edit watchlist' : 'Add watchlist', presentation: 'modal' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="What to buy"
          subtitle="Lock the thesis and levels so Today can tell you when the zone is live."
        />
        <Field label="Symbol" autoCapitalize="characters" value={symbol} onChangeText={setSymbol} />
        <Field
          label="Thesis"
          multiline
          value={thesis}
          onChangeText={setThesis}
          placeholder="Why this name, and what would prove you wrong?"
        />
        <Field label="Buy zone low" keyboardType="decimal-pad" value={entryLow} onChangeText={setEntryLow} />
        <Field label="Buy zone high" keyboardType="decimal-pad" value={entryHigh} onChangeText={setEntryHigh} />
        <Field label="Stop (get out)" keyboardType="decimal-pad" value={stop} onChangeText={setStop} />
        <Field label="Target" keyboardType="decimal-pad" value={target} onChangeText={setTarget} />

        <Text style={styles.fieldLabel}>Linked setup</Text>
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

        <Field label="Notes" multiline value={notes} onChangeText={setNotes} />
        <Button label="Save" onPress={save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
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
});
