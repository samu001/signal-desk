import { runBacktest, BacktestResult, BacktestTrade } from '@/lib/backtest';
import {
  BacktestCostModel,
  DEFAULT_BACKTEST_COSTS,
  DEFAULT_STOP_COOLDOWN_BARS,
  describeCostModel,
} from '@/lib/backtestCosts';
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
};

function dayKey(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Run all setups, then keep only the best trade per entry day for a ticker.
 * Also applies a ticker-level stop-out cooldown across setups.
 */
export function runCombinedPlaybookBacktest(input: {
  symbol: string;
  setups: Setup[];
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  earningsDates?: string[];
  sourceLabel: string;
  warnings?: string[];
  evalBars?: number;
  costs?: BacktestCostModel;
  stopCooldownBars?: number;
}): CombinedPlaybookResult {
  const costs = input.costs ?? DEFAULT_BACKTEST_COSTS;
  const stopCooldownBars =
    input.stopCooldownBars != null && input.stopCooldownBars >= 0
      ? input.stopCooldownBars
      : DEFAULT_STOP_COOLDOWN_BARS;

  const setupResults = input.setups.map((setup) =>
    runBacktest({
      setup,
      symbol: input.symbol,
      candles: input.candles,
      spyCandles: input.spyCandles,
      qqqCandles: input.qqqCandles,
      earningsDates: input.earningsDates,
      sourceLabel: input.sourceLabel,
      warnings: input.warnings,
      evalBars: input.evalBars,
      costs,
      stopCooldownBars,
    })
  );

  type Candidate = CombinedPlaybookTrade & { score: number };
  const candidates: Candidate[] = [];
  for (const result of setupResults) {
    for (const trade of result.trades) {
      const score =
        trade.rMultiple +
        (result.winRate ?? 0) * 0.25 +
        (result.avgR ?? 0) * 0.15;
      candidates.push({
        ...trade,
        setupId: result.setupId,
        setupName: result.setupName,
        passRate: result.winRate ?? 0,
        score,
      });
    }
  }

  candidates.sort((a, b) => {
    const byDay = dayKey(a.entryTime).localeCompare(dayKey(b.entryTime));
    if (byDay !== 0) return byDay;
    return b.score - a.score;
  });

  const dayWinners: CombinedPlaybookTrade[] = [];
  const seenDays = new Set<string>();
  let skippedOverlaps = 0;
  for (const c of candidates) {
    const key = dayKey(c.entryTime);
    if (seenDays.has(key)) {
      skippedOverlaps += 1;
      continue;
    }
    seenDays.add(key);
    const { score: _score, ...trade } = c;
    dayWinners.push(trade);
  }

  // Ticker-level cooldown: after any selected stop-out, skip later entries for N days.
  dayWinners.sort((a, b) => a.entryTime - b.entryTime);
  const trades: CombinedPlaybookTrade[] = [];
  let skippedCooldown = 0;
  let cooldownUntil = 0;
  for (const trade of dayWinners) {
    if (trade.entryTime < cooldownUntil) {
      skippedCooldown += 1;
      continue;
    }
    trades.push(trade);
    if (trade.reason === 'stop') {
      cooldownUntil = trade.exitTime + stopCooldownBars * 86400;
    }
  }

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
      'Combined playbook: at most one entry per day (highest-scoring setup wins).',
      'Includes market regime + earnings blackout gates on each setup.',
      describeCostModel(costs),
      `Ticker cooldown after stop-out: ${stopCooldownBars} trading day${
        stopCooldownBars === 1 ? '' : 's'
      }.`,
      `Overlapping same-day signals skipped: ${skippedOverlaps}.`,
      `Post-stop cooldown skips: ${skippedCooldown}.`,
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
  };
}
