import { fundamentalFlags, toUnitRatio } from '@/lib/fmp';
import { FundamentalSnapshot } from '@/types/trading';

const base: FundamentalSnapshot = {
  symbol: 'AAPL',
  name: 'Apple',
  sector: 'Technology',
  industry: 'Consumer Electronics',
  marketCap: 3e12,
  pe: 28,
  pb: 40,
  profitMargin: 0.25,
  revenueGrowth: 0.08,
  roe: 1.4,
  debtToEquity: 1.5,
  source: 'fmp',
};

describe('toUnitRatio', () => {
  it('keeps unit fractions and converts percent-scale values', () => {
    expect(toUnitRatio(0.24, 1)).toBeCloseTo(0.24);
    expect(toUnitRatio(24, 1)).toBeCloseTo(0.24);
    expect(toUnitRatio(1.47, 5)).toBeCloseTo(1.47); // 147% ROE as fraction
    expect(toUnitRatio(38, 5)).toBeCloseTo(0.38);
    expect(toUnitRatio(null, 1)).toBeNull();
  });
});

describe('fundamentalFlags', () => {
  it('flags rich PE and healthy margin', () => {
    const flags = fundamentalFlags(base);
    expect(flags.some((f) => f.label.startsWith('PE'))).toBe(true);
    expect(flags.some((f) => f.label.includes('Margin'))).toBe(true);
    // High ROE stored as fraction 1.4 → 140%, not misread as 1.4%.
    expect(flags.some((f) => f.label.startsWith('ROE') && /14\d%/.test(f.label))).toBe(true);
  });

  it('returns empty without fundamentals', () => {
    expect(fundamentalFlags(null)).toEqual([]);
  });
});
