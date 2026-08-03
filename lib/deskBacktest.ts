import { defaultSetups } from '@/constants/seed';
import { buildRecommendation, Stance } from '@/lib/recommend';
import { Candle, Quote, Setup } from '@/types/trading';

export type DeskBacktestTrade = {
  stance: Stance;
  technicalScore: number;
  overallScore: number;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  stop: number;
  target: number;
  rMultiple: number;
  reason: 'stop' | 'target' | 'time';
};

export type DeskBacktestStanceStats = {
  stance: Stance;
  trades: number;
  winRate: number | null;
  avgR: number | null;
};

export type DeskBacktestResult = {
  symbol: string;
  sourceLabel: string;
  warnings: string[];
  notes: string[];
  barsUsed: number;
  warmupBars: number;
  evalBars: number;
  signals: Record<Stance, number>;
  trades: DeskBacktestTrade[];
  winRate: number | null;
  avgR: number | null;
  expectancyR: number | null;
  maxDrawdownR: number | null;
  byStance: DeskBacktestStanceStats[];
};

const WARMUP = 55;
const MAX_HOLD_BARS = 12;

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

function shouldEnter(stance: Stance, nearEntry: boolean, inEntry: boolean): boolean {
  if (stance === 'strong_buy') return nearEntry || inEntry;
  if (stance === 'soft_buy') return inEntry || nearEntry;
  return false;
}

function statsFor(trades: DeskBacktestTrade[]): {
  winRate: number | null;
  avgR: number | null;
  maxDrawdownR: number | null;
} {
  const rs = trades.map((t) => t.rMultiple);
  if (!rs.length) return { winRate: null, avgR: null, maxDrawdownR: null };
  const wins = rs.filter((r) => r > 0);
  const avgR = rs.reduce((a, b) => a + b, 0) / rs.length;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return {
    winRate: wins.length / rs.length,
    avgR,
    maxDrawdownR: maxDd,
  };
}

/**
 * Replay Desk stances on daily history.
 * Company/news are neutralized (not point-in-time). Soft/Strong buy still requires
 * a Playbook setup match. Entries use next-bar open when in/near the zone.
 */
