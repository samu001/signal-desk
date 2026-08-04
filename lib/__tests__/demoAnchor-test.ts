import { buildSyntheticDemoCandles, getDemoCandles } from '@/constants/seed';
import {
  alignDemoCandlesToQuote,
  alignDemoBundleToQuotes,
  preferLiveCandleQuotes,
} from '@/lib/candles';
import { Quote } from '@/types/trading';

describe('demo candle anchoring', () => {
  it('builds synthetic history that ends at the provided quote (Jest fixtures only)', () => {
    const candles = buildSyntheticDemoCandles('BILI', 19.19);
    expect(candles.length).toBeGreaterThan(50);
    expect(candles[candles.length - 1].close).toBeCloseTo(19.19, 2);
  });

  it('clears demo/none series instead of re-anchoring (production No data path)', () => {
    const fake = buildSyntheticDemoCandles('BILI');
    const aligned = alignDemoCandlesToQuote(
      'BILI',
      fake,
      19.19,
      'demo',
      'Tiingo rate limit (HTTP 429)'
    );
    expect(aligned.reanchored).toBe(false);
    expect(aligned.candles).toHaveLength(0);
    expect(aligned.warning).toMatch(/No data/i);
    expect(aligned.warning).toMatch(/rate limit/i);
  });

  it('does not rewrite live candle sources', () => {
    const candles = buildSyntheticDemoCandles('BILI', 19.19);
    const aligned = alignDemoCandlesToQuote('BILI', candles, 19.19, 'fmp');
    expect(aligned.reanchored).toBe(false);
    expect(aligned.candles).toBe(candles);
  });

  it('empties demo symbols in a bundle', () => {
    const fake = buildSyntheticDemoCandles('BILI');
    const { candles, reanchored, warnings } = alignDemoBundleToQuotes(
      { BILI: fake },
      { BILI: 'demo' },
      { BILI: { price: 19.19 } },
      ['Tiingo blocked in this browser (CORS) — use FMP for EOD on web.']
    );
    expect(reanchored).toEqual([]);
    expect(candles.BILI).toHaveLength(0);
    expect(warnings.some((w) => /BILI/i.test(w) && /No data/i.test(w))).toBe(true);
  });

  it('replaces demo quotes when live EOD last close is available', () => {
    const live = buildSyntheticDemoCandles('IOVA', 4.3);
    const demoQuote: Quote = {
      symbol: 'IOVA',
      price: 273,
      change: 0,
      percentChange: 0,
      high: 273,
      low: 273,
      open: 273,
      previousClose: 273,
      source: 'demo',
    };
    const { quotes, lifted, warnings } = preferLiveCandleQuotes(
      { IOVA: demoQuote },
      { IOVA: live },
      { IOVA: 'yahoo' }
    );
    expect(lifted).toContain('IOVA');
    expect(quotes.IOVA.price).toBeCloseTo(4.3, 2);
    expect(quotes.IOVA.source).toBe('yahoo');
    expect(warnings[0]).toMatch(/last yahoo close/i);
  });

  it('getDemoCandles prefers an endPrice over a mismatched baked series', () => {
    const candles = getDemoCandles('AAPL', 19.19);
    expect(candles[candles.length - 1].close).toBeCloseTo(19.19, 2);
  });
});
