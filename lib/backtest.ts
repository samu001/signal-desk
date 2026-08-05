import {
  applyLongEntryFill,
  applyLongExitFill,
  BacktestCostModel,
  DEFAULT_BACKTEST_COSTS,
  DEFAULT_STOP_COOLDOWN_BARS,
  describeCostModel,
  netLongR,
} from '@/lib/backtestCosts';
import { DEFAULT_LIVE_GATES, PlaybookGateFlags } from '@/lib/backtestProfile';
import { atr, barsUpTo } from '@/lib/indicators';
import { applyLevelTuning, describeTuning, isProductionTuning, LevelTuning } from '@/lib/levelTuning';
import { clampLevelsRisk } from '@/lib/recommend';
import { evaluateSetupRules, setupSignalPasses } from '@/lib/rules';
import { levelsForSetup } from '@/lib/setupLevels';
import { plannedRewardToRisk, tradePriorityScore } from '@/lib/tradePriority';
import { Candle, Quote, Setup, WatchlistItem } from '@/types/trading';

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  stop: number;
  target: number;
  rMultiple: number;
  reason: 'stop' | 'target' | 'time';
  /** Rule pass rate at the signal bar (entry-time). */
  passRate: number;
  /** (target - entry) / (entry - stop) at fill — entry-time only. */
  plannedRR: number;
  /** plannedRR + passRate — for capacity / same-day ranking. */
  priorityScore: number;
};

export type BacktestResult = {
  symbol: string;
  setupId: string;
  setupName: string;
  sourceLabel: string;
  warnings: string[];
  barsUsed: number;
  warmupBars: number;
  trades: BacktestTrade[];
  winRate: number | null;
  avgR: number | null;
  expectancyR: number | null;
  maxDrawdownR: number | null;
  notes: string[];
  costs: BacktestCostModel;
  stopCooldownBars: number;
};

const WARMUP = 55;
const MAX_HOLD_BARS = 12;
const MIN_PASS_RATE = 0.7;

/** Checks that cannot be reconstructed historically on free APIs. */
const SKIP_IN_BACKTEST = new Set(['session_tradable', 'no_negative_catalyst']);

function quoteFromCandle(symbol: string, candle: Candle, prev?: Candle): Quote {
  return {
    symbol,
    price: candle.close,
    change: prev ? candle.close - prev.close : 0,
    percentChange: prev && prev.close ? ((candle.close - prev.close) / prev.close) * 100 : 0,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    previousClose: prev?.close ?? candle.open,
    source: 'yahoo',
  };
}

function signalAt(
  setup: Setup,
  symbol: string,
  history: Candle[],
  spyHistory: Candle[],
  options?: {
    qqqCandles?: Candle[];
    sectorCandles?: Candle[];
    earningsDates?: string[];
    gates?: PlaybookGateFlags;
  }
): { pass: boolean; passRate: number } {
  const levels = levelsForSetup(setup, history);
  const item: WatchlistItem = {
    id: 'bt',
    symbol,
    thesis: 'backtest',
    ...levels,
    setupId: setup.id,
    notes: '',
    createdAt: '',
  };
  const candle = history[history.length - 1];
  const prev = history[history.length - 2];
  const allResults = evaluateSetupRules(setup, {
    item,
    quote: quoteFromCandle(symbol, candle, prev),
    candles: history,
    spyCandles: spyHistory,
    qqqCandles: options?.qqqCandles,
    sectorCandles: options?.sectorCandles,
    news: [],
    earningsDates: options?.earningsDates,
    asOfTime: candle.time,
    gates: options?.gates ?? DEFAULT_LIVE_GATES,
    session: {
      phase: 'rth',
      label: 'RTH open',
      tradable: true,
      detail: 'Backtest assumes regular-session daily bars.',
    },
  });
  const { pass, passRate } = setupSignalPasses(setup, allResults, {
    minPassRate: MIN_PASS_RATE,
    skipCheckIds: SKIP_IN_BACKTEST,
  });
  return { pass, passRate };
}

function emptyResult(
  input: {
    setup: Setup;
    symbol: string;
    sourceLabel: string;
    warnings: string[];
    notes: string[];
    barsUsed: number;
    costs: BacktestCostModel;
    stopCooldownBars: number;
  }
): BacktestResult {
  return {
    symbol: input.symbol,
    setupId: input.setup.id,
    setupName: input.setup.name,
    sourceLabel: input.sourceLabel,
    warnings: input.warnings,
    barsUsed: input.barsUsed,
    warmupBars: WARMUP,
    trades: [],
    winRate: null,
    avgR: null,
    expectancyR: null,
    maxDrawdownR: null,
    notes: input.notes,
    costs: input.costs,
    stopCooldownBars: input.stopCooldownBars,
  };
}

