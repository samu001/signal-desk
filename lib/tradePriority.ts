/**
 * Entry-time trade quality for capacity / same-day ranking.
 * Never use realized rMultiple here — that would peek at the future.
 */

export function plannedRewardToRisk(entry: number, stop: number, target: number): number {
  const risk = entry - stop;
  if (!(risk > 0) || !Number.isFinite(risk)) return 0;
  const reward = target - entry;
  if (!Number.isFinite(reward) || reward <= 0) return 0;
  return reward / risk;
}

/** Stable priority: higher planned R:R and rule pass rate win contested slots. */
export function tradePriorityScore(plannedRR: number, passRate: number): number {
  const rr = Number.isFinite(plannedRR) ? Math.max(0, plannedRR) : 0;
  const pr = Number.isFinite(passRate) ? Math.max(0, Math.min(1, passRate)) : 0;
  return rr + pr;
}
