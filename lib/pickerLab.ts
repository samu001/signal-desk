/**
 * Picker lab: rerun the same trade universe through alternative slot-ranking
 * rules and compare capped results. Answers "is picking better winners
 * achievable on this basket, or is slot allocation basically luck?"
 *
 * Every rule only uses information available at entry time:
 * - priority: current planned R:R + rule pass rate (production behavior).
 * - rs20: 20-bar relative strength vs SPY at the signal bar close (the last
 *   bar strictly before entry — the entry bar's close is future info).
 * - expectancy: walk-forward mean realized R of the SAME setup, counting only
 *   trades that CLOSED before this entry (never peeks at open/future trades).
 * - random: seeded shuffle, averaged over many seeds — the luck baseline.
 */

import { Candle } from '@/types/trading';

import { CapacityTrade, simulateMaxOpenByPriority } from './portfolioCapacity';

export type PickerTrade = CapacityTrade & {
  setupId: string;
  /** 20-bar RS vs SPY at the close before entry; null when history lacked. */
  rs20: number | null;
};

export type PickerRuleId = 'priority' | 'rs20' | 'expectancy' | 'random';

/** Any rule that can drive Max-open totals (including a single random seed). */
export type SelectablePickerRuleId = PickerRuleId;

/** Rules compared for "Best" / auto-activate — random never wins that badge. */
export type RankingPickerRuleId = Exclude<PickerRuleId, 'random'>;

export type PickerRuleResult = {
  id: PickerRuleId;
  label: string;
  description: string;
  trades: number;
  skipped: number;
  winRate: number | null;
  totalR: number;
  /** Only for random: spread across seeds so a lucky draw isn't mistaken for edge. */
  randomSpread?: { minR: number; maxR: number; seeds: number };
};

/** Fixed seed used when Random is Active — lab row still shows the multi-seed average. */
export const ACTIVE_RANDOM_SEED = 1;

export function isSelectablePicker(id: PickerRuleId): id is SelectablePickerRuleId {
  return (
    id === 'priority' || id === 'rs20' || id === 'expectancy' || id === 'random'
  );
}

export function isRankingPicker(id: PickerRuleId): id is RankingPickerRuleId {
  return id === 'priority' || id === 'rs20' || id === 'expectancy';
}

/** Highest-totalR ranking rule (ignores random baseline). Falls back to rs20. */
export function bestSelectablePicker(pickers: PickerRuleResult[]): RankingPickerRuleId {
  const ranking = pickers.filter((p): p is PickerRuleResult & { id: RankingPickerRuleId } =>
    isRankingPicker(p.id)
  );
  if (!ranking.length) return 'rs20';
  return ranking.reduce((a, b) => (b.totalR > a.totalR ? b : a)).id;
}

export function pickerLabel(id: SelectablePickerRuleId): string {
  if (id === 'rs20') return 'Relative strength';
  if (id === 'expectancy') return 'Setup expectancy';
  if (id === 'random') return `Random (seed ${ACTIVE_RANDOM_SEED})`;
  return 'Planned R:R + pass rate (Production)';
}

export type PickerVerdictTone = 'losing' | 'noise' | 'caution' | 'edge';

export type PickerVerdict = {
  tone: PickerVerdictTone;
  /** Short banner title — hard to skim past. */
  headline: string;
  bullets: string[];
};

/**
 * Anti-self-fooling interpretation of picker-lab numbers.
 * Prefer calling something "noise" when in doubt.
 */
