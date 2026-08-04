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

export type FmpCandleResult = {
  candles: Candle[];
  warning?: string;
};

export type { FundamentalSnapshot };

function toDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * FMP stable EOD — solid free/cheap daily history for backtests when Tiingo isn't set.
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
    const url = `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(upper)}&from=${toDate(start)}&to=${toDate(end)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const text = await res.text();

    if (res.status === 429 || /rate.?limit|limit reach|too many requests|exceeded your/i.test(text)) {
      return {
        candles: [],
        warning: `FMP rate limit${res.status === 429 ? ` (HTTP 429)` : ''} — wait before Refresh signals, or slow down multi-ticker scans.`,
      };
    }

    if (!res.ok) {
      return {
        candles: [],
        warning:
          res.status === 401 || res.status === 403
            ? 'FMP auth failed — check your API key in Settings.'
            : `FMP candles HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`,
      };
    }

    let data:
      | Array<{
          date?: string;
          open?: number;
          high?: number;
          low?: number;
          close?: number;
          volume?: number;
        }>
      | { 'Error Message'?: string; error?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return { candles: [], warning: 'FMP returned non-JSON candle payload.' };
    }

    if (!Array.isArray(data)) {
      const msg =
        (data as { 'Error Message'?: string; error?: string })['Error Message'] ||
        (data as { error?: string }).error ||
        'FMP returned an unexpected candle payload.';
      const limit = /rate.?limit|limit reach|exceeded|quota/i.test(String(msg));
      return {
        candles: [],
        warning: limit
          ? `FMP rate limit: ${String(msg).slice(0, 140)}`
          : String(msg),
      };
    }

    const candles: Candle[] = data
      .map((row) => ({
        time: row.date ? Math.floor(new Date(`${row.date}T16:00:00Z`).getTime() / 1000) : 0,
        open: Number(row.open) || 0,
        high: Number(row.high) || 0,
        low: Number(row.low) || 0,
        close: Number(row.close) || 0,
        volume: Number(row.volume) || 0,
      }))
      .filter((c) => c.close > 0 && c.time > 0)
      .sort((a, b) => a.time - b.time);

    return {
      candles,
      warning: `FMP EOD (${candles.length} daily bars).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const corsLike = /failed to fetch|networkerror|load failed|cors/i.test(msg);
    return {
      candles: [],
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
