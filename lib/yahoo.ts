import { Candle } from '@/types/trading';

export type YahooCandleResult = {
  candles: Candle[];
  warning?: string;
  /** From proxy when it scales OHLC by Yahoo adjclose. */
  adjusted?: 'adjusted' | 'unknown';
};

type YahooEodResponse = {
  symbol?: string;
  source?: string;
  adjusted?: 'adjusted' | 'raw' | 'unknown';
  candles?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  warning?: string;
  error?: string;
};

/** Map requested history length to Yahoo chart ranges the Worker accepts. */
export function yahooRangeForDays(days: number): string {
  if (days <= 35) return '1mo';
  if (days <= 100) return '3mo';
  if (days <= 200) return '6mo';
  if (days <= 400) return '1y';
  if (days <= 800) return '2y';
  return '5y';
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Daily EOD via Cloudflare Worker proxy (Yahoo Finance chart API).
 * Avoids browser CORS; no Yahoo API key required.
 */
export async function fetchYahooDailyCandles(
  symbol: string,
  proxyBaseUrl: string,
  days = 800,
  proxyToken?: string
): Promise<YahooCandleResult> {
  const upper = symbol.toUpperCase().trim();
  const base = normalizeBaseUrl(proxyBaseUrl);
  if (!base) {
    return { candles: [], warning: 'Yahoo proxy URL is empty.' };
  }

  try {
    const range = yahooRangeForDays(days);
    const params = new URLSearchParams({ symbol: upper, range });
    if (proxyToken?.trim()) params.set('token', proxyToken.trim());

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (proxyToken?.trim()) headers['X-Proxy-Token'] = proxyToken.trim();

    const res = await fetch(`${base}/eod?${params.toString()}`, { headers });
    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      return {
        candles: [],
        warning: `Yahoo proxy auth failed (HTTP ${res.status}) — check proxy token in Settings.`,
      };
    }
    if (res.status === 429) {
      return {
        candles: [],
        warning: `Yahoo proxy rate limit (HTTP 429) — retry shortly.`,
      };
    }
    if (!res.ok) {
      let detail = body.slice(0, 120);
      try {
        const parsed = JSON.parse(body) as YahooEodResponse;
        detail = parsed.error || parsed.warning || detail;
      } catch {
        /* keep raw */
      }
      return {
        candles: [],
        warning: `Yahoo proxy HTTP ${res.status}: ${detail}`,
      };
    }

    let data: YahooEodResponse;
    try {
      data = JSON.parse(body) as YahooEodResponse;
    } catch {
      return { candles: [], warning: 'Yahoo proxy returned non-JSON.' };
    }

    if (data.error) {
      return { candles: [], warning: `Yahoo proxy: ${data.error}` };
    }

    const candles: Candle[] = (data.candles ?? [])
      .filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
      )
      .map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number.isFinite(c.volume) ? c.volume : 0,
      }))
      .sort((a, b) => a.time - b.time);

    if (!candles.length) {
      return {
        candles: [],
        warning: data.warning || `Yahoo proxy returned no bars for ${upper}.`,
      };
    }

    return {
      candles,
      warning: data.warning,
      adjusted: data.adjusted === 'adjusted' ? 'adjusted' : 'unknown',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request failed';
    return {
      candles: [],
      warning: `Yahoo proxy failed (${msg}).`,
    };
  }
}
