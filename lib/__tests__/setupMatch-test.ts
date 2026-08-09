import { defaultSetups, demoCandles, demoQuotes, getDemoNews } from '@/constants/seed';
import {
  commonPlaybookBlockers,
  matchPlaybookSetups,
  rankMatchedSetups,
  SetupMatch,
} from '@/lib/setupMatch';

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

describe('commonPlaybookBlockers', () => {
  it('surfaces a shared earnings calendar failure', () => {
    const matches: SetupMatch[] = [
      {
        setupId: 'one',
        setupName: 'One',
        pass: false,
        passRate: 0.8,
        expectancyScore: 0,
        passedChecks: [],
        failedChecks: ['Outside earnings blackout'],
        failedCheckDetails: [
          'Outside earnings blackout: Earnings calendar fetch failed — blackout fails closed for V',
        ],
      },
      {
        setupId: 'two',
        setupName: 'Two',
        pass: false,
        passRate: 0.75,
        expectancyScore: 0,
        passedChecks: [],
        failedChecks: ['Outside earnings blackout'],
        failedCheckDetails: [
          'Outside earnings blackout: Earnings calendar fetch failed — blackout fails closed for V',
        ],
      },
    ];

    expect(commonPlaybookBlockers(matches)).toEqual([
      {
        label: 'Outside earnings blackout',
        detail: 'Earnings calendar fetch failed — blackout fails closed for V',
        affectedSetups: 2,
      },
    ]);
  });
});
