import { defaultSetups, demoCandles, retiredSetups } from '@/constants/seed';
import { runBacktest, runBacktestVariants } from '@/lib/backtest';
import { applyLevelTuning, describeTuning, isProductionTuning } from '@/lib/levelTuning';
import {
  defaultParamVariants,
  formatLabReport,
  runParameterLab,
} from '@/lib/parameterLab';
import { Candle } from '@/types/trading';

const DAY = 24 * 60 * 60;

/** Long steady uptrend: trend setups fire reliably, targets get hit. */
function uptrendCandles(): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  const n = 120;
  let prev = 100;
  return Array.from({ length: n }, (_, i) => {
    const close = 100 * Math.pow(1.006, i);
    const open = prev;
    prev = close;
    return {
      time: now - (n - i) * DAY,
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 10_000_000,
    };
  });
}

// Retired in production but ideal for lab tests: only two non-skipped checks,
// both reliably true in a steady uptrend, so signals fire every bar.
const simpleTrend = [...defaultSetups, ...retiredSetups].find(
  (s) => s.id === 'setup-simple-trend'
)!;

describe('applyLevelTuning', () => {
  it('is the identity for production tuning', () => {
    const levels = { stop: 95, target: 110 };
    expect(applyLevelTuning(levels, 100, 2, undefined)).toEqual(levels);
    expect(applyLevelTuning(levels, 100, 2, {})).toEqual(levels);
    expect(isProductionTuning(undefined)).toBe(true);
    expect(isProductionTuning({})).toBe(true);
    expect(isProductionTuning({ targetR: 1.5 })).toBe(false);
  });

  it('rebuilds the target from fill and stop for targetR', () => {
    expect(applyLevelTuning({ stop: 95, target: 200 }, 100, 2, { targetR: 1.5 })).toEqual({
      stop: 95,
      target: 107.5,
    });
  });

  it('ATR cap tightens but never loosens the structural stop', () => {
    expect(applyLevelTuning({ stop: 90, target: 110 }, 100, 4, { atrCapMult: 2 }).stop).toBe(92);
    expect(applyLevelTuning({ stop: 90, target: 110 }, 100, 4, { atrCapMult: 5 }).stop).toBe(90);
  });

  it('percent cap tightens but never loosens the structural stop', () => {
    expect(applyLevelTuning({ stop: 90, target: 110 }, 100, null, { pctCap: 0.05 }).stop).toBe(95);
    expect(applyLevelTuning({ stop: 90, target: 110 }, 100, null, { pctCap: 0.2 }).stop).toBe(90);
  });

  it('targetR is measured from the tuned (tightened) stop', () => {
    // Stop tightened to 95 → risk 5 → target = 100 + 2*5.
    expect(
      applyLevelTuning({ stop: 90, target: 130 }, 100, null, { pctCap: 0.05, targetR: 2 })
    ).toEqual({ stop: 95, target: 110 });
  });

  it('keeps the structural target when tuned risk would be non-positive', () => {
    expect(
      applyLevelTuning({ stop: 105, target: 130 }, 100, null, { targetR: 2 }).target
    ).toBe(130);
  });

  it('describes tuning for result notes', () => {
    expect(describeTuning(undefined)).toBe('production levels');
    expect(describeTuning({ targetR: 1.5, atrCapMult: 2 })).toBe('target 1.5R · stop cap 2×ATR');
  });
});

describe('runBacktest with levelTuning', () => {
  const candles = uptrendCandles();

  it('keeps entries identical across targetR variants — only exits change', () => {
    const base = { setup: simpleTrend, symbol: 'UP', candles, spyCandles: demoCandles.SPY, sourceLabel: 't' };
    const prod = runBacktest(base);
    const tight = runBacktest({ ...base, levelTuning: { targetR: 1.0 } });
    const far = runBacktest({ ...base, levelTuning: { targetR: 3.0 } });

    expect(prod.trades.length).toBeGreaterThan(0);
    expect(tight.trades.map((t) => t.entryTime)).toEqual(prod.trades.map((t) => t.entryTime));
    expect(far.trades.map((t) => t.entryTime)).toEqual(prod.trades.map((t) => t.entryTime));

    // Closer targets are reached more often than far ones on the same entries.
    const targetHits = (trades: typeof prod.trades) =>
      trades.filter((t) => t.reason === 'target').length;
    expect(targetHits(tight.trades)).toBeGreaterThanOrEqual(targetHits(far.trades));

    // Tuning is disclosed in the result notes; production notes stay clean.
    expect(tight.notes.some((n) => /target 1R/.test(n))).toBe(true);
    expect(prod.notes.some((n) => /Parameter lab/.test(n))).toBe(false);
  });

  it('ATR cap never widens the stop on taken trades', () => {
    const base = { setup: simpleTrend, symbol: 'UP', candles, spyCandles: demoCandles.SPY, sourceLabel: 't' };
    const prod = runBacktest(base);
    const capped = runBacktest({ ...base, levelTuning: { atrCapMult: 2 } });
    expect(capped.trades.length).toBeGreaterThan(0);
    const prodByEntry = new Map(prod.trades.map((t) => [t.entryTime, t]));
    for (const trade of capped.trades) {
      const ref = prodByEntry.get(trade.entryTime);
      if (ref) expect(trade.stop).toBeGreaterThanOrEqual(ref.stop);
    }
  });
});