export function runBacktest(input: {
  setup: Setup;
  symbol: string;
  candles: Candle[];
  spyCandles: Candle[];
  sourceLabel: string;
  warnings?: string[];
  /** Only look for new entries in the last N bars (keeps earlier bars for indicator warmup). */
  evalBars?: number;
  qqqCandles?: Candle[];
  sectorCandles?: Candle[];
  /** YYYY-MM-DD earnings dates for ±1 day blackout. */
  earningsDates?: string[];
  costs?: BacktestCostModel;
  /** Trading days to wait after a stop-out before re-entering this setup. */
  stopCooldownBars?: number;
  gates?: PlaybookGateFlags;
  /**
   * Parameter lab: exits-only stop/target overrides applied at the fill.
   * Undefined = production structure-based levels (unchanged behavior).
   */
  levelTuning?: LevelTuning;
}): BacktestResult {
  return runBacktestVariants(input, [input.levelTuning])[0];
}

/**
 * Multi-variant engine: one pass over the bars, one signal evaluation per bar,
 * with an independent position state machine per tuning. A variant's result is
 * identical to running that tuning alone — the only sharing is the (expensive)
 * per-bar signal evaluation. Entry eligibility is computed BEFORE exit
 * processing each bar: a variant that was flat at the top of the bar may act on
 * that bar's signal; one that just closed cannot (same semantics as runBacktest
 * has always had).
 */