export function runDeskBacktest(input: {
  symbol: string;
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  earningsDates?: string[];
  sourceLabel: string;
  warnings?: string[];
  evalBars?: number;
  setups?: Setup[];
}): DeskBacktestResult {
  const symbol = input.symbol.toUpperCase().trim();
  const { candles, spyCandles, sourceLabel } = input;
  const setups = input.setups?.length ? input.setups : defaultSetups;
  const warnings = [...(input.warnings ?? [])];
  const notes = [
    'Desk historical mode: technicals + Playbook confirmation; company/news neutralized.',
    'Soft/Strong buy only when a playbook setup also matches and price is in/near the zone.',
    'Playbook gates: market regime (SPY/QQQ) + earnings blackout when dates are provided.',
    'Exits on stop, target (~2R), or ~12-session time stop.',
  ];
  const evalBars = input.evalBars && input.evalBars > 0 ? input.evalBars : 30;
  const signals: Record<Stance, number> = {
    strong_buy: 0,
    soft_buy: 0,
    wait: 0,
    avoid: 0,
  };
  const trades: DeskBacktestTrade[] = [];

  if (candles.length < WARMUP + 5) {
    warnings.push(`Need at least ${WARMUP + 5} daily bars; got ${candles.length}.`);
    return {
      symbol,
      sourceLabel,
      warnings,
      notes,
      barsUsed: candles.length,
      warmupBars: WARMUP,
      evalBars,
      signals,
      trades,
      winRate: null,
      avgR: null,
      expectancyR: null,
      maxDrawdownR: null,
      byStance: [],
    };
  }

  const loopStart = Math.max(WARMUP, candles.length - 1 - evalBars);
  notes.unshift(`Short window: last ~${evalBars} trading days (earlier bars used for warmup).`);

  let open:
    | {
        stance: Stance;
        technicalScore: number;
        overallScore: number;
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
      spyCandles.length >= history.length ? spyCandles.slice(0, i + 1) : spyCandles;
    const qqqFull = input.qqqCandles ?? [];
    const qqqHistory = qqqFull.length >= history.length ? qqqFull.slice(0, i + 1) : qqqFull;
    const candle = history[history.length - 1];
    const prev = history[history.length - 2];

    if (open) {
      const bar = candles[i];
      const risk = open.entry - open.stop;
      const hitStop = bar.low <= open.stop;
      const hitTarget = bar.high >= open.target;
      const timedOut = i - open.entryIndex >= MAX_HOLD_BARS;
      if (hitStop || hitTarget || timedOut) {
        let exit = bar.close;
        let reason: DeskBacktestTrade['reason'] = 'time';
        if (hitStop && hitTarget) {
          // Conservative stop-first; gap-aware fill at the open when it gaps through.
          exit = Math.min(open.stop, bar.open);
          reason = 'stop';
        } else if (hitStop) {
          exit = Math.min(open.stop, bar.open);
          reason = 'stop';
        } else if (hitTarget) {
          exit = Math.max(open.target, bar.open);
          reason = 'target';
        }
        trades.push({
          stance: open.stance,
          technicalScore: open.technicalScore,
          overallScore: open.overallScore,
          entryTime: open.entryTime,
          exitTime: bar.time,
          entry: open.entry,
          exit,
          stop: open.stop,
          target: open.target,
          rMultiple: risk > 0 ? (exit - open.entry) / risk : 0,
          reason,
        });
        open = null;
      }
      continue;
    }

    const rec = buildRecommendation({
      symbol,
      quote: quoteFromCandle(symbol, candle, prev),
      candles: history,
      spyCandles: spyHistory,
      qqqCandles: qqqHistory,
      candleSource: 'demo',
      historicalMode: true,
      setups,
      earningsDates: input.earningsDates,
    });
    signals[rec.stance] += 1;

    if (!shouldEnter(rec.stance, rec.nearEntry, rec.inEntry)) continue;

    const next = candles[i + 1];
    const entryMid = (rec.levels.entryLow + rec.levels.entryHigh) / 2;
    const entry = next.open > 0 ? next.open : entryMid;
    open = {
      stance: rec.stance,
      technicalScore: rec.technicalScore,
      overallScore: rec.overallScore,
      entryTime: next.time,
      entry,
      stop: rec.levels.stop,
      target: rec.levels.target,
      entryIndex: i + 1,
    };
  }

  if (open) {
    const last = candles[candles.length - 1];
    const risk = open.entry - open.stop;
    trades.push({
      stance: open.stance,
      technicalScore: open.technicalScore,
      overallScore: open.overallScore,
      entryTime: open.entryTime,
      exitTime: last.time,
      entry: open.entry,
      exit: last.close,
      stop: open.stop,
      target: open.target,
      rMultiple: risk > 0 ? (last.close - open.entry) / risk : 0,
      reason: 'time',
    });
  }

  const overall = statsFor(trades);
  const stanceOrder: Stance[] = ['strong_buy', 'soft_buy', 'wait', 'avoid'];
  const byStance = stanceOrder
    .map((stance) => {
      const subset = trades.filter((t) => t.stance === stance);
      const s = statsFor(subset);
      return {
        stance,
        trades: subset.length,
        winRate: s.winRate,
        avgR: s.avgR,
      };
    })
    .filter((row) => row.trades > 0 || signals[row.stance] > 0);

  return {
    symbol,
    sourceLabel,
    warnings,
    notes,
    barsUsed: candles.length,
    warmupBars: WARMUP,
    evalBars,
    signals,
    trades,
    winRate: overall.winRate,
    avgR: overall.avgR,
    expectancyR: overall.avgR,
    maxDrawdownR: overall.maxDrawdownR,
    byStance,
  };
}
