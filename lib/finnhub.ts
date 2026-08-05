import { fetchAlphaVantageEarningsDates } from '@/lib/alphavantage';
import {
  CandleApiOptions,
  CandleSource,
  fetchCandleBundle,
  isLiveCandleSource,
  preferLiveCandleQuotes,
} from '@/lib/candles';
import { fetchFmpEarningsDates, fetchFmpFundamentalsBundle } from '@/lib/fmp';
import { createInflightMap } from '@/lib/ttlCache';
import { fetchYahooDailyCandles } from '@/lib/yahoo';
import { Candle, FundamentalSnapshot, NewsItem, Quote } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const marketBundleInflight = createInflightMap<MarketBundle>();

/** Prefer reusing a context bundle when quotes are this fresh (ms). */
export const MARKET_BUNDLE_REUSE_MAX_AGE_MS = 5 * 60 * 1000;

export type QuoteFetchFallbacks = {
  yahooProxyUrl?: string;
  yahooProxyToken?: string;
  /** Collect human-readable failure / backup notes. */
  warningsOut?: string[];
};

function pushWarn(fallbacks: QuoteFetchFallbacks | undefined, note: string) {
  if (!fallbacks?.warningsOut) return;
  if (!fallbacks.warningsOut.includes(note)) fallbacks.warningsOut.push(note);
}

function quoteFromLastClose(
  symbol: string,
  close: number,
  source: Quote['source'],
  prior?: number
): Quote {
  const prev = prior && prior > 0 ? prior : close;
  const change = close - prev;
  const percentChange = prev > 0 ? (change / prev) * 100 : 0;
  return {
    symbol: symbol.toUpperCase(),
    price: close,
    change,
    percentChange,
    high: close,
    low: close,
    open: close,
    previousClose: prev,
    source,
  };
}

async function fetchYahooQuoteFallback(
  symbol: string,
  fallbacks?: QuoteFetchFallbacks
): Promise<Quote | null> {
  const url = fallbacks?.yahooProxyUrl?.trim();
  if (!url) return null;
  const yahoo = await fetchYahooDailyCandles(symbol, url, 35, fallbacks?.yahooProxyToken);
  if (yahoo.warning) pushWarn(fallbacks, yahoo.warning);
  const bars = yahoo.candles;
  if (bars.length < 1) return null;
  const last = bars[bars.length - 1].close;
  const prior = bars.length > 1 ? bars[bars.length - 2].close : last;
  if (!(last > 0)) return null;
  pushWarn(
    fallbacks,
    `${symbol.toUpperCase()}: Finnhub quote unavailable — using Yahoo last close $${last.toFixed(2)}.`
  );
  return quoteFromLastClose(symbol, last, 'yahoo', prior);
}

