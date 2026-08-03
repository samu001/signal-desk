import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Field, formatMoney, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function TradeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { trades, getSetup, updateTrade } = useTrading();
  const trade = trades.find((t) => t.id === id);
  const setup = getSetup(trade?.setupId);
  const [exitPrice, setExitPrice] = useState(trade?.exitPrice != null ? String(trade.exitPrice) : '');

  const pnl = useMemo(() => {
    if (!trade || trade.exitPrice == null) return null;
    return (trade.exitPrice - trade.entry) * trade.shares;
  }, [trade]);

  if (!trade) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: 'Trade' }} />
        <Text>Trade not found.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const closeTrade = (followedPlan: boolean) => {
    const price = Number(exitPrice);
    if (!price || price <= 0) {
      Alert.alert('Exit price required');
      return;
    }
    updateTrade(trade.id, {
      status: 'closed',
      exitPrice: price,
      closedAt: new Date().toISOString(),
      followedPlan,
    });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: trade.symbol }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Text style={styles.symbol}>{trade.symbol}</Text>
          <Pill
            label={trade.status}
            tone={trade.status === 'closed' ? (pnl != null && pnl >= 0 ? 'good' : 'bad') : 'warn'}
          />
        </View>
        <SectionTitle
          title="Desk position"
          subtitle={setup ? setup.name : 'Desk levels'}
        />
        <Text style={styles.line}>
          Entry {formatMoney(trade.entry)} · Stop {formatMoney(trade.stop)} · Target{' '}
          {formatMoney(trade.target)}
        </Text>
        <Text style={styles.line}>
          {trade.shares} shares · risked {formatMoney(trade.riskAmount)}
        </Text>
        {trade.notes ? <Text style={styles.notes}>{trade.notes}</Text> : null}

        {trade.checklist.length > 0 ? (
          <>
            <Text style={styles.section}>Machine checks at open</Text>
            {trade.checklist.map((c, i) => (
              <Text key={`${c.label}-${i}`} style={styles.check}>
                {c.checked ? '✓' : '✕'} {c.label}
              </Text>
            ))}
          </>
        ) : null}

        {trade.status !== 'closed' ? (
          <View style={styles.closeBox}>
            <Text style={styles.section}>Close trade</Text>
            <Field
              label="Exit price"
              keyboardType="decimal-pad"
              value={exitPrice}
              onChangeText={setExitPrice}
            />
            {trade.status === 'planned' ? (
              <Button
                label="Mark open"
                onPress={() => updateTrade(trade.id, { status: 'open' })}
              />
            ) : null}
            <View style={{ height: spacing.sm }} />
            <Button label="Close — followed Desk levels" onPress={() => closeTrade(true)} />
            <View style={{ height: spacing.sm }} />
            <Button
              label="Close — broke Desk levels"
              variant="danger"
              onPress={() => closeTrade(false)}
            />
          </View>
        ) : (
          <View style={styles.closeBox}>
            <Text style={styles.section}>Result</Text>
            <Text style={styles.line}>Exit {formatMoney(trade.exitPrice ?? 0)}</Text>
            <Text
              style={[
                styles.line,
                { color: (pnl ?? 0) >= 0 ? palette.leaf : palette.danger },
              ]}>
              P&L {formatMoney(pnl ?? 0)}
            </Text>
            <Text style={styles.line}>
              {trade.followedPlan ? 'Followed Desk levels' : 'Broke Desk levels'}
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  symbol: {
    fontFamily: 'SpaceMono',
    fontSize: 28,
    color: palette.ink,
  },
  line: {
    fontFamily: 'SpaceMono',
    fontSize: 13,
    color: palette.ink,
    marginBottom: 6,
  },
  notes: {
    color: palette.muted,
    marginTop: 8,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontWeight: '700',
    color: palette.ink,
    fontSize: 16,
  },
  check: {
    color: palette.ink,
    marginBottom: 6,
    lineHeight: 20,
  },
  closeBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: palette.sand,
    borderWidth: 1,
    borderColor: palette.line,
  },
});