export function runBacktestVariants(
  input: {
    setup: Setup;
    symbol: string;
    candles: Candle[];
    spyCandles: Candle[];
    sourceLabel: string;
    warnings?: string[];
    evalBars?: number;
    qqqCandles?: Candle[];
    sectorCandles?: Candle[];
    earningsDates?: string[];
    costs?: BacktestCostModel;
    stopCooldownBars?: number;
    gates?: PlaybookGateFlags;
  },
  tunings: Array<LevelTuning | undefined>
): BacktestResult[] {
  const { setup, symbol, candles, spyCandles, sourceLabel } = input;
  const costs = input.costs ?? DEFAULT_BACKTEST_COSTS;
  const gates = input.gates ?? DEFAULT_LIVE_GATES;
  const stopCooldownBars =
    input.stopCooldownBars != null && input.stopCooldownBars >= 0
      ? input.stopCooldownBars
      : DEFAULT_STOP_COOLDOWN_BARS;
  const warnings = [...(input.warnings ?? [])];
  const notes = [
    'Entries use next-bar open after a daily close signal.',
    'Stop/target are structure-based (not your current watchlist levels).',
    'Session + news checks are skipped in historical mode (free APIs lack reliable history).',
    describeCostModel(costs),
    `Cooldown: after a stop-out, wait ${stopCooldownBars} trading day${
      stopCooldownBars === 1 ? '' : 's'
    } before re-entering this setup.`,
  ];
  if (gates.marketRegime) {
    notes.push('Market regime gate: SPY/QQQ above 50-day MA with rising 20-day MA.');
  }
  if (gates.earningsBlackout) {
    notes.push('Earnings blackout: no new entries within ±1 day of reported earnings dates.');
  }
  if (gates.weeklyTrend) notes.push('Weekly trend gate: weekly close above rising SMA10.');
  if (gates.sectorRs) notes.push('Sector RS gate: not lagging sector ETF by more than ~2%.');
  if (gates.volatility) notes.push('Volatility gate: ATR% inside 0.9–5.5% band.');
  const notesFor = (tuning: LevelTuning | undefined) =>
    isProductionTuning(tuning)
      ? notes
      : [...notes, `Parameter lab tuning (exits only): ${describeTuning(tuning)}.`];

  if (candles.length < WARMUP + 5) {
    warnings.push(`Need at least ${WARMUP + 5} daily bars; got ${candles.length}.`);
    return tunings.map((tuning) =>
      emptyResult({
        setup,
        symbol,
        sourceLabel,
        warnings,
        notes: notesFor(tuning),
        barsUsed: candles.length,
        costs,
        stopCooldownBars,
      })
    );
  }

  const evalBars = input.evalBars && input.evalBars > 0 ? input.evalBars : null;
  const loopStart = evalBars
    ? Math.max(WARMUP, candles.length - 1 - evalBars)
    : WARMUP;
  if (evalBars) {
    notes.unshift(
      `Short window: scoring the last ~${evalBars} trading days only (earlier bars used for warmup).`
    );
  }

  type OpenPos = {
    entryTime: number;
    entry: number;
    stop: number;
    target: number;
    entryIndex: number;
    passRate: number;
    plannedRR: number;
    priorityScore: number;
  };

  const tradesByVariant: BacktestTrade[][] = tunings.map(() => []);
  const opens: Array<OpenPos | null> = tunings.map(() => null);
  /** Per variant: first bar index where a new entry is allowed after a stop. */
  const cooldowns: number[] = tunings.map(() => -1);

  const closeTrade = (
    openPos: OpenPos,
    exitTime: number,
    exitFill: number,
    reason: BacktestTrade['reason']
  ): BacktestTrade => ({
    entryTime: openPos.entryTime,
    exitTime,
    entry: openPos.entry,
    exit: exitFill,
    stop: openPos.stop,
    target: openPos.target,
    rMultiple: netLongR({
      entryFill: openPos.entry,
      exitFill,
      stop: openPos.stop,
    }),
    reason,
    passRate: openPos.passRate,
    plannedRR: openPos.plannedRR,
    priorityScore: openPos.priorityScore,
  });

  for (let i = loopStart; i < candles.length - 1; i++) {
    // Eligibility snapshot BEFORE exits: only variants flat at the top of this
    // bar may act on this bar's signal (mirrors single-run semantics).
    const eligible: number[] = [];
    for (let v = 0; v < tunings.length; v++) {
      if (!opens[v] && i >= cooldowns[v]) eligible.push(v);
    }

    const bar = candles[i];
    for (let v = 0; v < tunings.length; v++) {
      const open = opens[v];
      if (!open) continue;
      const hitStop = bar.low <= open.stop;
      const hitTarget = bar.high >= open.target;
      const timedOut = i - open.entryIndex >= MAX_HOLD_BARS;

      if (hitStop || hitTarget || timedOut) {
        let rawExit = bar.close;
        let reason: BacktestTrade['reason'] = 'time';
        if (hitStop && hitTarget) {
          // Conservative: assume stop first on same bar. Gap-aware: a bar that
          // opens through the stop fills at the open, not the stop price.
          rawExit = Math.min(open.stop, bar.open);
          reason = 'stop';
        } else if (hitStop) {
          rawExit = Math.min(open.stop, bar.open);
          reason = 'stop';
        } else if (hitTarget) {
          // Favorable gaps fill at the open too.
          rawExit = Math.max(open.target, bar.open);
          reason = 'target';
        }
        const exitFill = applyLongExitFill(rawExit, costs);
        tradesByVariant[v].push(closeTrade(open, bar.time, exitFill, reason));
        if (reason === 'stop') {
          cooldowns[v] = i + stopCooldownBars;
        }
        opens[v] = null;
      }
    }

    if (!eligible.length) continue;

    // Point-in-time benchmark truncation by DATE, not index: index slicing
    // misaligns short-history symbols (IPOs) and leaks future SPY/QQQ/sector
    // bars whenever the benchmark array is shorter than the symbol's.
    const history = candles.slice(0, i + 1);
    const asOf = bar.time;
    const spyHistoryForGates = barsUpTo(spyCandles, asOf);
    const qqqHistory = barsUpTo(input.qqqCandles ?? [], asOf);
    const sectorHistory = barsUpTo(input.sectorCandles ?? [], asOf);
    const { pass, passRate } = signalAt(setup, symbol, history, spyHistoryForGates, {
      qqqCandles: qqqHistory,
      sectorCandles: sectorHistory,
      earningsDates: input.earningsDates,
      gates,
    });
    if (!pass) continue;

    const levels = levelsForSetup(setup, history);
    const next = candles[i + 1];
    const entryFill = applyLongEntryFill(next.open, costs);
    const atr14 = atr(history, 14);
    // Match the Desk: cap risk at min(2.5×ATR, 8% of entry) before any tuning,
    // so backtests measure the same stop geometry the cards actually trade.
    const clamped = clampLevelsRisk(levels, atr14);
    for (const v of eligible) {
      const tuned = applyLevelTuning(clamped, entryFill, atr14, tunings[v]);
      // Skip pathological fills where friction wipes the stop distance.
      if (entryFill <= tuned.stop) continue;
      const plannedRR = plannedRewardToRisk(entryFill, tuned.stop, tuned.target);
      opens[v] = {
        entryTime: next.time,
        entry: entryFill,
        stop: tuned.stop,
        target: tuned.target,
        entryIndex: i + 1,
        passRate,
        plannedRR,
        priorityScore: tradePriorityScore(plannedRR, passRate),
      };
    }
  }

  // Force-close any open trade on last bar.
  const last = candles[candles.length - 1];
  for (let v = 0; v < tunings.length; v++) {
    const open = opens[v];
    if (open) {
      const exitFill = applyLongExitFill(last.close, costs);
      tradesByVariant[v].push(closeTrade(open, last.time, exitFill, 'time'));
      opens[v] = null;
    }
  }

  return tunings.map((tuning, v) => {
    const trades = tradesByVariant[v];
    const rs = trades.map((t) => t.rMultiple);
    const wins = rs.filter((r) => r > 0);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (const r of rs) {
      equity += r;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
    }
    return {
      symbol,
      setupId: setup.id,
      setupName: setup.name,
      sourceLabel,
      warnings,
      barsUsed: candles.length,
      warmupBars: WARMUP,
      trades,
      winRate: rs.length ? wins.length / rs.length : null,
      avgR,
      expectancyR: avgR,
      maxDrawdownR: rs.length ? maxDd : null,
      notes: notesFor(tuning),
      costs,
      stopCooldownBars,
    };
  });
}
