import { Candle } from '@/types/trading';

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

export function volumes(candles: Candle[]): number[] {
  return candles.map((c) => c.volume);
}

export function lastCompletedCandle(candles: Candle[]): Candle | null {
  if (candles.length === 0) return null;
  // Prefer prior daily bar when today's incomplete bar may be present.
  if (candles.length >= 2) return candles[candles.length - 2];
  return candles[candles.length - 1];
}

export function latestCandle(candles: Candle[]): Candle | null {
  return candles.length ? candles[candles.length - 1] : null;
}

export function avgVolume(candles: Candle[], period = 20): number | null {
  const vols = volumes(candles);
  return sma(vols, Math.min(period, vols.length));
}

/** True when the last few swing lows are rising. */
export function hasHigherLow(candles: Candle[], lookback = 12): boolean {
  if (candles.length < 6) return false;
  const slice = candles.slice(-lookback);
  const lows = slice.map((c) => c.low);
  const mid = Math.floor(lows.length / 2);
  const firstLow = Math.min(...lows.slice(0, mid));
  const secondLow = Math.min(...lows.slice(mid));
  return secondLow > firstLow;
}

/** Last candle has a lower wick that rejects lows (bullish wick). */
export function hasRejectionWick(candle: Candle | null): boolean {
  if (!candle) return false;
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const body = Math.abs(candle.close - candle.open);
  return lowerWick / range >= 0.45 && lowerWick > body;
}

export function percentFrom(value: number, ref: number): number {
  if (ref === 0) return 0;
  return ((value - ref) / ref) * 100;
}

/** Relative strength vs benchmark over N bars (price % change differential). */
export function relativeStrength(
  symbolCandles: Candle[],
  benchmarkCandles: Candle[],
  lookback = 20
): number | null {
  if (symbolCandles.length < lookback + 1 || benchmarkCandles.length < lookback + 1) {
    return null;
  }
  const s0 = symbolCandles[symbolCandles.length - 1 - lookback].close;
  const s1 = symbolCandles[symbolCandles.length - 1].close;
  const b0 = benchmarkCandles[benchmarkCandles.length - 1 - lookback].close;
  const b1 = benchmarkCandles[benchmarkCandles.length - 1].close;
  if (s0 <= 0 || b0 <= 0) return null;
  const symRet = (s1 - s0) / s0;
  const benRet = (b1 - b0) / b0;
  return (symRet - benRet) * 100;
}
