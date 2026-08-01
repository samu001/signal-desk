import { demoCandles, demoQuotes } from '@/constants/seed';
import { CandleApiOptions, CandleSource, fetchCandleBundle } from '@/lib/candles';
import { fetchFmpFundamentalsBundle } from '@/lib/fmp';
import { Candle, FundamentalSnapshot, NewsItem, Quote } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function fromDemoQuote(symbol: string): Quote {
  const upper = symbol.toUpperCase();
  const demo = demoQuotes[upper] ?? {
    price: 100,
    change: 0,
    percentChange: 0,
    high: 101,
    low: 99,
    open: 100,
    previousClose: 100,
  };

  return {
    symbol: upper,
    ...demo,
    source: 'demo',
  };
}

export async function fetchQuote(symbol: string, apiKey?: string): Promise<Quote> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return fromDemoQuote(upper);
  }

  try {
    const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(upper)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return fromDemoQuote(upper);
    }

    const data = (await res.json()) as {
      c?: number;
      d?: number;
      dp?: number;
      h?: number;
      l?: number;
      o?: number;
      pc?: number;
    };

    if (!data.c || data.c <= 0) {
      return fromDemoQuote(upper);
    }

    return {
      symbol: upper,
      price: data.c,
      change: data.d ?? 0,
      percentChange: data.dp ?? 0,
      high: data.h ?? data.c,
      low: data.l ?? data.c,
      open: data.o ?? data.c,
      previousClose: data.pc ?? data.c,
      source: 'finnhub',
    };
  } catch {
    return fromDemoQuote(upper);
  }
}

export async function fetchQuotes(symbols: string[], apiKey?: string): Promise<Record<string, Quote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const entries = await Promise.all(unique.map(async (symbol) => [symbol, await fetchQuote(symbol, apiKey)] as const));
  return Object.fromEntries(entries);
}

function demoCandleSeries(symbol: string): Candle[] {
  return demoCandles[symbol.toUpperCase()] ?? demoCandles.SPY ?? [];
}

export async function fetchDailyCandles(
  symbol: string,
  apiKey?: string,
  days = 120
): Promise<{ candles: Candle[]; source: 'finnhub' | 'demo' }> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return { candles: demoCandleSeries(upper), source: 'demo' };
  }

  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 60 * 60;
    const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(upper)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { candles: demoCandleSeries(upper), source: 'demo' };
    }
    const data = (await res.json()) as {
      s?: string;
      c?: number[];
      h?: number[];
      l?: number[];
      o?: number[];
      v?: number[];
      t?: number[];
    };
    if (data.s !== 'ok' || !data.c?.length || !data.t?.length) {
      return { candles: demoCandleSeries(upper), source: 'demo' };
    }

    const candles: Candle[] = data.t.map((time, i) => ({
      time,
      open: data.o?.[i] ?? data.c![i],
      high: data.h?.[i] ?? data.c![i],
      low: data.l?.[i] ?? data.c![i],
      close: data.c![i],
      volume: data.v?.[i] ?? 0,
    }));
    return { candles, source: 'finnhub' };
  } catch {
    return { candles: demoCandleSeries(upper), source: 'demo' };
  }
}

export async function fetchCompanyNews(
  symbol: string,
  apiKey?: string,
  lookbackDays = 3
): Promise<NewsItem[]> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return [];
  }

  try {
    const to = new Date();
    const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(upper)}&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      id?: number;
      headline?: string;
      datetime?: number;
      source?: string;
      url?: string;
    }>;
    if (!Array.isArray(data)) return [];
    return data.slice(0, 8).map((n, i) => ({
      id: String(n.id ?? `${upper}-${i}`),
      headline: n.headline ?? 'Untitled',
      datetime: n.datetime ?? 0,
      source: n.source ?? 'news',
      url: n.url,
    }));
  } catch {
    return [];
  }
}

export type MarketBundle = {
  quotes: Record<string, Quote>;
  candles: Record<string, Candle[]>;
  news: Record<string, NewsItem[]>;
  fundamentals: Record<string, FundamentalSnapshot>;
  sourceSummary: CandleSource | 'mixed';
  warnings: string[];
};

export async function fetchMarketBundle(
  symbols: string[],
  options?: CandleApiOptions
): Promise<MarketBundle> {
  const apiKey = options?.finnhubApiKey;
  const unique = [...new Set([...symbols.map((s) => s.toUpperCase().trim()), 'SPY'].filter(Boolean))];
  const quotes = await fetchQuotes(unique, apiKey);

  const bundle = await fetchCandleBundle(unique, {
    ...options,
    days: options?.days ?? 800,
  });

  const newsEntries = await Promise.all(
    unique
      .filter((s) => s !== 'SPY')
      .map(async (symbol) => [symbol, await fetchCompanyNews(symbol, apiKey)] as const)
  );
  const news = Object.fromEntries(newsEntries);

  let fundamentals: Record<string, FundamentalSnapshot> = {};
  const warnings = [...bundle.warnings];
  if (options?.fmpApiKey) {
    const fmp = await fetchFmpFundamentalsBundle(
      unique.filter((s) => s !== 'SPY'),
      options.fmpApiKey
    );
    fundamentals = fmp.fundamentals;
    for (const w of fmp.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  const sourceValues = Object.values(bundle.sources);
  const uniqueSources = [...new Set(sourceValues)];
  const sourceSummary =
    uniqueSources.length === 1 ? uniqueSources[0] : sourceValues.length ? 'mixed' : 'demo';

  return {
    quotes,
    candles: bundle.candles,
    news,
    fundamentals,
    sourceSummary,
    warnings,
  };
}
