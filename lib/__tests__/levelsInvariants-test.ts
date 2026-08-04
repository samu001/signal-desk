import {
  buildSyntheticDemoCandles,
  defaultSetups,
  demoCandles,
  retiredSetups,
} from '@/constants/seed';
import { atr } from '@/lib/indicators';
import { clampLevelsRisk } from '@/lib/recommend';
import { levelsForSetup } from '@/lib/setupLevels';
import { matchPlaybookSetups } from '@/lib/setupMatch';
import { Candle, Setup } from '@/types/trading';

/**
 * Property-based invariant checks for the level engine.
 *
 * Every playbook setup is run against many different market shapes and the
 * resulting buy zone / stop / target must obey the plan geometry:
 *   stop < entryLow <= entryHigh < target
 * plus the risk cap and a sane planned R:R on the UI (clamped) path.
 */

const ALL_SETUPS: Setup[] = [...defaultSetups, ...retiredSetups];

type Levels = { entryLow: number; entryHigh: number; stop: number; target: number };

const DAY = 24 * 60 * 60;

function series(closes: number[], wickPct = 0.006): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  let prev = closes[0];
  return closes.map((close, i) => {
    const open = prev;
    prev = close;
    return {
      time: now - (closes.length - i) * DAY,
      open,
      high: Math.max(open, close) * (1 + wickPct),
      low: Math.min(open, close) * (1 - wickPct),
      close,
      volume: 10_000_000,
    };
  });
}

/** Diverse market shapes: trends, gap-up, crash, flat, flush, parabolic, choppy. */
function stressHistories(): Record<string, Candle[]> {
  const linear = (start: number, step: number, n: number) =>
    Array.from({ length: n }, (_, i) => start + step * i);
  return {
    steadyUptrend: series(linear(100, 0.6, 70)),
    steadyDowntrend: series(linear(200, -1.1, 70)),
    flatTape: series(Array.from({ length: 70 }, (_, i) => 100 + Math.sin(i / 3) * 0.4)),
    // MSFT-bug shape: long base then a violent 3-day gap up (~+25%).
    gapUp: series([...linear(380, 0.2, 55), 430, 465, 487]),
    // Uptrend, then a hard 3-day flush (~-12%), then the first bounce day.
    vFlush: series([...linear(150, 0.9, 55), 190, 178, 168, 172]),
    parabolic: series(Array.from({ length: 65 }, (_, i) => 80 * Math.pow(1.012, i))),
    choppy: series(
      Array.from({ length: 70 }, (_, i) => 120 + Math.sin(i / 2.1) * 6 + Math.sin(i / 7) * 4)
    ),
    lowPrice: series(linear(4, 0.02, 70)),
    shortHistory: series(linear(50, 0.4, 8)),
  };
}

function allHistories(): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = { ...stressHistories() };
  for (const key of Object.keys(demoCandles)) out[`demo:${key}`] = demoCandles[key];
  // Deterministic synthetic tickers exercise varied hash-driven shapes.
  for (const sym of ['TSLA', 'AMD', 'META', 'AMZN', 'GOOG', 'NFLX', 'COIN', 'PLTR', 'XOM', 'JPM']) {
    out[`synthetic:${sym}`] = buildSyntheticDemoCandles(sym);
  }
  return out;
}

/** Mirrors levelsForSetupOption in lib/recommend.ts (Desk UI path). */
function uiLevels(setup: Setup, candles: Candle[]): Levels {
  const raw = levelsForSetup(setup, candles);
  const atr14 = atr(candles, 14);
  const price = candles[candles.length - 1].close;
  const atrFloor = atr14 != null ? price - 1.8 * atr14 : raw.stop;
  const stop = Math.min(raw.stop, atrFloor);
  return clampLevelsRisk({ ...raw, stop }, atr14);
}

function finitePositive(levels: Levels): boolean {
  return (
    Number.isFinite(levels.entryLow) &&
    Number.isFinite(levels.entryHigh) &&
    Number.isFinite(levels.stop) &&
    Number.isFinite(levels.target) &&
    levels.entryLow > 0 &&
    levels.entryHigh > 0 &&
    levels.stop > 0 &&
    levels.target > 0
  );
}

