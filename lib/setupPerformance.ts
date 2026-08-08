import { SetupExpectancy } from '@/lib/expectancy';
import { barsUpTo } from '@/lib/indicators';
import { evaluateSetupRules, MIN_SETUP_PASS_RATE, setupSignalPasses } from '@/lib/rules';
import { levelsForSetup } from '@/lib/setupLevels';
import { Candle, Quote, Setup, WatchlistItem } from '@/types/trading';

export type RecentSetupPerf = {
  setupId: string;
  sampleSize: number;
  hitRate: number | null;
  avgForwardR: number | null;
  /** Blended score used for Desk ranking (higher is better). */
  score: number;
};

const LOOKBACK = 28;
const FORWARD = 5;

function quoteFrom(symbol: string, candle: Candle, prev?: Candle): Quote {
  return {
    symbol,
    price: candle.close,
    change: prev ? candle.close - prev.close : 0,
    percentChange: prev?.close ? ((candle.close - prev.close) / prev.close) * 100 : 0,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    previousClose: prev?.close ?? candle.open,
    source: 'yahoo',
  };
}

function setupPasses(
  setup: Setup,
  symbol: string,
  history: Candle[],
  spyHistory: Candle[],
  options?: { qqqCandles?: Candle[] }
): boolean {
  if (history.length < 40) return false;
  const levels = levelsForSetup(setup, history);
  const item: WatchlistItem = {
    id: `perf-${setup.id}`,
    symbol,
    thesis: 'perf',
    ...levels,
    setupId: setup.id,
    notes: '',
    createdAt: '',
  };
  const candle = history[history.length - 1];
  const prev = history[history.length - 2];
  // Date-based truncation — index slicing could leak future QQQ bars.
  const qqqHistory = barsUpTo(options?.qqqCandles ?? [], candle.time);
  const results = evaluateSetupRules(setup, {
    item,
    quote: quoteFrom(symbol, candle, prev),
    candles: history,
    spyCandles: spyHistory,
    qqqCandles: qqqHistory,
    // Omit earnings calendar: the live near-term window is not point-in-time
    // for this lookback (past report days are absent; verified-empty [] would
    // zero every signal). Soft-unknown keeps earnings_clear out of the score.
    news: [],
    session: {
      phase: 'rth',
      label: 'RTH',
      tradable: true,
      detail: 'perf',
    },
  });
  return setupSignalPasses(setup, results, {
    minPassRate: MIN_SETUP_PASS_RATE,
    skipCheckIds: ['session_tradable', 'no_negative_catalyst', 'earnings_clear'],
  }).pass;
}

/**
 * Lightweight recent performance for each setup on this symbol:
 * when the setup would have fired, measure forward move vs stop distance (~R).
 */
export function scoreRecentSetupPerformance(input: {
  symbol: string;
  setups: Setup[];
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
}): RecentSetupPerf[] {
  const { symbol, setups, candles, spyCandles } = input;
  const end = candles.length - FORWARD - 1;
  const start = Math.max(55, end - LOOKBACK);

  return setups.map((setup) => {
    const forwards: number[] = [];
    let hits = 0;
    let signals = 0;

    for (let i = start; i <= end; i++) {
      const history = candles.slice(0, i + 1);
      const spyHistory = barsUpTo(spyCandles, candles[i].time);
      if (
        !setupPasses(setup, symbol, history, spyHistory, {
          qqqCandles: input.qqqCandles,
        })
      )
        continue;
      signals += 1;
      const levels = levelsForSetup(setup, history);
      const entry = candles[i + 1]?.open ?? history[history.length - 1].close;
      const risk = Math.max(entry - levels.stop, entry * 0.01);
      const future = candles.slice(i + 1, i + 1 + FORWARD);
      let exit = future[future.length - 1]?.close ?? entry;
      let reasonR = (exit - entry) / risk;
      for (const bar of future) {
        if (bar.low <= levels.stop) {
          reasonR = (levels.stop - entry) / risk;
          break;
        }
        if (bar.high >= levels.target) {
          reasonR = (levels.target - entry) / risk;
          break;
        }
      }
      forwards.push(reasonR);
      if (reasonR > 0) hits += 1;
    }

    const avgForwardR = forwards.length
      ? forwards.reduce((a, b) => a + b, 0) / forwards.length
      : null;
    const hitRate = signals ? hits / signals : null;
    const confidence = Math.min(1, signals / 6);
    const score =
      signals === 0
        ? 0
        : (avgForwardR ?? 0) * (0.5 + 0.5 * confidence) + (hitRate ?? 0) * 0.25;

    return {
      setupId: setup.id,
      sampleSize: signals,
      hitRate,
      avgForwardR,
      score,
    };
  });
}

/** Blend journal expectancy with recent symbol-specific setup performance. */
export function blendSetupScores(
  setups: Setup[],
  journal: Record<string, SetupExpectancy> | undefined,
  recent: RecentSetupPerf[]
): Record<string, SetupExpectancy> {
  const recentMap = Object.fromEntries(recent.map((r) => [r.setupId, r]));
  return Object.fromEntries(
    setups.map((setup) => {
      const j = journal?.[setup.id];
      const r = recentMap[setup.id];
      const journalScore = j?.score ?? 0;
      const recentScore = r?.score ?? 0;
      const journalWeight = j && j.sampleSize > 0 ? Math.min(0.55, 0.2 + j.sampleSize / 20) : 0;
      const recentWeight = r && r.sampleSize > 0 ? 1 - journalWeight : journalWeight > 0 ? 0 : 1;
      const score =
        journalWeight + recentWeight === 0
          ? 0
          : (journalScore * journalWeight + recentScore * recentWeight) /
            (journalWeight + recentWeight || 1);

      const merged: SetupExpectancy = {
        setupId: setup.id,
        sampleSize: (j?.sampleSize ?? 0) + (r?.sampleSize ?? 0),
        winRate: r?.hitRate ?? j?.winRate ?? null,
        avgR: r?.avgForwardR ?? j?.avgR ?? null,
        expectancyR: r?.avgForwardR ?? j?.expectancyR ?? null,
        planFollowRate: j?.planFollowRate ?? null,
        score,
      };
      return [setup.id, merged];
    })
  );
}
