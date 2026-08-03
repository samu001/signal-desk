import { buildSyntheticDemoCandles, getDemoCandles } from '@/constants/seed';
import { alignDemoCandlesToQuote, alignDemoBundleToQuotes } from '@/lib/candles';

describe('demo candle anchoring', () => {
  it('builds synthetic history that ends at the provided quote', () => {
    const candles = buildSyntheticDemoCandles('BILI', 19.19);
    expect(candles.length).toBeGreaterThan(50);
    expect(candles[candles.length - 1].close).toBeCloseTo(19.19, 2);
  });

  it('re-anchors mismatched demo bars to the live quote', () => {
    const fake = buildSyntheticDemoCandles('BILI'); // hash-based ~hundreds
    const last = fake[fake.length - 1].close;
    expect(last).toBeGreaterThan(50);

    const aligned = alignDemoCandlesToQuote('BILI', fake, 19.19, 'demo');
    expect(aligned.reanchored).toBe(true);
    expect(aligned.candles[aligned.candles.length - 1].close).toBeCloseTo(19.19, 2);
    expect(aligned.warning).toMatch(/re-anchored/i);
  });

  it('does not rewrite live candle sources', () => {
    const candles = buildSyntheticDemoCandles('BILI', 19.19);
    const aligned = alignDemoCandlesToQuote('BILI', candles, 19.19, 'fmp');
    expect(aligned.reanchored).toBe(false);
    expect(aligned.candles).toBe(candles);
  });

  it('aligns a whole demo bundle to quotes', () => {
    const fake = buildSyntheticDemoCandles('BILI');
    const { candles, reanchored, warnings } = alignDemoBundleToQuotes(
      { BILI: fake },
      { BILI: 'demo' },
      { BILI: { price: 19.19 } }
    );
    expect(reanchored).toContain('BILI');
    expect(candles.BILI[candles.BILI.length - 1].close).toBeCloseTo(19.19, 2);
    expect(warnings.some((w) => /BILI/i.test(w))).toBe(true);
  });

  it('getDemoCandles prefers an endPrice over a mismatched baked series', () => {
    const candles = getDemoCandles('AAPL', 19.19);
    expect(candles[candles.length - 1].close).toBeCloseTo(19.19, 2);
  });
});
