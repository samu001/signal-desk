import { defaultSetups, demoCandles, demoQuotes, getDemoNews } from '@/constants/seed';
import { matchPlaybookSetups, rankMatchedSetups } from '@/lib/setupMatch';

describe('matchPlaybookSetups', () => {
  it('evaluates demo AAPL against default playbook setups', () => {
    const matches = matchPlaybookSetups({
      symbol: 'AAPL',
      setups: defaultSetups,
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: getDemoNews('AAPL'),
    });
    expect(matches.length).toBe(defaultSetups.length);
    const ranked = rankMatchedSetups(matches);
    for (const m of ranked) {
      expect(m.pass).toBe(true);
      expect(m.passRate).toBeGreaterThanOrEqual(0.7);
      expect(Array.isArray(m.passedChecks)).toBe(true);
      expect(Array.isArray(m.failedChecks)).toBe(true);
    }
  });
});
