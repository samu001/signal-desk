import { demoCandles, defaultSetups } from '@/constants/seed';
import {
  applyStopCooldown,
  CombinedPlaybookTrade,
  runCombinedPlaybookBacktest,
} from '@/lib/playbookCombined';

const DAY = 86400;

function makeTrade(
  overrides: Partial<CombinedPlaybookTrade> & Pick<CombinedPlaybookTrade, 'entryTime' | 'exitTime' | 'reason'>
): CombinedPlaybookTrade {
  return {
    entry: 100,
    exit: overrides.reason === 'stop' ? 95 : 110,
    stop: 95,
    target: 110,
    rMultiple: overrides.reason === 'stop' ? -1 : 2,
    passRate: 0.8,
    plannedRR: 2,
    priorityScore: 2.8,
    setupId: 'setup-a',
    setupName: 'Setup A',
    ...overrides,
  };
}

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
    expect(result.notes.some((n) => /planned R:R/i.test(n))).toBe(true);
    for (const t of result.trades) {
      expect(typeof t.priorityScore).toBe('number');
      expect(typeof t.plannedRR).toBe('number');
      expect(typeof t.passRate).toBe('number');
    }

    const rawCount = result.setupResults.reduce((n, r) => n + r.trades.length, 0);
    expect(
      result.trades.length + result.skippedOverlaps + result.skippedCooldown
    ).toBeLessThanOrEqual(rawCount);
    expect(result.notes.some((n) => /Costs:/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /cooldown/i.test(n))).toBe(true);
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

describe('applyStopCooldown (no lookahead)', () => {
  const t0 = 1_700_000_000;

  it('does not skip an entry that happens while a later-stopping trade is still open', () => {
    // Trade A enters day 0 and stops out on day 7. Trade B enters day 3 —
    // at that moment nobody can know A will stop out, so B must be taken.
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 7 * DAY, reason: 'stop' });
    const b = makeTrade({ entryTime: t0 + 3 * DAY, exitTime: t0 + 9 * DAY, reason: 'target' });

    const { taken, skippedCooldown } = applyStopCooldown([a, b], 2);
    expect(taken).toHaveLength(2);
    expect(skippedCooldown).toBe(0);
  });

  it('skips entries inside the cooldown window after the stop exit happened', () => {
    // A stops out day 7; cooldown 2 days blocks entries on days 7–9.
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 7 * DAY, reason: 'stop' });
    const b = makeTrade({
      entryTime: t0 + 8 * DAY,
      exitTime: t0 + 12 * DAY,
      reason: 'target',
    });
    const c = makeTrade({
      entryTime: t0 + 10 * DAY,
      exitTime: t0 + 14 * DAY,
      reason: 'target',
    });

    const { taken, skippedCooldown } = applyStopCooldown([a, b, c], 2);
    expect(taken.map((t) => t.entryTime)).toEqual([a.entryTime, c.entryTime]);
    expect(skippedCooldown).toBe(1);
  });

  it('applies no cooldown after winners', () => {
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 5 * DAY, reason: 'target' });
    const b = makeTrade({
      entryTime: t0 + 5 * DAY,
      exitTime: t0 + 9 * DAY,
      reason: 'target',
    });
    const { taken, skippedCooldown } = applyStopCooldown([a, b], 2);
    expect(taken).toHaveLength(2);
    expect(skippedCooldown).toBe(0);
  });
});
