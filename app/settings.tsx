import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export default function SettingsScreen() {
  const { settings, updateSettings, refreshQuotes, clearDataCaches } = useTrading();
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [accountSize, setAccountSize] = useState(String(settings.accountSize));
  const [riskPercent, setRiskPercent] = useState(String(settings.riskPercent));
  const [marketBias, setMarketBias] = useState(settings.marketBias);
  const [finnhubKey, setFinnhubKey] = useState(settings.finnhubApiKey);
  const [tiingoKey, setTiingoKey] = useState(settings.tiingoApiKey);
  const [tiingoProxyUrl, setTiingoProxyUrl] = useState(settings.tiingoProxyUrl ?? '');
  const [tiingoProxyToken, setTiingoProxyToken] = useState(settings.tiingoProxyToken ?? '');
  const [fmpKey, setFmpKey] = useState(settings.fmpApiKey);
  const [alphaKey, setAlphaKey] = useState(settings.alphaVantageApiKey);
  const [yahooProxyUrl, setYahooProxyUrl] = useState(settings.yahooProxyUrl);
  const [yahooProxyToken, setYahooProxyToken] = useState(settings.yahooProxyToken);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    setDisplayName(settings.displayName);
    setAccountSize(String(settings.accountSize));
    setRiskPercent(String(settings.riskPercent));
    setMarketBias(settings.marketBias);
    setFinnhubKey(settings.finnhubApiKey);
    setTiingoKey(settings.tiingoApiKey);
    setTiingoProxyUrl(settings.tiingoProxyUrl ?? '');
    setTiingoProxyToken(settings.tiingoProxyToken ?? '');
    setFmpKey(settings.fmpApiKey);
    setAlphaKey(settings.alphaVantageApiKey);
    setYahooProxyUrl(settings.yahooProxyUrl);
    setYahooProxyToken(settings.yahooProxyToken);
  }, [settings]);

  const save = async () => {
    const size = Number(accountSize);
    const risk = Number(riskPercent);
    if (!(size > 0) || !(risk > 0)) {
      notify('Check risk inputs', 'Account size and risk % must be positive.');
      return;
    }

    updateSettings({
      displayName: displayName.trim() || 'Trader',
      accountSize: size,
      riskPercent: risk,
      marketBias: marketBias.trim(),
      finnhubApiKey: finnhubKey.trim(),
      tiingoApiKey: tiingoKey.trim(),
      tiingoProxyUrl: tiingoProxyUrl.trim().replace(/\/+$/, ''),
      tiingoProxyToken: tiingoProxyToken.trim(),
      fmpApiKey: fmpKey.trim(),
      alphaVantageApiKey: alphaKey.trim(),
      yahooProxyUrl: yahooProxyUrl.trim().replace(/\/+$/, ''),
      yahooProxyToken: yahooProxyToken.trim(),
    });
    await refreshQuotes();
    notify(
      'Saved',
      'Keys stored on device. Web EOD: Tiingo proxy → Yahoo proxy → FMP → …. Native: Tiingo → Yahoo → FMP → …. Adjusted bars preferred; portfolio excludes RAW/adj?. Pull-to-refresh updates quotes only; Desk / Refresh signals load history.'
    );
  };

  const runClearCaches = async () => {
    setClearingCache(true);
    try {
      await clearDataCaches();
      notify('Caches cleared', 'Refetch with Desk or Refresh signals / re-run backtests.');
    } catch (e) {
      notify('Could not clear', e instanceof Error ? e.message : 'Unknown error clearing caches.');
    } finally {
      setClearingCache(false);
    }
  };

  const confirmClearCaches = () => {
    const detail =
      'Removes cached EOD bars, fundamentals, provider cooldowns, and in-app market snapshots. Next Desk / backtest run will refetch live APIs. Settings, watchlist, and trades are kept.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Clear data caches?\n\n${detail}`)) {
        void runClearCaches();
      }
      return;
    }
    Alert.alert('Clear data caches?', detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void runClearCaches();
        },
      },
    ]);
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
          placeholder="Native / Expo Go direct API (optional if proxy set)"
        />
        <Field
          label="Tiingo proxy URL (web)"
          autoCapitalize="none"
          autoCorrect={false}
          value={tiingoProxyUrl}
          onChangeText={setTiingoProxyUrl}
          placeholder="https://edge-stock-tiingo.xxx.workers.dev"
        />
        <Field
          label="Tiingo proxy token (optional)"
          autoCapitalize="none"
          autoCorrect={false}
          value={tiingoProxyToken}
          onChangeText={setTiingoProxyToken}
          placeholder="Only if Worker PROXY_TOKEN is set"
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
          label="Yahoo proxy URL"
          autoCapitalize="none"
          autoCorrect={false}
          value={yahooProxyUrl}
          onChangeText={setYahooProxyUrl}
          placeholder="https://signal-desk-bars.xxx.workers.dev"
        />
        <Field
          label="Yahoo proxy token (optional)"
          autoCapitalize="none"
          autoCorrect={false}
          value={yahooProxyToken}
          onChangeText={setYahooProxyToken}
          placeholder="Only if Worker PROXY_TOKEN is set"
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
            EOD order: Tiingo → Yahoo proxy → FMP adjusted. Tiingo: best free adjusted history
            (web: proxy Worker; native: token). Yahoo: adjclose-scaled Worker (no FMP quota).
            FMP: dividend-adjusted EOD fallback + fundamentals. Finnhub:
            live quotes + headlines. Alpha Vantage: last-resort short history (~25 calls/day).
            Without working EOD, Desk and backtests show No data — they will not invent Soft/Strong
            or levels.
          </Text>
        </View>

        <Button label="Save settings" onPress={save} />

        <View style={styles.cacheBlock}>
          <Text style={styles.section}>Data caches</Text>
          <Text style={styles.helpBody}>
            Backtests and Desk reuse cached EOD (12–24h) plus rate-limit cooldowns. Clear when you
            change keys or want a forced live refetch.
          </Text>
          <Button
            label={clearingCache ? 'Clearing…' : 'Clear EOD + API caches'}
            variant="danger"
            onPress={confirmClearCaches}
            disabled={clearingCache}
          />
        </View>
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
  cacheBlock: {
    marginTop: spacing.lg,
    gap: 10,
  },
});
