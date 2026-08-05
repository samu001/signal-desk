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

/**
 * Stable priority: higher planned R:R and rule pass rate win contested slots.
 * Scaled so small RR differences still outrank pass-rate noise when targets
 * cluster near ~2R (otherwise scores pack into ~2.7–3.0 and ties dominate).
 */
export function tradePriorityScore(plannedRR: number, passRate: number): number {
  const rr = Number.isFinite(plannedRR) ? Math.max(0, plannedRR) : 0;
  const pr = Number.isFinite(passRate) ? Math.max(0, Math.min(1, passRate)) : 0;
  return rr * 10 + pr;
}

/** Deterministic non-alphabetical tie-break key (djb2). */
export function stableTieBreakKey(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Compare two candidates for contested slots.
 * 1) Higher priorityScore wins
 * 2) Earlier entryTime (FIFO — no symbol alphabet bias)
 * 3) Stable hash of `tieKey` (symbol / setupId) — deterministic, not A→Z
 */
export function compareByPriorityThenFifo(
  a: { priorityScore: number; entryTime: number; tieKey: string },
  b: { priorityScore: number; entryTime: number; tieKey: string }
): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.entryTime !== b.entryTime) return a.entryTime - b.entryTime;
  return stableTieBreakKey(a.tieKey) - stableTieBreakKey(b.tieKey);
}
