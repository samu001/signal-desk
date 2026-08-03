import {
  buildSyntheticDemoCandles,
  demoQuotes,
  getDemoCandles,
  getDemoFundamentals,
  getDemoNews,
} from '@/constants/seed';
import {
  alignDemoBundleToQuotes,
  CandleApiOptions,
  CandleSource,
  fetchCandleBundle,
} from '@/lib/candles';
import { fetchFmpFundamentalsBundle } from '@/lib/fmp';
import { Candle, FundamentalSnapshot, NewsItem, Quote } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function fromDemoQuote(symbol: string): Quote {
  const upper = symbol.toUpperCase();
  if (demoQuotes[upper]) {
    return {
      symbol: upper,
      ...demoQuotes[upper],
      source: 'demo',
    };
  }
  // Match synthetic demo candle end price so unknown tickers stay consistent offline.
  const series = buildSyntheticDemoCandles(upper);
  const price = series[series.length - 1]?.close ?? 100;
  return {
    symbol: upper,
    price,
    change: 0,
    percentChange: 0,
    high: price * 1.01,
    low: price * 0.99,
    open: price,
    previousClose: price,
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
  return getDemoCandles(symbol);
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

export type EarningsWindow = {
  date: string;
  daysUntil: number;
  blocked: boolean;
  detail: string;
};

/** Historical earnings dates (YYYY-MM-DD) from Finnhub calendar for Playbook blackout. */
export async function fetchEarningsDates(
  symbol: string,
  apiKey: string | undefined,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey || !upper) return [];

  try {
    const url = `${FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&symbol=${encodeURIComponent(upper)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      earningsCalendar?: Array<{ date?: string; symbol?: string }>;
    };
    const rows = (data.earningsCalendar ?? []).filter(
      (r) => (r.symbol ?? '').toUpperCase() === upper && r.date
    );
    return [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort();
  } catch {
    return [];
  }
}

/** Next earnings date near today (Finnhub calendar). Blocks Desk buys inside ±1 day. */
export async function fetchEarningsWindow(
  symbol: string,
  apiKey?: string
): Promise<EarningsWindow | null> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) return null;

  try {
    const today = new Date();
    const from = new Date(today.getTime() - 2 * 86400000);
    const to = new Date(today.getTime() + 14 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const dates = await fetchEarningsDates(upper, apiKey, fmt(from), fmt(to));
    if (!dates.length) return null;
    const next = dates[0];
    const earnDate = new Date(`${next}T12:00:00Z`);
    const daysUntil = Math.round((earnDate.getTime() - today.getTime()) / 86400000);
    const blocked = daysUntil >= -1 && daysUntil <= 1;
    return {
      date: next,
      daysUntil,
      blocked,
      detail: blocked
        ? `Earnings ${next} is inside the ±1 day blackout`
        : `Next earnings ${next} (~${daysUntil}d)`,
    };
  } catch {
    return null;
  }
}

export async function fetchCompanyNews(
  symbol: string,
  apiKey?: string,
  lookbackDays = 3
): Promise<{ news: NewsItem[]; demo: boolean }> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return { news: getDemoNews(upper), demo: true };
  }

  try {
    const to = new Date();
    const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(upper)}&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return { news: getDemoNews(upper), demo: true };
    const data = (await res.json()) as Array<{
      id?: number;
      headline?: string;
      datetime?: number;
      source?: string;
      url?: string;
    }>;
    if (!Array.isArray(data) || !data.length) {
      return { news: getDemoNews(upper), demo: true };
    }
    return {
      news: data.slice(0, 8).map((n, i) => ({
        id: String(n.id ?? `${upper}-${i}`),
        headline: n.headline ?? 'Untitled',
        datetime: n.datetime ?? 0,
        source: n.source ?? 'news',
        url: n.url,
      })),
      demo: false,
    };
  } catch {
    return { news: getDemoNews(upper), demo: true };
  }
}

const BENCHMARKS = new Set(['SPY', 'QQQ']);

export type MarketBundle = {
  quotes: Record<string, Quote>;
  candles: Record<string, Candle[]>;
  candleSources: Record<string, CandleSource>;
  news: Record<string, NewsItem[]>;
  fundamentals: Record<string, FundamentalSnapshot>;
  /** Near-term earnings dates per symbol (YYYY-MM-DD) for Playbook blackout. */
  earningsDates: Record<string, string[]>;
  sourceSummary: CandleSource | 'mixed';
  warnings: string[];
};

export async function fetchMarketBundle(
  symbols: string[],
  options?: CandleApiOptions
): Promise<MarketBundle> {
  const apiKey = options?.finnhubApiKey;
  const unique = [
    ...new Set([...symbols.map((s) => s.toUpperCase().trim()), 'SPY', 'QQQ'].filter(Boolean)),
  ];
  const quotes = await fetchQuotes(unique, apiKey);

  const bundle = await fetchCandleBundle(unique, {
    ...options,
    days: options?.days ?? 800,
  });

  // Live quote + hash-based demo bars caused nonsense levels (e.g. BILI $19 vs ~$167 zone).
  const aligned = alignDemoBundleToQuotes(bundle.candles, bundle.sources, quotes);

  const equitySymbols = unique.filter((s) => !BENCHMARKS.has(s));

  const newsEntries = await Promise.all(
    equitySymbols.map(async (symbol) => {
      const result = await fetchCompanyNews(symbol, apiKey);
      return [symbol, result] as const;
    })
  );
  const news = Object.fromEntries(newsEntries.map(([symbol, result]) => [symbol, result.news]));
  const warnings = [...bundle.warnings];
  for (const w of aligned.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  if (newsEntries.some(([, result]) => result.demo)) {
    warnings.push('Using demo headlines where live company news was unavailable.');
  }

  const earningsEntries = await Promise.all(
    equitySymbols.map(async (symbol) => {
      const window = await fetchEarningsWindow(symbol, apiKey);
      return [symbol, window?.date ? [window.date] : []] as const;
    })
  );
  const earningsDates = Object.fromEntries(earningsEntries);

  let fundamentals: Record<string, FundamentalSnapshot> = {};
  if (options?.fmpApiKey) {
    const fmp = await fetchFmpFundamentalsBundle(equitySymbols, options.fmpApiKey);
    fundamentals = fmp.fundamentals;
    for (const w of fmp.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }
  for (const symbol of equitySymbols) {
    if (!fundamentals[symbol]) {
      fundamentals[symbol] = getDemoFundamentals(symbol);
    }
  }
  if (!options?.fmpApiKey || equitySymbols.some((s) => fundamentals[s]?.source === 'demo')) {
    warnings.push('Using demo company fundamentals where FMP data was unavailable.');
  }

  const sourceValues = Object.values(bundle.sources);
  const uniqueSources = [...new Set(sourceValues)];
  const sourceSummary =
    uniqueSources.length === 1 ? uniqueSources[0] : sourceValues.length ? 'mixed' : 'demo';

  return {
    quotes,
    candles: aligned.candles,
    candleSources: bundle.sources,
    news,
    fundamentals,
    earningsDates,
    sourceSummary,
    warnings,
  };
}
