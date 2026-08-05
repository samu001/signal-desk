import { Candle, FundamentalSnapshot } from '@/types/trading';
import { createInflightMap, createTtlCache } from '@/lib/ttlCache';

const FMP_BASE = 'https://financialmodelingprep.com/stable';

/** Fundamentals move slowly — reuse profile/TTM payloads for half a day. */
export const FUNDAMENTALS_TTL_MS = 12 * 60 * 60 * 1000;

const fundamentalsCache = createTtlCache<FundamentalSnapshot>(FUNDAMENTALS_TTL_MS);
const fundamentalsInflight = createInflightMap<FundamentalSnapshot | null>();

/** Test helper — clear fundamentals TTL between suites. */
export function clearFundamentalsCache() {
  fundamentalsCache.clear();
  fundamentalsInflight.clear();
}

/** Whether the bars carry split/dividend adjustment. */
export type FmpAdjustment = 'adjusted' | 'raw';

export type FmpCandleResult = {
  candles: Candle[];
  warning?: string;
  /** 'adjusted' = dividend-adjusted endpoint; 'raw' = unadjusted /full fallback. */
  adjusted: FmpAdjustment;
};

export type { FundamentalSnapshot };

function toDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Adjusted-endpoint availability.
 * Per-symbol blocklist: FMP rejects some symbols (e.g. index ETFs) with 402
 * even on plans where dividend-adjusted works for others — one symbol must not
 * poison the rest. Session-wide kill switch: only for plan-wide rejections
 * (e.g. "Exclusive Endpoint: upgrade your plan") where no symbol will succeed.
 */
let adjustedEndpointUnavailable = false;
const adjustedUnavailableBySymbol = new Set<string>();

function isPlanWideAdjustedRejection(reason: string): boolean {
  return /exclusive endpoint|upgrade your plan|special endpoint|legacy endpoint/i.test(reason);
}

/** Test helper — forget adjusted-endpoint availability. */
export function resetFmpAdjustedAvailability() {
  adjustedEndpointUnavailable = false;
  adjustedUnavailableBySymbol.clear();
}

type FmpEodRow = {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjOpen?: number;
  adjHigh?: number;
  adjLow?: number;
  adjClose?: number;
  volume?: number;
};

function rowsToCandles(rows: FmpEodRow[], adjusted: boolean): Candle[] {
  return rows
    .map((row) => ({
      time: row.date ? Math.floor(new Date(`${row.date}T16:00:00Z`).getTime() / 1000) : 0,
      // Prefer adj* fields on the adjusted endpoint, tolerating raw field names
      // (same graceful pattern as the Tiingo adapter).
      open: Number(adjusted ? (row.adjOpen ?? row.open) : row.open) || 0,
      high: Number(adjusted ? (row.adjHigh ?? row.high) : row.high) || 0,
      low: Number(adjusted ? (row.adjLow ?? row.low) : row.low) || 0,
      close: Number(adjusted ? (row.adjClose ?? row.close) : row.close) || 0,
      volume: Number(row.volume) || 0,
    }))
    .filter((c) => c.close > 0 && c.time > 0)
    .sort((a, b) => a.time - b.time);
}

type FmpEodResponse =
  | { kind: 'rows'; rows: FmpEodRow[] }
  | { kind: 'ratelimit'; warning: string }
  | { kind: 'auth'; warning: string }
  /** Endpoint rejected for this key/plan — safe to fall back to another endpoint. */
  | { kind: 'unavailable'; warning: string }
  | { kind: 'error'; warning: string };

