import { fetchAlphaVantageDailyCandles } from '@/lib/alphavantage';
import { fetchFmpDailyCandles } from '@/lib/fmp';
import { fetchTiingoDailyCandles } from '@/lib/tiingo';
import { demoCandles } from '@/constants/seed';
import { Candle } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

export type CandleSource = 'tiingo' | 'fmp' | 'finnhub' | 'alphavantage' | 'demo';

export type CandleFetchResult = {
  candles: Candle[];
  source: CandleSource;
  warnings: string[];
};

export type CandleApiOptions = {
  tiingoApiKey?: string;
  fmpApiKey?: string;
  finnhubApiKey?: string;
  alphaVantageApiKey?: string;
  days?: number;
};

function demoSeries(symbol: string): Candle[] {
  return demoCandles[symbol.toUpperCase()] ?? demoCandles.SPY ?? [];
}

async function fetchFinnhubCandles(
  symbol: string,
  apiKey: string,
  days: number
): Promise<{ candles: Candle[]; warning?: string }> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const text = await res.text();
  let data: {
    error?: string;
    s?: string;
    c?: number[];
    h?: number[];
    l?: number[];
    o?: number[];
    v?: number[];
    t?: number[];
  } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { candles: [], warning: `Finnhub candle response was not JSON (HTTP ${res.status}).` };
  }

  if (data.error || res.status === 403) {
    const msg = data.error ?? `Finnhub HTTP ${res.status}`;
    const accessDenied = /don't have access|access to this resource|403/i.test(msg);
    return {
      candles: [],
      warning: accessDenied
        ? 'Finnhub free plan does not include /stock/candle (OHLC). Prefer Tiingo or FMP for history.'
        : `Finnhub candles: ${msg}`,
    };
  }

  if (!res.ok) {
    return { candles: [], warning: `Finnhub candles HTTP ${res.status}` };
  }
  if (data.s !== 'ok' || !data.c?.length || !data.t?.length) {
    return {
      candles: [],
      warning: data.s === 'no_data' ? 'Finnhub returned no_data for this range.' : 'Finnhub candle payload incomplete.',
    };
  }

  const candles: Candle[] = data.t.map((time, i) => ({
    time,
    open: data.o?.[i] ?? data.c![i],
    high: data.h?.[i] ?? data.c![i],
    low: data.l?.[i] ?? data.c![i],
    close: data.c![i],
    volume: data.v?.[i] ?? 0,
  }));
  return { candles };
}

/**
 * Resolve daily bars for scoring/backtests.
 * Prefer long clean EOD first: Tiingo → FMP → Finnhub → Alpha Vantage → demo.
 */
export async function fetchDailyCandlesResolved(
  symbol: string,
  options?: CandleApiOptions
): Promise<CandleFetchResult> {
  const upper = symbol.toUpperCase().trim();
  const days = options?.days ?? 800;
  const warnings: string[] = [];

  if (options?.tiingoApiKey) {
    const tiingo = await fetchTiingoDailyCandles(upper, options.tiingoApiKey, days);
    if (tiingo.warning) warnings.push(tiingo.warning);
    if (tiingo.candles.length >= 60) {
      return { candles: tiingo.candles, source: 'tiingo', warnings };
    }
    if (tiingo.candles.length > 0) {
      warnings.push(`Tiingo only returned ${tiingo.candles.length} bars; trying fallbacks.`);
    }
  } else {
    warnings.push('No Tiingo token — skipping best free long-history EOD source.');
  }

  if (options?.fmpApiKey) {
    const fmp = await fetchFmpDailyCandles(upper, options.fmpApiKey, Math.min(days, 400));
    if (fmp.warning) warnings.push(fmp.warning);
    if (fmp.candles.length >= 60) {
      return { candles: fmp.candles, source: 'fmp', warnings };
    }
    if (fmp.candles.length > 0) {
      warnings.push(`FMP only returned ${fmp.candles.length} bars; trying fallbacks.`);
    }
  } else {
    warnings.push('No FMP key — skipping FMP EOD fallback.');
  }

  if (options?.finnhubApiKey) {
    try {
      const fh = await fetchFinnhubCandles(upper, options.finnhubApiKey, Math.min(days, 180));
      if (fh.warning) warnings.push(fh.warning);
      if (fh.candles.length >= 60) {
        return { candles: fh.candles, source: 'finnhub', warnings };
      }
      if (fh.candles.length > 0) {
        warnings.push(`Finnhub only returned ${fh.candles.length} bars; trying fallbacks.`);
      }
    } catch {
      warnings.push('Finnhub candle request failed.');
    }
  }

  if (options?.alphaVantageApiKey) {
    const av = await fetchAlphaVantageDailyCandles(upper, options.alphaVantageApiKey);
    if (av.warning) warnings.push(av.warning);
    if (av.candles.length >= 60) {
      return { candles: av.candles, source: 'alphavantage', warnings };
    }
    if (av.candles.length > 0) {
      warnings.push(`Alpha Vantage only returned ${av.candles.length} bars; using demo history.`);
    }
  }

  warnings.push('Using built-in demo daily history for offline backtests.');
  return { candles: demoSeries(upper), source: 'demo', warnings };
}

export async function fetchCandleBundle(
  symbols: string[],
  options?: CandleApiOptions
): Promise<{
  candles: Record<string, Candle[]>;
  sources: Record<string, CandleSource>;
  warnings: string[];
}> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const candles: Record<string, Candle[]> = {};
  const sources: Record<string, CandleSource> = {};
  const warnings: string[] = [];

  // Sequential to respect free-tier rate limits (esp. Alpha Vantage / Tiingo hourly).
  for (const symbol of unique) {
    const result = await fetchDailyCandlesResolved(symbol, options);
    candles[symbol] = result.candles;
    sources[symbol] = result.source;
    for (const w of result.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  return { candles, sources, warnings };
}
