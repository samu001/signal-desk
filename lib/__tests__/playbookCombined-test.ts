import { demoCandles, defaultSetups } from '@/constants/seed';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';

describe('runCombinedPlaybookBacktest', () => {
  it('keeps at most one trade per entry day across setups', () => {
    const result = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
    });

    const days = result.trades.map((t) =>
      new Date(t.entryTime * 1000).toISOString().slice(0, 10)
    );
    expect(new Set(days).size).toBe(days.length);
    expect(result.notes.some((n) => /Combined playbook/i.test(n))).toBe(true);

    const rawCount = result.setupResults.reduce((n, r) => n + r.trades.length, 0);
    expect(result.trades.length + result.skippedOverlaps).toBe(rawCount);
  });

  it('blocks entries inside the earnings blackout window', () => {
    const last = demoCandles.AAPL[demoCandles.AAPL.length - 1];
    const earnDay = new Date(last.time * 1000).toISOString().slice(0, 10);
    const withBlackout = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups.slice(0, 2),
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      earningsDates: [earnDay],
      sourceLabel: 'demo',
      evalBars: 30,
    });
    const without = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups.slice(0, 2),
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
    });
    // Blackout around the last bar should not increase trade count.
    expect(withBlackout.trades.length).toBeLessThanOrEqual(without.trades.length);
  });
});
