/**
 * Live dashboard behavior — one engine with independent entry and exit
 * toggles, mirroring the Portfolio backtest knobs, persisted in Settings and
 * consumed by the live Desk pipeline.
 *
 * Defaults reproduce production behavior exactly: Desk confirmation on,
 * setup-structure levels, earnings blackout only, no cooldown, no position
 * cap, production exits.
 */
import { DEFAULT_LIVE_GATES, describeActiveExtras } from '@/lib/backtestProfile';
import { describeTuning, isProductionTuning, LevelTuning } from '@/lib/levelTuning';
import {
  Candle,
  LiveBehaviorConfig,
  LiveLevelAnchor,
  Trade,
} from '@/types/trading';

export const LIVE_LEVEL_ANCHOR_LABELS: Record<LiveLevelAnchor, string> = {
  setup: 'Setup structure',
  desk_blend: 'Desk blend',
};

export const DEFAULT_LIVE_BEHAVIOR: LiveBehaviorConfig = {
  deskConfirmation: true,
  gates: { ...DEFAULT_LIVE_GATES },
  stopCooldownBars: 0,
  maxOpenPositions: 0,
  levelAnchor: 'setup',
  exitTuning: {},
};

function normalizeTuning(raw: LevelTuning | undefined): LevelTuning {
  const tuning: LevelTuning = {};
  if (raw?.targetR != null && Number(raw.targetR) > 0) tuning.targetR = Number(raw.targetR);
  if (raw?.atrCapMult != null && Number(raw.atrCapMult) > 0) {
    tuning.atrCapMult = Number(raw.atrCapMult);
  }
  if (raw?.pctCap != null && Number(raw.pctCap) > 0) tuning.pctCap = Number(raw.pctCap);
  return tuning;
}

/** Persisted shape before the entry-engine → toggles split (storage migration). */
type LegacyLiveBehavior = Partial<LiveBehaviorConfig> & {
  entryEngine?: 'playbook' | 'playbook_desk' | 'desk';
};

/** Fill defaults / repair a possibly-partial persisted config (storage migration). */
export function normalizeLiveBehavior(
  raw: LegacyLiveBehavior | null | undefined
): LiveBehaviorConfig {
  const gates = { ...DEFAULT_LIVE_GATES, ...(raw?.gates ?? {}) };
  // Legacy engine presets map onto the two toggles:
  // playbook → confirmation off; desk → Desk-blend levels; playbook_desk → defaults.
  const legacy = raw?.entryEngine;
  const deskConfirmation =
    typeof raw?.deskConfirmation === 'boolean'
      ? raw.deskConfirmation
      : legacy !== 'playbook';
  const levelAnchor: LiveLevelAnchor =
    raw?.levelAnchor === 'desk_blend' || raw?.levelAnchor === 'setup'
      ? raw.levelAnchor
      : legacy === 'desk'
        ? 'desk_blend'
        : 'setup';
  const cooldown = Number(raw?.stopCooldownBars);
  const maxOpen = Number(raw?.maxOpenPositions);
  return {
    deskConfirmation,
    levelAnchor,
    gates: {
      marketRegime: Boolean(gates.marketRegime),
      earningsBlackout: Boolean(gates.earningsBlackout),
      weeklyTrend: Boolean(gates.weeklyTrend),
      sectorRs: Boolean(gates.sectorRs),
      volatility: Boolean(gates.volatility),
    },
    stopCooldownBars:
      Number.isFinite(cooldown) && cooldown > 0 ? Math.round(cooldown) : 0,
    maxOpenPositions:
      Number.isFinite(maxOpen) && maxOpen > 0 ? Math.round(maxOpen) : 0,
    exitTuning: normalizeTuning(raw?.exitTuning),
  };
}

export function isDefaultLiveBehavior(cfg: LiveBehaviorConfig): boolean {
  return (
    cfg.deskConfirmation === DEFAULT_LIVE_BEHAVIOR.deskConfirmation &&
    cfg.levelAnchor === DEFAULT_LIVE_BEHAVIOR.levelAnchor &&
    cfg.stopCooldownBars === 0 &&
    cfg.maxOpenPositions === 0 &&
    isProductionTuning(cfg.exitTuning) &&
    cfg.gates.marketRegime === DEFAULT_LIVE_GATES.marketRegime &&
    cfg.gates.earningsBlackout === DEFAULT_LIVE_GATES.earningsBlackout &&
    cfg.gates.weeklyTrend === DEFAULT_LIVE_GATES.weeklyTrend &&
    cfg.gates.sectorRs === DEFAULT_LIVE_GATES.sectorRs &&
    cfg.gates.volatility === DEFAULT_LIVE_GATES.volatility
  );
}

