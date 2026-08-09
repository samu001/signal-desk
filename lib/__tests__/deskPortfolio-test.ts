import { demoCandles } from '@/constants/seed';
import {
  applyLongEntryFill,
  applyLongExitFill,
  costsForSymbol,
  netLongR,
} from '@/lib/backtestCosts';
import { runDeskBacktest } from '@/lib/deskBacktest';
import { simulateMaxOpenByPriority } from '@/lib/portfolioCapacity';

/** Same mapping the portfolio screen's Desk engine uses. */
function deskCapacityTrades() {
  const symbols = Object.keys(demoCandles).filter((s) => s !== 'SPY' && s !== 'QQQ');
  return symbols.flatMap((symbol) => {
    const candles = demoCandles[symbol];
    const costs = costsForSymbol(symbol, candles);
    return runDeskBacktest({
      symbol,
      candles,
      spyCandles: demoCandles.SPY,
      sourceLabel: 'demo',
      evalBars: candles.length,
    }).trades.map((t) => {
      const entryFill = applyLongEntryFill(t.entry, costs);
      const exitFill = applyLongExitFill(t.exit, costs);
      return {
        symbol,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        r: netLongR({ entryFill, exitFill, stop: t.stop }),
        priorityScore: t.priorityScore,
        rawR: t.rMultiple,
      };
    });
  });
}

describe('Desk entries through the portfolio capacity pipeline', () => {
  it('feeds Desk trades into the max-open cap without losing any', () => {
    const trades = deskCapacityTrades();
    expect(trades.length).toBeGreaterThan(0);

    const sim = simulateMaxOpenByPriority(trades, 1);
    expect(sim.taken.length + sim.skipped).toBe(trades.length);
    // With max-open 1 no two taken trades may overlap in time.
    const sorted = [...sim.taken].sort((a, b) => a.entryTime - b.entryTime);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].entryTime).toBeGreaterThanOrEqual(sorted[i - 1].exitTime);
    }
  });

  it('applies ADV-tiered friction against the raw Desk fills', () => {
    for (const t of deskCapacityTrades()) {
      // Friction can only hurt a long: net R strictly below the raw R.
      expect(t.r).toBeLessThan(t.rawR + 1e-12);
    }
  });
});
