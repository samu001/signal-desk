import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function SettingsScreen() {
  const { settings, updateSettings, refreshQuotes } = useTrading();
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [accountSize, setAccountSize] = useState(String(settings.accountSize));
  const [riskPercent, setRiskPercent] = useState(String(settings.riskPercent));
  const [marketBias, setMarketBias] = useState(settings.marketBias);
  const [apiKey, setApiKey] = useState(settings.finnhubApiKey);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAccountSize(String(settings.accountSize));
    setRiskPercent(String(settings.riskPercent));
    setMarketBias(settings.marketBias);
    setApiKey(settings.finnhubApiKey);
  }, [settings]);

  const save = async () => {
    const size = Number(accountSize);
    const risk = Number(riskPercent);
    if (!(size > 0) || !(risk > 0)) {
      Alert.alert('Check risk inputs', 'Account size and risk % must be positive.');
      return;
    }

    updateSettings({
      displayName: displayName.trim() || 'Trader',
      accountSize: size,
      riskPercent: risk,
      marketBias: marketBias.trim(),
      finnhubApiKey: apiKey.trim(),
    });
    await refreshQuotes();
    Alert.alert('Saved', apiKey.trim() ? 'Finnhub key stored on device.' : 'Using demo quotes until you add a Finnhub key.');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Personalize"
          subtitle="Risk defaults and bias live on this device. A Finnhub key unlocks live quotes, daily candles, and catalyst headlines for Today’s auto-checks."
        />

        <Field label="Display name" value={displayName} onChangeText={setDisplayName} />
        <Field
          label="Account size ($)"
          keyboardType="decimal-pad"
          value={accountSize}
          onChangeText={setAccountSize}
        />
        <Field
          label="Risk per trade (%)"
          keyboardType="decimal-pad"
          value={riskPercent}
          onChangeText={setRiskPercent}
        />
        <Field
          label="Today's market bias"
          multiline
          value={marketBias}
          onChangeText={setMarketBias}
          placeholder="Bullish / Neutral / Defensive — and why"
        />
        <Field
          label="Finnhub API key"
          autoCapitalize="none"
          autoCorrect={false}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Optional — leave blank for demo quotes"
        />

        <View style={styles.help}>
          <Text style={styles.helpTitle}>Free data</Text>
          <Text style={styles.helpBody}>
            Get a free personal key at finnhub.io. Without it, Signal Desk uses demo quotes + demo daily
            candles so rule scoring still works offline. News catalysts need a live key.
          </Text>
        </View>

        <Button label="Save settings" onPress={save} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  help: {
    backgroundColor: palette.mist,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  helpTitle: {
    fontWeight: '700',
    color: palette.ink,
  },
  helpBody: {
    color: palette.muted,
    lineHeight: 20,
  },
});
