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
import { evaluateSetupRules, scoreRuleResults } from '@/lib/rules';
import { levelsForSetup } from '@/lib/setupLevels';
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
    source: 'demo',
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
  const usable = allResults.filter((r) => !SKIP_IN_BACKTEST.has(r.id));
  const scored = scoreRuleResults(usable.length ? usable : allResults);
  const hardFails = usable.filter((r) => r.verdict === 'fail').length;
  return {
    pass: scored.passRate >= MIN_PASS_RATE && hardFails === 0,
    passRate: scored.passRate,
  };
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
}): BacktestResult {
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

  if (candles.length < WARMUP + 5) {
    warnings.push(`Need at least ${WARMUP + 5} daily bars; got ${candles.length}.`);
    return emptyResult({
      setup,
      symbol,
      sourceLabel,
      warnings,
      notes,
      barsUsed: candles.length,
      costs,
      stopCooldownBars,
    });
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

  const trades: BacktestTrade[] = [];
  let open:
    | {
        entryTime: number;
        entry: number;
        stop: number;
        target: number;
        entryIndex: number;
      }
    | null = null;
  /** First bar index where a new entry is allowed again after a stop. */
  let cooldownUntilIndex = -1;

  for (let i = loopStart; i < candles.length - 1; i++) {
    const history = candles.slice(0, i + 1);

    if (open) {
      const bar = candles[i];
      const hitStop = bar.low <= open.stop;
      const hitTarget = bar.high >= open.target;
      const timedOut = i - open.entryIndex >= MAX_HOLD_BARS;

      if (hitStop || hitTarget || timedOut) {
        let rawExit = bar.close;
        let reason: BacktestTrade['reason'] = 'time';
        if (hitStop && hitTarget) {
          // Conservative: assume stop first on same bar.
          rawExit = open.stop;
          reason = 'stop';
        } else if (hitStop) {
          rawExit = open.stop;
          reason = 'stop';
        } else if (hitTarget) {
          rawExit = open.target;
          reason = 'target';
        }
        const exitFill = applyLongExitFill(rawExit, costs);
        const rMultiple = netLongR({
          entryFill: open.entry,
          exitFill,
          stop: open.stop,
        });
        trades.push({
          entryTime: open.entryTime,
          exitTime: bar.time,
          entry: open.entry,
          exit: exitFill,
          stop: open.stop,
          target: open.target,
          rMultiple,
          reason,
        });
        if (reason === 'stop') {
          cooldownUntilIndex = i + stopCooldownBars;
        }
        open = null;
      }
      continue;
    }

    if (i < cooldownUntilIndex) continue;

    const spyHistoryForGates =
      spyCandles.length >= history.length ? spyCandles.slice(0, i + 1) : spyCandles;
    const qqqFull = input.qqqCandles ?? [];
    const qqqHistory =
      qqqFull.length >= history.length ? qqqFull.slice(0, i + 1) : qqqFull;
    const sectorFull = input.sectorCandles ?? [];
    const sectorHistory =
      sectorFull.length >= history.length ? sectorFull.slice(0, i + 1) : sectorFull;
    const { pass } = signalAt(setup, symbol, history, spyHistoryForGates, {
      qqqCandles: qqqHistory,
      sectorCandles: sectorHistory,
      earningsDates: input.earningsDates,
      gates,
    });
    if (!pass) continue;

    const levels = levelsForSetup(setup, history);
    const next = candles[i + 1];
    const entryFill = applyLongEntryFill(next.open, costs);
    // Skip pathological fills where friction wipes the stop distance.
    if (entryFill <= levels.stop) continue;
    open = {
      entryTime: next.time,
      entry: entryFill,
      stop: levels.stop,
      target: levels.target,
      entryIndex: i + 1,
    };
  }

  // Force-close any open trade on last bar.
  if (open) {
    const last = candles[candles.length - 1];
    const exitFill = applyLongExitFill(last.close, costs);
    trades.push({
      entryTime: open.entryTime,
      exitTime: last.time,
      entry: open.entry,
      exit: exitFill,
      stop: open.stop,
      target: open.target,
      rMultiple: netLongR({
        entryFill: open.entry,
        exitFill,
        stop: open.stop,
      }),
      reason: 'time',
    });
  }

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
    notes,
    costs,
    stopCooldownBars,
  };
}
