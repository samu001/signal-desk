import { barsUpTo } from '@/lib/indicators';
import { Candle } from '@/types/trading';

const DAY = 86400;
const t0 = 1_700_000_000;

function bar(time: number, close = 100): Candle {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 };
}

describe('barsUpTo', () => {
  const series = [bar(t0), bar(t0 + DAY), bar(t0 + 2 * DAY), bar(t0 + 3 * DAY)];

  it('drops bars after the as-of time (no future leak)', () => {
    const truncated = barsUpTo(series, t0 + DAY);
    expect(truncated).toHaveLength(2);
    expect(truncated[truncated.length - 1].time).toBe(t0 + DAY);
  });

  it('returns the full array when as-of is at/after the last bar', () => {
    expect(barsUpTo(series, t0 + 3 * DAY)).toHaveLength(4);
    expect(barsUpTo(series, t0 + 30 * DAY)).toHaveLength(4);
  });

  it('returns empty when everything is in the future', () => {
    expect(barsUpTo(series, t0 - DAY)).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(barsUpTo([], t0)).toHaveLength(0);
  });

  it('truncates a longer benchmark to the symbol bar date, not by index', () => {
    // Benchmark starts 5 days earlier than the symbol (e.g. recent IPO).
    const benchmark = Array.from({ length: 9 }, (_, i) => bar(t0 + (i - 5) * DAY));
    const symbolBarTime = t0 + DAY; // symbol's bar index 1
    const truncated = barsUpTo(benchmark, symbolBarTime);
    // Date-correct answer is 7 bars (t0-5d .. t0+1d) — index slicing gave 2.
    expect(truncated).toHaveLength(7);
    expect(truncated[truncated.length - 1].time).toBe(symbolBarTime);
  });
});
