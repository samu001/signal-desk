import { defaultSetups, demoCandles, demoQuotes, getDemoFundamentals, getDemoNews } from '@/constants/seed';
import { buildRecommendation, computeTradeLevels } from '@/lib/recommend';

describe('computeTradeLevels', () => {
  it('returns ordered entry/stop/target from demo AAPL history', () => {
    const levels = computeTradeLevels(demoCandles.AAPL);
    expect(levels.entryLow).toBeLessThanOrEqual(levels.entryHigh);
    expect(levels.stop).toBeLessThan(levels.entryLow);
    expect(levels.target).toBeGreaterThan(levels.entryHigh);
  });
});

describe('buildRecommendation', () => {
  it('can issue a buy only with Playbook confirmation on demo AAPL', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: getDemoNews('AAPL'),
      fundamentals: getDemoFundamentals('AAPL'),
      candleSource: 'demo',
      setups: defaultSetups,
    });

    expect(rec.levels.entryLow).toBeLessThanOrEqual(rec.levels.entryHigh);
    expect(rec.matchedSetups.length).toBeLessThanOrEqual(1);
    expect(rec.technicalScore).toBeGreaterThan(50);
    expect(rec.reasons.length).toBeGreaterThan(0);
    if (rec.matchedSetups.length) {
      expect(['strong_buy', 'soft_buy', 'wait']).toContain(rec.stance);
      expect(rec.bestSetupName).toBeTruthy();
    } else {
      expect(rec.stance).toBe('wait');
      expect(rec.warnings.some((w) => /no playbook setup matched/i.test(w))).toBe(true);
    }
  });

  it('blocks Soft/Strong buy when no setups are provided', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: getDemoNews('AAPL'),
      fundamentals: getDemoFundamentals('AAPL'),
      candleSource: 'demo',
      setups: [],
    });
    expect(['wait', 'avoid']).toContain(rec.stance);
    expect(rec.matchedSetups).toHaveLength(0);
  });

  it('returns avoid when negative catalyst headlines appear', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: [
        {
          id: 'bad',
          headline: 'Company faces SEC charges after fraud probe',
          datetime: Date.now() / 1000,
          source: 'Test',
        },
      ],
      fundamentals: getDemoFundamentals('AAPL'),
      candleSource: 'demo',
      setups: defaultSetups,
    });

    expect(rec.stance).toBe('avoid');
    expect(rec.newsScore).toBeLessThan(30);
  });

  it('waits when earnings are inside the blackout window', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      qqqCandles: demoCandles.QQQ,
      news: getDemoNews('AAPL'),
      fundamentals: getDemoFundamentals('AAPL'),
      candleSource: 'demo',
      setups: defaultSetups,
      earnings: {
        date: '2026-08-03',
        daysUntil: 0,
        blocked: true,
        detail: 'Earnings 2026-08-03 is inside the ±1 day blackout',
      },
    });
    expect(rec.stance).toBe('wait');
    expect(rec.summary).toMatch(/earnings/i);
  });
});
