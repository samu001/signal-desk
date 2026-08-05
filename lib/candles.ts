import { Platform } from 'react-native';

import { fetchAlphaVantageDailyCandles } from '@/lib/alphavantage';
import {
  clearPersistedEodCache,
  loadPersistedCandles,
  loadPersistedCooldowns,
  persistCandle,
  persistProviderCooldown,
} from '@/lib/candleDiskCache';
import { fetchFmpDailyCandles } from '@/lib/fmp';
import { fetchTiingoDailyCandles } from '@/lib/tiingo';
import { fetchYahooDailyCandles } from '@/lib/yahoo';
import { createInflightMap, createTtlCache } from '@/lib/ttlCache';
import { Candle } from '@/types/trading';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

/** Rematerialize / quote-lift threshold (legacy demo helpers + live quote salvage). */
export const DEMO_QUOTE_MISMATCH_PCT = 0.15;

/** Daily bars barely change intraday — reuse live EOD for half a day. */
export const CANDLE_TTL_MS = 12 * 60 * 60 * 1000;
/** SPY/QQQ are shared across Desk, Dashboard, and backtests — keep longer. */
export const BENCHMARK_CANDLE_TTL_MS = 24 * 60 * 60 * 1000;
/** After a provider 429, skip that provider (and AV cascade) briefly. */
export const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;

export const BENCHMARK_SYMBOLS = new Set(['SPY', 'QQQ']);

/** `'none'` = live providers failed; no synthetic bars. `'demo'` kept for tests / legacy cache only. */
export type CandleSource =
  | 'tiingo'
  | 'fmp'
  | 'yahoo'
  | 'finnhub'
  | 'alphavantage'
  | 'demo'
  | 'none';

/** Split/dividend adjustment of a bar series, when known. */
export type AdjustmentStatus = 'adjusted' | 'raw' | 'unknown';

/** An overnight move big enough to look like an unadjusted split artifact. */
export type SuspectGap = { date: string; pct: number };

export type CandleFetchResult = {
  candles: Candle[];
  source: CandleSource;
  warnings: string[];
  /** How the bars are adjusted. Derived from source for older cache entries. */
  adjusted?: AdjustmentStatus;
  /** Overnight moves beyond ±40% — data artifacts on raw/unknown feeds. */
  suspectGaps?: SuspectGap[];
};

export function isLiveCandleSource(source: CandleSource | string | undefined): boolean {
  return Boolean(source && source !== 'demo' && source !== 'none');
}

/**
 * Adjustment by provider when a result predates the `adjusted` field (old disk
 * cache): Tiingo bars have always come from adj* fields; FMP used the raw /full
 * endpoint before Aug 2026; the Yahoo proxy worker is out-of-repo (unverified);
 * Finnhub and Alpha Vantage free endpoints are unadjusted.
 */
const ADJUSTMENT_BY_SOURCE: Partial<Record<CandleSource, AdjustmentStatus>> = {
  tiingo: 'adjusted',
  fmp: 'raw',
  yahoo: 'unknown',
  finnhub: 'raw',
  alphavantage: 'raw',
};

export const SUSPECT_GAP_THRESHOLD = 0.4;

/**
 * Overnight moves beyond ±threshold vs the prior close (checked on both the
 * open and the close). Real one-day moves this size are rare; on raw or
 * unknown-adjustment feeds they are usually unadjusted splits (2:1 = −50%,
 * 10:1 = −90%), which would otherwise print catastrophic fake trades.
 */
export function detectSuspectGaps(
  candles: Candle[],
  threshold = SUSPECT_GAP_THRESHOLD
): SuspectGap[] {
  const gaps: SuspectGap[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    if (!(prevClose > 0)) continue;
    const openMove = candles[i].open > 0 ? candles[i].open / prevClose - 1 : 0;
    const closeMove = candles[i].close / prevClose - 1;
    const move = Math.abs(openMove) >= Math.abs(closeMove) ? openMove : closeMove;
    if (Math.abs(move) > threshold) {
      gaps.push({
        date: new Date(candles[i].time * 1000).toISOString().slice(0, 10),
        pct: move,
      });
    }
  }
  return gaps;
}

function isSuspectGapNote(w: string): boolean {
  return /possible unadjusted split/i.test(w);
}