/** One-line summary for Dashboard / Settings, e.g. "Playbook + Desk confirm · earnings blackout · setup levels · production exits". */
export function describeLiveBehavior(cfg: LiveBehaviorConfig): string {
  const bits = [cfg.deskConfirmation ? 'Playbook + Desk confirm' : 'Playbook rules only'];
  const extras = describeActiveExtras(cfg.gates, cfg.stopCooldownBars);
  bits.push(extras.length ? extras.join(' · ') : 'no accuracy gates');
  bits.push(cfg.levelAnchor === 'desk_blend' ? 'Desk blend levels' : 'setup levels');
  bits.push(
    isProductionTuning(cfg.exitTuning) ? 'production exits' : describeTuning(cfg.exitTuning)
  );
  if (cfg.maxOpenPositions > 0) bits.push(`max ${cfg.maxOpenPositions} open`);
  return bits.join(' · ');
}

export type StopCooldownStatus = {
  /** Trading days still to wait before this symbol is eligible again. */
  barsRemaining: number;
  detail: string;
};

/**
 * Live analog of the backtest post-stop cooldown: after the most recent
 * stop-out on a symbol, hold new entries for `stopCooldownBars` trading days.
 * Trading days are counted from the symbol's daily bars after the exit;
 * without bars it falls back to calendar days (same as the backtest fallback).
 */
export function stopCooldownStatus(input: {
  symbol: string;
  trades: Trade[];
  candles?: Candle[];
  stopCooldownBars: number;
  /** Epoch ms "now" for the calendar fallback (tests). */
  now?: number;
}): StopCooldownStatus | null {
  const bars = input.stopCooldownBars;
  if (!(bars > 0)) return null;
  const upper = input.symbol.toUpperCase().trim();
  let lastStopExitMs: number | null = null;
  for (const t of input.trades) {
    if (t.symbol.toUpperCase().trim() !== upper) continue;
    if (t.status !== 'closed' || t.exitPrice == null || !t.closedAt) continue;
    // Only stop-outs start a cooldown (mirrors reason === 'stop' in backtests).
    if (!(t.stop > 0) || t.exitPrice > t.stop) continue;
    const ms = Date.parse(t.closedAt);
    if (Number.isFinite(ms)) {
      lastStopExitMs = lastStopExitMs == null ? ms : Math.max(lastStopExitMs, ms);
    }
  }
  if (lastStopExitMs == null) return null;

  const exitSec = lastStopExitMs / 1000;
  const elapsed = input.candles?.length
    ? input.candles.filter((c) => c.time > exitSec).length
    : Math.floor(((input.now ?? Date.now()) - lastStopExitMs) / 86_400_000);
  if (elapsed >= bars) return null;

  const remaining = bars - elapsed;
  const exitDay = new Date(lastStopExitMs).toISOString().slice(0, 10);
  return {
    barsRemaining: remaining,
    detail: `Stopped out ${exitDay} — ${remaining} trading day${
      remaining === 1 ? '' : 's'
    } left of the ${bars}-day cooldown`,
  };
}

function roundPrice(n: number): number {
  if (n >= 10) return Math.round(n * 100) / 100;
  return Math.round(n * 1000) / 1000;
}

type Levels = { entryLow: number; entryHigh: number; stop: number; target: number };

/**
 * Apply exits-only tuning to Desk display levels using the entry-zone mid as
 * the assumed fill (backtests apply the same tuning at the actual fill).
 * Stops only tighten and are kept below the zone floor so a plan never shows
 * an instant stop-out.
 */
export function applyLiveExitTuning(
  levels: Levels,
  atr14: number | null,
  tuning: LevelTuning | undefined
): Levels {
  if (isProductionTuning(tuning)) return levels;
  const entryMid = (levels.entryLow + levels.entryHigh) / 2;
  if (!(entryMid > 0)) return levels;

  let stop = levels.stop;
  if (tuning!.atrCapMult != null && atr14 != null && atr14 > 0) {
    stop = Math.max(stop, entryMid - tuning!.atrCapMult * atr14);
  }
  if (tuning!.pctCap != null && tuning!.pctCap > 0) {
    stop = Math.max(stop, entryMid * (1 - tuning!.pctCap));
  }
  stop = Math.min(stop, levels.entryLow * 0.995);

  let target = levels.target;
  if (tuning!.targetR != null) {
    const risk = entryMid - stop;
    if (risk > 0) target = entryMid + tuning!.targetR * risk;
  }
  if (!(target > levels.entryHigh)) {
    target = levels.entryHigh + Math.max(entryMid - stop, entryMid * 0.01);
  }

  return { ...levels, stop: roundPrice(stop), target: roundPrice(target) };
}

/** Open + planned trades both count toward the live max-open cap. */
export function committedPositionCount(trades: Trade[]): number {
  return trades.filter((t) => t.status === 'open' || t.status === 'planned').length;
}
