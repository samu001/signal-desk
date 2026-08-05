import {
  applyLongEntryFill,
  applyLongExitFill,
  avgDollarVolume,
  costsForSymbol,
  costsFromCandles,
  DEFAULT_BACKTEST_COSTS,
  gapAwareLongStopRaw,
  LIQUIDITY_ADV_BIG,
  LIQUIDITY_ADV_MID,
  netLongR,
  overnightBorrowDragR,
  resolveCosts,
  slippageBpsLabel,
  slippageTierForSymbol,
  slippageTierFromAdv,
  slippageTierFromCandles,
} from '@/lib/backtestCosts';
import { demoCandles, defaultSetups } from '@/constants/seed';
import { runBacktest } from '@/lib/backtest';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';
import type { Candle } from '@/types/trading';

function candlesWithAdv(adv: number, bars = 25, price = 100): Candle[] {
  const volume = adv / price;
  const out: Candle[] = [];
  const day = 86_400;
  const start = 1_700_000_000;
  for (let i = 0; i < bars; i++) {
    out.push({
      time: start + i * day,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume,
    });
  }
  return out;
}

describe('backtest costs + cooldown', () => {
  it('worsens long fills against the trader (slip + spread + commission)', () => {
    const entry = applyLongEntryFill(100, DEFAULT_BACKTEST_COSTS);
    const exit = applyLongExitFill(110, DEFAULT_BACKTEST_COSTS);
    expect(entry).toBeGreaterThan(100);
    expect(exit).toBeLessThan(110);
    const r = netLongR({ entryFill: entry, exitFill: exit, stop: 95 });
    const gross = (110 - 100) / (100 - 95);
    expect(r).toBeLessThan(gross);
  });

  it('documents costs and cooldown in backtest notes', () => {
    const setup = defaultSetups[0];
    const result = runBacktest({
      setup,
      symbol: 'AAPL',
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      stopCooldownBars: 3,
    });
    expect(result.notes.some((n) => /Costs:/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /spread/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /gap-beyond/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /Cooldown/i.test(n))).toBe(true);
    expect(result.stopCooldownBars).toBe(3);
  });

  it('cooldown after stop can reduce combined trade count', () => {
    const withCooldown = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
      stopCooldownBars: 5,
      costs: { slippagePct: 0, commissionPct: 0 },
    });
    const noCooldown = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
      stopCooldownBars: 0,
      costs: { slippagePct: 0, commissionPct: 0 },
    });
    expect(withCooldown.trades.length).toBeLessThanOrEqual(noCooldown.trades.length);
    expect(withCooldown.skippedCooldown).toBeGreaterThanOrEqual(0);
  });
});

describe('ADV liquidity tiers (honesty audit)', () => {
  it('classifies big / mid / small from dollar volume thresholds', () => {
    expect(slippageTierFromAdv(LIQUIDITY_ADV_BIG)).toBe('big');
    expect(slippageTierFromAdv(LIQUIDITY_ADV_MID)).toBe('mid');
    expect(slippageTierFromAdv(LIQUIDITY_ADV_MID - 1)).toBe('small');
    expect(slippageTierFromAdv(null)).toBe('small');
  });

  it('uses 5 bps slip + 1 bp½ spread when ADV ≥ $100M', () => {
    const bars = candlesWithAdv(150_000_000);
    expect(slippageTierFromCandles(bars)).toBe('big');
    const c = resolveCosts(costsFromCandles(bars));
    expect(c.slippagePct).toBe(0.0005);
    expect(c.halfSpreadPct).toBe(0.0001);
    expect(c.gapBeyondFraction).toBe(0.1);
    expect(slippageBpsLabel('ANY', bars)).toMatch(/5 bps slip/);
  });

  it('uses 10 bps slip + 2 bp½ spread when ADV is mid ($20–100M)', () => {
    const bars = candlesWithAdv(40_000_000);
    expect(slippageTierFromCandles(bars)).toBe('mid');
    expect(resolveCosts(costsFromCandles(bars)).halfSpreadPct).toBe(0.0002);
    expect(slippageBpsLabel('ANY', bars)).toMatch(/10 bps slip/);
  });

  it('uses 20 bps slip + 5 bp½ spread for thin ADV or missing bars', () => {
    expect(slippageTierForSymbol('AAPL')).toBe('small');
    expect(slippageTierForSymbol('XYZ')).toBe('small');
    const thin = candlesWithAdv(5_000_000);
    expect(slippageTierFromCandles(thin)).toBe('small');
    const c = resolveCosts(costsForSymbol('xyz'));
    expect(c.slippagePct).toBe(0.002);
    expect(c.halfSpreadPct).toBe(0.0005);
    expect(c.gapBeyondFraction).toBe(0.25);
    expect(slippageBpsLabel('FOO')).toMatch(/20 bps slip/);
  });

  it('classifies demo AAPL as big from its volume history', () => {
    expect(avgDollarVolume(demoCandles.AAPL)).toBeGreaterThan(LIQUIDITY_ADV_BIG);
    expect(slippageTierFromCandles(demoCandles.AAPL)).toBe('big');
    expect(resolveCosts(costsForSymbol('AAPL', demoCandles.AAPL)).slippagePct).toBe(0.0005);
  });

  it('keeps commission and borrow at $0 / n/a for long-only tiers', () => {
    for (const bars of [
      candlesWithAdv(200_000_000),
      candlesWithAdv(30_000_000),
      candlesWithAdv(1_000_000),
    ]) {
      const c = resolveCosts(costsFromCandles(bars));
      expect(c.commissionPct).toBe(0);
      expect(c.overnightBorrowPctPerDay).toBe(0);
    }
  });
});

describe('gap-beyond stop fills', () => {
  it('fills at the stop when the open does not gap through', () => {
    expect(gapAwareLongStopRaw(95, 96, 0.25)).toBe(95);
  });

  it('fills at the open when gapped through with fraction 0', () => {
    expect(gapAwareLongStopRaw(95, 90, 0)).toBe(90);
  });

  it('worsens into the gap by gapBeyondFraction', () => {
    // Stop 95, open 90 → gap 5; 20% beyond → 90 - 1 = 89
    expect(gapAwareLongStopRaw(95, 90, 0.2)).toBeCloseTo(89);
  });
});

describe('overnight borrow drag', () => {
  it('is zero when rate is zero (long-only default)', () => {
    expect(
      overnightBorrowDragR({
        entryFill: 100,
        stop: 95,
        holdCalendarDays: 5,
        costs: costsFromCandles(candlesWithAdv(200_000_000)),
      })
    ).toBe(0);
  });

  it('converts notional×days into R when a rate is set', () => {
    // 10 bps/day × 5 days × $100 notional / $5 risk = 0.1 R
    const drag = overnightBorrowDragR({
      entryFill: 100,
      stop: 95,
      holdCalendarDays: 5,
      costs: {
        slippagePct: 0,
        commissionPct: 0,
        overnightBorrowPctPerDay: 0.001,
      },
    });
    expect(drag).toBeCloseTo(0.1);
  });
});