describe('level invariants for every playbook setup', () => {
  const histories = allHistories();
  const cases: Array<[string, string]> = [];
  for (const setup of ALL_SETUPS) {
    for (const historyName of Object.keys(histories)) {
      cases.push([setup.id, historyName]);
    }
  }

  it('covers all active and retired setups', () => {
    expect(defaultSetups.length).toBe(8);
    expect(ALL_SETUPS.length).toBe(19);
  });

  it('raw levels (backtest/matching path) are sane on every history', () => {
    const violations: string[] = [];
    for (const setup of ALL_SETUPS) {
      for (const [name, candles] of Object.entries(histories)) {
        const l = levelsForSetup(setup, candles);
        const tag = `${setup.id} × ${name}`;
        if (!finitePositive(l)) violations.push(`${tag}: non-finite/non-positive ${JSON.stringify(l)}`);
        if (!(l.entryLow <= l.entryHigh)) violations.push(`${tag}: entryLow > entryHigh`);
        if (!(l.stop < l.entryHigh)) violations.push(`${tag}: stop ${l.stop} >= entryHigh ${l.entryHigh}`);
        if (!(l.target > l.stop)) violations.push(`${tag}: target ${l.target} <= stop ${l.stop}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('UI levels (Desk cards) obey stop < zone < target on every history', () => {
    const violations: string[] = [];
    for (const setup of ALL_SETUPS) {
      for (const [name, candles] of Object.entries(histories)) {
        const l = uiLevels(setup, candles);
        const tag = `${setup.id} × ${name}`;
        if (!finitePositive(l)) violations.push(`${tag}: non-finite/non-positive ${JSON.stringify(l)}`);
        if (!(l.entryLow <= l.entryHigh)) violations.push(`${tag}: entryLow > entryHigh`);
        if (!(l.stop < l.entryLow)) violations.push(`${tag}: stop ${l.stop} not below zone ${l.entryLow}`);
        if (!(l.target > l.entryHigh)) violations.push(`${tag}: target ${l.target} not above zone ${l.entryHigh}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('UI planned R:R stays within 0 – 2.6R', () => {
    const violations: string[] = [];
    for (const setup of ALL_SETUPS) {
      for (const [name, candles] of Object.entries(histories)) {
        const l = uiLevels(setup, candles);
        const mid = (l.entryLow + l.entryHigh) / 2;
        const risk = mid - l.stop;
        const reward = l.target - mid;
        if (risk <= 0) continue; // covered by ordering test
        const rr = reward / risk;
        if (!(rr > 0 && rr <= 2.6)) {
          violations.push(`${setup.id} × ${name}: R:R ${rr.toFixed(2)} (risk ${risk.toFixed(2)}, reward ${reward.toFixed(2)})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('UI risk per share respects the cap: min(2.5×ATR, 8% of entry mid)', () => {
    const violations: string[] = [];
    for (const setup of ALL_SETUPS) {
      for (const [name, candles] of Object.entries(histories)) {
        const l = uiLevels(setup, candles);
        const atr14 = atr(candles, 14);
        const mid = (l.entryLow + l.entryHigh) / 2;
        const cap = Math.min(
          atr14 != null && atr14 > 0 ? 2.5 * atr14 : Number.POSITIVE_INFINITY,
          mid * 0.08
        );
        const risk = mid - l.stop;
        // Levels are rounded to cent precision (roundPrice), so a stop placed
        // exactly at the cap can drift by up to one cent after rounding.
        if (risk > cap + 0.011) {
          violations.push(
            `${setup.id} × ${name}: risk ${risk.toFixed(2)} > cap ${cap.toFixed(2)} (${((risk / mid) * 100).toFixed(1)}% of entry)`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('MATCHED setups (what Desk actually shows) respect min(2.5×ATR, 8%) risk', () => {
    // Runs the real rule-matching pipeline first: only setups whose entry
    // checks pass reach the UI, so the risk cap only matters for those.
    const violations: string[] = [];
    let matchedCount = 0;
    for (const [name, candles] of Object.entries(histories)) {
      if (candles.length < 20) continue;
      const matches = matchPlaybookSetups({
        symbol: 'TEST',
        setups: ALL_SETUPS,
        quote: null,
        candles,
        spyCandles: demoCandles.SPY,
        qqqCandles: demoCandles.QQQ,
        news: [],
        historicalMode: true,
      });
      for (const match of matches.filter((m) => m.pass)) {
        matchedCount++;
        const setup = ALL_SETUPS.find((s) => s.id === match.setupId)!;
        const l = uiLevels(setup, candles);
        const atr14 = atr(candles, 14);
        const mid = (l.entryLow + l.entryHigh) / 2;
        const cap = Math.min(
          atr14 != null && atr14 > 0 ? 2.5 * atr14 : Number.POSITIVE_INFINITY,
          mid * 0.08
        );
        const risk = mid - l.stop;
        if (risk > cap + 0.011) {
          violations.push(
            `${setup.id} × ${name}: risk ${risk.toFixed(2)} > cap ${cap.toFixed(2)} (${((risk / mid) * 100).toFixed(1)}% of entry)`
          );
        }
      }
    }
    // Sanity: the pipeline actually matched some setups, so this test bites.
    expect(matchedCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
