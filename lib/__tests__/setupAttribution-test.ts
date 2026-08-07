import {
  SETUP_ATTRIBUTION_MIN_N,
  aggregateSetupAttribution,
  bestSetupByTotalR,
  bestSetupByWinRate,
} from '@/lib/setupAttribution';

describe('setupAttribution', () => {
  const catalog = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ];

  it('aggregates win rate and R, including zero-trade catalog rows', () => {
    const rows = aggregateSetupAttribution(
      [
        { setupId: 'a', r: 1 },
        { setupId: 'a', r: -1 },
        { setupId: 'a', r: 2 },
        { setupId: 'b', r: 0.5 },
      ],
      catalog
    );
    expect(rows.find((r) => r.setupId === 'a')).toMatchObject({
      trades: 3,
      wins: 2,
      winRate: 2 / 3,
      totalR: 2,
    });
    expect(rows.find((r) => r.setupId === 'c')).toMatchObject({
      trades: 0,
      winRate: null,
      totalR: 0,
    });
    expect(rows[0].setupId).toBe('a'); // highest total R
  });

  it('requires min n for best badges', () => {
    const rows = aggregateSetupAttribution(
      [
        { setupId: 'a', r: 10 },
        { setupId: 'b', r: 1 },
        { setupId: 'b', r: 1 },
        { setupId: 'b', r: 1 },
        { setupId: 'b', r: 1 },
        { setupId: 'b', r: 1 },
      ],
      catalog
    );
    expect(bestSetupByTotalR(rows, SETUP_ATTRIBUTION_MIN_N)).toBe('b');
    expect(bestSetupByWinRate(rows, SETUP_ATTRIBUTION_MIN_N)).toBe('b');
    expect(bestSetupByTotalR(rows, 1)).toBe('a');
  });
});