async function requestFmpEod(url: string): Promise<FmpEodResponse> {
  const res = await fetch(url);
  const text = await res.text();

  if (res.status === 429 || /rate.?limit|limit reach|too many requests|exceeded your/i.test(text)) {
    return {
      kind: 'ratelimit',
      warning: `FMP rate limit${res.status === 429 ? ` (HTTP 429)` : ''} — wait before Refresh signals, or slow down multi-ticker scans.`,
    };
  }
  if (res.status === 401) {
    return { kind: 'auth', warning: 'FMP auth failed — check your API key in Settings.' };
  }
  if (!res.ok) {
    if (res.status === 402 || res.status === 403 || res.status === 404) {
      return {
        kind: 'unavailable',
        warning: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`,
      };
    }
    return {
      kind: 'error',
      warning: `FMP candles HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`,
    };
  }

  let data: FmpEodRow[] | { 'Error Message'?: string; error?: string; message?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { kind: 'error', warning: 'FMP returned non-JSON candle payload.' };
  }

  if (!Array.isArray(data)) {
    const msg = String(
      data['Error Message'] || data.error || data.message || 'FMP returned an unexpected candle payload.'
    );
    if (/rate.?limit|limit reach|exceeded|quota/i.test(msg)) {
      return { kind: 'ratelimit', warning: `FMP rate limit: ${msg.slice(0, 140)}` };
    }
    if (/exclusive|subscription|upgrade|premium|plan|special endpoint|legacy/i.test(msg)) {
      return { kind: 'unavailable', warning: msg.slice(0, 140) };
    }
    return { kind: 'error', warning: msg };
  }

  return { kind: 'rows', rows: data };
}

/**
 * FMP stable EOD — solid free/cheap daily history for backtests when Tiingo isn't set.
 * Prefers the dividend-adjusted endpoint (split+dividend adjusted OHLC, same
 * one-call-per-symbol shape as /full). Falls back to raw /full bars — clearly
 * flagged — only when the key's plan rejects the adjusted endpoint; that
 * discovery costs a single extra call once per session, never per symbol.
 */
export async function fetchFmpDailyCandles(
  symbol: string,
  apiKey: string,
  days = 400
): Promise<FmpCandleResult> {
  const upper = symbol.toUpperCase().trim();
  try {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const range = `symbol=${encodeURIComponent(upper)}&from=${toDate(start)}&to=${toDate(end)}&apikey=${encodeURIComponent(apiKey)}`;

    let fallbackNote: string | null = null;
    if (!adjustedEndpointUnavailable && !adjustedUnavailableBySymbol.has(upper)) {
      const adj = await requestFmpEod(`${FMP_BASE}/historical-price-eod/dividend-adjusted?${range}`);
      if (adj.kind === 'rows') {
        const candles = rowsToCandles(adj.rows, true);
        return {
          candles,
          adjusted: 'adjusted',
          warning: `FMP EOD (${candles.length} adjusted daily bars).`,
        };
      }
      // Rate limit / auth: do not burn a second FMP call (raw) for the same outcome.
      if (adj.kind === 'ratelimit' || adj.kind === 'auth') {
        return { candles: [], adjusted: 'adjusted', warning: adj.warning };
      }
      if (adj.kind === 'unavailable') {
        if (isPlanWideAdjustedRejection(adj.warning)) {
          adjustedEndpointUnavailable = true;
        } else {
          adjustedUnavailableBySymbol.add(upper);
        }
      }
      fallbackNote = adj.warning;
    }

    const raw = await requestFmpEod(`${FMP_BASE}/historical-price-eod/full?${range}`);
    if (raw.kind !== 'rows') {
      return { candles: [], adjusted: 'raw', warning: raw.warning };
    }
    const candles = rowsToCandles(raw.rows, false);
    return {
      candles,
      adjusted: 'raw',
      warning: `FMP adjusted EOD unavailable${
        fallbackNote ? ` (${fallbackNote})` : ' for this key'
      } — using RAW unadjusted bars (${candles.length}); dividends/splits are not adjusted.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const corsLike = /failed to fetch|networkerror|load failed|cors/i.test(msg);
    return {
      candles: [],
      adjusted: 'raw',
      warning: corsLike
        ? 'FMP request blocked in this browser (network/CORS) — check key and free-tier limits.'
        : `FMP candle request failed: ${msg.slice(0, 120)}`,
    };
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export type FmpEarningsFetchResult = {
  dates: string[];
  status: 'ok' | 'empty' | 'error' | 'no_key';
  detail: string;
};

/**
 * Historical + upcoming earnings announcement dates for blackout windows.
 * Stable `/earnings?symbol=` — filter to [fromDate, toDate] (inclusive).
 */
export async function fetchFmpEarningsDates(
  symbol: string,
  apiKey: string | undefined,
  fromDate: string,
  toDate: string
): Promise<FmpEarningsFetchResult> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey?.trim() || !upper) {
    return {
      dates: [],
      status: 'no_key',
      detail: 'No FMP key — earnings calendar unavailable.',
    };
  }

  try {
    const url = `${FMP_BASE}/earnings?symbol=${encodeURIComponent(upper)}&apikey=${encodeURIComponent(
      apiKey.trim()
    )}`;
    const res = await fetch(url);
    const text = await res.text();

    if (res.status === 429 || /rate.?limit|limit reach|too many requests|exceeded your/i.test(text)) {
      return {
        dates: [],
        status: 'error',
        detail: `FMP earnings rate-limited${res.status === 429 ? ' (HTTP 429)' : ''} — blackout fails closed for ${upper}.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        dates: [],
        status: 'error',
        detail: `FMP earnings auth failed (HTTP ${res.status}) — check FMP key.`,
      };
    }
    if (!res.ok) {
      return {
        dates: [],
        status: 'error',
        detail: `FMP earnings HTTP ${res.status} — blackout fails closed for ${upper}.`,
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      return {
        dates: [],
        status: 'error',
        detail: `FMP earnings returned non-JSON — blackout fails closed for ${upper}.`,
      };
    }

    if (!Array.isArray(data)) {
      const msg =
        data && typeof data === 'object'
          ? String(
              (data as { 'Error Message'?: string; error?: string; message?: string })['Error Message'] ||
                (data as { error?: string }).error ||
                (data as { message?: string }).message ||
                'unexpected payload'
            )
          : 'unexpected payload';
      if (/rate.?limit|limit reach|exceeded|quota/i.test(msg)) {
        return {
          dates: [],
          status: 'error',
          detail: `FMP earnings rate-limited — blackout fails closed for ${upper}.`,
        };
      }
      return {
        dates: [],
        status: 'error',
        detail: `FMP earnings error: ${msg.slice(0, 120)} — blackout fails closed for ${upper}.`,
      };
    }

    const from = fromDate.slice(0, 10);
    const to = toDate.slice(0, 10);
    const dates = [
      ...new Set(
        data
          .map((row) => {
            const r = row as { date?: string; symbol?: string };
            const d = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
            const sym = typeof r.symbol === 'string' ? r.symbol.toUpperCase() : upper;
            if (sym !== upper || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
            if (d < from || d > to) return null;
            return d;
          })
          .filter((d): d is string => Boolean(d))
      ),
    ].sort();

    if (!dates.length) {
      return {
        dates: [],
        status: 'empty',
        detail: `FMP returned no earnings dates for ${upper} in ${from}…${to} — blackout fails closed.`,
      };
    }
    return {
      dates,
      status: 'ok',
      detail: `${dates.length} earnings date${dates.length === 1 ? '' : 's'} via FMP.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      dates: [],
      status: 'error',
      detail: `FMP earnings request failed (${msg.slice(0, 80)}) — blackout fails closed for ${upper}.`,
    };
  }
}

/**
 * Lightweight “what to buy” fundamentals from FMP profile + TTM metrics/ratios.
 * Successful snapshots are TTL-cached (12h); concurrent fetches coalesce.
 */
export async function fetchFmpFundamentals(
  symbol: string,
  apiKey: string
): Promise<FundamentalSnapshot | null> {
  const upper = symbol.toUpperCase().trim();
  const cached = fundamentalsCache.get(upper);
  if (cached) return cached;

  return fundamentalsInflight.run(upper, async () => {
    const again = fundamentalsCache.get(upper);
    if (again) return again;

    try {
      const [profileRaw, metricsRaw, ratiosRaw] = await Promise.all([
        fetchJson(
          `${FMP_BASE}/profile?symbol=${encodeURIComponent(upper)}&apikey=${encodeURIComponent(apiKey)}`
        ),
        fetchJson(
          `${FMP_BASE}/key-metrics-ttm?symbol=${encodeURIComponent(upper)}&apikey=${encodeURIComponent(apiKey)}`
        ),
        fetchJson(
          `${FMP_BASE}/ratios-ttm?symbol=${encodeURIComponent(upper)}&apikey=${encodeURIComponent(apiKey)}`
        ),
      ]);

      const profile = Array.isArray(profileRaw) ? (profileRaw[0] as Record<string, unknown>) : null;
      const metrics = Array.isArray(metricsRaw) ? (metricsRaw[0] as Record<string, unknown>) : null;
      const ratios = Array.isArray(ratiosRaw) ? (ratiosRaw[0] as Record<string, unknown>) : null;

      if (!profile && !metrics && !ratios) return null;

      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

      const snap: FundamentalSnapshot = {
        symbol: upper,
        name: typeof profile?.companyName === 'string' ? profile.companyName : null,
        sector: typeof profile?.sector === 'string' ? profile.sector : null,
        industry: typeof profile?.industry === 'string' ? profile.industry : null,
        marketCap: num(profile?.mktCap) ?? num(profile?.marketCap),
        pe: num(ratios?.priceToEarningsRatioTTM) ?? num(metrics?.peRatioTTM),
        pb: num(ratios?.priceToBookRatioTTM) ?? num(metrics?.pbRatioTTM),
        profitMargin: num(ratios?.netProfitMarginTTM) ?? num(metrics?.netProfitMarginTTM),
        revenueGrowth: num(ratios?.revenueGrowthTTM) ?? num(metrics?.revenueGrowthTTM),
        roe: num(ratios?.returnOnEquityTTM) ?? num(metrics?.roeTTM),
        debtToEquity: num(ratios?.debtToEquityRatioTTM) ?? num(metrics?.debtToEquityTTM),
        source: 'fmp',
      };
      fundamentalsCache.set(upper, snap);
      return snap;
    } catch {
      return null;
    }
  });
}

export async function fetchFmpFundamentalsBundle(
  symbols: string[],
  apiKey: string
): Promise<{ fundamentals: Record<string, FundamentalSnapshot>; warnings: string[] }> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const fundamentals: Record<string, FundamentalSnapshot> = {};
  const warnings: string[] = [];

  // Keep sequential-ish batches small to respect free daily caps.
  for (const symbol of unique) {
    if (symbol === 'SPY' || symbol === 'QQQ') continue;
    const snap = await fetchFmpFundamentals(symbol, apiKey);
    if (snap) fundamentals[symbol] = snap;
  }

  if (!Object.keys(fundamentals).length) {
    warnings.push('FMP fundamentals returned no rows — check key/limits.');
  }

  return { fundamentals, warnings };
}

/** Simple quality flags for “what to buy” context — not hard trade blockers. */
export function fundamentalFlags(f: FundamentalSnapshot | null | undefined): {
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  detail: string;
}[] {
  if (!f) return [];
  const flags: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; detail: string }[] = [];

  if (f.pe != null) {
    if (f.pe > 0 && f.pe < 25) flags.push({ label: `PE ${f.pe.toFixed(1)}`, tone: 'good', detail: 'Reasonable PE' });
    else if (f.pe >= 25 && f.pe < 45)
      flags.push({ label: `PE ${f.pe.toFixed(1)}`, tone: 'warn', detail: 'Rich valuation' });
    else if (f.pe >= 45 || f.pe < 0)
      flags.push({ label: `PE ${f.pe.toFixed(1)}`, tone: 'bad', detail: 'Stretched / negative PE' });
  }

  if (f.profitMargin != null) {
    const pct = f.profitMargin * (Math.abs(f.profitMargin) <= 1 ? 100 : 1);
    if (pct >= 15) flags.push({ label: `Margin ${pct.toFixed(0)}%`, tone: 'good', detail: 'Healthy margin' });
    else if (pct < 5)
      flags.push({ label: `Margin ${pct.toFixed(0)}%`, tone: 'warn', detail: 'Thin profitability' });
  }

  if (f.debtToEquity != null && f.debtToEquity > 2) {
    flags.push({
      label: `D/E ${f.debtToEquity.toFixed(1)}`,
      tone: 'warn',
      detail: 'Elevated leverage',
    });
  }

  if (f.roe != null) {
    const pct = f.roe * (Math.abs(f.roe) <= 1 ? 100 : 1);
    if (pct >= 15) flags.push({ label: `ROE ${pct.toFixed(0)}%`, tone: 'good', detail: 'Solid ROE' });
  }

  return flags.slice(0, 3);
}
