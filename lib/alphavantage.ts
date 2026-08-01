import { Candle } from '@/types/trading';

const AV_BASE = 'https://www.alphavantage.co/query';

export type AlphaVantageCandleResult = {
  candles: Candle[];
  warning?: string;
};

/**
 * Free Alpha Vantage daily bars.
 * Compact output ≈ last 100 sessions (free-tier friendly).
 * Full history is often premium-only — we request compact on purpose.
 */
export async function fetchAlphaVantageDailyCandles(
  symbol: string,
  apiKey: string
): Promise<AlphaVantageCandleResult> {
  const upper = symbol.toUpperCase().trim();
  try {
    const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(upper)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { candles: [], warning: `Alpha Vantage HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      Note?: string;
      Information?: string;
      'Error Message'?: string;
      'Time Series (Daily)'?: Record<
        string,
        {
          '1. open': string;
          '2. high': string;
          '3. low': string;
          '4. close': string;
          '5. volume': string;
        }
      >;
    };

    if (data.Note || data.Information) {
      return {
        candles: [],
        warning:
          data.Note ||
          data.Information ||
          'Alpha Vantage rate limit hit (free: ~25 calls/day, 5/min).',
      };
    }
    if (data['Error Message']) {
      return { candles: [], warning: data['Error Message'] };
    }

    const series = data['Time Series (Daily)'];
    if (!series) {
      return { candles: [], warning: 'Alpha Vantage returned no daily series.' };
    }

    const candles = Object.entries(series)
      .map(([date, bar]) => ({
        time: Math.floor(new Date(`${date}T16:00:00Z`).getTime() / 1000),
        open: Number(bar['1. open']),
        high: Number(bar['2. high']),
        low: Number(bar['3. low']),
        close: Number(bar['4. close']),
        volume: Number(bar['5. volume']),
      }))
      .filter((c) => c.close > 0)
      .sort((a, b) => a.time - b.time);

    return {
      candles,
      warning:
        candles.length > 0
          ? `Alpha Vantage free compact series (~${candles.length} daily bars).`
          : 'Alpha Vantage returned an empty series.',
    };
  } catch {
    return { candles: [], warning: 'Alpha Vantage request failed.' };
  }
}
