import { Candle } from '@/types/trading';

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average (seeded with SMA). */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

/** EMA series aligned to input length (nulls until warm). */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
    out[i] = value;
  }
  return out;
}

/** True when latest close is at/above the highest high of the prior `lookback` bars. */
export function isBreakOfHigh(candles: Candle[], lookback = 20): boolean {
  if (candles.length < lookback + 1) return false;
  const last = candles[candles.length - 1];
  const priorHigh = Math.max(...candles.slice(-(lookback + 1), -1).map((c) => c.high));
  return last.close >= priorHigh;
}

/** Average True Range over `period` completed bars. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
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

/** Wilder RSI. Returns null until enough bars exist. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Latest RSI plus prior bar RSI for turn detection. */
export function rsiSeries(values: number[], period = 14): number[] {
  if (values.length < period + 1) return [];
  const out: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function isSmaRising(values: number[], period: number, lookback = 3): boolean {
  if (values.length < period + lookback) return false;
  const latest = sma(values, period);
  const earlier = sma(values.slice(0, values.length - lookback), period);
  if (latest == null || earlier == null) return false;
  return latest > earlier;
}

/** True when short SMA crossed above long SMA on this bar or within `withinBars`. */
export function smaCrossedUp(
  values: number[],
  shortPeriod: number,
  longPeriod: number,
  withinBars = 2
): boolean {
  if (values.length < longPeriod + withinBars + 1) return false;
  for (let offset = 0; offset <= withinBars; offset++) {
    const end = values.length - offset;
    const prevEnd = end - 1;
    if (prevEnd < longPeriod) continue;
    const shortNow = sma(values.slice(0, end), shortPeriod);
    const longNow = sma(values.slice(0, end), longPeriod);
    const shortPrev = sma(values.slice(0, prevEnd), shortPeriod);
    const longPrev = sma(values.slice(0, prevEnd), longPeriod);
    if (shortNow == null || longNow == null || shortPrev == null || longPrev == null) continue;
    if (shortNow > longNow && shortPrev <= longPrev) return true;
  }
  return false;
}
