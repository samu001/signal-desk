import { rsi, smaCrossedUp, isSmaRising } from '@/lib/indicators';

describe('rsi / sma helpers', () => {
  it('computes RSI in a valid 0-100 range', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2);
    const value = rsi(closes, 14);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThanOrEqual(0);
    expect(value!).toBeLessThanOrEqual(100);
  });

  it('detects a rising SMA and a bullish cross on synthetic uptrend', () => {
    const values: number[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
      price -= 0.8;
      values.push(price);
    }
    for (let i = 0; i < 12; i++) {
      price += 2.2;
      values.push(price);
    }
    expect(isSmaRising(values, 20, 3)).toBe(true);
    expect(smaCrossedUp(values, 10, 30, 8)).toBe(true);
  });
});
