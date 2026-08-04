import {
  plannedRewardToRisk,
  tradePriorityScore,
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
    expect(tradePriorityScore(2, 1)).toBe(3);
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
