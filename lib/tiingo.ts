import { Candle } from '@/types/trading';

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily';

export type TiingoCandleResult = {
  candles: Candle[];
  warning?: string;
};

function toDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Tiingo free EOD — best free long-history source for daily backtests.
 * Auth via token query param or Authorization header.
 */
export async function fetchTiingoDailyCandles(
  symbol: string,
  apiKey: string,
  days = 800
): Promise<TiingoCandleResult> {
  const upper = symbol.toUpperCase().trim();
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const url = `${TIINGO_BASE}/${encodeURIComponent(upper)}/prices?startDate=${toDate(start)}&endDate=${toDate(end)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        candles: [],
        warning:
          res.status === 401 || res.status === 403
            ? 'Tiingo auth failed — check your token.'
            : `Tiingo HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
      };
    }

    const data = (await res.json()) as Array<{
      date?: string;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      volume?: number;
      adjOpen?: number;
      adjHigh?: number;
      adjLow?: number;
      adjClose?: number;
      adjVolume?: number;
    }>;

    if (!Array.isArray(data) || data.length === 0) {
      return { candles: [], warning: 'Tiingo returned no EOD rows.' };
    }

    const candles: Candle[] = data
      .map((row) => {
        const open = row.adjOpen ?? row.open ?? 0;
        const high = row.adjHigh ?? row.high ?? 0;
        const low = row.adjLow ?? row.low ?? 0;
        const close = row.adjClose ?? row.close ?? 0;
        const volume = row.adjVolume ?? row.volume ?? 0;
        const time = row.date ? Math.floor(new Date(row.date).getTime() / 1000) : 0;
        return { time, open, high, low, close, volume };
      })
      .filter((c) => c.close > 0 && c.time > 0)
      .sort((a, b) => a.time - b.time);

    return {
      candles,
      warning: `Tiingo EOD (${candles.length} adjusted daily bars).`,
    };
  } catch {
    // Tiingo often omits CORS headers, so browser/web clients fail while native/server calls work.
    return {
      candles: [],
      warning:
        'Tiingo blocked in this browser (CORS). FMP/Finnhub still work on web; Tiingo works in Expo Go / native.',
    };
  }
}