export function interpretPickerLab(input: {
  pickers: PickerRuleResult[];
  allSignalsTotalR: number;
  allSignalsTrades: number;
}): PickerVerdict {
  const { pickers, allSignalsTotalR, allSignalsTrades } = input;
  const random = pickers.find((p) => p.id === 'random');
  const selectable = pickers.filter((p) => isRankingPicker(p.id));
  const best =
    selectable.length > 0
      ? selectable.reduce((a, b) => (b.totalR > a.totalR ? b : a))
      : null;
  const spread = random?.randomSpread;
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}R`;

  if (allSignalsTrades === 0) {
    return {
      tone: 'caution',
      headline: 'No usable trades — nothing to pick.',
      bullets: [
        'Fix data coverage first. Picker rankings are meaningless without a trade pool.',
      ],
    };
  }

  // Negative universe: capped winners cannot be trusted as strategy edge.
  if (allSignalsTotalR < 0) {
    const bullets = [
      `All signals totaled ${fmt(allSignalsTotalR)} across ${allSignalsTrades} trades — the Playbook loses on this basket before any capacity filter.`,
      'When the pool is negative, a capped subset can still print a big positive number by luck (a few moonshots landed in the taken set). That is selection variance, not an edge.',
      'Do not promote a picker from this run. Drop weak names or raise quality gates until All signals is positive.',
    ];
    if (best && spread) {
      bullets.push(
        `${best.label} shows ${fmt(best.totalR)}, but random seeds already span ${fmt(spread.minR)} to ${fmt(spread.maxR)} — pick order alone can swing more than the "best" rule.`
      );
    }
    return {
      tone: 'losing',
      headline: 'Losing basket — capped winners are luck, not edge.',
      bullets,
    };
  }

  if (!best || !random || !spread) {
    return {
      tone: 'caution',
      headline: 'Not enough data to judge picker edge.',
      bullets: ['Re-run once SPY/QQQ and the symbol list have full live EOD.'],
    };
  }

  const inSampleNote =
    'Auto-activating the best rule on this same window is in-sample selection — confirm on a longer history (e.g. 800d) or a different basket before trusting it.';

  // Random itself topped the board (only happened if we counted it as best —
  // we don't, but handle empty selectable edge cases above). Prefer comparing
  // best selectable vs every random seed.
  if (best.totalR <= spread.maxR) {
    const bullets = [
      `${best.label} leads at ${fmt(best.totalR)}, but random pick orders already reached ${fmt(spread.maxR)} (range ${fmt(spread.minR)} to ${fmt(spread.maxR)}). That means slot allocation looks like luck on this window.`,
      `Underlying setups look productive (All signals ${fmt(allSignalsTotalR)}). Focus on basket quality and the max-open cap — not on which picker wins today.`,
      inSampleNote,
    ];
    if (random.totalR > 0) {
      bullets.splice(
        1,
        0,
        `Random averaged ${fmt(random.totalR)} — even a coin-flip filler of free slots would have been profitable. That credits the setups, not the ranking rule.`
      );
    }
    return {
      tone: 'noise',
      headline: 'Treat as noise — best picker is inside the random range.',
      bullets,
    };
  }

  // Beats every random seed — still caution about confirmation.
  return {
    tone: 'edge',
    headline: `${best.label} beat every random draw — possible picking edge.`,
    bullets: [
      `${best.label} at ${fmt(best.totalR)} cleared the best random seed (${fmt(spread.maxR)}). That is stronger than luck on this window alone.`,
      `All signals were ${fmt(allSignalsTotalR)} — the setups contribute, and the picker may be adding on top.`,
      inSampleNote,
      'Still check concentration: if a couple of tickers drive most of the capped R, one regime change can erase it.',
    ],
  };
}


/**
 * 20-bar relative strength vs benchmark using only bars STRICTLY BEFORE
 * entryTime. Entries fill at the entry bar's open, so the entry bar's close is
 * future information — including it leaks the trade's own first-day move into
 * the ranking (lookahead). The last usable close is the signal bar's.
 * RS = symbol 20-bar return − benchmark 20-bar return. Null if not enough bars.
 */
export function relativeStrength20(
  candles: Candle[],
  benchmark: Candle[],
  entryTime: number
): number | null {
  const idxAt = (series: Candle[]) => {
    let idx = -1;
    for (let i = 0; i < series.length; i++) {
      if (series[i].time < entryTime) idx = i;
      else break;
    }
    return idx;
  };
  const si = idxAt(candles);
  const bi = idxAt(benchmark);
  if (si < 20 || bi < 20) return null;
  const sNow = candles[si].close;
  const sThen = candles[si - 20].close;
  const bNow = benchmark[bi].close;
  const bThen = benchmark[bi - 20].close;
  if (!(sThen > 0) || !(bThen > 0)) return null;
  return sNow / sThen - bNow / bThen;
}

/**
 * Walk-forward setup expectancy score for each trade: mean realized R of
 * same-setup trades that exited strictly before this trade's entry.
 * Needs at least minSamples closed trades, otherwise 0 (no opinion).
 */
export function walkForwardExpectancyScores(
  trades: PickerTrade[],
  minSamples = 3
): Map<PickerTrade, number> {
  const scores = new Map<PickerTrade, number>();
  for (const t of trades) {
    const prior = trades.filter(
      (p) => p !== t && p.setupId === t.setupId && p.exitTime < t.entryTime
    );
    if (prior.length < minSamples) {
      scores.set(t, 0);
      continue;
    }
    scores.set(t, prior.reduce((a, p) => a + p.r, 0) / prior.length);
  }
  return scores;
}

/** Deterministic PRNG (mulberry32) so random baselines are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withScores(trades: PickerTrade[], score: (t: PickerTrade) => number): CapacityTrade[] {
  return trades.map((t) => ({
    symbol: t.symbol,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    r: t.r,
    priorityScore: score(t),
  }));
}

export const RANDOM_SEEDS = 25;

/**
 * Run max-open capacity using one ranking rule. Returns taken/skipped so the UI
 * can drive portfolio totals / per-symbol capped breakdown without re-fetching.
 * For `random`, uses ACTIVE_RANDOM_SEED (one draw) — not the multi-seed average.
 */
export function applyPickerRule(
  trades: PickerTrade[],
  ruleId: SelectablePickerRuleId,
  maxOpen: number
) {
  if (ruleId === 'rs20') {
    return simulateMaxOpenByPriority(
      withScores(trades, (t) => t.rs20 ?? 0),
      maxOpen
    );
  }
  if (ruleId === 'expectancy') {
    const expScores = walkForwardExpectancyScores(trades);
    return simulateMaxOpenByPriority(
      withScores(trades, (t) => expScores.get(t) ?? 0),
      maxOpen
    );
  }
  if (ruleId === 'random') {
    const rand = mulberry32(ACTIVE_RANDOM_SEED * 7919);
    return simulateMaxOpenByPriority(
      withScores(trades, () => rand()),
      maxOpen
    );
  }
  return simulateMaxOpenByPriority(
    withScores(trades, (t) => t.priorityScore),
    maxOpen
  );
}

/** Run the max-open simulation under each ranking rule on the same trades. */
export function comparePickerRules(
  trades: PickerTrade[],
  maxOpen: number,
  randomSeeds = RANDOM_SEEDS
): PickerRuleResult[] {
  const results: PickerRuleResult[] = [];

  const current = applyPickerRule(trades, 'priority', maxOpen);
  results.push({
    id: 'priority',
    label: 'Planned R:R + pass rate (Production)',
    description: 'Planned R:R + rule pass rate (what the app uses today).',
    trades: current.trades,
    skipped: current.skipped,
    winRate: current.winRate,
    totalR: current.totalR,
  });

  const rs = applyPickerRule(trades, 'rs20', maxOpen);
  results.push({
    id: 'rs20',
    label: 'Relative strength',
    description:
      '20-bar return vs SPY at the close before entry — prefer names outperforming the market.',
    trades: rs.trades,
    skipped: rs.skipped,
    winRate: rs.winRate,
    totalR: rs.totalR,
  });

  const exp = applyPickerRule(trades, 'expectancy', maxOpen);
  results.push({
    id: 'expectancy',
    label: 'Setup expectancy',
    description:
      'Walk-forward avg R of the same setup (closed trades only) — prefer setups that have been paying.',
    trades: exp.trades,
    skipped: exp.skipped,
    winRate: exp.winRate,
    totalR: exp.totalR,
  });

  const seeds = Math.max(1, Math.round(randomSeeds));
  let sumR = 0;
  let sumWinTrades = 0;
  let sumTaken = 0;
  let sumSkipped = 0;
  let minR = Infinity;
  let maxR = -Infinity;
  for (let s = 1; s <= seeds; s++) {
    const rand = mulberry32(s * 7919);
    const sim = simulateMaxOpenByPriority(
      withScores(trades, () => rand()),
      maxOpen
    );
    sumR += sim.totalR;
    sumTaken += sim.trades;
    sumSkipped += sim.skipped;
    sumWinTrades += sim.winRate != null ? sim.winRate * sim.trades : 0;
    minR = Math.min(minR, sim.totalR);
    maxR = Math.max(maxR, sim.totalR);
  }
  const avgTaken = sumTaken / seeds;
  results.push({
    id: 'random',
    label: 'Random (luck baseline)',
    description: `Average of ${seeds} random pick orders — tap applies seed ${ACTIVE_RANDOM_SEED} to Max-open (row stays the average).`,
    trades: Math.round(avgTaken),
    skipped: Math.round(sumSkipped / seeds),
    winRate: avgTaken > 0 ? sumWinTrades / sumTaken : null,
    totalR: sumR / seeds,
    randomSpread: trades.length
      ? { minR, maxR, seeds }
      : { minR: 0, maxR: 0, seeds },
  });

  return results;
}
