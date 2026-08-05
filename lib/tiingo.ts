import { Candle } from '@/types/trading';

const TIINGO_BASE = 'https://api.tiingo.com/tiingo/daily';

export type TiingoCandleResult = {
  candles: Candle[];
  warning?: string;
  adjusted?: 'adjusted' | 'raw' | 'unknown';
};

function toDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isRateLimited(status: number, body: string): boolean {
  return (
    status === 429 ||
    /rate.?limit|too many requests|exceeded|quota/i.test(body)
  );
}

/**
 * Tiingo EOD via Cloudflare Worker (browser-safe). Token lives on the Worker.
 */
export async function fetchTiingoDailyCandlesViaProxy(
  symbol: string,
  proxyBaseUrl: string,
  days = 800,
  proxyToken?: string
): Promise<TiingoCandleResult> {
  const upper = symbol.toUpperCase().trim();
  const base = normalizeBaseUrl(proxyBaseUrl);
  if (!base) {
    return { candles: [], warning: 'Tiingo proxy URL is empty.' };
  }

  try {
    const params = new URLSearchParams({
      symbol: upper,
      days: String(Math.max(30, Math.min(days, 5000))),
    });
    if (proxyToken?.trim()) params.set('token', proxyToken.trim());

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (proxyToken?.trim()) headers['X-Proxy-Token'] = proxyToken.trim();

    const res = await fetch(`${base}/eod?${params.toString()}`, { headers });
    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      return {
        candles: [],
        warning: `Tiingo proxy auth failed (HTTP ${res.status}) — check proxy token in Settings.`,
      };
    }
    if (isRateLimited(res.status, body)) {
      return {
        candles: [],
        warning: `Tiingo proxy rate limit (HTTP ${res.status}) — retry shortly.`,
      };
    }
    if (!res.ok) {
      let detail = body.slice(0, 160);
      try {
        const parsed = JSON.parse(body) as { error?: string; warning?: string };
        detail = parsed.error || parsed.warning || detail;
      } catch {
        /* keep */
      }
      return { candles: [], warning: `Tiingo proxy HTTP ${res.status}: ${detail}` };
    }

    let data: {
      candles?: Candle[];
      warning?: string;
      error?: string;
      adjusted?: string;
    };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      return { candles: [], warning: 'Tiingo proxy returned non-JSON.' };
    }
    if (data.error) {
      return { candles: [], warning: `Tiingo proxy: ${data.error}` };
    }

    const candles = (data.candles ?? [])
      .filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close) &&
          c.close > 0
      )
      .sort((a, b) => a.time - b.time);

    if (!candles.length) {
      return {
        candles: [],
        warning: data.warning || `Tiingo proxy returned no bars for ${upper}.`,
      };
    }

    return {
      candles,
      warning: data.warning || `Tiingo EOD via proxy (${candles.length} adjusted daily bars).`,
      adjusted: data.adjusted === 'adjusted' ? 'adjusted' : 'adjusted',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request failed';
    return { candles: [], warning: `Tiingo proxy failed (${msg}).` };
  }
}

/**
 * Tiingo free EOD — best free long-history source for daily backtests.
 * Auth via token query param or Authorization header.
 * Note: browser/web often fails CORS even with a valid token (use proxy on web).
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
      adjusted: 'adjusted',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const corsLike = /failed to fetch|networkerror|load failed|cors/i.test(msg);
    return {
      candles: [],
      warning: corsLike
        ? 'Tiingo blocked in this browser (CORS) — set Tiingo proxy URL in Settings, or use Expo Go / native.'
        : `Tiingo request failed: ${msg.slice(0, 120)}`,
    };
  }
}
