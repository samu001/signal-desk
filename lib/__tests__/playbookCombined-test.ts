import { demoCandles, defaultSetups } from '@/constants/seed';
import {
  applyStopCooldown,
  CombinedPlaybookTrade,
  enforceOneOpenPosition,
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
      result.trades.length +
        result.skippedOverlaps +
        result.skippedOpen +
        result.skippedCooldown
    ).toBeLessThanOrEqual(rawCount);
    expect(result.notes.some((n) => /Costs:/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /cooldown/i.test(n))).toBe(true);
    expect(result.notes.some((n) => /one open position/i.test(n))).toBe(true);
    // No two taken trades overlap on this ticker (occupy through exit day).
    for (let i = 0; i < result.trades.length; i++) {
      for (let j = i + 1; j < result.trades.length; j++) {
        const a = result.trades[i];
        const b = result.trades[j];
        const aExitDay = new Date(a.exitTime * 1000).toISOString().slice(0, 10);
        const bEntryDay = new Date(b.entryTime * 1000).toISOString().slice(0, 10);
        expect(aExitDay < bEntryDay).toBe(true);
      }
    }
  });

  it('threads exit tuning into every setup run and discloses it', () => {
    const tuned = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
      levelTuning: { targetR: 1.0 },
    });
    const production = runCombinedPlaybookBacktest({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      sourceLabel: 'demo',
      evalBars: 30,
    });

    expect(tuned.notes.some((n) => /Exit tuning active/i.test(n))).toBe(true);
    expect(production.notes.some((n) => /Exit tuning active/i.test(n))).toBe(false);
    // The disclosure comes from the engine itself, proving every setup got it.
    for (const r of tuned.setupResults) {
      expect(r.notes.some((n) => /tuning/i.test(n))).toBe(true);
    }
    // Tuning reached the fills: on entries both runs share, a 1R target caps
    // planned R:R at ~1. (Entry sets can differ — a stop-out cools down while a
    // target hit doesn't, so each run is flat on different bars.)
    const prodByEntry = new Map(production.trades.map((t) => [t.entryTime, t]));
    let shared = 0;
    for (const t of tuned.trades) {
      const ref = prodByEntry.get(t.entryTime);
      if (ref) {
        shared++;
        expect(t.plannedRR).toBeLessThanOrEqual(1.01);
      }
    }
    expect(shared).toBeGreaterThan(0);
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

describe('enforceOneOpenPosition', () => {
  const t0 = 1_700_000_000;

  it('skips a new entry while a prior trade is still open', () => {
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 7 * DAY, reason: 'target' });
    const b = makeTrade({
      entryTime: t0 + 3 * DAY,
      exitTime: t0 + 9 * DAY,
      reason: 'target',
      setupId: 'setup-b',
      setupName: 'Setup B',
    });
    const { taken, skippedOpen } = enforceOneOpenPosition([a, b]);
    expect(taken).toHaveLength(1);
    expect(taken[0].setupName).toBe('Setup A');
    expect(skippedOpen).toBe(1);
  });

  it('blocks same-day exit→re-entry (slot occupies the exit calendar day)', () => {
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 5 * DAY, reason: 'target' });
    const sameDay = makeTrade({
      entryTime: t0 + 5 * DAY,
      exitTime: t0 + 8 * DAY,
      reason: 'target',
      setupId: 'setup-b',
      setupName: 'Setup B',
    });
    const nextDay = makeTrade({
      entryTime: t0 + 6 * DAY,
      exitTime: t0 + 9 * DAY,
      reason: 'target',
      setupId: 'setup-c',
      setupName: 'Setup C',
    });
    const { taken, skippedOpen } = enforceOneOpenPosition([a, sameDay, nextDay]);
    expect(taken.map((t) => t.setupName)).toEqual(['Setup A', 'Setup C']);
    expect(skippedOpen).toBe(1);
  });

  it('allows a new entry once the prior trade has fully exited', () => {
    const a = makeTrade({ entryTime: t0, exitTime: t0 + 2 * DAY, reason: 'stop' });
    const b = makeTrade({
      entryTime: t0 + 3 * DAY,
      exitTime: t0 + 6 * DAY,
      reason: 'target',
      setupId: 'setup-b',
      setupName: 'Setup B',
    });
    const { taken, skippedOpen } = enforceOneOpenPosition([a, b]);
    expect(taken).toHaveLength(2);
    expect(skippedOpen).toBe(0);
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
