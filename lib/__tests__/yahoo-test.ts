import { yahooRangeForDays } from '@/lib/yahoo';

describe('yahooRangeForDays', () => {
  it('maps day counts to Yahoo chart ranges', () => {
    expect(yahooRangeForDays(20)).toBe('1mo');
    expect(yahooRangeForDays(80)).toBe('3mo');
    expect(yahooRangeForDays(150)).toBe('6mo');
    expect(yahooRangeForDays(400)).toBe('1y');
    expect(yahooRangeForDays(800)).toBe('2y');
    expect(yahooRangeForDays(1200)).toBe('5y');
  });
});
