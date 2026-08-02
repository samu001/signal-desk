import { closes, sma } from '@/lib/indicators';
import { evaluateSetupRules, scoreRuleResults } from '@/lib/rules';
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

function dynamicLevels(setup: Setup, history: Candle[]): Pick<
  WatchlistItem,
  'entryLow' | 'entryHigh' | 'stop' | 'target'
> {
  const price = history[history.length - 1].close;
  const window = history.slice(-12);
  const swingLow = Math.min(...window.map((c) => c.low));
  const swingHigh = Math.max(...window.map((c) => c.high));
  const sma20 = sma(closes(history), 20) ?? price;

  if (setup.id.includes('breakout')) {
    const level = swingHigh;
    const stop = level * 0.97;
    const entry = Math.max(price, level);
    const risk = Math.max(entry - stop, entry * 0.01);
    return {
      entryLow: level * 0.995,
      entryHigh: level * 1.03,
      stop,
      target: entry + 2 * risk,
    };
  }

  if (setup.id.includes('mean-reversion')) {
    const stop = swingLow * 0.99;
    const risk = Math.max(price - stop, price * 0.01);
    return {
      entryLow: sma20 * 0.96,
      entryHigh: sma20 * 0.995,
      stop,
      target: sma20,
    };
  }

  // Trend pullback default
  const stop = Math.min(swingLow, sma20 * 0.97);
  const risk = Math.max(price - stop, price * 0.01);
  return {
    entryLow: sma20 * 0.985,
    entryHigh: sma20 * 1.015,
    stop,
    target: price + 2 * risk,
  };
}

function signalAt(
  setup: Setup,
  symbol: string,
  history: Candle[],
  spyHistory: Candle[]
): { pass: boolean; passRate: number } {
  const levels = dynamicLevels(setup, history);
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
    news: [],
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

export function runBacktest(input: {
  setup: Setup;
  symbol: string;
  candles: Candle[];
  spyCandles: Candle[];
  sourceLabel: string;
  warnings?: string[];
  /** Only look for new entries in the last N bars (keeps earlier bars for indicator warmup). */
  evalBars?: number;
}): BacktestResult {
  const { setup, symbol, candles, spyCandles, sourceLabel } = input;
  const warnings = [...(input.warnings ?? [])];
  const notes = [
    'Entries use next-bar open after a daily close signal.',
    'Stop/target are structure-based (not your current watchlist levels).',
    'Session + news checks are skipped in historical mode (free APIs lack reliable history).',
  ];

  const trades: BacktestTrade[] = [];
  if (candles.length < WARMUP + 5) {
    warnings.push(`Need at least ${WARMUP + 5} daily bars; got ${candles.length}.`);
    return {
      symbol,
      setupId: setup.id,
      setupName: setup.name,
      sourceLabel,
      warnings,
      barsUsed: candles.length,
      warmupBars: WARMUP,
      trades,
      winRate: null,
      avgR: null,
      expectancyR: null,
      maxDrawdownR: null,
      notes,
    };
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

  let open:
    | {
        entryTime: number;
        entry: number;
        stop: number;
        target: number;
        entryIndex: number;
      }
    | null = null;

  for (let i = loopStart; i < candles.length - 1; i++) {
    const history = candles.slice(0, i + 1);
    const spyHistory =
      spyCandles.length >= history.length
        ? spyCandles.slice(0, i + 1)
        : spyCandles;

    if (open) {
      const bar = candles[i];
      const risk = open.entry - open.stop;
      const hitStop = bar.low <= open.stop;
      const hitTarget = bar.high >= open.target;
      const timedOut = i - open.entryIndex >= MAX_HOLD_BARS;

      if (hitStop || hitTarget || timedOut) {
        let exit = bar.close;
        let reason: BacktestTrade['reason'] = 'time';
        if (hitStop && hitTarget) {
          // Conservative: assume stop first on same bar.
          exit = open.stop;
          reason = 'stop';
        } else if (hitStop) {
          exit = open.stop;
          reason = 'stop';
        } else if (hitTarget) {
          exit = open.target;
          reason = 'target';
        }
        const rMultiple = risk > 0 ? (exit - open.entry) / risk : 0;
        trades.push({
          entryTime: open.entryTime,
          exitTime: bar.time,
          entry: open.entry,
          exit,
          stop: open.stop,
          target: open.target,
          rMultiple,
          reason,
        });
        open = null;
      }
      continue;
    }

    const { pass } = signalAt(setup, symbol, history, spyHistory);
    if (!pass) continue;

    const levels = dynamicLevels(setup, history);
    const next = candles[i + 1];
    open = {
      entryTime: next.time,
      entry: next.open,
      stop: levels.stop,
      target: levels.target,
      entryIndex: i + 1,
    };
    // Jump index handling: loop will process exits from entry bar onward.
  }

  // Force-close any open trade on last bar.
  if (open) {
    const last = candles[candles.length - 1];
    const risk = open.entry - open.stop;
    const exit = last.close;
    trades.push({
      entryTime: open.entryTime,
      exitTime: last.time,
      entry: open.entry,
      exit,
      stop: open.stop,
      target: open.target,
      rMultiple: risk > 0 ? (exit - open.entry) / risk : 0,
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
  };
}