describe('runBacktestVariants engine', () => {
  const candles = uptrendCandles();

  it('matches separate runBacktest calls for every tuning', () => {
    const base = { setup: simpleTrend, symbol: 'UP', candles, spyCandles: demoCandles.SPY, sourceLabel: 't' };
    const tunings = [undefined, { targetR: 1.5 }, { targetR: 3 }, { atrCapMult: 2 }, { pctCap: 0.05 }];
    const batched = runBacktestVariants(base, tunings);
    expect(batched).toHaveLength(tunings.length);
    tunings.forEach((tuning, i) => {
      const solo = runBacktest({ ...base, levelTuning: tuning });
      expect(batched[i].trades).toEqual(solo.trades);
      expect(batched[i].avgR).toEqual(solo.avgR);
      expect(batched[i].maxDrawdownR).toEqual(solo.maxDrawdownR);
    });
  });

  it('handles the insufficient-history path per variant', () => {
    const results = runBacktestVariants(
      {
        setup: simpleTrend,
        symbol: 'UP',
        candles: candles.slice(0, 20),
        spyCandles: demoCandles.SPY,
        sourceLabel: 't',
      },
      [undefined, { targetR: 1.5 }]
    );
    expect(results).toHaveLength(2);
    expect(results[0].trades).toEqual([]);
    expect(results[1].notes.some((n) => /target 1.5R/.test(n))).toBe(true);
    expect(results[0].notes.some((n) => /Parameter lab/.test(n))).toBe(false);
  });
});

describe('runParameterLab', () => {
  jest.setTimeout(60000);

  const tickers = [
    { symbol: 'AAPL', candles: demoCandles.AAPL },
    { symbol: 'NVDA', candles: demoCandles.NVDA },
    { symbol: 'MSFT', candles: demoCandles.MSFT },
  ];

  it('sweeps one knob at a time with production pinned elsewhere', () => {
    const variants = defaultParamVariants();
    const knobs = new Set(variants.map((v) => v.knob));
    expect(knobs).toEqual(new Set(['targetR', 'atrCapMult', 'pctCap']));
    for (const knob of knobs) {
      expect(variants.filter((v) => v.knob === knob && v.isProduction)).toHaveLength(1);
    }
    // Non-production variants touch exactly one knob.
    for (const v of variants.filter((v) => !v.isProduction)) {
      const keys = Object.keys(v.tuning ?? {});
      expect(keys).toHaveLength(1);
    }
  });

  it('runs the full sweep deterministically and returns per-knob verdicts', () => {
    const input = {
      setups: defaultSetups,
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
    };
    const a = runParameterLab(input);
    const b = runParameterLab(input);

    expect(a.knobs.map((k) => k.knob)).toEqual(['targetR', 'atrCapMult', 'pctCap']);
    for (const knob of a.knobs) {
      expect(['edge', 'flat', 'fragile', 'insufficient']).toContain(knob.verdict.tone);
      expect(knob.variants.some((v) => v.variant.isProduction)).toBe(true);
      for (const v of knob.variants) {
        expect(v.perTicker).toHaveLength(tickers.length);
        if (v.trades > 0) {
          expect(v.windows).toHaveLength(2);
          expect(v.windows[0].trades + v.windows[1].trades).toBe(v.trades);
        }
      }
    }

    // Determinism: same inputs → identical pooled R per variant.
    for (let k = 0; k < a.knobs.length; k++) {
      for (let v = 0; v < a.knobs[k].variants.length; v++) {
        expect(a.knobs[k].variants[v].totalR).toBe(b.knobs[k].variants[v].totalR);
        expect(a.knobs[k].variants[v].trades).toBe(b.knobs[k].variants[v].trades);
      }
    }
  });

  it('targetR variants take the same entries as production (exits-only)', () => {
    const result = runParameterLab({
      setups: defaultSetups,
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
    });
    const targetKnob = result.knobs.find((k) => k.knob === 'targetR')!;
    const prod = targetKnob.variants.find((v) => v.variant.isProduction)!;
    if (prod.trades > 0) {
      for (const v of targetKnob.variants) {
        expect(v.trades).toBe(prod.trades);
      }
    }
    expect(formatLabReport(result)).toContain('Parameter lab');
  });
});
