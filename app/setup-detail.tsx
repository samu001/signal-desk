import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { ruleCheckLabel } from '@/lib/rules';

export default function SetupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { setups, updateSetup } = useTrading();
  const setup = setups.find((s) => s.id === id);

  const [name, setName] = useState(setup?.name ?? '');
  const [summary, setSummary] = useState(setup?.summary ?? '');

  useEffect(() => {
    if (!setup) return;
    setName(setup.name);
    setSummary(setup.summary);
  }, [setup?.id]);

  if (!setup) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: 'Setup' }} />
        <Text>Setup not found.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const save = () => {
    updateSetup({
      ...setup,
      name: name.trim() || setup.name,
      summary: summary.trim(),
      enabled: setup.enabled,
    });
    Alert.alert('Saved', 'Playbook setup updated on this device.');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: setup.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Edit setup"
          subtitle="Name and summary only. Machine auto-checks drive Dashboard scoring — they are not edited here."
        />
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Summary" multiline value={summary} onChangeText={setSummary} />

        <View style={styles.layerHead}>
          <Text style={styles.layerTitle}>Machine auto-checks</Text>
          <Text style={styles.layerHint}>
            Read-only. Soft/Strong buy and Dashboard pass rates use these checks.
          </Text>
        </View>
        <View style={styles.checksBox}>
          {setup.entryChecks.length === 0 ? (
            <Text style={styles.checkItem}>No auto-checks configured for this setup.</Text>
          ) : (
            setup.entryChecks.map((check) => (
              <View key={check} style={styles.checkRow}>
                <Text style={styles.checkItem}>{ruleCheckLabel(check)}</Text>
                <Text style={styles.checkId}>{check}</Text>
              </View>
            ))
          )}
        </View>

        <Button label="Save setup" onPress={save} />
        <View style={{ height: spacing.sm }} />
        <Button
          label="Backtest this setup"
          variant="ghost"
          onPress={() =>
            router.push({ pathname: '/backtest', params: { setupId: setup.id } })
          }
        />
        <Button label="All Lab tools →" variant="ghost" onPress={() => router.push('/lab')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  layerHead: {
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    gap: 4,
  },
  layerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
  },
  layerHint: {
    color: palette.muted,
    lineHeight: 20,
    fontSize: 13,
  },
  checksBox: {
    backgroundColor: palette.mist,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 10,
  },
  checkRow: {
    gap: 2,
  },
  checkItem: {
    color: palette.ink,
    fontWeight: '600',
  },
  checkId: {
    color: palette.muted,
    fontFamily: 'SpaceMono',
    fontSize: 11,
  },
});
