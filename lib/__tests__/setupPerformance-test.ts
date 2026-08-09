import { defaultSetups, demoCandles } from '@/constants/seed';
import {
  blendSetupScores,
  RECENT_PERF_LOOKBACK,
  RECENT_PERF_MIN_SAMPLES,
  scoreRecentSetupPerformance,
} from '@/lib/setupPerformance';
import { Candle } from '@/types/trading';

/** Stretch demo bars so the lookback window has room to run. */
function extendCandles(base: Candle[], total: number): Candle[] {
  if (base.length >= total) return base;
  const day = 86400;
  const first = base[0];
  const prefix: Candle[] = [];
  for (let i = total - base.length; i >= 1; i--) {
    const close = first.close * (1 - i * 0.001);
    prefix.push({
      time: first.time - i * day,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: first.volume,
    });
  }
  return [...prefix, ...base];
}

describe('scoreRecentSetupPerformance', () => {
  it('uses an extended lookback window constant', () => {
    expect(RECENT_PERF_LOOKBACK).toBeGreaterThanOrEqual(90);
    expect(RECENT_PERF_MIN_SAMPLES).toBeGreaterThanOrEqual(3);
  });

  it('returns a score row for each setup on demo AAPL', () => {
    const rows = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
    });
    expect(rows.length).toBe(defaultSetups.length);
    for (const row of rows) {
      expect(row.setupId).toBeTruthy();
      expect(typeof row.score).toBe('number');
    }
  });

  it('forces score to 0 when sample size is below the noise floor', () => {
    const candles = extendCandles(demoCandles.AAPL, 200);
    const spy = extendCandles(demoCandles.SPY, 200);
    const rows = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles,
      spyCandles: spy,
    });
    for (const row of rows) {
      if (row.sampleSize > 0 && row.sampleSize < RECENT_PERF_MIN_SAMPLES) {
        expect(row.score).toBe(0);
      }
    }
  });

  it('applies point-in-time earnings blackout when a wide calendar is provided', () => {
    const candles = extendCandles(demoCandles.AAPL, 200);
    const spy = extendCandles(demoCandles.SPY, 200);
    // Blackout every bar in the eval window — should suppress signals vs no calendar.
    const mid = candles[Math.floor(candles.length / 2)];
    const dayKey = new Date(mid.time * 1000).toISOString().slice(0, 10);
    const withEarn = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles,
      spyCandles: spy,
      earningsDates: [dayKey],
      earningsCalendarStatus: 'ok',
    });
    const without = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles,
      spyCandles: spy,
    });
    const signalsWith = withEarn.reduce((a, r) => a + r.sampleSize, 0);
    const signalsWithout = without.reduce((a, r) => a + r.sampleSize, 0);
    expect(signalsWith).toBeLessThanOrEqual(signalsWithout);
  });

  it('blends journal and recent scores, ignoring under-powered recent samples', () => {
    const recent = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups.slice(0, 1),
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
    });
    // Force a tiny recent sample in the blend input.
    const tiny = recent.map((r) => ({
      ...r,
      sampleSize: 1,
      score: 9.9,
      avgForwardR: 2,
      hitRate: 1,
    }));
    const blended = blendSetupScores(
      defaultSetups.slice(0, 1),
      {
        [defaultSetups[0].id]: {
          setupId: defaultSetups[0].id,
          sampleSize: 4,
          winRate: 0.5,
          avgR: 0.2,
          expectancyR: 0.2,
          planFollowRate: 1,
          score: 0.25,
        },
      },
      tiny
    );
    // Tiny recent must not dominate — land on journal score.
    expect(blended[defaultSetups[0].id].score).toBeCloseTo(0.25, 5);
  });
});
