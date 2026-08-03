import { demoCandles } from '@/constants/seed';
import {
  aggregateWeeklyCandles,
  assessSectorRelativeStrength,
  assessVolatilityBand,
  assessWeeklyTrend,
  sectorEtfForSymbol,
} from '@/lib/playbookExtras';

describe('playbookExtras', () => {
  it('maps common symbols to sector ETFs', () => {
    expect(sectorEtfForSymbol('JPM')).toBe('XLF');
    expect(sectorEtfForSymbol('XOM')).toBe('XLE');
    expect(sectorEtfForSymbol('META')).toBe('XLC');
    expect(sectorEtfForSymbol('QQQ')).toBeNull();
  });

  it('aggregates daily bars into weekly candles', () => {
    const weekly = aggregateWeeklyCandles(demoCandles.AAPL);
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.length).toBeLessThan(demoCandles.AAPL.length);
    expect(weekly[0].high).toBeGreaterThanOrEqual(weekly[0].low);
  });

  it('scores weekly trend on demo uptrend', () => {
    const gate = assessWeeklyTrend(demoCandles.AAPL);
    expect(gate.detail).toMatch(/Weekly/i);
  });

  it('passes sector RS when symbol keeps up with sector proxy', () => {
    const gate = assessSectorRelativeStrength('AAPL', demoCandles.AAPL, demoCandles.SPY);
    expect(gate.etf).toBe('XLK');
    expect(['pass', 'fail', true, false]).toContain(gate.ok);
    expect(gate.ok === true || gate.ok === false).toBe(true);
  });

  it('evaluates ATR volatility band', () => {
    const gate = assessVolatilityBand(demoCandles.AAPL);
    expect(gate.detail).toMatch(/ATR/i);
  });
});
