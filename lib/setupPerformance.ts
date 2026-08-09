import { SetupExpectancy } from '@/lib/expectancy';
import { EarningsFetchStatus } from '@/lib/finnhub';
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

/** ~6 months of sessions — Desk fetches ~400 calendar days of EOD. */
export const RECENT_PERF_LOOKBACK = 120;
export const RECENT_PERF_FORWARD = 5;
/** Below this, recent edge is treated as noise (score forced to 0). */
export const RECENT_PERF_MIN_SAMPLES = 4;
/** Signals needed before recent edge gets full confidence weight. */
export const RECENT_PERF_FULL_SAMPLES = 12;

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
  options?: {
    qqqCandles?: Candle[];
    earningsDates?: string[];
    earningsCalendarStatus?: EarningsFetchStatus;
  }
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
  const hasCalendar = options?.earningsDates != null;
  const results = evaluateSetupRules(setup, {
    item,
    quote: quoteFrom(symbol, candle, prev),
    candles: history,
    spyCandles: spyHistory,
    qqqCandles: qqqHistory,
    earningsDates: options?.earningsDates,
    earningsCalendarStatus: options?.earningsCalendarStatus,
    asOfTime: candle.time,
    news: [],
    session: {
      phase: 'rth',
      label: 'RTH',
      tradable: true,
      detail: 'perf',
    },
  });
  const skip = ['session_tradable', 'no_negative_catalyst'];
  // Without a point-in-time calendar, leave earnings soft-unknown (do not
  // score the live near-term-only list against historical bars).
  if (!hasCalendar) skip.push('earnings_clear');
  return setupSignalPasses(setup, results, {
    minPassRate: MIN_SETUP_PASS_RATE,
    skipCheckIds: skip,
  }).pass;
}

/**
 * Recent performance for each setup on this symbol:
 * when the setup would have fired, measure forward move vs stop distance (~R).
 * Tiny samples (< RECENT_PERF_MIN_SAMPLES) score as 0 so noise cannot steer
 * Desk ranking / Strong edge.
 */
export function scoreRecentSetupPerformance(input: {
  symbol: string;
  setups: Setup[];
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  /** Wide historical calendar (preferred). Omit to skip earnings in the replay. */
  earningsDates?: string[];
  earningsCalendarStatus?: EarningsFetchStatus;
}): RecentSetupPerf[] {
  const { symbol, setups, candles, spyCandles } = input;
  const end = candles.length - RECENT_PERF_FORWARD - 1;
  const start = Math.max(55, end - RECENT_PERF_LOOKBACK);

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
          earningsDates: input.earningsDates,
          earningsCalendarStatus: input.earningsCalendarStatus,
        })
      )
        continue;
      signals += 1;
      const levels = levelsForSetup(setup, history);
      const entry = candles[i + 1]?.open ?? history[history.length - 1].close;
      const risk = Math.max(entry - levels.stop, entry * 0.01);
      const future = candles.slice(i + 1, i + 1 + RECENT_PERF_FORWARD);
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
    const confidence = Math.min(1, signals / RECENT_PERF_FULL_SAMPLES);
    // Under-powered samples are noise — neutral score, not a fake edge.
    const score =
      signals < RECENT_PERF_MIN_SAMPLES
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
      const recentUsable = Boolean(r && r.sampleSize >= RECENT_PERF_MIN_SAMPLES);
      // Tiny recent samples get no weight even when the journal is empty.
      const recentWeight = recentUsable
        ? Math.min(
            1 - journalWeight,
            0.2 + 0.8 * Math.min(1, r!.sampleSize / RECENT_PERF_FULL_SAMPLES)
          )
        : 0;
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
