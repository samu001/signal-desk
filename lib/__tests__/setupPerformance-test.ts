import { defaultSetups, demoCandles } from '@/constants/seed';
import { blendSetupScores, scoreRecentSetupPerformance } from '@/lib/setupPerformance';

describe('scoreRecentSetupPerformance', () => {
  it('returns a score row for each setup on demo AAPL', () => {
    const rows = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups,
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
    });
    expect(rows.length).toBe(defaultSetups.length);
    for (const row of rows) {
      expect(row.setupId).toBeTruthy();
      expect(typeof row.score).toBe('number');
    }
  });

  it('blends journal and recent scores', () => {
    const recent = scoreRecentSetupPerformance({
      symbol: 'AAPL',
      setups: defaultSetups.slice(0, 1),
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
    });
    const blended = blendSetupScores(
      defaultSetups.slice(0, 1),
      {
        [defaultSetups[0].id]: {
          setupId: defaultSetups[0].id,
          sampleSize: 4,
          winRate: 0.5,
          avgR: 0.2,
          expectancyR: 0.2,
          planFollowRate: 1,
          score: 0.25,
        },
      },
      recent
    );
    expect(blended[defaultSetups[0].id].score).toBeDefined();
  });
});
