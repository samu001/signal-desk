import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

function linesToText(lines: string[]) {
  return lines.join('\n');
}

function textToLines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function SetupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setups, updateSetup } = useTrading();
  const setup = setups.find((s) => s.id === id);

  const [name, setName] = useState(setup?.name ?? '');
  const [summary, setSummary] = useState(setup?.summary ?? '');
  const [entryRules, setEntryRules] = useState(linesToText(setup?.entryRules ?? []));
  const [exitRules, setExitRules] = useState(linesToText(setup?.exitRules ?? []));
  const [checklist, setChecklist] = useState(linesToText(setup?.checklist ?? []));

  useEffect(() => {
    if (!setup) return;
    setName(setup.name);
    setSummary(setup.summary);
    setEntryRules(linesToText(setup.entryRules));
    setExitRules(linesToText(setup.exitRules));
    setChecklist(linesToText(setup.checklist));
  }, [setup?.id]);

  if (!setup) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: 'Setup' }} />
        <Text>Setup not found.</Text>
      </Screen>
    );
  }

  const save = () => {
    updateSetup({
      ...setup,
      name: name.trim() || setup.name,
      summary: summary.trim(),
      entryRules: textToLines(entryRules),
      exitRules: textToLines(exitRules),
      checklist: textToLines(checklist),
    });
    Alert.alert('Saved', 'Playbook setup updated on this device.');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: setup.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Edit setup"
          subtitle="One line per rule. These drive your pre-trade checklist."
        />
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Summary" multiline value={summary} onChangeText={setSummary} />
        <Field
          label="When to buy (entry rules)"
          multiline
          value={entryRules}
          onChangeText={setEntryRules}
        />
        <Field
          label="When to get out (exit rules)"
          multiline
          value={exitRules}
          onChangeText={setExitRules}
        />
        <Field
          label="Checklist items"
          multiline
          value={checklist}
          onChangeText={setChecklist}
        />
        <Button label="Save setup" onPress={save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
});
