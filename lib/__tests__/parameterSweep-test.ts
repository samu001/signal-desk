import { defaultSetups, demoCandles, retiredSetups } from '@/constants/seed';
import { defaultParamVariants } from '@/lib/parameterLab';
import {
  bestParamVariantId,
  ParameterSweepResult,
  runParameterSweep,
  runProductionBaseline,
} from '@/lib/parameterSweep';
import { Candle } from '@/types/trading';

const DAY = 24 * 60 * 60;

/** Long steady uptrend: trend setups fire reliably. */
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

const simpleTrend = [...defaultSetups, ...retiredSetups].find(
  (s) => s.id === 'setup-simple-trend'
)!;

describe('runParameterSweep', () => {
  const tickers = [
    { symbol: 'UP', candles: uptrendCandles() },
    { symbol: 'UP2', candles: uptrendCandles() },
  ];

  it('runs every variant through the portfolio pipeline and returns a verdict per knob', () => {
    const result = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      maxOpen: 3,
    });

    // One exit-grid section with a verdict and a production row.
    expect(result.knobs.length).toBe(1);
    for (const { variants, verdict } of result.knobs) {
      expect(variants.some((v) => v.variant.isProduction)).toBe(true);
      expect(['edge', 'flat', 'fragile', 'insufficient']).toContain(verdict.tone);
      // Per-ticker rows cover the whole basket.
      for (const v of variants) {
        expect(v.perTicker.map((p) => p.symbol).sort()).toEqual(['UP', 'UP2']);
      }
    }
  });

  it('respects the max-open cap (never takes more than capacity allows per day)', () => {
    const result = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      maxOpen: 1,
      variants: defaultParamVariants().filter((v) => !v.isProduction),
    });
    // With two identical tickers and cap 1, the cap should bind hard.
    for (const { variants } of result.knobs) {
      for (const v of variants) {
        // Capped trades can never exceed the number of distinct entry days.
        expect(v.trades).toBeLessThanOrEqual(120);
      }
    }
  });

  it('is deterministic', () => {
    const a = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      maxOpen: 3,
    });
    const b = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      maxOpen: 3,
    });
    const totals = (r: typeof a) =>
      r.knobs.flatMap((k) => k.variants.map((v) => v.totalR));
    expect(totals(a)).toEqual(totals(b));
  });

  it('stores uncapped trades per variant with RS20, so stats can be recomputed without re-running', () => {
    const result = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      maxOpen: 3,
    });

    // One uncapped list per variant, keyed by the same variant object.
    const totalVariants = result.knobs.reduce((n, k) => n + k.variants.length, 0);
    expect(result.uncappedByVariant).toHaveLength(totalVariants);

    for (const { variant, trades } of result.uncappedByVariant) {
      // Uncapped (dedup+cooldown only) >= capped trades for that variant.
      const capped = result.knobs
        .flatMap((k) => k.variants)
        .find((v) => v.variant.id === variant.id)!;
      expect(trades.length).toBeGreaterThanOrEqual(capped.trades);
      // Each trade carries what the picker lab needs: symbol, setup, priority, RS20.
      for (const t of trades) {
        expect(t.symbol).toBeTruthy();
        expect(t.setupId).toBeTruthy();
        expect(typeof t.priorityScore).toBe('number');
        expect(t.rs20 === null || typeof t.rs20 === 'number').toBe(true);
      }
    }
  });

  it('runProductionBaseline matches the production variant of a full sweep', () => {
    const baseline = runProductionBaseline({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      maxOpen: 3,
    });
    const full = runParameterSweep({
      setups: [simpleTrend],
      tickers,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      maxOpen: 3,
    });
    // The production row inside the exit grid should equal the baseline.
    const prodRow = full.knobs
      .find((k) => k.knob === 'exitGrid')!
      .variants.find((v) => v.variant.isProduction)!;
    expect(baseline.totalR).toBeCloseTo(prodRow.totalR, 6);
    expect(baseline.trades).toBe(prodRow.trades);
    expect(baseline.trades).toBeGreaterThan(0);
  });
});

describe('bestParamVariantId', () => {
  const variant = (
    id: string,
    totalR: number,
    isProduction: boolean
  ): ParameterSweepResult['knobs'][0]['variants'][0] => ({
    variant: {
      id,
      knob: 'exitGrid',
      label: id,
      tuning: isProduction ? undefined : { targetR: 1, atrCapMult: 2, pctCap: 0.08 },
      isProduction,
    },
    trades: 10,
    winRate: 0.5,
    avgR: totalR / 10,
    totalR,
    maxDrawdownR: null,
    perTicker: [],
    windows: [],
  });

  it('returns the highest-totalR non-production variant', () => {
    const sweep: ParameterSweepResult = {
      knobs: [
        {
          knob: 'exitGrid',
          variants: [
            variant('exitGrid:prod', 12.9, true),
            variant('exitGrid:a', 27, false),
            variant('exitGrid:b', 20, false),
          ],
          verdict: {
            knob: 'exitGrid',
            tone: 'edge',
            headline: '',
            bullets: [],
            winnerId: 'exitGrid:a',
            productionId: 'exitGrid:prod',
          },
        },
      ],
      productionCappedTrades: 10,
      uncappedByVariant: [],
    };
    expect(bestParamVariantId(sweep)).toBe('exitGrid:a');
  });

  it('returns null when production is the top totalR', () => {
    const sweep: ParameterSweepResult = {
      knobs: [
        {
          knob: 'exitGrid',
          variants: [variant('exitGrid:prod', 30, true), variant('exitGrid:a', 10, false)],
          verdict: {
            knob: 'exitGrid',
            tone: 'flat',
            headline: '',
            bullets: [],
            winnerId: 'exitGrid:prod',
            productionId: 'exitGrid:prod',
          },
        },
      ],
      productionCappedTrades: 10,
      uncappedByVariant: [],
    };
    expect(bestParamVariantId(sweep)).toBeNull();
  });
});
