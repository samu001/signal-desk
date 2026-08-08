import {
  deskNewsHardFail,
  hasNegativeCatalyst,
  matchNegativeCatalysts,
  matchPositiveCatalysts,
} from '@/lib/catalysts';
import { NewsItem } from '@/types/trading';

function news(headline: string): NewsItem {
  return { id: headline, headline, datetime: 0, source: 'test' };
}

describe('catalyst screen', () => {
  it('hard-fails Desk on a single severe headline', () => {
    const hits = matchNegativeCatalysts([
      news('Company faces SEC charges after fraud probe'),
    ]);
    expect(hits.some((h) => h.severity === 'hard')).toBe(true);
    expect(deskNewsHardFail(hits)).toBe(true);
  });

  it('does not hard-fail Desk on a lone soft caution', () => {
    const hits = matchNegativeCatalysts([news('Analyst downgrade hits chip sector')]);
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('soft');
    expect(deskNewsHardFail(hits)).toBe(false);
    expect(hasNegativeCatalyst([news('Analyst downgrade hits chip sector')])).toBe(true);
  });

  it('hard-fails Desk when two soft cautions pile up', () => {
    const hits = matchNegativeCatalysts([
      news('Analyst downgrade hits chip sector'),
      news('Shares plunge after weak outlook'),
    ]);
    expect(deskNewsHardFail(hits)).toBe(true);
  });

  it('ignores false-positive phrases that used to match bare miss/record/win', () => {
    const headlines = [
      news('CEO misses the point on strategy'),
      news('Stock hits record low on thin volume'),
      news('Team win celebrated at company picnic'),
      news('Traders beat a path to the exits'),
    ];
    expect(matchNegativeCatalysts(headlines)).toHaveLength(0);
    expect(matchPositiveCatalysts(headlines)).toHaveLength(0);
  });

  it('still catches real earnings misses and beats', () => {
    expect(
      matchNegativeCatalysts([news('Company misses estimates as EPS slides')]).length
    ).toBe(1);
    expect(
      matchPositiveCatalysts([news('Retailer beats revenue estimates, raises guidance')]).length
    ).toBeGreaterThan(0);
  });
});
