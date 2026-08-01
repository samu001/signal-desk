import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { palette, spacing } from '@/constants/theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BrandMark() {
  return (
    <View style={styles.brandRow}>
      <Text style={styles.brand}>Signal Desk</Text>
      <Text style={styles.brandTag}>Personal trading guide</Text>
    </View>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.7 },
      ]}>
      <Text
        style={[
          styles.buttonText,
          variant === 'ghost' && styles.buttonGhostText,
          variant === 'danger' && styles.buttonDangerText,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.muted}
        style={[styles.input, props.multiline && styles.inputMultiline]}
        {...props}
      />
    </View>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'good' && styles.pillGood,
        tone === 'warn' && styles.pillWarn,
        tone === 'bad' && styles.pillBad,
      ]}>
      <Text
        style={[
          styles.pillText,
          tone === 'good' && { color: palette.moss },
          tone === 'warn' && { color: palette.warn },
          tone === 'bad' && { color: palette.danger },
        ]}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <FontAwesome name="compass" size={22} color={palette.moss} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function formatMoney(n: number, digits = 2) {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatPct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.paper,
  },
  brandRow: {
    gap: 2,
    marginBottom: spacing.md,
  },
  brand: {
    fontFamily: 'SpaceMono',
    fontSize: 28,
    letterSpacing: -0.5,
    color: palette.ink,
  },
  brandTag: {
    color: palette.muted,
    fontSize: 14,
  },
  sectionHead: {
    gap: 4,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: palette.ink,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: palette.muted,
    lineHeight: 20,
  },
  button: {
    backgroundColor: palette.moss,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.line,
  },
  buttonDanger: {
    backgroundColor: palette.dangerSoft,
  },
  buttonText: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 15,
  },
  buttonGhostText: {
    color: palette.ink,
  },
  buttonDangerText: {
    color: palette.danger,
  },
  field: {
    gap: 6,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: palette.ink,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: palette.mist,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillGood: {
    backgroundColor: palette.mossSoft,
  },
  pillWarn: {
    backgroundColor: palette.warnSoft,
  },
  pillBad: {
    backgroundColor: palette.dangerSoft,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.ink,
  },
  empty: {
    gap: 8,
    padding: spacing.lg,
    backgroundColor: palette.mist,
    borderRadius: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.ink,
  },
  emptyBody: {
    color: palette.muted,
    lineHeight: 20,
  },
});