export async function fetchQuote(
  symbol: string,
  apiKey?: string,
  fallbacks?: QuoteFetchFallbacks
): Promise<Quote | null> {
  const upper = symbol.toUpperCase().trim();

  if (apiKey) {
    try {
      const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(upper)}&token=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (res.status === 429) {
        pushWarn(
          fallbacks,
          `Finnhub quote rate limit (HTTP 429) for ${upper} — trying Yahoo/EOD backup.`
        );
      } else if (!res.ok) {
        pushWarn(fallbacks, `Finnhub quote HTTP ${res.status} for ${upper}.`);
      } else {
        const data = (await res.json()) as {
          c?: number;
          d?: number;
          dp?: number;
          h?: number;
          l?: number;
          o?: number;
          pc?: number;
        };

        if (data.c && data.c > 0) {
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
        }
        pushWarn(fallbacks, `Finnhub returned no quote for ${upper}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'request failed';
      pushWarn(fallbacks, `Finnhub quote failed for ${upper} (${msg}).`);
    }
  }

  const yahoo = await fetchYahooQuoteFallback(upper, fallbacks);
  if (yahoo) return yahoo;

  pushWarn(fallbacks, `${upper}: No data — live quote unavailable.`);
  return null;
}

export async function fetchQuotes(
  symbols: string[],
  apiKey?: string,
  fallbacks?: QuoteFetchFallbacks
): Promise<Record<string, Quote>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  if (!apiKey) {
    pushWarn(fallbacks, 'No Finnhub key — quotes use Yahoo/EOD backup when available.');
  }
  const entries = await Promise.all(
    unique.map(async (symbol) => {
      const quote = await fetchQuote(symbol, apiKey, fallbacks);
      return quote ? ([symbol, quote] as const) : null;
    })
  );
  return Object.fromEntries(entries.filter((e): e is readonly [string, Quote] => e != null));
}

export async function fetchDailyCandles(
  symbol: string,
  apiKey?: string,
  days = 120
): Promise<{ candles: Candle[]; source: 'finnhub' | 'none' }> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey) {
    return { candles: [], source: 'none' };
  }

  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 60 * 60;
    const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(upper)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { candles: [], source: 'none' };
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
      return { candles: [], source: 'none' };
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
    return { candles: [], source: 'none' };
  }
}

export type EarningsWindow = {
  date: string;
  daysUntil: number;
  blocked: boolean;
  detail: string;
};

/**
 * Why an earnings calendar is missing or present.
 * Callers pass `dates` into the blackout gate; `status` drives UI copy so
 * no-key / fetch-fail / empty-window are not collapsed into one silent [].
 */
export type EarningsFetchStatus = 'ok' | 'empty' | 'no_key' | 'error';

export type EarningsFetchResult = {
  dates: string[];
  status: EarningsFetchStatus;
  detail: string;
};

/** Fail-closed gate copy when dates are empty (shared by rules + UI). */
export function earningsFailClosedDetail(status: EarningsFetchStatus): string {
  if (status === 'no_key') {
    return 'No Finnhub / FMP / Alpha Vantage key — earnings blackout fails closed (add a key in Settings)';
  }
  if (status === 'error') {
    return 'Earnings calendar fetch failed — blackout fails closed for this symbol';
  }
  if (status === 'empty') {
    return 'Earnings calendar empty for this window — blackout fails closed (cannot verify clear)';
  }
  return 'Earnings calendar unavailable — blackout fails closed';
}

/** Roll up per-symbol fetches for a portfolio / multi-ticker banner. */
export function summarizeEarningsFetches(
  results: Iterable<Pick<EarningsFetchResult, 'status'>>
): {
  ok: number;
  empty: number;
  error: number;
  noKey: number;
  total: number;
  /** True when any symbol will fail-closed without a usable calendar. */
  anyBlocked: boolean;
  headline: string;
} {
  let ok = 0;
  let empty = 0;
  let error = 0;
  let noKey = 0;
  let total = 0;
  for (const r of results) {
    total += 1;
    if (r.status === 'ok') ok += 1;
    else if (r.status === 'empty') empty += 1;
    else if (r.status === 'error') error += 1;
    else noKey += 1;
  }
  const blocked = empty + error + noKey;
  let headline = '';
  if (!total) {
    headline = 'No earnings calendars requested.';
  } else if (noKey === total) {
    headline = `No Finnhub / FMP / Alpha Vantage key — earnings blackout fails closed on all ${total} symbols (almost no trades). Add a key in Settings.`;
  } else if (ok === total) {
    headline = `Earnings calendars loaded for all ${total} symbols.`;
  } else if (ok === 0) {
    headline = `No usable earnings calendars (${error} fetch error${error === 1 ? '' : 's'}, ${empty} empty) — blackout fails closed on every symbol.`;
  } else {
    headline = `Earnings: ${ok}/${total} calendars loaded — ${blocked} symbol${
      blocked === 1 ? '' : 's'
    } fail-closed (${[
      error ? `${error} fetch error${error === 1 ? '' : 's'}` : '',
      empty ? `${empty} empty` : '',
      noKey ? `${noKey} no key` : '',
    ]
      .filter(Boolean)
      .join(', ')}).`;
  }
  return {
    ok,
    empty,
    error,
    noKey,
    total,
    anyBlocked: blocked > 0,
    headline,
  };
}

/**
 * Historical earnings dates (YYYY-MM-DD) for Playbook blackout.
 * Chain: Finnhub → FMP → Alpha Vantage (last resort; free AV is ~25 calls/day).
 */
export async function fetchEarningsDates(
  symbol: string,
  apiKey: string | undefined,
  fromDate: string,
  toDate: string,
  fmpApiKey?: string,
  alphaVantageApiKey?: string
): Promise<EarningsFetchResult> {
  const upper = symbol.toUpperCase().trim();
  const providers: Array<{
    name: string;
    run: () => Promise<Pick<EarningsFetchResult, 'dates' | 'status' | 'detail'>>;
  }> = [];

  if (apiKey?.trim()) {
    providers.push({
      name: 'Finnhub',
      run: () => fetchFinnhubEarningsDates(upper, apiKey.trim(), fromDate, toDate),
    });
  }
  if (fmpApiKey?.trim()) {
    providers.push({
      name: 'FMP',
      run: () => fetchFmpEarningsDates(upper, fmpApiKey, fromDate, toDate),
    });
  }
  if (alphaVantageApiKey?.trim()) {
    providers.push({
      name: 'Alpha Vantage',
      run: () => fetchAlphaVantageEarningsDates(upper, alphaVantageApiKey, fromDate, toDate),
    });
  }

  if (!upper || !providers.length) {
    return {
      dates: [],
      status: 'no_key',
      detail: earningsFailClosedDetail('no_key'),
    };
  }

  const failures: string[] = [];
  let sawError = false;
  let sawEmpty = false;

  for (let i = 0; i < providers.length; i++) {
    const { name, run } = providers[i];
    const result = await run();
    if (result.status === 'ok' && result.dates.length) {
      if (i === 0 && name === 'Finnhub') {
        return {
          dates: result.dates,
          status: 'ok',
          detail: result.detail.includes('via ')
            ? result.detail
            : `${result.dates.length} earnings date${
                result.dates.length === 1 ? '' : 's'
              } via Finnhub.`,
        };
      }
      const prior = failures.length
        ? ` after ${failures.map((f) => f.split(' ')[0]).join(' → ')}`
        : providers[0].name !== name
          ? ` (no ${providers
              .slice(0, i)
              .map((p) => p.name)
              .join('/')})`
          : '';
      return {
        dates: result.dates,
        status: 'ok',
        detail: `${result.dates.length} earnings date${
          result.dates.length === 1 ? '' : 's'
        } via ${name}${prior}.`,
      };
    }
    if (result.status === 'error') sawError = true;
    if (result.status === 'empty') sawEmpty = true;
    failures.push(`${name}: ${result.detail}`);
  }

  const status: EarningsFetchStatus = sawError || !sawEmpty ? 'error' : 'empty';
  return {
    dates: [],
    status,
    detail: failures.join(' · '),
  };
}

async function fetchFinnhubEarningsDates(
  upper: string,
  apiKey: string,
  fromDate: string,
  toDate: string
): Promise<EarningsFetchResult> {
  try {
    const url = `${FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&symbol=${encodeURIComponent(upper)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const detail =
        res.status === 429
          ? `Finnhub earnings rate-limited (HTTP 429) — blackout fails closed for ${upper}.`
          : `Finnhub earnings HTTP ${res.status} — blackout fails closed for ${upper}.`;
      return { dates: [], status: 'error', detail };
    }
    const data = (await res.json()) as {
      earningsCalendar?: Array<{ date?: string; symbol?: string }>;
      error?: string;
    };
    if (data.error) {
      return {
        dates: [],
        status: 'error',
        detail: `Finnhub earnings error: ${String(data.error).slice(0, 120)} — blackout fails closed for ${upper}.`,
      };
    }
    const rows = (data.earningsCalendar ?? []).filter(
      (r) => (r.symbol ?? '').toUpperCase() === upper && r.date
    );
    const dates = [...new Set(rows.map((r) => String(r.date).slice(0, 10)))].sort();
    if (!dates.length) {
      return {
        dates: [],
        status: 'empty',
        detail: `Finnhub returned no earnings dates for ${upper} in ${fromDate}…${toDate} — blackout fails closed.`,
      };
    }
    return {
      dates,
      status: 'ok',
      detail: `${dates.length} earnings date${dates.length === 1 ? '' : 's'} via Finnhub.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      dates: [],
      status: 'error',
      detail: `Finnhub earnings request failed (${msg.slice(0, 80)}) — blackout fails closed for ${upper}.`,
    };
  }
}

/** Next earnings date near today. Finnhub → FMP → Alpha Vantage. Blocks Desk buys inside ±1 day. */
export async function fetchEarningsWindow(
  symbol: string,
  apiKey?: string,
  fmpApiKey?: string,
  alphaVantageApiKey?: string
): Promise<EarningsWindow | null> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey && !fmpApiKey && !alphaVantageApiKey) return null;

  try {
    const today = new Date();
    const from = new Date(today.getTime() - 2 * 86400000);
    const to = new Date(today.getTime() + 14 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const result = await fetchEarningsDates(
      upper,
      apiKey,
      fmt(from),
      fmt(to),
      fmpApiKey,
      alphaVantageApiKey
    );
    if (result.status !== 'ok' || !result.dates.length) return null;
    const next = result.dates[0];
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
    return { news: [], demo: false };
  }

  try {
    const to = new Date();
    const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(upper)}&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return { news: [], demo: false };
    const data = (await res.json()) as Array<{
      id?: number;
      headline?: string;
      datetime?: number;
      source?: string;
      url?: string;
    }>;
    if (!Array.isArray(data) || !data.length) {
      return { news: [], demo: false };
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
    return { news: [], demo: false };
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

function normalizeSymbols(symbols: string[]): string[] {
  return [
    ...new Set([...symbols.map((s) => s.toUpperCase().trim()), 'SPY', 'QQQ'].filter(Boolean)),
  ].sort();
}

function marketBundleKey(symbols: string[], options?: CandleApiOptions): string {
  const days = options?.days ?? 800;
  // Bucket days so Desk (400) and Dashboard refresh (800) share in-flight/cache work.
  const daysBucket = days <= 400 ? 400 : 800;
  return [
    normalizeSymbols(symbols).join(','),
    `d${daysBucket}`,
    options?.finnhubApiKey ? 'fh' : '-',
    options?.tiingoApiKey ? 'tg' : '-',
    options?.fmpApiKey ? 'fmp' : '-',
    options?.yahooProxyUrl ? 'yh' : '-',
    options?.alphaVantageApiKey ? 'av' : '-',
  ].join('|');
}

/** True when a preloaded bundle has quotes + enough bars for every requested equity + benchmarks. */
export function marketBundleCovers(
  bundle: MarketBundle | null | undefined,
  symbols: string[]
): boolean {
  if (!bundle) return false;
  for (const symbol of normalizeSymbols(symbols)) {
    if (!bundle.quotes[symbol]?.price) return false;
    if ((bundle.candles[symbol]?.length ?? 0) < 60) return false;
  }
  return true;
}

/**
 * Prefer a recent context bundle over another network pull.
 * Quotes can drift; candles/fundamentals are also TTL-cached underneath.
 */
export function shouldReuseMarketBundle(
  bundle: MarketBundle | null | undefined,
  symbols: string[],
  fetchedAt: number | null | undefined,
  maxAgeMs = MARKET_BUNDLE_REUSE_MAX_AGE_MS
): boolean {
  if (!fetchedAt || Date.now() - fetchedAt > maxAgeMs) return false;
  return marketBundleCovers(bundle, symbols);
}

async function fetchMarketBundleUncached(
  symbols: string[],
  options?: CandleApiOptions
): Promise<MarketBundle> {
  const apiKey = options?.finnhubApiKey;
  const unique = normalizeSymbols(symbols);
  const quoteWarnings: string[] = [];
  let quotes = await fetchQuotes(unique, apiKey, {
    yahooProxyUrl: options?.yahooProxyUrl,
    yahooProxyToken: options?.yahooProxyToken,
    warningsOut: quoteWarnings,
  });

  const bundle = await fetchCandleBundle(unique, {
    ...options,
    days: options?.days ?? 800,
  });

  // If Finnhub/Yahoo quote failed but live EOD exists, use last close as the quote.
  const lifted = preferLiveCandleQuotes(quotes, bundle.candles, bundle.sources);
  quotes = lifted.quotes;

  const equitySymbols = unique.filter((s) => !BENCHMARKS.has(s));

  const newsEntries = await Promise.all(
    equitySymbols.map(async (symbol) => {
      const result = await fetchCompanyNews(symbol, apiKey);
      return [symbol, result] as const;
    })
  );
  const news = Object.fromEntries(newsEntries.map(([symbol, result]) => [symbol, result.news]));
  const warnings = [...quoteWarnings, ...bundle.warnings];
  for (const w of lifted.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  const earningsEntries = await Promise.all(
    equitySymbols.map(async (symbol) => {
      const window = await fetchEarningsWindow(
        symbol,
        apiKey,
        options?.fmpApiKey,
        options?.alphaVantageApiKey
      );
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
  } else {
    warnings.push('No FMP key — company fundamentals unavailable.');
  }

  const liveSources = Object.values(bundle.sources).filter(isLiveCandleSource);
  const uniqueSources = [...new Set(liveSources)];
  const sourceSummary: CandleSource | 'mixed' =
    uniqueSources.length === 1
      ? uniqueSources[0]
      : uniqueSources.length > 1
        ? 'mixed'
        : 'none';

  return {
    quotes,
    candles: bundle.candles,
    candleSources: bundle.sources,
    news,
    fundamentals,
    earningsDates,
    sourceSummary,
    warnings,
  };
}

export async function fetchMarketBundle(
  symbols: string[],
  options?: CandleApiOptions
): Promise<MarketBundle> {
  const key = marketBundleKey(symbols, options);
  return marketBundleInflight.run(key, () => fetchMarketBundleUncached(symbols, options));
}

/** Test helper. */
export function clearMarketBundleInflight() {
  marketBundleInflight.clear();
}
