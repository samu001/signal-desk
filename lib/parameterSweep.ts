/**
 * Portfolio-level parameter sweep: answer "on THIS basket, under my real
 * max-open cap, which exit setting would have produced the best capped R — and
 * is that edge real or luck?"
 *
 * Unlike lib/parameterLab.ts (which pools raw per-setup signals for statistical
 * power), this runs each exit variant through the full portfolio pipeline —
 * same-day dedup, one-open-per-ticker, stop cooldown, and the max-open capacity
 * cap — so the numbers are directly comparable to the Portfolio backtest's own
 * capped total.
 *
 * Small exit grid: production plus a few stop-policy × target combos. Each row
 * is a complete exit package run through the full portfolio pipeline — same-day
 * dedup, one-open-per-ticker, stop cooldown, and the max-open capacity cap — so
 * the numbers are directly comparable to the Portfolio backtest's own capped
 * total.
 *
 * Ranking under the cap uses entry-time priority (planned R:R + pass rate) —
 * production behavior — never realized R, so this stays a what-if, not a
 * curve-fit.
 */

import { runBacktestVariants } from '@/lib/backtest';
import { BacktestCostModel, DEFAULT_BACKTEST_COSTS } from '@/lib/backtestCosts';
import { PlaybookGateFlags } from '@/lib/backtestProfile';
import { EarningsFetchStatus } from '@/lib/finnhub';
import { LevelTuning } from '@/lib/levelTuning';
import {
  buildVerdict,
  defaultParamVariants,
  ParamKnob,
  ParamVariant,
  ParamVariantResult,
  ParamKnobVerdict,
} from '@/lib/parameterLab';
import { PickerTrade, relativeStrength20 } from '@/lib/pickerLab';
import { simulateMaxOpenByPriority } from '@/lib/portfolioCapacity';
import {
  applyStopCooldown,
  enforceOneOpenPosition,
  selectBestTradesPerDay,
  CombinedPlaybookTrade,
} from '@/lib/playbookCombined';
import { tradePriorityScore } from '@/lib/tradePriority';
import { Candle, Setup } from '@/types/trading';

export type SweepTicker = {
  symbol: string;
  candles: Candle[];
  /** YYYY-MM-DD earnings dates for ±1 day blackout (same as portfolio run). */
  earningsDates?: string[];
  /** Distinguishes no-key / fetch-error / empty when dates are []. */
  earningsCalendarStatus?: EarningsFetchStatus;
  /** Per-ticker costs (tiered slippage); falls back to input.costs. */
  costs?: BacktestCostModel;
};

/** A combined-playbook trade tagged with its symbol for the pooled cap. */
type SymbolTrade = CombinedPlaybookTrade & { symbol: string };

export type SweepKnobResult = {
  knob: ParamKnob;
  variants: ParamVariantResult[];
  verdict: ParamKnobVerdict;
};

export type ParameterSweepResult = {
  knobs: SweepKnobResult[];
  /** Pooled capped trades for the production variant — sanity anchor. */
  productionCappedTrades: number;
  /**
   * Uncapped trades per variant (same order as the flattened variant list),
   * with RS20 attached — enough to recompute All-signals and a per-variant
   * Picker lab without re-running the backtest.
   */
  uncappedByVariant: { variant: ParamVariant; trades: PickerTrade[] }[];
};

function summarize(rs: number[]): { totalR: number; winRate: number | null; avgR: number | null; maxDrawdownR: number | null } {
  const wins = rs.filter((r) => r > 0);
  const totalR = rs.reduce((a, b) => a + b, 0);
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return {
    totalR,
    winRate: rs.length ? wins.length / rs.length : null,
    avgR: rs.length ? totalR / rs.length : null,
    maxDrawdownR: rs.length ? maxDd : null,
  };
}

