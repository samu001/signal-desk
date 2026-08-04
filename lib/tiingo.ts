import { Candle } from '@/types/trading';

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily';

export type TiingoCandleResult = {
  candles: Candle[];
  warning?: string;
};

function toDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function isRateLimited(status: number, body: string): boolean {
  return (
    status === 429 ||
    /rate.?limit|too many requests|exceeded|quota/i.test(body)
  );
}

/**
 * Tiingo free EOD — best free long-history source for daily backtests.
 * Auth via token query param or Authorization header.
 * Note: browser/web often fails CORS even with a valid token (use FMP on web, or Expo Go).
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

    const body = await res.text();

    if (isRateLimited(res.status, body)) {
      const retry = res.headers.get('retry-after');
      return {
        candles: [],
        warning: retry
          ? `Tiingo rate limit (HTTP ${res.status}) — retry after ${retry}s, or use FMP for EOD on web.`
          : `Tiingo rate limit (HTTP ${res.status}) — wait before refreshing, or use FMP for EOD.`,
      };
    }

    if (!res.ok) {
      return {
        candles: [],
        warning:
          res.status === 401 || res.status === 403
            ? 'Tiingo auth failed — check your token in Settings.'
            : `Tiingo HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
      };
    }

    let data: Array<{
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
    }> = [];
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      return { candles: [], warning: 'Tiingo returned non-JSON EOD payload.' };
    }

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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const corsLike = /failed to fetch|networkerror|load failed|cors/i.test(msg);
    return {
      candles: [],
      warning: corsLike
        ? 'Tiingo blocked in this browser (CORS) — token may be fine. Use FMP for EOD on web, or run in Expo Go / native.'
        : `Tiingo request failed: ${msg.slice(0, 120)}`,
    };
  }
}
