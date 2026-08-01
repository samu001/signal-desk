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
  const [alphaKey, setAlphaKey] = useState(settings.alphaVantageApiKey);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAccountSize(String(settings.accountSize));
    setRiskPercent(String(settings.riskPercent));
    setMarketBias(settings.marketBias);
    setApiKey(settings.finnhubApiKey);
    setAlphaKey(settings.alphaVantageApiKey);
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
      alphaVantageApiKey: alphaKey.trim(),
    });
    await refreshQuotes();
    Alert.alert(
      'Saved',
      alphaKey.trim()
        ? 'Keys stored on device. Alpha Vantage powers OHLC/backtests if Finnhub candles are blocked.'
        : apiKey.trim()
          ? 'Finnhub key stored. If candle history fails on free tier, add Alpha Vantage for backtests.'
          : 'Using demo quotes/candles until you add API keys.'
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Personalize"
          subtitle="Risk defaults and API keys live on this device."
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
          placeholder="Quotes + news (free OHLC often blocked)"
        />
        <Field
          label="Alpha Vantage API key"
          autoCapitalize="none"
          autoCorrect={false}
          value={alphaKey}
          onChangeText={setAlphaKey}
          placeholder="Recommended for backtests (~100 daily bars)"
        />

        <View style={styles.help}>
          <Text style={styles.helpTitle}>API limits that affect backtests</Text>
          <Text style={styles.helpBody}>
            Finnhub free typically cannot call /stock/candle (OHLC). Quotes/news may still work. Alpha
            Vantage free allows compact daily history (~100 bars) but only ~25 requests/day and 5/min —
            backtests fetch sequentially. Without either key, Signal Desk uses demo history so the
            engine still runs offline.
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
