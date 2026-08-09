import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Field, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { DEFAULT_LIVE_GATES, PROFILE_ALL8 } from '@/lib/backtestProfile';
import { LevelTuning } from '@/lib/levelTuning';
import {
  DEFAULT_LIVE_BEHAVIOR,
  describeLiveBehavior,
  LIVE_LEVEL_ANCHOR_LABELS,
  normalizeLiveBehavior,
} from '@/lib/liveBehavior';
import { LiveLevelAnchor, PlaybookGateFlags } from '@/types/trading';

function notify(title: string, message?: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

const ANCHOR_BLURBS: Record<LiveLevelAnchor, string> = {
  setup:
    'Buy zone / stop / target come from the top setup’s own invalidation structure (flush low, inside-day low, pullback low…) — the production default.',
  desk_blend:
    'Buy zone / stop / target anchor to the Desk blend: the setup structure merged with Desk’s generic chart read (Desk card levels).',
};

const GATE_ROWS: { key: keyof PlaybookGateFlags; label: string; hint: string }[] = [
  {
    key: 'earningsBlackout',
    label: 'Earnings blackout',
    hint: 'No new entries ±1 day around earnings',
  },
  {
    key: 'marketRegime',
    label: 'Market regime',
    hint: 'SPY/QQQ above SMA50 with rising SMA20',
  },
  { key: 'weeklyTrend', label: 'Weekly trend', hint: 'Weekly close above rising SMA10' },
  {
    key: 'sectorRs',
    label: 'Sector RS',
    hint: 'Sector ETF beating SPY (soft-skip without a proxy)',
  },
  { key: 'volatility', label: 'Volatility band', hint: 'ATR% roughly 0.9–5.5%' },
];

const TARGET_CHOICES = [1.5, 2.0, 3.0];
const STOP_ATR_CHOICES = [1.5, 2.0, 2.5];
/** Same % cap the Parameter lab exit grid pairs with every ATR stop. */
const STOP_PCT_CAP = 0.08;

export default function LiveBehaviorScreen() {
  const { liveBehavior, updateLiveBehavior } = useTrading();

  const [deskConfirm, setDeskConfirm] = useState<boolean>(liveBehavior.deskConfirmation);
  const [anchor, setAnchor] = useState<LiveLevelAnchor>(liveBehavior.levelAnchor);
  const [gates, setGates] = useState<PlaybookGateFlags>({ ...liveBehavior.gates });
  const [cooldown, setCooldown] = useState(String(liveBehavior.stopCooldownBars));
  const [maxOpen, setMaxOpen] = useState(String(liveBehavior.maxOpenPositions));
  const [targetR, setTargetR] = useState<number | null>(liveBehavior.exitTuning.targetR ?? null);
  const [stopAtr, setStopAtr] = useState<number | null>(
    liveBehavior.exitTuning.atrCapMult ?? null
  );

  useEffect(() => {
    setDeskConfirm(liveBehavior.deskConfirmation);
    setAnchor(liveBehavior.levelAnchor);
    setGates({ ...liveBehavior.gates });
    setCooldown(String(liveBehavior.stopCooldownBars));
    setMaxOpen(String(liveBehavior.maxOpenPositions));
    setTargetR(liveBehavior.exitTuning.targetR ?? null);
    setStopAtr(liveBehavior.exitTuning.atrCapMult ?? null);
  }, [liveBehavior]);

  const toggleGate = (key: keyof PlaybookGateFlags) => {
    setGates((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const draftConfig = () => {
    const tuning: LevelTuning = {
      ...(targetR != null ? { targetR } : {}),
      ...(stopAtr != null ? { atrCapMult: stopAtr, pctCap: STOP_PCT_CAP } : {}),
    };
    return normalizeLiveBehavior({
      deskConfirmation: deskConfirm,
      levelAnchor: anchor,
      gates,
      stopCooldownBars: Number(cooldown) || 0,
      maxOpenPositions: Number(maxOpen) || 0,
      exitTuning: tuning,
    });
  };

  const save = () => {
    const next = draftConfig();
    updateLiveBehavior(next);
    notify(
      'Live behavior saved',
      `${describeLiveBehavior(next)}.\n\nApplies on the next Refresh signals / Desk load.`
    );
  };

  const resetDefaults = () => {
    setDeskConfirm(DEFAULT_LIVE_BEHAVIOR.deskConfirmation);
    setAnchor(DEFAULT_LIVE_BEHAVIOR.levelAnchor);
    setGates({ ...DEFAULT_LIVE_GATES });
    setCooldown('0');
    setMaxOpen('0');
    setTargetR(null);
    setStopAtr(null);
    updateLiveBehavior(normalizeLiveBehavior(DEFAULT_LIVE_BEHAVIOR));
    notify('Reset to defaults', 'Production behavior restored (Desk confirmation on, setup levels, earnings blackout, production exits).');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Live behavior' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Live behavior"
          subtitle="The same knobs as the Portfolio backtest, applied to Dashboard / Desk signals. Test a combination in the Lab first, then set it here — or use “Use these settings live” on a backtest run. Changes apply on the next Refresh signals."
        />

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Current</Text>
          <Text style={styles.summaryText}>{describeLiveBehavior(liveBehavior)}</Text>
        </View>

        <Text style={styles.groupTitle}>Entry — when to get in</Text>
        <Text style={styles.hint}>
          A Playbook setup match is always required for Soft/Strong. Everything below tightens or
          loosens what gets through.
        </Text>
        <Pressable
          style={styles.checkRow}
          onPress={() => setDeskConfirm((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: deskConfirm }}>
          <FontAwesome
            name={deskConfirm ? 'check-square' : 'square-o'}
            size={18}
            color={deskConfirm ? palette.moss : palette.muted}
          />
          <View style={styles.checkCol}>
            <Text style={[styles.checkName, !deskConfirm && styles.checkNameOff]}>
              Desk confirmation
            </Text>
            <Text style={styles.checkHint}>
              {deskConfirm
                ? 'Soft/Strong also needs healthy Desk scores and price in/near the buy zone (production default).'
                : 'Off — Playbook rules alone decide Soft/Strong. Red-flag news, thin liquidity, cooldown, and stop risk still block.'}
            </Text>
          </View>
        </Pressable>

        <Text style={styles.subLabel}>Accuracy gates</Text>
        <View style={styles.presetRow}>
          <Pressable
            onPress={() => {
              setGates({ ...DEFAULT_LIVE_GATES });
              setCooldown('0');
            }}
            hitSlop={6}>
            <Text style={styles.presetLink}>Default (earnings only)</Text>
          </Pressable>
          <Text style={styles.presetDot}>·</Text>
          <Pressable
            onPress={() => {
              setGates({ ...PROFILE_ALL8.gates });
              setCooldown(String(PROFILE_ALL8.stopCooldownBars));
            }}
            hitSlop={6}>
            <Text style={styles.presetLink}>All 8</Text>
          </Pressable>
        </View>
        {GATE_ROWS.map((row) => {
          const on = gates[row.key];
          return (
            <Pressable key={row.key} style={styles.checkRow} onPress={() => toggleGate(row.key)}>
              <FontAwesome
                name={on ? 'check-square' : 'square-o'}
                size={18}
                color={on ? palette.moss : palette.muted}
              />
              <View style={styles.checkCol}>
                <Text style={[styles.checkName, !on && styles.checkNameOff]}>{row.label}</Text>
                <Text style={styles.checkHint}>{row.hint}</Text>
              </View>
            </Pressable>
          );
        })}

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Field
              label="Stop cooldown (days, 0 = off)"
              keyboardType="number-pad"
              value={cooldown}
              onChangeText={setCooldown}
            />
          </View>
          <View style={styles.rowItem}>
            <Field
              label="Max open positions (0 = no cap)"
              keyboardType="number-pad"
              value={maxOpen}
              onChangeText={setMaxOpen}
            />
          </View>
        </View>
        <Text style={styles.hint}>
          Cooldown holds a symbol for N trading days after a stop-out (mirrors the backtest
          cooldown). Max open counts open + planned trades — the Dashboard flags new entries when
          the cap is reached.
        </Text>

        <Text style={styles.groupTitle}>Exit — where the levels come from</Text>
        <Text style={styles.subLabel}>Level anchor</Text>
        <View style={styles.chipRow}>
          {(Object.keys(LIVE_LEVEL_ANCHOR_LABELS) as LiveLevelAnchor[]).map((id) => (
            <Pressable
              key={id}
              onPress={() => setAnchor(id)}
              style={[styles.chip, anchor === id && styles.chipOn]}>
              <Text style={[styles.chipText, anchor === id && styles.chipTextOn]}>
                {LIVE_LEVEL_ANCHOR_LABELS[id]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>{ANCHOR_BLURBS[anchor]}</Text>

        <Text style={styles.subLabel}>Tuning overrides</Text>
        <Text style={styles.hint}>
          Production = structure target (~2R) with stop capped at min(2.5×ATR, 8%). Overrides mirror
          the Lab exit grid and only tighten stops / rewrite targets — entries are unchanged.
        </Text>
        <Text style={styles.subLabel}>Target</Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => setTargetR(null)}
            style={[styles.chip, targetR == null && styles.chipOn]}>
            <Text style={[styles.chipText, targetR == null && styles.chipTextOn]}>Production</Text>
          </Pressable>
          {TARGET_CHOICES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setTargetR(t)}
              style={[styles.chip, targetR === t && styles.chipOn]}>
              <Text style={[styles.chipText, targetR === t && styles.chipTextOn]}>{t}R</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.subLabel}>Stop cap</Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => setStopAtr(null)}
            style={[styles.chip, stopAtr == null && styles.chipOn]}>
            <Text style={[styles.chipText, stopAtr == null && styles.chipTextOn]}>Production</Text>
          </Pressable>
          {STOP_ATR_CHOICES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setStopAtr(m)}
              style={[styles.chip, stopAtr === m && styles.chipOn]}>
              <Text style={[styles.chipText, stopAtr === m && styles.chipTextOn]}>
                {m}×ATR · 8%
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.actions}>
          <Button label="Save live behavior" onPress={save} />
          <Button label="Reset to production defaults" variant="ghost" onPress={resetDefaults} />
        </View>

        <Text style={styles.footNote}>
          Playbook setups are chosen on the Playbook tab (on/off per setup) — the same roster the
          backtest’s “Match Playbook” option uses. Account size and risk % live in Settings.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  summaryBox: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: 12,
    marginBottom: spacing.md,
    gap: 2,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryText: {
    color: palette.ink,
    fontWeight: '600',
    lineHeight: 19,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.ink,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.white,
  },
  chipOn: {
    backgroundColor: palette.moss,
    borderColor: palette.moss,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.ink,
  },
  chipTextOn: {
    color: palette.white,
  },
  hint: {
    color: palette.muted,
    lineHeight: 19,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  presetLink: {
    color: palette.moss,
    fontWeight: '700',
    fontSize: 13,
  },
  presetDot: {
    color: palette.muted,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  checkCol: {
    flex: 1,
    gap: 2,
  },
  checkName: {
    color: palette.ink,
    fontWeight: '600',
  },
  checkNameOff: {
    color: palette.muted,
  },
  checkHint: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowItem: {
    flex: 1,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  footNote: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.md,
  },
});
