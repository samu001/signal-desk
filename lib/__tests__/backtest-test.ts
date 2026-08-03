import { demoCandles, defaultSetups } from '@/constants/seed';
import { runBacktest } from '@/lib/backtest';

describe('runBacktest', () => {
  it('runs on demo candles and returns stats shape', () => {
    const setup = defaultSetups.find((s) => s.id === 'setup-prior-day-high')!;
    const result = runBacktest({
      setup,
      symbol: 'AAPL',
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      sourceLabel: 'demo',
      warnings: ['Using built-in demo daily history for offline backtests.'],
    });

    expect(result.barsUsed).toBe(demoCandles.AAPL.length);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.notes.length).toBeGreaterThan(0);
    expect(Array.isArray(result.trades)).toBe(true);
    if (result.trades.length) {
      expect(result.avgR).not.toBeNull();
      expect(result.winRate).not.toBeNull();
    }
  });

  it('warns when history is too short', () => {
    const setup = defaultSetups[0];
    const result = runBacktest({
      setup,
      symbol: 'TEST',
      candles: demoCandles.AAPL.slice(0, 10),
      spyCandles: demoCandles.SPY.slice(0, 10),
      sourceLabel: 'demo',
    });
    expect(result.trades).toHaveLength(0);
    expect(result.warnings.some((w) => /at least/i.test(w))).toBe(true);
  });
});
