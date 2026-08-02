import { demoCandles } from '@/constants/seed';
import { runDeskBacktest } from '@/lib/deskBacktest';

describe('runDeskBacktest', () => {
  it('runs a short historical Desk replay on demo AAPL', () => {
    const result = runDeskBacktest({
      symbol: 'AAPL',
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      sourceLabel: 'demo',
      evalBars: 30,
    });

    expect(result.barsUsed).toBe(demoCandles.AAPL.length);
    expect(result.notes.some((n) => /technicals/i.test(n))).toBe(true);
    expect(result.signals.wait + result.signals.soft_buy + result.signals.strong_buy + result.signals.avoid).toBeGreaterThan(0);
    expect(Array.isArray(result.trades)).toBe(true);
    if (result.trades.length) {
      expect(result.avgR).not.toBeNull();
      expect(['stop', 'target', 'time']).toContain(result.trades[0].reason);
    }
  });

  it('warns when history is too short', () => {
    const result = runDeskBacktest({
      symbol: 'TEST',
      candles: demoCandles.AAPL.slice(0, 10),
      spyCandles: demoCandles.SPY.slice(0, 10),
      sourceLabel: 'demo',
    });
    expect(result.trades).toHaveLength(0);
    expect(result.warnings.some((w) => /at least/i.test(w))).toBe(true);
  });
});
