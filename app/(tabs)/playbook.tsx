import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';

export default function PlaybookScreen() {
  const { setups } = useTrading();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Playbook"
          subtitle="Your personalized rules for what to buy, when to enter, and when to get out."
        />

        {setups.length === 0 ? (
          <EmptyState title="No setups yet" body="Seed data should load on first launch." />
        ) : (
          setups.map((setup) => (
            <Link key={setup.id} href={{ pathname: '/setup-detail', params: { id: setup.id } }} asChild>
              <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
                <Text style={styles.name}>{setup.name}</Text>
                <Text style={styles.summary}>{setup.summary}</Text>
                <View style={styles.counts}>
                  <Text style={styles.count}>{setup.entryRules.length} entry rules</Text>
                  <Text style={styles.count}>{setup.exitRules.length} exit rules</Text>
                  <Text style={styles.count}>{setup.checklist.length} checklist</Text>
                </View>
              </Pressable>
            </Link>
          ))
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
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: palette.ink,
  },
  summary: {
    color: palette.muted,
    lineHeight: 21,
  },
  counts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  count: {
    color: palette.moss,
    fontWeight: '600',
    fontSize: 13,
  },
});
