import { detectSuspectGaps, SUSPECT_GAP_THRESHOLD } from '@/lib/candles';
import { Candle } from '@/types/trading';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const day = (ymd: string) => Math.floor(new Date(`${ymd}T16:00:00Z`).getTime() / 1000);

function bar(ymd: string, price: number, open = price): Candle {
  return {
    time: day(ymd),
    open,
    high: Math.max(open, price) * 1.01,
    low: Math.min(open, price) * 0.99,
    close: price,
    volume: 1_000,
  };
}

describe('detectSuspectGaps', () => {
  it('flags an unadjusted 10:1 split as a suspect gap', () => {
    const candles = [
      bar('2024-06-03', 500),
      bar('2024-06-04', 505),
      // Unadjusted 10:1 split: price drops ~90% overnight.
      bar('2024-06-05', 50.5, 50.4),
      bar('2024-06-06', 51),
    ];
    const gaps = detectSuspectGaps(candles);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].date).toBe('2024-06-05');
    expect(gaps[0].pct).toBeLessThan(-0.85);
  });

  it('flags 2:1 (−50%), 3:2 (−33%), and 4:3 (−25%) splits', () => {
    expect(detectSuspectGaps([bar('2024-06-03', 100), bar('2024-06-04', 50, 49.9)])).toHaveLength(1);
    expect(detectSuspectGaps([bar('2024-06-03', 90), bar('2024-06-04', 60, 59.8)])).toHaveLength(1); // 3:2
    expect(detectSuspectGaps([bar('2024-06-03', 80), bar('2024-06-04', 60, 59.9)])).toHaveLength(1); // 4:3
  });

  it('does not flag normal volatility under the threshold', () => {
    const volatile = [
      bar('2024-06-03', 100),
      bar('2024-06-04', 120, 118), // +20% day
      bar('2024-06-05', 100, 102), // −17% day (under 22%)
    ];
    expect(detectSuspectGaps(volatile)).toHaveLength(0);
  });

  it('catches gaps visible on the open even when the close recovers', () => {
    const candles = [
      bar('2024-06-03', 100),
      // Opens −55% (split artifact) but "closes" back near flat.
      { time: day('2024-06-04'), open: 45, high: 101, low: 44, close: 98, volume: 1_000 },
    ];
    const gaps = detectSuspectGaps(candles);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].pct).toBeCloseTo(-0.55, 2);
  });

  it('returns nothing for clean series and catches 4:3-sized moves', () => {
    const candles = [bar('2024-06-03', 100), bar('2024-06-04', 101), bar('2024-06-05', 99)];
    expect(detectSuspectGaps(candles)).toHaveLength(0);
    // Threshold sits between a noisy −20% day and a 4:3 (−25%) split.
    expect(SUSPECT_GAP_THRESHOLD).toBeGreaterThan(0.2);
    expect(SUSPECT_GAP_THRESHOLD).toBeLessThan(0.25);
  });
});
