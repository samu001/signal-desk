/**
 * Exit-level tuning knobs for the parameter lab.
 *
 * All knobs are EXITS-ONLY: they are applied after the entry signal fired and
 * never change which entries are taken, so a sweep isolates the effect of the
 * exit geometry. Undefined = production behavior (structure-based levels from
 * levelsForSetup, exactly as the live backtest runs today).
 *
 * Deliberately absent: buy-zone placement. The zone feeds entry-rule checks
 * (in_buy_zone etc.), so tuning it changes WHICH trades happen, not just how
 * they exit — a different experiment than this lab answers.
 */
export type LevelTuning = {
  /**
   * Override the take-profit target to entryFill + targetR × (entryFill - stop),
   * measured at the actual fill. Undefined keeps the structure-based target.
   */
  targetR?: number;
  /**
   * Tighten the stop to at most atrCapMult × ATR(14) below the fill
   * (max with the structural stop — never loosens). Undefined = no ATR cap,
   * which is current backtest behavior.
   */
  atrCapMult?: number;
  /**
   * Tighten the stop to at most pctCap fraction below the fill (max with the
   * structural stop — never loosens). Undefined = no percent cap.
   */
  pctCap?: number;
};

export type TunedLevels = { stop: number; target: number };

export const PRODUCTION_TUNING: LevelTuning = {};

export function isProductionTuning(tuning: LevelTuning | undefined): boolean {
  return (
    !tuning ||
    (tuning.targetR == null && tuning.atrCapMult == null && tuning.pctCap == null)
  );
}

/**
 * Apply exit tuning to structure-based levels at the actual fill price.
 * Pure: no side effects, deterministic.
 */
export function applyLevelTuning(
  levels: { stop: number; target: number },
  entryFill: number,
  atr14: number | null,
  tuning: LevelTuning | undefined
): TunedLevels {
  if (isProductionTuning(tuning)) return { stop: levels.stop, target: levels.target };

  let stop = levels.stop;
  if (tuning!.atrCapMult != null && atr14 != null && atr14 > 0) {
    stop = Math.max(stop, entryFill - tuning!.atrCapMult * atr14);
  }
  if (tuning!.pctCap != null && tuning!.pctCap > 0) {
    stop = Math.max(stop, entryFill * (1 - tuning!.pctCap));
  }

  let target = levels.target;
  if (tuning!.targetR != null) {
    const risk = entryFill - stop;
    if (risk > 0) target = entryFill + tuning!.targetR * risk;
  }

  return { stop, target };
}

/** Short human label for result notes, e.g. "target 1.5R · stop cap 2×ATR". */
export function describeTuning(tuning: LevelTuning | undefined): string {
  if (isProductionTuning(tuning)) return 'production levels';
  const parts: string[] = [];
  if (tuning!.targetR != null) parts.push(`target ${tuning!.targetR}R`);
  if (tuning!.atrCapMult != null) parts.push(`stop cap ${tuning!.atrCapMult}×ATR`);
  if (tuning!.pctCap != null) parts.push(`stop cap ${(tuning!.pctCap * 100).toFixed(0)}%`);
  return parts.join(' · ');
}
