import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { AWAITING_DESK_THESIS } from '@/constants/watchlist';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function WatchlistFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { watchlist, setups, upsertWatchlistItem, addWatchlistSymbol } = useTrading();
  const existing = watchlist.find((w) => w.id === id);
  const editing = Boolean(existing);

  const [symbol, setSymbol] = useState(existing?.symbol ?? '');
  const [thesis, setThesis] = useState(existing?.thesis ?? '');
  const [entryLow, setEntryLow] = useState(existing ? String(existing.entryLow || '') : '');
  const [entryHigh, setEntryHigh] = useState(existing ? String(existing.entryHigh || '') : '');
  const [stop, setStop] = useState(existing ? String(existing.stop || '') : '');
  const [target, setTarget] = useState(existing ? String(existing.target || '') : '');
  const [setupId, setSetupId] = useState<string | null>(existing?.setupId ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');

  useEffect(() => {
    if (!existing) return;
    setSymbol(existing.symbol);
    setThesis(existing.thesis);
    setEntryLow(existing.entryLow > 0 ? String(existing.entryLow) : '');
    setEntryHigh(existing.entryHigh > 0 ? String(existing.entryHigh) : '');
    setStop(existing.stop > 0 ? String(existing.stop) : '');
    setTarget(existing.target > 0 ? String(existing.target) : '');
    setSetupId(existing.setupId);
    setNotes(existing.notes);
  }, [existing?.id]);

  const saveNew = () => {
    const ticker = symbol.trim();
    if (!ticker) {
      Alert.alert('Symbol required');
      return;
    }
    try {
      const { created } = addWatchlistSymbol(ticker);
      if (!created) {
        Alert.alert('Already on watchlist', `${ticker.toUpperCase()} is already saved.`);
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const saveEdit = () => {
    if (!existing) return;
    if (!symbol.trim()) {
      Alert.alert('Symbol required');
      return;
    }

    const low = entryLow.trim() ? Number(entryLow) : 0;
    const high = entryHigh.trim() ? Number(entryHigh) : 0;
    const stopN = stop.trim() ? Number(stop) : 0;
    const targetN = target.trim() ? Number(target) : 0;
    const hasLevels = [low, high, stopN, targetN].every((n) => n > 0);

    if (entryLow || entryHigh || stop || target) {
      if (!hasLevels) {
        Alert.alert('Levels incomplete', 'Fill buy zone, stop, and target — or clear them for Desk.');
        return;
      }
      if (low > high) {
        Alert.alert('Buy zone invalid', 'Low must be ≤ high.');
        return;
      }
    }

    upsertWatchlistItem({
      id: existing.id,
      symbol,
      thesis: thesis.trim() || (hasLevels ? existing.thesis || AWAITING_DESK_THESIS : AWAITING_DESK_THESIS),
      entryLow: hasLevels ? low : 0,
      entryHigh: hasLevels ? high : 0,
      stop: hasLevels ? stopN : 0,
      target: hasLevels ? targetN : 0,
      setupId,
      notes,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ title: editing ? 'Edit watchlist' : 'Add ticker', presentation: 'modal' }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <SectionTitle
              title="Edit symbol"
              subtitle="Levels are optional — leave blank and use Get signals on Watchlist for Desk levels."
            />
            <Field label="Symbol" autoCapitalize="characters" value={symbol} onChangeText={setSymbol} />
            <Field
              label="Thesis"
              multiline
              value={thesis}
              onChangeText={setThesis}
              placeholder="Optional — Desk fills this when you get signals"
            />
            <Field
              label="Buy zone low"
              keyboardType="decimal-pad"
              value={entryLow}
              onChangeText={setEntryLow}
              placeholder="Optional"
            />
            <Field
              label="Buy zone high"
              keyboardType="decimal-pad"
              value={entryHigh}
              onChangeText={setEntryHigh}
              placeholder="Optional"
            />
            <Field
              label="Stop (get out)"
              keyboardType="decimal-pad"
              value={stop}
              onChangeText={setStop}
              placeholder="Optional"
            />
            <Field
              label="Target"
              keyboardType="decimal-pad"
              value={target}
              onChangeText={setTarget}
              placeholder="Optional"
            />

            <Text style={styles.fieldLabel}>Linked setup</Text>
            <View style={styles.setupRow}>
              <Pressable
                onPress={() => setSetupId(null)}
                style={[styles.setupChip, setupId == null && styles.setupChipOn]}>
                <Text style={[styles.setupChipText, setupId == null && styles.setupChipTextOn]}>
                  Desk picks
                </Text>
              </Pressable>
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
            <Button label="Save" onPress={saveEdit} />
          </>
        ) : (
          <>
            <SectionTitle
              title="Add ticker"
              subtitle="Just the symbol. Desk checks every Playbook setup when you Get signals."
            />
            <Field
              label="Symbol"
              autoCapitalize="characters"
              autoCorrect={false}
              value={symbol}
              onChangeText={(t) => setSymbol(t.toUpperCase())}
              placeholder="e.g. AAPL"
              onSubmitEditing={saveNew}
              returnKeyType="done"
            />
            <Button label="Add to watchlist" onPress={saveNew} />
          </>
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
