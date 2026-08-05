import {
  plannedRewardToRisk,
  tradePriorityScore,
  compareByPriorityThenFifo,
  stableTieBreakKey,
} from '@/lib/tradePriority';
import { simulateMaxOpenByPriority } from '@/lib/portfolioCapacity';
import { selectBestTradesPerDay, CombinedPlaybookTrade } from '@/lib/playbookCombined';

describe('tradePriority', () => {
  it('computes planned R:R from entry/stop/target', () => {
    expect(plannedRewardToRisk(100, 95, 110)).toBeCloseTo(2);
    expect(plannedRewardToRisk(100, 100, 110)).toBe(0);
    expect(plannedRewardToRisk(100, 95, 90)).toBe(0);
  });

  it('ranks higher plannedRR and passRate above lower', () => {
    const high = tradePriorityScore(2.5, 0.9);
    const low = tradePriorityScore(1.0, 0.7);
    expect(high).toBeGreaterThan(low);
    expect(tradePriorityScore(2, 1)).toBe(21);
  });

  it('spreads near-~2R scores so passRate still breaks near ties', () => {
    // Both ~2R targets — old rr+pr packed them into 2.7–3.0.
    const a = tradePriorityScore(2.0, 0.7);
    const b = tradePriorityScore(2.0, 0.95);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeCloseTo(0.25);
  });

  it('FIFO then hash beats alphabetical symbol bias on equal priority', () => {
    const earlier = { priorityScore: 3, entryTime: 100, tieKey: 'XOM' };
    const later = { priorityScore: 3, entryTime: 200, tieKey: 'AAPL' };
    expect(compareByPriorityThenFifo(earlier, later)).toBeLessThan(0);

    const sameTimeAapl = { priorityScore: 3, entryTime: 100, tieKey: 'AAPL' };
    const sameTimeXom = { priorityScore: 3, entryTime: 100, tieKey: 'XOM' };
    // Must not prefer AAPL solely because A < X.
    const cmp = compareByPriorityThenFifo(sameTimeAapl, sameTimeXom);
    expect(cmp).toBe(stableTieBreakKey('AAPL') - stableTieBreakKey('XOM'));
    expect(cmp).not.toBe(0);
  });
});

describe('simulateMaxOpenByPriority', () => {
  const day = (ymd: string) => Math.floor(new Date(`${ymd}T16:00:00Z`).getTime() / 1000);

  it('same day with one slot takes higher priority, not first symbol', () => {
    const t0 = day('2024-06-03');
    const result = simulateMaxOpenByPriority(
      [
        {
          symbol: 'AAA',
          entryTime: t0,
          exitTime: t0 + 5 * 86400,
          r: -1,
          priorityScore: 1.2,
        },
        {
          symbol: 'BBB',
          entryTime: t0 + 60,
          exitTime: t0 + 5 * 86400,
          r: 3,
          priorityScore: 2.8,
        },
      ],
      1
    );
    expect(result.trades).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.totalR).toBe(3);
    expect(result.avgPriorityTaken).toBeCloseTo(2.8);
    expect(result.avgPrioritySkipped).toBeCloseTo(1.2);
  });

  it('does not prefer a junk realized-R loser when priority is lower', () => {
    const t0 = day('2024-06-04');
    const result = simulateMaxOpenByPriority(
      [
        { symbol: 'AAA', entryTime: t0, exitTime: t0 + 86400, r: 5, priorityScore: 1.0 },
        { symbol: 'BBB', entryTime: t0, exitTime: t0 + 86400, r: -0.5, priorityScore: 3.0 },
      ],
      1
    );
    expect(result.totalR).toBe(-0.5);
  });

  it('keeps the slot occupied through the exit calendar day (no same-day recycle)', () => {
    // Trade A exits on 2024-06-05. With maxOpen=1, a new entry that same day
    // must be skipped — entries fill at the open, before exits happen.
    const aEntry = day('2024-06-03');
    const aExit = day('2024-06-05');
    const bEntry = day('2024-06-05');
    const cEntry = day('2024-06-06');
    const result = simulateMaxOpenByPriority(
      [
        {
          symbol: 'AAA',
          entryTime: aEntry,
          exitTime: aExit,
          r: 1,
          priorityScore: 2,
        },
        {
          symbol: 'BBB',
          entryTime: bEntry,
          exitTime: bEntry + 3 * 86400,
          r: 5,
          priorityScore: 3,
        },
        {
          symbol: 'CCC',
          entryTime: cEntry,
          exitTime: cEntry + 3 * 86400,
          r: 2,
          priorityScore: 3,
        },
      ],
      1
    );
    expect(result.taken.map((t) => t.symbol)).toEqual(['AAA', 'CCC']);
    expect(result.skippedTrades.map((t) => t.symbol)).toEqual(['BBB']);
    expect(result.totalR).toBe(3);
  });

  it('on equal priority prefers earlier entry, not alphabetical symbol', () => {
    const t0 = day('2024-06-03');
    const result = simulateMaxOpenByPriority(
      [
        {
          symbol: 'AAPL',
          entryTime: t0 + 120,
          exitTime: t0 + 5 * 86400,
          r: 1,
          priorityScore: 2.5,
        },
        {
          symbol: 'XOM',
          entryTime: t0,
          exitTime: t0 + 5 * 86400,
          r: 2,
          priorityScore: 2.5,
        },
      ],
      1
    );
    expect(result.taken.map((t) => t.symbol)).toEqual(['XOM']);
    expect(result.skippedTrades.map((t) => t.symbol)).toEqual(['AAPL']);
  });
});

describe('selectBestTradesPerDay', () => {
  const base = (
    partial: Partial<CombinedPlaybookTrade> &
      Pick<CombinedPlaybookTrade, 'setupName' | 'priorityScore' | 'rMultiple'>
  ): CombinedPlaybookTrade => ({
    entryTime: Math.floor(new Date('2024-06-05T16:00:00Z').getTime() / 1000),
    exitTime: Math.floor(new Date('2024-06-10T16:00:00Z').getTime() / 1000),
    entry: 100,
    exit: 100,
    stop: 95,
    target: 110,
    reason: 'time',
    passRate: 0.8,
    plannedRR: 2,
    setupId: partial.setupName.toLowerCase(),
    ...partial,
  });

  it('prefers higher entry-time priority over lucky realized R', () => {
    const luckyLoserPriority: CombinedPlaybookTrade = base({
      setupName: 'Lucky',
      rMultiple: 4,
      plannedRR: 1,
      passRate: 0.7,
      priorityScore: tradePriorityScore(1, 0.7),
    });
    const strongPlan: CombinedPlaybookTrade = base({
      setupName: 'Strong',
      rMultiple: -1,
      plannedRR: 2.5,
      passRate: 0.95,
      priorityScore: tradePriorityScore(2.5, 0.95),
    });
    const { winners, skippedOverlaps } = selectBestTradesPerDay([luckyLoserPriority, strongPlan]);
    expect(skippedOverlaps).toBe(1);
    expect(winners).toHaveLength(1);
    expect(winners[0].setupName).toBe('Strong');
  });
});