/**
 * Attach adjustment status + suspect-gap scan to a resolved result (fresh or
 * cached). Warns only when big gaps land on non-adjusted bars — on adjusted
 * feeds a huge move is likely a real crash/squeeze, not an artifact.
 */
function withDataQuality(symbol: string, result: CandleFetchResult): CandleFetchResult {
  if (!isLiveCandleSource(result.source) || !result.candles.length) return result;
  const adjusted = result.adjusted ?? ADJUSTMENT_BY_SOURCE[result.source] ?? 'unknown';
  const suspectGaps = detectSuspectGaps(result.candles);
  const warnings = result.warnings.filter((w) => !isSuspectGapNote(w));
  if (suspectGaps.length && adjusted !== 'adjusted') {
    const worst = suspectGaps.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
    warnings.push(
      `${symbol}: ${suspectGaps.length} overnight move(s) beyond ±40% on ${
        adjusted === 'raw' ? 'RAW unadjusted' : 'unknown-adjustment'
      } ${result.source} bars (worst ${worst.pct >= 0 ? '+' : ''}${(worst.pct * 100).toFixed(
        0
      )}% on ${worst.date}) — possible unadjusted split; backtests on this feed are suspect.`
    );
  }
  return { ...result, adjusted, suspectGaps, warnings };
}

function noDataResult(warnings: string[]): CandleFetchResult {
  return { candles: [], source: 'none', warnings };
}

export type CandleApiOptions = {
  tiingoApiKey?: string;
  fmpApiKey?: string;
  finnhubApiKey?: string;
  alphaVantageApiKey?: string;
  /** Cloudflare Worker base URL for Yahoo EOD. */
  yahooProxyUrl?: string;
  yahooProxyToken?: string;
  days?: number;
};

const candleTtlCache = createTtlCache<CandleFetchResult>(CANDLE_TTL_MS);
const benchmarkTtlCache = createTtlCache<CandleFetchResult>(BENCHMARK_CANDLE_TTL_MS);
const candleInflight = createInflightMap<CandleFetchResult>();
/** provider → last rate-limit warning while cooling down */
const providerCooldown = createTtlCache<string>(PROVIDER_COOLDOWN_MS);

function isRateLimitNote(note?: string | null): boolean {
  if (!note) return false;
  return /rate limit|429|Limit Reach|too many requests|exceeded your|Thank you for using Alpha/i.test(
    note
  );
}

function markProviderCooldown(
  provider: 'tiingo' | 'fmp' | 'yahoo' | 'finnhub' | 'alphavantage',
  warning?: string
): boolean {
  if (!isRateLimitNote(warning)) return false;
  const note = warning!.slice(0, 160);
  providerCooldown.set(provider, note);
  persistProviderCooldown(provider, note, Date.now() + PROVIDER_COOLDOWN_MS);
  return true;
}

function providerCooling(
  provider: 'tiingo' | 'fmp' | 'yahoo' | 'finnhub' | 'alphavantage'
): string | undefined {
  return providerCooldown.get(provider);
}

let diskHydratePromise: Promise<void> | null = null;

/** Pull live EOD + provider cooldowns from AsyncStorage into memory (once per process). */
function hydrateFromDisk(): Promise<void> {
  if (!diskHydratePromise) {
    diskHydratePromise = (async () => {
      const [candles, cooldowns] = await Promise.all([
        loadPersistedCandles(),
        loadPersistedCooldowns(),
      ]);
      for (const [key, entry] of Object.entries(candles)) {
        if (!isLiveCandleSource(entry.value.source) || entry.value.candles.length < 60) continue;
        const result: CandleFetchResult = {
          candles: entry.value.candles,
          source: entry.value.source as CandleSource,
          warnings: entry.value.warnings ?? [],
          adjusted: entry.value.adjusted as AdjustmentStatus | undefined,
        };
        if (key.startsWith('bench:')) {
          benchmarkTtlCache.setUntil(key, result, entry.expiresAt);
        } else {
          candleTtlCache.setUntil(key, result, entry.expiresAt);
        }
      }
      for (const [provider, entry] of Object.entries(cooldowns)) {
        providerCooldown.setUntil(provider, entry.note, entry.expiresAt);
      }
    })().catch(() => {
      // Disk hydrate is best-effort; network path still works.
    });
  }
  return diskHydratePromise;
}

