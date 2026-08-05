import { runBacktest, BacktestResult, BacktestTrade } from '@/lib/backtest';
import {
  BacktestCostModel,
  DEFAULT_BACKTEST_COSTS,
  DEFAULT_STOP_COOLDOWN_BARS,
  describeCostModel,
} from '@/lib/backtestCosts';
import { BacktestProfile, DEFAULT_LIVE_GATES, PlaybookGateFlags } from '@/lib/backtestProfile';
import { describeTuning, isProductionTuning, LevelTuning } from '@/lib/levelTuning';
import { tradePriorityScore } from '@/lib/tradePriority';
import { Candle, Setup } from '@/types/trading';

export type CombinedPlaybookTrade = BacktestTrade & {
  setupId: string;
  setupName: string;
  passRate: number;
};

export type CombinedPlaybookResult = {
  symbol: string;
  sourceLabel: string;
  warnings: string[];
  notes: string[];
  setupResults: BacktestResult[];
  /** De-duplicated: at most one entry per day (best setup wins). */
  trades: CombinedPlaybookTrade[];
  skippedOverlaps: number;
  skippedCooldown: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number | null;
  costs: BacktestCostModel;
  stopCooldownBars: number;
  profileId?: string;
};

function dayKey(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Same-day winner by entry-time priority (exported for tests). */
export function selectBestTradesPerDay(
  candidates: CombinedPlaybookTrade[]
): { winners: CombinedPlaybookTrade[]; skippedOverlaps: number } {
  const ranked = [...candidates].sort((a, b) => {
    const byDay = dayKey(a.entryTime).localeCompare(dayKey(b.entryTime));
    if (byDay !== 0) return byDay;
    const aScore = a.priorityScore ?? tradePriorityScore(a.plannedRR ?? 0, a.passRate ?? 0);
    const bScore = b.priorityScore ?? tradePriorityScore(b.plannedRR ?? 0, b.passRate ?? 0);
    if (bScore !== aScore) return bScore - aScore;
    if (b.plannedRR !== a.plannedRR) return b.plannedRR - a.plannedRR;
    return a.setupName.localeCompare(b.setupName);
  });

  const winners: CombinedPlaybookTrade[] = [];
  const seenDays = new Set<string>();
  let skippedOverlaps = 0;
  for (const c of ranked) {
    const key = dayKey(c.entryTime);
    if (seenDays.has(key)) {
      skippedOverlaps += 1;
      continue;
    }
    seenDays.add(key);
    winners.push(c);
  }
  winners.sort((a, b) => a.entryTime - b.entryTime);
  return { winners, skippedOverlaps };
}

/**
 * Post-stop cooldown without lookahead (exported for tests).
 * Each cooldown window starts at the stop-out EXIT. An entry taken while that
 * trade was still open must not be skipped — at entry time nobody knows the
 * open trade will stop out (skipping it would peek at the future).
 */
export function applyStopCooldown(
  dayWinners: CombinedPlaybookTrade[],
  stopCooldownBars: number
): { taken: CombinedPlaybookTrade[]; skippedCooldown: number } {
  const taken: CombinedPlaybookTrade[] = [];
  let skippedCooldown = 0;
  const windows: Array<{ from: number; until: number }> = [];
  for (const trade of dayWinners) {
    const inCooldown =
      stopCooldownBars > 0 &&
      windows.some((w) => trade.entryTime >= w.from && trade.entryTime < w.until);
    if (inCooldown) {
      skippedCooldown += 1;
      continue;
    }
    taken.push(trade);
    if (trade.reason === 'stop' && stopCooldownBars > 0) {
      windows.push({
        from: trade.exitTime,
        until: trade.exitTime + stopCooldownBars * 86400,
      });
    }
  }
  return { taken, skippedCooldown };
}

/**
 * Run all setups, then keep only the best trade per entry day for a ticker.
 * Also applies a ticker-level stop-out cooldown across setups when enabled.
 * Same-day winner uses entry-time priority (planned R:R + pass rate) — never realized R.
 */
export function runCombinedPlaybookBacktest(input: {
  symbol: string;
  setups: Setup[];
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  sectorCandles?: Candle[];
  earningsDates?: string[];
  sourceLabel: string;
  warnings?: string[];
  evalBars?: number;
  costs?: BacktestCostModel;
  stopCooldownBars?: number;
  gates?: PlaybookGateFlags;
  profile?: BacktestProfile;
  /**
   * Exits-only stop/target overrides applied at the fill (see
   * lib/levelTuning.ts). Threads into every per-setup run, so same-day dedup
   * and picker priorities are recomputed from the tuned planned R:R.
   */
  levelTuning?: LevelTuning;
}): CombinedPlaybookResult {
  const profile = input.profile;
  const costs = profile?.costs ?? input.costs ?? DEFAULT_BACKTEST_COSTS;
  const gates = profile?.gates ?? input.gates ?? DEFAULT_LIVE_GATES;
  const stopCooldownBars =
    profile?.stopCooldownBars ??
    (input.stopCooldownBars != null && input.stopCooldownBars >= 0
      ? input.stopCooldownBars
      : DEFAULT_STOP_COOLDOWN_BARS);

  const setupResults = input.setups.map((setup) =>
    runBacktest({
      setup,
      symbol: input.symbol,
      candles: input.candles,
      spyCandles: input.spyCandles,
      qqqCandles: input.qqqCandles,
      sectorCandles: input.sectorCandles,
      earningsDates: input.earningsDates,
      sourceLabel: input.sourceLabel,
      warnings: input.warnings,
      evalBars: input.evalBars,
      costs,
      stopCooldownBars,
      gates,
      levelTuning: input.levelTuning,
    })
  );

  const candidates: CombinedPlaybookTrade[] = [];
  for (const result of setupResults) {
    for (const trade of result.trades) {
      candidates.push({
        ...trade,
        setupId: result.setupId,
        setupName: result.setupName,
        passRate: trade.passRate,
        priorityScore:
          trade.priorityScore ?? tradePriorityScore(trade.plannedRR ?? 0, trade.passRate ?? 0),
      });
    }
  }

  const { winners: dayWinners, skippedOverlaps } = selectBestTradesPerDay(candidates);
  const { taken: trades, skippedCooldown } = applyStopCooldown(dayWinners, stopCooldownBars);

  const rs = trades.map((t) => t.rMultiple);
  const wins = rs.filter((r) => r > 0);
  const totalR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
  const avgR = rs.length && totalR != null ? totalR / rs.length : null;

  const warnings = [...(input.warnings ?? [])];
  for (const r of setupResults) {
    for (const w of r.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  return {
    symbol: input.symbol.toUpperCase(),
    sourceLabel: input.sourceLabel,
    warnings,
    notes: [
      profile
        ? `Profile: ${profile.label} — ${profile.description}`
        : 'Combined playbook: at most one entry per day (highest entry-time priority wins).',
      'Same-day setup pick uses planned R:R + rule pass rate (not realized R).',
      describeCostModel(costs),
      `Ticker cooldown after stop-out: ${stopCooldownBars} trading day${
        stopCooldownBars === 1 ? '' : 's'
      }.`,
      `Overlapping same-day signals skipped: ${skippedOverlaps}.`,
      `Post-stop cooldown skips: ${skippedCooldown}.`,
      ...(isProductionTuning(input.levelTuning)
        ? []
        : [
            `Exit tuning active (exits-only): ${describeTuning(input.levelTuning)} — same entries; planned R:R and same-day/picker priorities recomputed from tuned levels.`,
          ]),
    ],
    setupResults,
    trades,
    skippedOverlaps,
    skippedCooldown,
    winRate: rs.length ? wins.length / rs.length : null,
    avgR,
    totalR,
    costs,
    stopCooldownBars,
    profileId: profile?.id,
  };
}
