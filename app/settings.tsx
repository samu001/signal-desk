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
  const [finnhubKey, setFinnhubKey] = useState(settings.finnhubApiKey);
  const [tiingoKey, setTiingoKey] = useState(settings.tiingoApiKey);
  const [fmpKey, setFmpKey] = useState(settings.fmpApiKey);
  const [alphaKey, setAlphaKey] = useState(settings.alphaVantageApiKey);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAccountSize(String(settings.accountSize));
    setRiskPercent(String(settings.riskPercent));
    setMarketBias(settings.marketBias);
    setFinnhubKey(settings.finnhubApiKey);
    setTiingoKey(settings.tiingoApiKey);
    setFmpKey(settings.fmpApiKey);
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
      finnhubApiKey: finnhubKey.trim(),
      tiingoApiKey: tiingoKey.trim(),
      fmpApiKey: fmpKey.trim(),
      alphaVantageApiKey: alphaKey.trim(),
    });
    await refreshQuotes();
    Alert.alert(
      'Saved',
      'Keys stored on device. Candle order: Tiingo → FMP → Finnhub → Alpha Vantage → demo.'
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle title="Personalize" subtitle="Risk defaults and API keys live on this device." />

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
          label="Market bias"
          multiline
          value={marketBias}
          onChangeText={setMarketBias}
          placeholder="Bullish / Neutral / Defensive — and why"
        />

        <Text style={styles.section}>Market data keys</Text>
        <Field
          label="Tiingo token"
          autoCapitalize="none"
          autoCorrect={false}
          value={tiingoKey}
          onChangeText={setTiingoKey}
          placeholder="Best free long EOD history for backtests"
        />
        <Field
          label="FMP API key"
          autoCapitalize="none"
          autoCorrect={false}
          value={fmpKey}
          onChangeText={setFmpKey}
          placeholder="EOD fallback + fundamentals context"
        />
        <Field
          label="Finnhub API key"
          autoCapitalize="none"
          autoCorrect={false}
          value={finnhubKey}
          onChangeText={setFinnhubKey}
          placeholder="Quotes + news (free OHLC often blocked)"
        />
        <Field
          label="Alpha Vantage API key"
          autoCapitalize="none"
          autoCorrect={false}
          value={alphaKey}
          onChangeText={setAlphaKey}
          placeholder="Short ~100-bar fallback"
        />

        <View style={styles.help}>
          <Text style={styles.helpTitle}>Where each key helps</Text>
          <Text style={styles.helpBody}>
            Tiingo: long adjusted daily history for Desk signals and backtests. FMP: daily bars fallback plus
            PE / margins / ROE on Dashboard. Finnhub: live quotes + catalyst headlines. Alpha Vantage:
            last-resort short history. Without keys, demo history / company / news still power Desk offline.
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
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
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
