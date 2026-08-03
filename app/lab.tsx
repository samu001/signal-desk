import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';

const LAB_TOOLS = [
  {
    href: '/backtest' as const,
    title: 'Setup / Playbook backtest',
    body: 'Test one setup or the combined Playbook on a single symbol. Best for rule tuning.',
    tone: 'primary' as const,
  },
  {
    href: '/desk-backtest' as const,
    title: 'Desk signal backtest',
    body: 'Replay Soft/Strong/Wait/Avoid stance history for a ticker. Best for signal quality.',
    tone: 'secondary' as const,
  },
  {
    href: '/portfolio-backtest' as const,
    title: 'Portfolio backtest',
    body: 'Multi-symbol Playbook run with a max open-position cap. Best for capacity realism.',
    tone: 'ink' as const,
  },
];

export default function LabScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Lab' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle
          title="Lab"
          subtitle="Three backtest tools — pick by question, not by habit. All live under Playbook."
        />

        {LAB_TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} asChild>
            <Pressable
              style={StyleSheet.flatten([
                styles.card,
                tool.tone === 'primary' && styles.cardPrimary,
                tool.tone === 'secondary' && styles.cardSecondary,
                tool.tone === 'ink' && styles.cardInk,
              ])}>
              <Text
                style={[
                  styles.cardTitle,
                  tool.tone !== 'secondary' && styles.cardTitleOnDark,
                ]}>
                {tool.title}
              </Text>
              <Text
                style={[
                  styles.cardBody,
                  tool.tone !== 'secondary' && styles.cardBodyOnDark,
                ]}>
                {tool.body}
              </Text>
              <Text
                style={[
                  styles.cardCta,
                  tool.tone !== 'secondary' && styles.cardTitleOnDark,
                ]}>
                Open →
              </Text>
            </Pressable>
          </Link>
        ))}

        <Text style={styles.footnote}>
          Setup cards on Playbook still deep-link into Setup backtest for that rule set.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
    gap: spacing.sm,
  },
  card: {
    borderRadius: 16,
    padding: spacing.md,
    gap: 8,
    borderWidth: 1,
    borderColor: palette.line,
    marginBottom: spacing.sm,
  },
  cardPrimary: {
    backgroundColor: palette.moss,
    borderColor: palette.moss,
  },
  cardSecondary: {
    backgroundColor: palette.white,
  },
  cardInk: {
    backgroundColor: palette.ink,
    borderColor: palette.ink,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.ink,
  },
  cardTitleOnDark: {
    color: palette.white,
  },
  cardBody: {
    color: palette.muted,
    lineHeight: 21,
  },
  cardBodyOnDark: {
    color: 'rgba(255,255,255,0.82)',
  },
  cardCta: {
    marginTop: 4,
    fontWeight: '700',
    color: palette.moss,
  },
  footnote: {
    marginTop: spacing.md,
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
  },
});
