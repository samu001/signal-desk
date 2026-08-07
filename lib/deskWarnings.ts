import { CandleSource } from '@/lib/candles';

const BENCHMARKS = new Set(['SPY', 'QQQ']);

function isSuccessNoise(warning: string): boolean {
  if (/^Cached .+ EOD/i.test(warning)) return true;
  // Healthy provider success lines, e.g. "Tiingo EOD via proxy (275 adjusted daily bars…)"
  if (/\bEOD via proxy\b/i.test(warning) && !/fail|404|502|429|only returned/i.test(warning)) {
    return true;
  }
  if (/\b\d+\s+adjusted daily bars\b/i.test(warning) && !/fail|only returned/i.test(warning)) {
    return true;
  }
  return false;
}

/** True when the note clearly concerns a different equity than `symbol`. */
export function isAboutOtherSymbol(warning: string, symbol: string): boolean {
  const upper = symbol.toUpperCase().trim();
  if (!upper) return false;

  const prefix = warning.match(/^([A-Z][A-Z0-9.\-]{0,11}):\s/);
  if (prefix) {
    const tagged = prefix[1].toUpperCase();
    if (tagged !== upper && !BENCHMARKS.has(tagged) && tagged !== 'HTTP') return true;
  }

  const forMatch = warning.match(/\bfor ([A-Z]{1,6})\b/);
  if (forMatch) {
    const tagged = forMatch[1].toUpperCase();
    if (tagged !== upper && !BENCHMARKS.has(tagged)) return true;
  }

  const tickerMatch = warning.match(/Ticker ['"]([A-Z0-9.\-]+)['"]/i);
  if (tickerMatch) {
    const tagged = tickerMatch[1].toUpperCase();
    if (tagged !== upper) return true;
  }

  return false;
}

/** Provider cascade chatter that is irrelevant once this ticker already has live bars. */
function isCascadeNoiseWhenLive(warning: string): boolean {
  return (
    /Finnhub free plan does not include/i.test(warning) ||
    /Invalid API call.*TIME_SERIES/i.test(warning) ||
    /HTTP 402|Premium Query Parameter/i.test(warning) ||
    /No data — all live EOD sources failed/i.test(warning) ||
    /Yahoo proxy HTTP 502/i.test(warning) ||
    /Tiingo proxy HTTP 502/i.test(warning) ||
    /Alpha Vantage/i.test(warning) ||
    /Finnhub returned no quote/i.test(warning) ||
    /only returned \d+ bars; trying fallbacks/i.test(warning)
  );
}

function isStanceDuplicate(warning: string): boolean {
  return (
    /No Playbook setup matched/i.test(warning) ||
    /Research-interesting only/i.test(warning) ||
    /Historical Desk mode:/i.test(warning)
  );
}

/**
 * Scope + quiet market-bundle warnings for one Desk ticker.
 * Drops other-symbol noise, cache/success chatter, and (when live) provider cascade leftovers.
 */
export function filterDeskDataWarnings(
  symbol: string,
  warnings: string[],
  candleSource: CandleSource | 'none',
  options?: { hasFundamentals?: boolean; includeStance?: boolean }
): string[] {
  const hasLive = candleSource !== 'none' && candleSource !== 'demo';
  const out: string[] = [];

  for (const w of warnings) {
    if (!w?.trim()) continue;
    if (isAboutOtherSymbol(w, symbol)) continue;
    if (isSuccessNoise(w)) continue;
    if (!options?.includeStance && isStanceDuplicate(w)) continue;
    if (hasLive && isCascadeNoiseWhenLive(w)) continue;
    if (options?.hasFundamentals && /FMP fundamentals returned no rows/i.test(w)) continue;
    if (!out.includes(w)) out.push(w);
  }

  return out;
}

/** Warnings safe to show on the Desk detail scorecard. */
export function userFacingDeskWarnings(input: {
  symbol: string;
  warnings: string[];
  candleSource: CandleSource | 'none';
  fundamentals: unknown;
}): string[] {
  return filterDeskDataWarnings(input.symbol, input.warnings, input.candleSource, {
    hasFundamentals: Boolean(input.fundamentals),
    includeStance: false,
  });
}