function candleCacheKey(symbol: string, options?: CandleApiOptions): string {
  const upper = symbol.toUpperCase().trim();
  const flags = [
    options?.tiingoApiKey ? 't' : '-',
    options?.fmpApiKey ? 'f' : '-',
    options?.yahooProxyUrl ? 'y' : '-',
    options?.finnhubApiKey ? 'h' : '-',
    options?.alphaVantageApiKey ? 'a' : '-',
  ].join('');
  // Benchmarks share one slot per key-set (ignore days) so Desk/backtests reuse.
  if (BENCHMARK_SYMBOLS.has(upper)) {
    return `bench:${upper}:${flags}`;
  }
  return `${upper}:${flags}`;
}

function cacheGet(key: string, symbol: string): CandleFetchResult | undefined {
  if (BENCHMARK_SYMBOLS.has(symbol.toUpperCase())) {
    return benchmarkTtlCache.get(key) ?? candleTtlCache.get(key);
  }
  return candleTtlCache.get(key);
}

function cacheSet(key: string, symbol: string, value: CandleFetchResult) {
  const ttlMs = BENCHMARK_SYMBOLS.has(symbol.toUpperCase())
    ? BENCHMARK_CANDLE_TTL_MS
    : CANDLE_TTL_MS;
  if (BENCHMARK_SYMBOLS.has(symbol.toUpperCase())) {
    benchmarkTtlCache.set(key, value);
  } else {
    candleTtlCache.set(key, value);
  }
  persistCandle(key, value, Date.now() + ttlMs);
}

/** Test helper — clear candle TTL / cooldowns / disk between suites. */
export async function clearCandleCache() {
  candleTtlCache.clear();
  benchmarkTtlCache.clear();
  candleInflight.clear();
  providerCooldown.clear();
  diskHydratePromise = null;
  await clearPersistedEodCache();
}

/**
 * Drop in-memory EOD only so the next resolve rehydrates from AsyncStorage.
 * Used to prove disk survival across "reload".
 */
export function dropCandleMemoryCacheForTests() {
  candleTtlCache.clear();
  benchmarkTtlCache.clear();
  candleInflight.clear();
  providerCooldown.clear();
  diskHydratePromise = null;
}

export function clearProviderCooldowns() {
  providerCooldown.clear();
}

/**
 * Legacy helper kept for unit tests. Production never emits `source: 'demo'`.
 * When called with demo + quote, previously re-anchored synthetic bars; now
 * returns empty history with a No data warning.
 */
