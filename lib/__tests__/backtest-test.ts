import { demoCandles, defaultSetups } from '@/constants/seed';
import { runBacktest } from '@/lib/backtest';
import { Candle, Setup } from '@/types/trading';

const DAY = 86400;

function flatBars(n: number, price = 100, start = 1_700_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * DAY,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1_000_000,
  }));
}

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

  it('scores a stop on the last bar at the stop fill, not the close', () => {
    // Always-on signal so we get a position into the final bar.
    const setup: Setup = {
      id: 'setup-test-last-bar-stop',
      name: 'Last-bar stop probe',
      summary: 'test',
      entryRules: ['always'],
      entryChecks: ['session_tradable'],
      exitRules: ['stop'],
      checklist: [],
      enabled: true,
    };
    const noGates = {
      marketRegime: false,
      earningsBlackout: false,
      weeklyTrend: false,
      sectorRs: false,
      volatility: false,
    };
    // 65 quiet bars, then a last bar that opens through any reasonable stop.
    const candles = flatBars(65, 100);
    const last = candles[candles.length - 1];
    last.open = 70;
    last.high = 72;
    last.low = 68;
    last.close = 71; // close is above a typical stop — old bug would use close

    const result = runBacktest({
      setup,
      symbol: 'TEST',
      candles,
      spyCandles: candles,
      sourceLabel: 'test',
      gates: noGates,
      costs: { slippagePct: 0, commissionPct: 0 },
    });

    const lastBarStops = result.trades.filter(
      (t) => t.reason === 'stop' && t.exitTime === last.time
    );
    expect(lastBarStops.length).toBeGreaterThan(0);
    for (const t of lastBarStops) {
      // Gap-aware stop fill is min(stop, open)=open here (70), never the close (71).
      expect(t.exit).toBeLessThanOrEqual(t.stop);
      expect(t.exit).toBe(last.open);
      expect(t.exit).not.toBe(last.close);
    }
  });
});
