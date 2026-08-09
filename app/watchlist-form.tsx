import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { fetchRecommendationsWithBundle } from '@/lib/fetchRecommendation';

export default function WatchlistFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const {
    watchlist,
    enabledSetups,
    settings,
    trades,
    upsertWatchlistItem,
    addWatchlistSymbol,
    applyDeskSignals,
    ingestMarketBundle,
    marketBundle,
    quotesUpdatedAt,
    liveBehavior,
  } = useTrading();
  const existing = watchlist.find((w) => w.id === id);
  const editing = Boolean(existing);

  const [symbol, setSymbol] = useState(existing?.symbol ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setSymbol(existing.symbol);
    setNotes(existing.notes);
  }, [existing?.id]);

  const saveNew = async () => {
    const ticker = symbol.trim();
    if (!ticker) {
      Alert.alert('Symbol required');
      return;
    }
    try {
      const { created } = addWatchlistSymbol(ticker);
      if (!created) {
        Alert.alert('Already on list', `${ticker.toUpperCase()} is already saved.`);
        router.back();
        return;
      }
      setSaving(true);
      try {
        const { recommendations, bundle, reusedMarket } = await fetchRecommendationsWithBundle(
          [ticker],
          settings,
          {
            setups: enabledSetups,
            trades,
            market: marketBundle,
            marketFetchedAt: quotesUpdatedAt,
            behavior: liveBehavior,
          }
        );
        const rec = recommendations[0];
        if (!rec) throw new Error('Could not get Desk signal.');
        if (!reusedMarket) {
          ingestMarketBundle(bundle);
        }
        applyDeskSignals([rec]);
      } catch (e) {
        Alert.alert(
          'Added without levels',
          e instanceof Error
            ? e.message
            : 'Could not get Desk signal. Use Refresh signals on Dashboard.'
        );
      } finally {
        setSaving(false);
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const saveEdit = () => {
    if (!existing) return;
    upsertWatchlistItem({
      id: existing.id,
      symbol: existing.symbol,
      thesis: existing.thesis,
      entryLow: existing.entryLow,
      entryHigh: existing.entryHigh,
      stop: existing.stop,
      target: existing.target,
      setupId: existing.setupId,
      notes,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ title: editing ? 'Edit ticker' : 'Add ticker', presentation: 'modal' }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <SectionTitle
              title={existing?.symbol ?? 'Ticker'}
              subtitle="Levels come from Desk only. Refresh signals on Dashboard to update them."
            />
            <Text style={styles.levels}>
              Buy {existing && existing.entryHigh > 0 ? `${existing.entryLow}–${existing.entryHigh}` : 'pending'} ·
              Stop {existing && existing.stop > 0 ? existing.stop : '—'} · Target{' '}
              {existing && existing.target > 0 ? existing.target : '—'}
            </Text>
            <Field label="Notes" multiline value={notes} onChangeText={setNotes} />
            <Button label="Save notes" onPress={saveEdit} />
          </>
        ) : (
          <>
            <SectionTitle
              title="Add ticker"
              subtitle="Symbol only. Desk fills levels and Playbook match automatically."
            />
            <Field
              label="Symbol"
              autoCapitalize="characters"
              autoCorrect={false}
              value={symbol}
              onChangeText={(t) => setSymbol(t.toUpperCase())}
              placeholder="e.g. AAPL"
              onSubmitEditing={() => void saveNew()}
              returnKeyType="done"
            />
            <Button
              label={saving ? 'Getting Desk levels…' : 'Add & get Desk levels'}
              onPress={() => void saveNew()}
              disabled={saving}
            />
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
  levels: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.muted,
    marginBottom: spacing.md,
  },
});