function splitWindows(trades: { exitTime: number; rMultiple: number }[]) {
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const midExit = sorted[Math.floor(sorted.length / 2)].exitTime;
  const sum = (ts: { exitTime: number; rMultiple: number }[]) =>
    ts.reduce((a, t) => a + t.rMultiple, 0);
  const early = sorted.filter((t) => t.exitTime <= midExit);
  const late = sorted.filter((t) => t.exitTime > midExit);
  return [
    { label: 'Early half', totalR: sum(early), trades: early.length },
    { label: 'Late half', totalR: sum(late), trades: late.length },
  ];
}

/**
 * Run every exit variant across the basket, push each through the portfolio
 * pipeline, and score it by capped R. Variants share one signal evaluation per
 * (ticker, setup) via runBacktestVariants, so cost is one sweep, not N runs.
 */
export function runParameterSweep(input: {
  setups: Setup[];
  tickers: SweepTicker[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  costs?: BacktestCostModel;
  gates?: PlaybookGateFlags;
  stopCooldownBars?: number;
  maxOpen: number;
  variants?: ParamVariant[];
}): ParameterSweepResult {
  const variants = input.variants ?? defaultParamVariants();
  const tunings = variants.map((v) => v.tuning);
  const knobs: ParamKnob[] = [...new Set(variants.map((v) => v.knob))];

  // Per variant: pooled de-duplicated/cooldown trades (symbol attached for the cap).
  const pooledByVariant: SymbolTrade[][] = variants.map(() => []);
  // Per variant: the same trades as PickerTrade (with RS20) for uncapped views.
  const uncappedByVariant: { variant: ParamVariant; trades: PickerTrade[] }[] = variants.map(
    (v) => ({ variant: v, trades: [] })
  );

  for (const ticker of input.tickers) {
    // Collect this ticker's trades per variant across all setups.
    const byVariant: SymbolTrade[][] = variants.map(() => []);
    for (const setup of input.setups) {
      const results = runBacktestVariants(
        {
          setup,
          symbol: ticker.symbol,
          candles: ticker.candles,
          spyCandles: input.spyCandles,
          qqqCandles: input.qqqCandles,
          earningsDates: ticker.earningsDates,
          earningsCalendarStatus: ticker.earningsCalendarStatus,
          costs: ticker.costs ?? input.costs ?? DEFAULT_BACKTEST_COSTS,
          gates: input.gates,
          stopCooldownBars: input.stopCooldownBars,
          sourceLabel: 'parameter-sweep',
        },
        tunings
      );
      results.forEach((result, vi) => {
        for (const trade of result.trades) {
          byVariant[vi].push({
            ...trade,
            symbol: ticker.symbol,
            setupId: result.setupId,
            setupName: result.setupName,
            passRate: trade.passRate,
            priorityScore:
              trade.priorityScore ?? tradePriorityScore(trade.plannedRR ?? 0, trade.passRate ?? 0),
          });
        }
      });
    }

    // Same pipeline as the portfolio run: dedup per day, one open at a time,
    // then stop cooldown.
    byVariant.forEach((candidates, vi) => {
      const { winners } = selectBestTradesPerDay(candidates);
      const { taken: nonOverlapping } = enforceOneOpenPosition(winners);
      const barTimes = ticker.candles.map((c) => c.time);
      const { taken } = applyStopCooldown(
        nonOverlapping,
        input.stopCooldownBars ?? 0,
        barTimes
      );
      for (const t of taken) {
        pooledByVariant[vi].push({ ...t, symbol: ticker.symbol });
        uncappedByVariant[vi].trades.push({
          symbol: ticker.symbol,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          r: t.rMultiple,
          priorityScore: t.priorityScore,
          setupId: t.setupId,
          rs20: relativeStrength20(ticker.candles, input.spyCandles, t.entryTime),
          entry: t.entry,
          stop: t.stop,
        });
      }
    });
  }

  // Apply the max-open cap per variant on the pooled trades, then score.
  const resultsByVariant: ParamVariantResult[] = variants.map((variant, vi) => {
    const pooled = pooledByVariant[vi];
    const capped = simulateMaxOpenByPriority(
      pooled.map((t) => ({
        symbol: t.symbol,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        r: t.rMultiple,
        priorityScore: t.priorityScore,
      })),
      input.maxOpen
    );
    const takenTrades = capped.taken;
    const rs = takenTrades.map((t) => t.r);
    const summary = summarize(rs);
    // Per-ticker capped totals: re-aggregate the taken trades by symbol.
    const takenBySymbol = new Map<string, { trades: number; totalR: number }>();
    for (const t of takenTrades) {
      const cur = takenBySymbol.get(t.symbol) ?? { trades: 0, totalR: 0 };
      cur.trades += 1;
      cur.totalR += t.r;
      takenBySymbol.set(t.symbol, cur);
    }
    const perTicker = input.tickers.map((tk) => {
      const c = takenBySymbol.get(tk.symbol);
      return { symbol: tk.symbol, trades: c?.trades ?? 0, totalR: c?.totalR ?? 0 };
    });
    return {
      variant,
      trades: takenTrades.length,
      winRate: summary.winRate,
      avgR: summary.avgR,
      totalR: summary.totalR,
      maxDrawdownR: summary.maxDrawdownR,
      perTicker,
      windows: splitWindows(
        takenTrades.map((t) => ({ exitTime: t.exitTime, rMultiple: t.r }))
      ),
    };
  });

  const knobResults: SweepKnobResult[] = knobs.map((knob) => {
    const results = resultsByVariant.filter((r) => r.variant.knob === knob);
    return { knob, variants: results, verdict: buildVerdict(knob, results) };
  });

  const prodIdx = variants.findIndex((v) => v.isProduction);
  return {
    knobs: knobResults,
    productionCappedTrades: prodIdx >= 0 ? resultsByVariant[prodIdx].trades : 0,
    uncappedByVariant,
  };
}

/**
 * Highest-totalR exit variant across every knob (for the "Best (this window)"
 * badge / lab comparisons). Returns null when production wins or the sweep is
 * empty. The portfolio screen no longer auto-activates this — Active stays on
 * Production after a run; callers tap a row to compare.
 */
export function bestParamVariantId(sweep: ParameterSweepResult): string | null {
  let best: { id: string; totalR: number; isProduction: boolean } | null = null;
  for (const { variants } of sweep.knobs) {
    for (const v of variants) {
      if (!best || v.totalR > best.totalR) {
        best = {
          id: v.variant.id,
          totalR: v.totalR,
          isProduction: v.variant.isProduction,
        };
      }
    }
  }
  if (!best || best.isProduction) return null;
  return best.id;
}

/**
 * Production-only baseline: run just the production exit levels through the
 * same dedup/cooldown/cap pipeline. Used to give a tuned run a same-basket
 * production comparison without paying for the full sweep.
 */
export function runProductionBaseline(input: {
  setups: Setup[];
  tickers: SweepTicker[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  costs?: BacktestCostModel;
  gates?: PlaybookGateFlags;
  stopCooldownBars?: number;
  maxOpen: number;
}): { totalR: number; trades: number; winRate: number | null } {
  const prodVariant: ParamVariant = {
    id: 'exitGrid:prod',
    knob: 'exitGrid',
    label: 'Production',
    tuning: undefined,
    isProduction: true,
  };
  const result = runParameterSweep({ ...input, variants: [prodVariant] });
  const prod = result.knobs[0]?.variants.find((v) => v.variant.isProduction);
  return {
    totalR: prod?.totalR ?? 0,
    trades: prod?.trades ?? 0,
    winRate: prod?.winRate ?? null,
  };
}

/** Re-export so the screen can label variants without importing parameterLab. */
export type { ParamVariant, ParamVariantResult, ParamKnobVerdict, LevelTuning };
