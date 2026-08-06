/**
 * Deep Must-profile backtest across big+mid+small.
 *
 * Matches portfolio-backtest honesty: Must + earnings blackout (live Desk
 * parity), tiered slippage, gap-aware fills. Prefers TIINGO/FMP/FINNHUB when
 * env keys are set; otherwise uses Yahoo chart EOD (script-only) so we can
 * still score ~2y — but without FINNHUB / FMP / ALPHA_VANTAGE keys the blackout
 * fails closed (same as the portfolio screen). Finnhub → FMP → Alpha Vantage.
 *
 *   npx tsx scripts/run-deep-backtest.ts
 *   TIINGO_API_KEY=... FINNHUB_API_KEY=... FMP_API_KEY=... ALPHA_VANTAGE_API_KEY=... npx tsx scripts/run-deep-backtest.ts
 */
import { defaultSetups } from '../constants/seed';
import { BacktestProfile, PROFILE_MUST } from '../lib/backtestProfile';
import { costsForSymbol } from '../lib/backtestCosts';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { fetchEarningsDates, summarizeEarningsFetches } from '../lib/finnhub';
import { runBacktest } from '../lib/backtest';
import { runCombinedPlaybookBacktest } from '../lib/playbookCombined';
import { Candle } from '../types/trading';

const DAYS = Number(process.env.BT_DAYS ?? 800);
const EVAL_BARS = process.env.BT_EVAL_BARS ? Number(process.env.BT_EVAL_BARS) : undefined;
const SLEEP_MS = Number(process.env.BT_SLEEP_MS ?? 1200);
const REGIME = process.env.BT_REGIME === '1';
/** Trades kept in full — outliers reported separately instead of deleted. */
const OUTLIER_R = 3;
/** Score only bars up to this date (YYYY-MM-DD) — walk-forward "train" window. */
const END_DATE = process.env.BT_END || undefined;
/** Score only bars after this date (YYYY-MM-DD) — walk-forward "test" window. */
const START_DATE = process.env.BT_START || undefined;
/** Max simultaneous open positions across the whole portfolio (capital limit). */
const MAX_CONCURRENT = Number(process.env.BT_MAX_OPEN ?? 3);

/**
 * Same base as the portfolio screen: Must + earnings blackout (Desk parity).
 * Optionally stack SPY/QQQ market-regime via BT_REGIME=1.
 */
const PROFILE: BacktestProfile = {
  ...PROFILE_MUST,
  label: REGIME ? 'Must + earnings + regime' : 'Must + earnings blackout',
  description: REGIME
    ? `${PROFILE_MUST.description} Plus earnings blackout (live Desk parity) and SPY/QQQ market-regime gate.`
    : `${PROFILE_MUST.description} Plus earnings blackout (live Desk parity) — same gates as Portfolio backtest.`,
  gates: {
    ...PROFILE_MUST.gates,
    earningsBlackout: true,
    ...(REGIME ? { marketRegime: true } : {}),
  },
};

// Universe picked by demonstrated combined R (historically scored without the
// earnings blackout). Re-score with FINNHUB / FMP / ALPHA_VANTAGE keys — this
// script uses the same blackout as the portfolio UI, so totals will differ.
const BIG = ['AAPL', 'AMZN', 'JPM', 'XOM'];
const MID = ['FANG', 'CFG', 'WSM', 'DDOG'];
const SMALL = ['CROX', 'DUOL', 'FIX', 'IOT', 'PATH', 'RKLB'];
const SYMBOLS = [...BIG, ...MID, ...SMALL];
// costsForSymbol lives in lib/backtestCosts.ts (shared with the portfolio UI).

function clipWindow(candles: Candle[]): Candle[] {
  let out = candles;
  if (END_DATE) {
    const end = Math.floor(Date.parse(`${END_DATE}T23:59:59Z`) / 1000);
    out = out.filter((c) => c.time <= end);
  }
  if (START_DATE) {
    // Keep warmup history before the start; scoring window is handled via evalBars.
    return out;
  }
  return out;
}

function evalBarsForWindow(candles: Candle[]): number | undefined {
  if (!START_DATE) return EVAL_BARS;
  const start = Math.floor(Date.parse(`${START_DATE}T00:00:00Z`) / 1000);
  const after = candles.filter((c) => c.time >= start).length;
  return after > 0 ? after : EVAL_BARS;
}

const keys = {
  tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
  fmpApiKey: process.env.FMP_API_KEY || undefined,
  finnhubApiKey: process.env.FINNHUB_API_KEY || undefined,
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || undefined,
  yahooProxyUrl: process.env.YAHOO_PROXY_URL || undefined,
  yahooProxyToken: process.env.YAHOO_PROXY_TOKEN || undefined,
  days: DAYS,
};

