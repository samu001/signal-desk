import { demoCandles, demoQuotes, getDemoFundamentals, getDemoNews } from '@/constants/seed';
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
  it('labels demo AAPL as a buy-leaning stance with entry levels', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
      news: getDemoNews('AAPL'),
      fundamentals: getDemoFundamentals('AAPL'),
      candleSource: 'demo',
    });

    expect(['strong_buy', 'soft_buy']).toContain(rec.stance);
    expect(rec.levels.entryLow).toBeLessThanOrEqual(rec.levels.entryHigh);
    expect(rec.technicalScore).toBeGreaterThan(50);
    expect(rec.reasons.length).toBeGreaterThan(0);
    expect(rec.label).toMatch(/buy/i);
  });

  it('returns avoid when negative catalyst headlines appear', () => {
    const rec = buildRecommendation({
      symbol: 'AAPL',
      quote: { symbol: 'AAPL', ...demoQuotes.AAPL, source: 'demo' },
      candles: demoCandles.AAPL,
      spyCandles: demoCandles.SPY,
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
    });

    expect(rec.stance).toBe('avoid');
    expect(rec.newsScore).toBeLessThan(30);
  });
});
