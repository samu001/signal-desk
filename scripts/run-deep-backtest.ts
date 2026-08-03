/**
 * Deep Must-profile backtest across big+mid+small.
 *
 * Prefers TIINGO/FMP/FINNHUB when env keys are set; otherwise uses Yahoo chart
 * EOD (script-only, no key) so we can still score ~2y without rate-limit keys.
 *
 *   npx tsx scripts/run-deep-backtest.ts
 *   TIINGO_API_KEY=... npx tsx scripts/run-deep-backtest.ts
 */
import { defaultSetups } from '../constants/seed';
import { BacktestProfile, PROFILE_MUST } from '../lib/backtestProfile';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { runBacktest } from '../lib/backtest';
import { runCombinedPlaybookBacktest } from '../lib/playbookCombined';
import { Candle } from '../types/trading';

const DAYS = Number(process.env.BT_DAYS ?? 800);
const EVAL_BARS = process.env.BT_EVAL_BARS ? Number(process.env.BT_EVAL_BARS) : undefined;
const SLEEP_MS = Number(process.env.BT_SLEEP_MS ?? 1200);
const REGIME = process.env.BT_REGIME === '1';
const OUTLIER_R = 3;

/** Must realism, optionally with the SPY/QQQ market-regime gate stacked on. */
const PROFILE: BacktestProfile = REGIME
  ? {
      ...PROFILE_MUST,
      label: 'Must + regime gate',
      description: `${PROFILE_MUST.description} Plus SPY/QQQ market-regime gate.`,
      gates: { ...PROFILE_MUST.gates, marketRegime: true },
    }
  : PROFILE_MUST;

// Universe picked by demonstrated combined R, not sector-matching. High-beta
// consumer/gaming names (PENN, LYFT, CZR, ETSY, DECK) all lost over 5y and
// were dropped; quality growth mid-caps (DUOL, FIX, IOT) fill the small/mid slots.
const BIG = ['AAPL', 'AMZN', 'JPM', 'XOM'];
const MID = ['FANG', 'CFG', 'WSM', 'DDOG'];
const SMALL = ['CROX', 'DUOL', 'FIX', 'IOT', 'PATH', 'RKLB'];
const SYMBOLS = [...BIG, ...MID, ...SMALL];

const keys = {
  tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
  fmpApiKey: process.env.FMP_API_KEY || undefined,
  finnhubApiKey: process.env.FINNHUB_API_KEY || undefined,
  days: DAYS,
};

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
          };
        }>;
      };
    };
    const result = data.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0];
    if (!ts.length || !q?.close?.length) {
      return { candles: [], source: 'yahoo', warnings: [`Yahoo empty payload for ${upper}`] };
    }
    const candles: Candle[] = [];
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
      candles.push({ time: ts[i], open, high, low, close, volume: volume ?? 0 });
    }
    candles.sort((a, b) => a.time - b.time);
    return {
      candles,
      source: 'yahoo',
      warnings: [`Yahoo EOD (${candles.length} daily bars, range=${range}).`],
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
    `Deep Must backtest · days=${DAYS} evalBars=${EVAL_BARS ?? 'full-after-warmup'} sleep=${SLEEP_MS}ms`
  );
  console.log(`Setups (${defaultSetups.length}): ${defaultSetups.map((s) => s.name).join(', ')}`);
  console.log(`Universe (${SYMBOLS.length}): ${SYMBOLS.join(', ')}`);
  console.log(`Profile: ${PROFILE.description}`);
  console.log(
    `Keys: tiingo=${Boolean(keys.tiingoApiKey)} fmp=${Boolean(keys.fmpApiKey)} finnhub=${Boolean(
      keys.finnhubApiKey
    )} (Yahoo fallback if missing/demo)\n`
  );

  const spy = await fetchBars('SPY');
  await sleep(SLEEP_MS);
  const qqq = await fetchBars('QQQ');
  await sleep(SLEEP_MS);
  console.log(`SPY=${spy.source}/${spy.candles.length} QQQ=${qqq.source}/${qqq.candles.length}`);

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

  let combinedTrades = 0;
  let combinedWins = 0;
  let combinedR = 0;
  let sources: Record<string, number> = {};

  for (const symbol of SYMBOLS) {
    const bars = await fetchBars(symbol);
    await sleep(SLEEP_MS);
    sources[bars.source] = (sources[bars.source] ?? 0) + 1;
    const first = bars.candles[0];
    const last = bars.candles[bars.candles.length - 1];
    console.log(
      `\n==== ${symbol} source=${bars.source} bars=${bars.candles.length} ${
        first ? fmt(first.time) : '?'
      } → ${last ? fmt(last.time) : '?'} ====`
    );
    if (bars.candles.length < 60) {
      console.log('  skip: insufficient bars');
      continue;
    }

    const common = {
      symbol,
      candles: bars.candles,
      spyCandles: spy.candles,
      qqqCandles: qqq.candles,
      sourceLabel: bars.source,
      warnings: bars.warnings,
      evalBars: EVAL_BARS,
      profile: PROFILE,
    };

    const combined = runCombinedPlaybookBacktest({
      ...common,
      setups: defaultSetups,
    });
    const filteredCombined = combined.trades.filter((t) => Math.abs(t.rMultiple) <= OUTLIER_R);
    const cR = filteredCombined.reduce((a, t) => a + t.rMultiple, 0);
    const cW = filteredCombined.filter((t) => t.rMultiple > 0).length;
    combinedTrades += filteredCombined.length;
    combinedWins += cW;
    combinedR += cR;
    console.log(
      `  COMBINED: trades=${filteredCombined.length} (raw ${combined.trades.length}) win=${
        filteredCombined.length ? pct(cW / filteredCombined.length) : 'n/a'
      } totalR=${r(cR)} overlaps=${combined.skippedOverlaps}`
    );

    for (const setup of defaultSetups) {
      const result = runBacktest({
        setup,
        ...common,
        costs: PROFILE.costs,
        stopCooldownBars: PROFILE.stopCooldownBars,
        gates: PROFILE.gates,
      });
      const trades = result.trades.filter((t) => Math.abs(t.rMultiple) <= OUTLIER_R);
      const totalR = trades.reduce((a, t) => a + t.rMultiple, 0);
      const wins = trades.filter((t) => t.rMultiple > 0).length;
      const agg = bySetup[setup.id];
      agg.trades += trades.length;
      agg.wins += wins;
      agg.totalR += totalR;
      console.log(
        `  ${setup.name}: trades=${trades.length} win=${
          trades.length ? pct(wins / trades.length) : 'n/a'
        } avgR=${r(trades.length ? totalR / trades.length : null)} totalR=${r(totalR)}`
      );
    }
  }

  console.log(`\n=== SETUP RANK (${PROFILE.label}, |R|>${OUTLIER_R} removed) ===`);
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
  console.log(
    `\nPORTFOLIO COMBINED (de-duped, |R|>${OUTLIER_R} removed): trades=${combinedTrades} win=${
      combinedTrades ? pct(combinedWins / combinedTrades) : 'n/a'
    } totalR=${r(combinedR)} avgR=${r(combinedTrades ? combinedR / combinedTrades : null)}`
  );
  console.log(`Sources used: ${JSON.stringify(sources)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