const yahooProxy = keys.yahooProxyUrl
  ? { url: keys.yahooProxyUrl, token: keys.yahooProxyToken }
  : undefined;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function pct(n: number | null) {
  return n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`;
}

function r(n: number | null) {
  return n == null ? 'n/a' : n.toFixed(2);
}

/** Script-only Yahoo daily bars — avoids Tiingo hourly caps when no keys. */
async function fetchYahooDaily(symbol: string, days: number): Promise<{
  candles: Candle[];
  source: string;
  warnings: string[];
}> {
  const upper = symbol.toUpperCase();
  const range = days >= 1500 ? '5y' : days >= 700 ? '2y' : days >= 400 ? '1y' : '6mo';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    upper
  )}?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SignalDeskBacktest/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return {
        candles: [],
        source: 'yahoo',
        warnings: [`Yahoo HTTP ${res.status} for ${upper}`],
      };
    }
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>;
      };
    };
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0];
    const adjSeries = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
    if (!ts.length || !q?.close?.length) {
      return { candles: [], source: 'yahoo', warnings: [`Yahoo empty payload for ${upper}`] };
    }
    const candles: Candle[] = [];
    let usedAdj = 0;
    for (let i = 0; i < ts.length; i++) {
      const open = q.open?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const close = q.close?.[i];
      const volume = q.volume?.[i] ?? 0;
      if (
        open == null ||
        high == null ||
        low == null ||
        close == null ||
        !(close > 0)
      ) {
        continue;
      }
      const adj = adjSeries[i];
      const factor =
        typeof adj === 'number' && Number.isFinite(adj) && adj > 0 ? adj / close : 1;
      if (factor !== 1) usedAdj += 1;
      candles.push({
        time: ts[i],
        open: open * factor,
        high: high * factor,
        low: low * factor,
        close: close * factor,
        volume: volume ?? 0,
      });
    }
    candles.sort((a, b) => a.time - b.time);
    const adjNote =
      usedAdj > 0
        ? ', split+dividend adjusted via adjclose'
        : '';
    return {
      candles,
      source: 'yahoo',
      warnings: [`Yahoo EOD (${candles.length} daily bars, range=${range}${adjNote}).`],
    };
  } catch (err) {
    return {
      candles: [],
      source: 'yahoo',
      warnings: [`Yahoo fetch failed for ${upper}: ${String(err)}`],
    };
  }
}

async function fetchBars(symbol: string): Promise<{
  candles: Candle[];
  source: string;
  warnings: string[];
}> {
  const hasKey = Boolean(keys.tiingoApiKey || keys.fmpApiKey || keys.finnhubApiKey);
  if (hasKey) {
    const resolved = await fetchDailyCandlesResolved(symbol, keys);
    if (resolved.candles.length >= 60 && resolved.source !== 'demo') {
      return resolved;
    }
  }
  return fetchYahooDaily(symbol, DAYS);
}

async function main() {
  console.log(
    `Deep Must backtest · days=${DAYS} evalBars=${EVAL_BARS ?? 'full-after-warmup'} window=${
      START_DATE ?? '…'
    }→${END_DATE ?? 'today'} maxOpen=${MAX_CONCURRENT}`
  );
  console.log(`Setups (${defaultSetups.length}): ${defaultSetups.map((s) => s.name).join(', ')}`);
  console.log(`Universe (${SYMBOLS.length}): ${SYMBOLS.join(', ')}`);
  console.log(`Profile: ${PROFILE.label} — ${PROFILE.description}`);
  console.log(
    'Realism: gap-aware + gap-beyond stop fills, outliers kept, ADV-tiered slip+spread (≥$100M 5+1 / ≥$20M 10+2 / else 20+5 bps), earnings blackout (Desk/portfolio parity), portfolio position cap.'
  );
  console.log(
    `Keys: tiingo=${Boolean(keys.tiingoApiKey)} fmp=${Boolean(keys.fmpApiKey)} finnhub=${Boolean(
      keys.finnhubApiKey
    )} alphavantage=${Boolean(keys.alphaVantageApiKey)} (Yahoo fallback if missing/demo)`
  );
  if (!keys.finnhubApiKey && !keys.fmpApiKey && !keys.alphaVantageApiKey) {
    console.log(
      'WARNING: No FINNHUB / FMP / ALPHA_VANTAGE key — earnings blackout fails closed on every symbol (expect ~0 trades).\n'
    );
  } else if (!keys.finnhubApiKey) {
    console.log(
      `No Finnhub key — earnings via ${[
        keys.fmpApiKey ? 'FMP' : '',
        keys.alphaVantageApiKey ? 'Alpha Vantage' : '',
      ]
        .filter(Boolean)
        .join(' → ')} only (fail-closed on empty/error).\n`
    );
  } else {
    const backups = [
      keys.fmpApiKey ? 'FMP' : '',
      keys.alphaVantageApiKey ? 'Alpha Vantage' : '',
    ].filter(Boolean);
    console.log(
      `Finnhub earnings calendars per symbol${
        backups.length ? ` (${backups.join(' → ')} backup)` : ''
      }; fail-closed on empty/error.\n`
    );
  }

  const spy = await fetchBars('SPY');
  await sleep(SLEEP_MS);
  const qqq = await fetchBars('QQQ');
  await sleep(SLEEP_MS);
  const spyBars = clipWindow(spy.candles);
  const qqqBars = clipWindow(qqq.candles);
  console.log(`SPY=${spy.source}/${spyBars.length} QQQ=${qqq.source}/${qqqBars.length}`);

  type SetupAgg = {
    name: string;
    trades: number;
    wins: number;
    totalR: number;
  };
  const bySetup: Record<string, SetupAgg> = {};
  for (const s of defaultSetups) {
    bySetup[s.id] = { name: s.name, trades: 0, wins: 0, totalR: 0 };
  }

  type PortfolioTrade = { symbol: string; entryTime: number; exitTime: number; r: number };
  const allCombined: PortfolioTrade[] = [];
  let outlierLosses = 0;
  let outlierWins = 0;
  const sources: Record<string, number> = {};
  const earningsFetches: Awaited<ReturnType<typeof fetchEarningsDates>>[] = [];

  for (const symbol of SYMBOLS) {
    const raw = await fetchBars(symbol);
    await sleep(SLEEP_MS);
    sources[raw.source] = (sources[raw.source] ?? 0) + 1;
    const candles = clipWindow(raw.candles);
    const first = candles[0];
    const last = candles[candles.length - 1];
    console.log(
      `\n==== ${symbol} source=${raw.source} bars=${candles.length} ${
        first ? fmt(first.time) : '?'
      } → ${last ? fmt(last.time) : '?'} ====`
    );
    if (candles.length < 60) {
      console.log('  skip: insufficient bars');
      continue;
    }

    const earnFrom = first
      ? fmt(first.time)
      : new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
    const earnTo = last
      ? new Date(last.time * 1000 + 2 * 86400000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const earnings = await fetchEarningsDates(
      symbol,
      keys.finnhubApiKey,
      earnFrom,
      earnTo,
      keys.fmpApiKey,
      keys.alphaVantageApiKey,
      yahooProxy
    );
    earningsFetches.push(earnings);
    await sleep(Math.min(400, SLEEP_MS));
    console.log(
      `  earnings: ${earnings.status}${
        earnings.status === 'ok' ? ` (${earnings.dates.length} dates)` : ` — ${earnings.detail}`
      }`
    );

    const costs = costsForSymbol(symbol, candles);
    const common = {
      symbol,
      candles,
      spyCandles: spyBars,
      qqqCandles: qqqBars,
      earningsDates: earnings.dates,
      earningsCalendarStatus: earnings.status,
      sourceLabel: raw.source,
      warnings: raw.warnings,
      evalBars: evalBarsForWindow(candles),
    };

    const combined = runCombinedPlaybookBacktest({
      ...common,
      setups: defaultSetups,
      profile: { ...PROFILE, costs },
    });
    const cR = combined.trades.reduce((a, t) => a + t.rMultiple, 0);
    const cW = combined.trades.filter((t) => t.rMultiple > 0).length;
    outlierLosses += combined.trades.filter((t) => t.rMultiple < -OUTLIER_R).length;
    outlierWins += combined.trades.filter((t) => t.rMultiple > OUTLIER_R).length;
    for (const t of combined.trades) {
      allCombined.push({
        symbol,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        r: t.rMultiple,
      });
    }
    console.log(
      `  COMBINED: trades=${combined.trades.length} win=${
        combined.trades.length ? pct(cW / combined.trades.length) : 'n/a'
      } totalR=${r(cR)} overlaps=${combined.skippedOverlaps}`
    );

    for (const setup of defaultSetups) {
      const result = runBacktest({
        setup,
        ...common,
        costs,
        stopCooldownBars: PROFILE.stopCooldownBars,
        gates: PROFILE.gates,
      });
      const totalR = result.trades.reduce((a, t) => a + t.rMultiple, 0);
      const wins = result.trades.filter((t) => t.rMultiple > 0).length;
      const agg = bySetup[setup.id];
      agg.trades += result.trades.length;
      agg.wins += wins;
      agg.totalR += totalR;
      console.log(
        `  ${setup.name}: trades=${result.trades.length} win=${
          result.trades.length ? pct(wins / result.trades.length) : 'n/a'
        } avgR=${r(result.trades.length ? totalR / result.trades.length : null)} totalR=${r(totalR)}`
      );
    }
  }

  if (earningsFetches.length) {
    const earnSummary = summarizeEarningsFetches(earningsFetches);
    console.log(`\n=== EARNINGS CALENDARS ===`);
    console.log(earnSummary.headline);
  }

  console.log(`\n=== SETUP RANK (${PROFILE.label}, outliers kept, gap-aware fills) ===`);
  const ranked = Object.values(bySetup).sort((a, b) => b.totalR - a.totalR);
  for (const [i, row] of ranked.entries()) {
    console.log(
      `${String(i + 1).padStart(2)}. ${row.name.padEnd(26)} trades=${String(row.trades).padStart(
        3
      )} win=${row.trades ? pct(row.wins / row.trades).padStart(4) : ' n/a'} avgR=${r(
        row.trades ? row.totalR / row.trades : null
      )} totalR=${r(row.totalR)}`
    );
  }

  // Unconstrained portfolio (all signals taken).
  const totTrades = allCombined.length;
  const totWins = allCombined.filter((t) => t.r > 0).length;
  const totR = allCombined.reduce((a, t) => a + t.r, 0);
  console.log(
    `\nPORTFOLIO (all signals): trades=${totTrades} win=${
      totTrades ? pct(totWins / totTrades) : 'n/a'
    } totalR=${r(totR)} avgR=${r(totTrades ? totR / totTrades : null)}`
  );
  console.log(
    `Outlier trades kept: ${outlierWins} wins > +${OUTLIER_R}R, ${outlierLosses} losses < -${OUTLIER_R}R`
  );

  // How crowded is the uncapped book? Daily count of simultaneously open trades.
  if (allCombined.length) {
    const DAY = 86400;
    const minT = Math.min(...allCombined.map((t) => t.entryTime));
    const maxT = Math.max(...allCombined.map((t) => t.exitTime));
    const counts: number[] = [];
    for (let d = minT; d <= maxT; d += DAY) {
      const openCount = allCombined.filter((t) => t.entryTime <= d && t.exitTime > d).length;
      counts.push(openCount);
    }
    const activeDays = counts.filter((c) => c > 0);
    const sortedCounts = [...activeDays].sort((a, b) => a - b);
    const pick = (q: number) =>
      sortedCounts.length ? sortedCounts[Math.min(sortedCounts.length - 1, Math.floor(q * sortedCounts.length))] : 0;
    const over = activeDays.filter((c) => c > MAX_CONCURRENT).length;
    console.log(
      `CONCURRENCY (uncapped): max=${Math.max(0, ...counts)} median=${pick(0.5)} p90=${pick(0.9)} ` +
        `avg=${(activeDays.reduce((a, b) => a + b, 0) / Math.max(activeDays.length, 1)).toFixed(1)} ` +
        `days>${MAX_CONCURRENT} open: ${pct(over / Math.max(activeDays.length, 1))} of active days`
    );
  }

  // Capital-constrained portfolio: max N open positions, first-come first-served.
  // Occupy through exit calendar day (entries fill at the open; exits are later).
  const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  const sorted = [...allCombined].sort((a, b) => a.entryTime - b.entryTime);
  const taken: PortfolioTrade[] = [];
  let skippedForCapital = 0;
  for (const t of sorted) {
    const entryDay = dayKey(t.entryTime);
    const openNow = taken.filter((o) => dayKey(o.exitTime) >= entryDay).length;
    if (openNow >= MAX_CONCURRENT) {
      skippedForCapital += 1;
      continue;
    }
    taken.push(t);
  }
  const capWins = taken.filter((t) => t.r > 0).length;
  const capR = taken.reduce((a, t) => a + t.r, 0);
  console.log(
    `PORTFOLIO (max ${MAX_CONCURRENT} open): trades=${taken.length} skipped=${skippedForCapital} win=${
      taken.length ? pct(capWins / taken.length) : 'n/a'
    } totalR=${r(capR)} avgR=${r(taken.length ? capR / taken.length : null)}`
  );
  console.log(`Sources used: ${JSON.stringify(sources)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
