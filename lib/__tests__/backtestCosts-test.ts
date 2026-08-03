import {
  applyLongEntryFill,
  applyLongExitFill,
  DEFAULT_BACKTEST_COSTS,
  netLongR,
} from '@/lib/backtestCosts';
import { demoCandles, defaultSetups } from '@/constants/seed';
import { runBacktest } from '@/lib/backtest';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';

describe('backtest costs + cooldown', () => {
  it('worsens long fills against the trader', () => {
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
