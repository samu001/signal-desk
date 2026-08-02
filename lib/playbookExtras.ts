import { atr, closes, isSmaRising, relativeStrength, sma } from '@/lib/indicators';
import { Candle } from '@/types/trading';

/** Rough sector ETF proxy for common US large caps. */
const SECTOR_ETF: Record<string, string> = {
  AAPL: 'XLK',
  MSFT: 'XLK',
  NVDA: 'XLK',
  GOOGL: 'XLC',
  GOOG: 'XLC',
  META: 'XLC',
  AMZN: 'XLY',
  TSLA: 'XLY',
  JPM: 'XLF',
  BAC: 'XLF',
  XOM: 'XLE',
  CVX: 'XLE',
};

export function sectorEtfForSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase().trim();
  if (upper === 'SPY' || upper === 'QQQ' || upper.startsWith('XL')) return null;
  return SECTOR_ETF[upper] ?? null;
}

export function isoWeekKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  // UTC Thursday-based ISO week
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Aggregate daily bars into weekly OHLC (UTC weeks). */
export function aggregateWeeklyCandles(daily: Candle[]): Candle[] {
  const buckets = new Map<string, Candle[]>();
  for (const c of daily) {
    const key = isoWeekKey(c.time);
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bars]) => {
      const first = bars[0];
      const last = bars[bars.length - 1];
      return {
        time: last.time,
        open: first.open,
        high: Math.max(...bars.map((b) => b.high)),
        low: Math.min(...bars.map((b) => b.low)),
        close: last.close,
        volume: bars.reduce((n, b) => n + b.volume, 0),
      };
    });
}

export type WeeklyTrendGate = { ok: boolean; detail: string };

/** Weekly uptrend confirmation: weekly close above rising ~10-week MA. */
export function assessWeeklyTrend(dailyCandles: Candle[]): WeeklyTrendGate {
  const weekly = aggregateWeeklyCandles(dailyCandles);
  if (weekly.length < 12) {
    return { ok: true, detail: 'Weekly history short (unchecked)' };
  }
  const series = closes(weekly);
  const price = series[series.length - 1];
  const ma = sma(series, 10);
  const rising = isSmaRising(series, 10, 2);
  if (ma == null) return { ok: true, detail: 'Weekly MA unavailable' };
  const above = price > ma;
  const ok = above && rising;
  return {
    ok,
    detail: `Weekly ${above ? '>' : '≤'} SMA10, SMA10 ${rising ? 'rising' : 'flat/down'}`,
  };
}

export type SectorRsGate = { ok: boolean; detail: string; etf: string | null };

/** Stock should not badly lag its sector ETF over ~20 sessions. */
export function assessSectorRelativeStrength(
  symbol: string,
  symbolCandles: Candle[],
  sectorCandles: Candle[] | undefined
): SectorRsGate {
  const etf = sectorEtfForSymbol(symbol);
  if (!etf) {
    return { ok: true, detail: 'No sector proxy for this symbol', etf: null };
  }
  if (!sectorCandles?.length) {
    return { ok: true, detail: `Sector ${etf} history not loaded`, etf };
  }
  const rs = relativeStrength(symbolCandles, sectorCandles, 20);
  if (rs == null) {
    return { ok: true, detail: `Need ${etf} history for sector RS`, etf };
  }
  const ok = rs >= -2;
  return {
    ok,
    etf,
    detail: `20d RS vs ${etf} ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}%`,
  };
}

export type VolatilityGate = { ok: boolean; detail: string };

/**
 * Skip dead-quiet and crazy-wide ATR days.
 * Band is ATR(14) as % of price roughly 0.9%–5.5%.
 */
export function assessVolatilityBand(candles: Candle[]): VolatilityGate {
  const last = candles[candles.length - 1];
  if (!last?.close) return { ok: true, detail: 'No price for ATR band' };
  const value = atr(candles, 14);
  if (value == null) return { ok: true, detail: 'ATR history short (unchecked)' };
  const atrPct = (value / last.close) * 100;
  if (atrPct < 0.9) {
    return { ok: false, detail: `ATR ${atrPct.toFixed(2)}% too quiet (<0.9%)` };
  }
  if (atrPct > 5.5) {
    return { ok: false, detail: `ATR ${atrPct.toFixed(2)}% too wide (>5.5%)` };
  }
  return { ok: true, detail: `ATR ${atrPct.toFixed(2)}% inside 0.9–5.5% band` };
}
