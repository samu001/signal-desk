import { fundamentalFlags } from '@/lib/fmp';
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

describe('fundamentalFlags', () => {
  it('flags rich PE and healthy margin', () => {
    const flags = fundamentalFlags(base);
    expect(flags.some((f) => f.label.startsWith('PE'))).toBe(true);
    expect(flags.some((f) => f.label.includes('Margin'))).toBe(true);
  });

  it('returns empty without fundamentals', () => {
    expect(fundamentalFlags(null)).toEqual([]);
  });
});