export function alignDemoCandlesToQuote(
  symbol: string,
  candles: Candle[],
  quotePrice: number | undefined,
  source: CandleSource,
  /** Why live EOD failed — rate limit, CORS, auth, missing keys, etc. */
  liveFailureHint?: string | null
): { candles: Candle[]; reanchored: boolean; warning: string | null } {
  if (source !== 'demo' && source !== 'none') {
    return { candles, reanchored: false, warning: null };
  }
  const upper = symbol.toUpperCase().trim();
  const hint =
    liveFailureHint?.trim() ||
    'live EOD unavailable — check Tiingo/FMP (rate limit, CORS on web, or auth)';
  void quotePrice;
  return {
    candles: [],
    reanchored: false,
    warning: `${upper}: No data — ${hint}.`,
  };
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
 * Prefer long clean EOD first:
 * Web: FMP → Yahoo proxy → Finnhub → Alpha Vantage → none (Tiingo skipped for CORS).
 * Native: Tiingo → FMP → Yahoo proxy → Finnhub → Alpha Vantage → none.
 * Never invents synthetic bars. Live successes are TTL-cached (12h); identical
 * in-flight requests coalesce.
 */
function pushProviderNote(warnings: string[], note?: string) {
  // Keep failure / rate-limit / CORS notes; drop noisy success "EOD (N bars)" lines.
  if (!note) return;
  if (/\bEOD\s*\(\d+\s/i.test(note) && !/rate limit|fail|HTTP|auth|cors|blocked/i.test(note)) {
    return;
  }
  warnings.push(note);
}

async function fetchDailyCandlesResolvedUncached(
  symbol: string,
  options?: CandleApiOptions
): Promise<CandleFetchResult> {
  const upper = symbol.toUpperCase().trim();
  const days = options?.days ?? 800;
  const warnings: string[] = [];
  // Tiingo's browser API is CORS-blocked; on web prefer FMP first and skip Tiingo.
  const onWeb = Platform.OS === 'web';
  /** Once any paid/free EOD source 429s, stop cascading into Alpha Vantage. */
  let hitRateLimit = false;

  const tryTiingo = async () => {
    if (!options?.tiingoApiKey) {
      warnings.push('No Tiingo token — skipping best free long-history EOD source.');
      return null;
    }
    if (onWeb) {
      warnings.push(
        'Tiingo skipped on web (CORS) — token ignored here; use FMP for browser EOD, or Expo Go / native for Tiingo.'
      );
      return null;
    }
    const cool = providerCooling('tiingo');
    if (cool) {
      warnings.push(`Tiingo on cooldown after rate limit — ${cool}`);
      hitRateLimit = true;
      return null;
    }
    const tiingo = await fetchTiingoDailyCandles(upper, options.tiingoApiKey, days);
    pushProviderNote(warnings, tiingo.warning);
    if (markProviderCooldown('tiingo', tiingo.warning)) hitRateLimit = true;
    if (tiingo.candles.length >= 60) {
      return {
        candles: tiingo.candles,
        source: 'tiingo' as const,
        warnings,
        adjusted: 'adjusted' as const,
      };
    }
    if (tiingo.candles.length > 0) {
      warnings.push(`Tiingo only returned ${tiingo.candles.length} bars; trying fallbacks.`);
    }
    return null;
  };

  const tryFmp = async () => {
    if (!options?.fmpApiKey) {
      warnings.push('No FMP key — skipping FMP EOD fallback.');
      return null;
    }
    const cool = providerCooling('fmp');
    if (cool) {
      warnings.push(`FMP on cooldown after rate limit — ${cool}`);
      hitRateLimit = true;
      return null;
    }
    const fmp = await fetchFmpDailyCandles(upper, options.fmpApiKey, Math.min(days, 400));
    pushProviderNote(warnings, fmp.warning);
    if (markProviderCooldown('fmp', fmp.warning)) hitRateLimit = true;
    if (fmp.candles.length >= 60) {
      return { candles: fmp.candles, source: 'fmp' as const, warnings, adjusted: fmp.adjusted };
    }
    if (fmp.candles.length > 0) {
      warnings.push(`FMP only returned ${fmp.candles.length} bars; trying fallbacks.`);
    }
    return null;
  };

  const tryYahoo = async () => {
    if (!options?.yahooProxyUrl?.trim()) {
      warnings.push('No Yahoo proxy URL — skipping Yahoo EOD fallback.');
      return null;
    }
    const cool = providerCooling('yahoo');
    if (cool) {
      warnings.push(`Yahoo proxy on cooldown after rate limit — ${cool}`);
      return null;
    }
    const yahoo = await fetchYahooDailyCandles(
      upper,
      options.yahooProxyUrl,
      days,
      options.yahooProxyToken
    );
    pushProviderNote(warnings, yahoo.warning);
    markProviderCooldown('yahoo', yahoo.warning);
    if (yahoo.candles.length >= 60) {
      // Proxy worker is out-of-repo; whether its bars are adjusted is unverified.
      return {
        candles: yahoo.candles,
        source: 'yahoo' as const,
        warnings,
        adjusted: 'unknown' as const,
      };
    }
    if (yahoo.candles.length > 0) {
      warnings.push(`Yahoo only returned ${yahoo.candles.length} bars; trying fallbacks.`);
    }
    return null;
  };

  // Web: FMP → Yahoo → …. Native: Tiingo → FMP → Yahoo → ….
  // Yahoo is tried even after FMP/Tiingo 429 (does not burn those quotas).
  if (onWeb) {
    const fmpHit = await tryFmp();
    if (fmpHit) return fmpHit;
    await tryTiingo(); // records the CORS skip note only
  } else {
    const tiingoHit = await tryTiingo();
    if (tiingoHit) return tiingoHit;
    if (!hitRateLimit) {
      const fmpHit = await tryFmp();
      if (fmpHit) return fmpHit;
    } else {
      warnings.push('Skipping FMP after upstream rate limit — protecting free-tier caps.');
    }
  }

  const yahooHit = await tryYahoo();
  if (yahooHit) return yahooHit;

  if (hitRateLimit) {
    warnings.push(
      'Skipping Finnhub/Alpha Vantage candle fallbacks after rate limit (avoids burning the ~25/day AV cap).'
    );
    warnings.push(
      options?.tiingoApiKey || options?.fmpApiKey || options?.yahooProxyUrl
        ? 'No data — live EOD unavailable until provider cooldown ends (or check Yahoo proxy in Settings).'
        : 'No data — add Tiingo/FMP keys or a Yahoo proxy URL in Settings for real bars.'
    );
    return noDataResult(warnings);
  }

  if (options?.finnhubApiKey) {
    const cool = providerCooling('finnhub');
    if (cool) {
      warnings.push(`Finnhub candles on cooldown after rate limit — ${cool}`);
    } else {
      try {
        const fh = await fetchFinnhubCandles(upper, options.finnhubApiKey, Math.min(days, 180));
        if (fh.warning) warnings.push(fh.warning);
        if (markProviderCooldown('finnhub', fh.warning)) hitRateLimit = true;
        if (fh.candles.length >= 60) {
          return { candles: fh.candles, source: 'finnhub', warnings, adjusted: 'raw' };
        }
        if (fh.candles.length > 0) {
          warnings.push(`Finnhub only returned ${fh.candles.length} bars; trying fallbacks.`);
        }
      } catch {
        warnings.push('Finnhub candle request failed.');
      }
    }
  }

  if (hitRateLimit) {
    warnings.push('Skipping Alpha Vantage after rate limit.');
  } else if (options?.alphaVantageApiKey) {
    const cool = providerCooling('alphavantage');
    if (cool) {
      warnings.push(`Alpha Vantage on cooldown after rate limit — ${cool}`);
    } else {
      const av = await fetchAlphaVantageDailyCandles(upper, options.alphaVantageApiKey);
      if (av.warning) warnings.push(av.warning);
      markProviderCooldown('alphavantage', av.warning);
      if (av.candles.length >= 60) {
        return { candles: av.candles, source: 'alphavantage', warnings, adjusted: 'raw' };
      }
      if (av.candles.length > 0) {
        warnings.push(
          `Alpha Vantage only returned ${av.candles.length} bars; not enough history.`
        );
      }
    }
  }

  warnings.push(
    options?.tiingoApiKey || options?.fmpApiKey || options?.yahooProxyUrl
      ? 'No data — all live EOD sources failed (see Tiingo/FMP/Yahoo warnings above).'
      : 'No data — add Tiingo/FMP keys or a Yahoo proxy URL in Settings for real bars.'
  );
  return noDataResult(warnings);
}

export async function fetchDailyCandlesResolved(
  symbol: string,
  options?: CandleApiOptions
): Promise<CandleFetchResult> {
  await hydrateFromDisk();
  const upper = symbol.toUpperCase().trim();
  const key = candleCacheKey(upper, options);
  const cached = cacheGet(key, upper);
  if (cached && isLiveCandleSource(cached.source) && cached.candles.length >= 60) {
    const ttlH = Math.round(
      (BENCHMARK_SYMBOLS.has(upper) ? BENCHMARK_CANDLE_TTL_MS : CANDLE_TTL_MS) / 3600000
    );
    return withDataQuality(upper, {
      ...cached,
      warnings: [
        `Cached ${cached.source} EOD (${cached.candles.length} bars, ≤${ttlH}h TTL).`,
        ...cached.warnings.filter((w) => !/Cached .+ EOD/i.test(w)),
      ],
    });
  }

  return candleInflight.run(key, async () => {
    const again = cacheGet(key, upper);
    if (again && isLiveCandleSource(again.source) && again.candles.length >= 60) {
      const ttlH = Math.round(
        (BENCHMARK_SYMBOLS.has(upper) ? BENCHMARK_CANDLE_TTL_MS : CANDLE_TTL_MS) / 3600000
      );
      return withDataQuality(upper, {
        ...again,
        warnings: [
          `Cached ${again.source} EOD (${again.candles.length} bars, ≤${ttlH}h TTL).`,
          ...again.warnings.filter((w) => !/Cached .+ EOD/i.test(w)),
        ],
      });
    }
    const result = await fetchDailyCandlesResolvedUncached(upper, options);
    if (isLiveCandleSource(result.source) && result.candles.length >= 60) {
      cacheSet(key, upper, result);
    }
    return withDataQuality(upper, result);
  });
}

function pickLiveFailureHint(warnings: string[]): string | null {
  const isSuccessNoise = (w: string) => /\bEOD\s*\(/i.test(w);
  const priority = warnings.find(
    (w) =>
      !isSuccessNoise(w) &&
      /rate limit|429|cors|auth failed|blocked in this browser|skipped on web|Limit Reach|HTTP \d{3}/i.test(
        w
      )
  );
  if (priority) return priority;
  const provider = warnings.find(
    (w) => !isSuccessNoise(w) && /^(Tiingo|FMP|Finnhub|Alpha Vantage)/i.test(w)
  );
  return provider ?? null;
}

/** Legacy helper: empties demo/none series (production never emits them). */
export function alignDemoBundleToQuotes(
  candles: Record<string, Candle[]>,
  sources: Record<string, CandleSource>,
  quotes: Record<string, { price: number } | undefined>,
  bundleWarnings: string[] = []
): {
  candles: Record<string, Candle[]>;
  warnings: string[];
  reanchored: string[];
} {
  const next: Record<string, Candle[]> = { ...candles };
  const warnings: string[] = [];
  const reanchored: string[] = [];
  const hint = pickLiveFailureHint(bundleWarnings);
  for (const symbol of Object.keys(sources)) {
    const aligned = alignDemoCandlesToQuote(
      symbol,
      next[symbol] ?? [],
      quotes[symbol]?.price,
      sources[symbol],
      hint
    );
    next[symbol] = aligned.candles;
    if (aligned.reanchored) reanchored.push(symbol);
    if (aligned.warning && !warnings.includes(aligned.warning)) {
      warnings.push(aligned.warning);
    }
  }
  return { candles: next, warnings, reanchored };
}

/**
 * When Finnhub left a missing/demo quote but EOD bars are live, use the
 * last close so Last / Desk price matches buy-zone levels.
 */
export function preferLiveCandleQuotes<T extends { price: number; source: string }>(
  quotes: Record<string, T>,
  candles: Record<string, Candle[]>,
  sources: Record<string, CandleSource>
): { quotes: Record<string, T>; lifted: string[]; warnings: string[] } {
  const next = { ...quotes };
  const lifted: string[] = [];
  const warnings: string[] = [];

  for (const symbol of Object.keys(sources)) {
    const source = sources[symbol];
    if (!isLiveCandleSource(source)) continue;
    const quote = next[symbol];
    const bars = candles[symbol];
    const last = bars?.[bars.length - 1]?.close;
    if (!(last && last > 0)) continue;

    // Lift demo quotes, or inject a quote when Finnhub/Yahoo both failed.
    if (!quote) {
      next[symbol] = {
        symbol,
        price: last,
        change: 0,
        percentChange: 0,
        high: last,
        low: last,
        open: last,
        previousClose: last,
        source,
      } as T;
      lifted.push(symbol);
      warnings.push(`${symbol}: No live quote — using last ${source} close $${last.toFixed(2)}.`);
      continue;
    }
    if (quote.source !== 'demo') continue;
    const mismatch = Math.abs(quote.price - last) / last > DEMO_QUOTE_MISMATCH_PCT;
    if (!mismatch) continue;

    next[symbol] = {
      ...quote,
      price: last,
      change: 0,
      percentChange: 0,
      high: last,
      low: last,
      open: last,
      previousClose: last,
      source,
    } as T;
    lifted.push(symbol);
    warnings.push(
      `${symbol}: Finnhub/demo quote replaced with last ${source} close $${last.toFixed(2)}.`
    );
  }

  return { quotes: next, lifted, warnings };
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
  // Resolve SPY/QQQ first so equity Desk/backtest passes reuse the warm benchmark cache.
  const ordered = [
    ...unique.filter((s) => BENCHMARK_SYMBOLS.has(s)),
    ...unique.filter((s) => !BENCHMARK_SYMBOLS.has(s)),
  ];
  const candles: Record<string, Candle[]> = {};
  const sources: Record<string, CandleSource> = {};
  const warnings: string[] = [];

  // Sequential to respect free-tier rate limits (esp. Alpha Vantage / Tiingo hourly).
  for (const symbol of ordered) {
    const result = await fetchDailyCandlesResolved(symbol, options);
    candles[symbol] = result.candles;
    sources[symbol] = result.source;
    for (const w of result.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
  }

  return { candles, sources, warnings };
}
