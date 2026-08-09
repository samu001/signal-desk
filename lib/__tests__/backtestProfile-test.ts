import {
  DEFAULT_PORTFOLIO_GATES,
  PROFILE_ALL8,
  describeActiveExtras,
  isAll8Extras,
  isDefaultPortfolioExtras,
} from '@/lib/backtestProfile';

describe('portfolio gate extras helpers', () => {
  it('defaults match Must + earnings', () => {
    expect(isDefaultPortfolioExtras(DEFAULT_PORTFOLIO_GATES, 0)).toBe(true);
    expect(describeActiveExtras(DEFAULT_PORTFOLIO_GATES, 0)).toEqual(['earnings blackout']);
  });

  it('detects All 8 extras', () => {
    expect(isAll8Extras(PROFILE_ALL8.gates, PROFILE_ALL8.stopCooldownBars)).toBe(true);
    expect(describeActiveExtras(PROFILE_ALL8.gates, PROFILE_ALL8.stopCooldownBars)).toEqual([
      'earnings blackout',
      'market regime',
      'weekly trend',
      'sector RS',
      'volatility band',
      '3-day stop cooldown',
    ]);
  });

  it('treats Must-only as empty extras list', () => {
    expect(
      describeActiveExtras(
        {
          marketRegime: false,
          earningsBlackout: false,
          weeklyTrend: false,
          sectorRs: false,
          volatility: false,
        },
        0
      )
    ).toEqual([]);
  });
});
