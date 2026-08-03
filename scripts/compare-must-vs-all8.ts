/**
 * Compare Robinhood-style "must" realism vs full first-eight stack.
 *
 *   TIINGO_API_KEY=... FINNHUB_API_KEY=... npx tsx scripts/compare-must-vs-all8.ts
 */
import { defaultSetups } from '../constants/seed';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { fetchEarningsDates } from '../lib/finnhub';
import { PROFILE_ALL8, PROFILE_MUST } from '../lib/backtestProfile';
import { runCombinedPlaybookBacktest } from '../lib/playbookCombined';
import { sectorEtfForSymbol } from '../lib/playbookExtras';
import { Candle } from '../types/trading';

const keys = {
  tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
  fmpApiKey: process.env.FMP_API_KEY || undefined,
  finnhubApiKey: process.env.FINNHUB_API_KEY || undefined,
  days: 140,
};

function fmt(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function pct(n: number | null) {
  return n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`;
}

function r(n: number | null) {
  return n == null ? 'n/a' : n.toFixed(2);
}

async function main() {
  const symbols = ['GOOGL', 'AMZN', 'META', 'JPM', 'XOM', 'QQQ'];
  const [spy, qqq] = await Promise.all([
    fetchDailyCandlesResolved('SPY', keys),
    fetchDailyCandlesResolved('QQQ', keys),
  ]);

  const sectorEtfs = [
    ...new Set(symbols.map((s) => sectorEtfForSymbol(s)).filter((s): s is string => Boolean(s))),
  ];
  const sectorBars: Record<string, Candle[]> = {};
  for (const etf of sectorEtfs) {
    const bars = await fetchDailyCandlesResolved(etf, keys);
    sectorBars[etf] = bars.candles;
    console.log(`Sector ${etf}: source=${bars.source} bars=${bars.candles.length}`);
  }

  console.log(`\nSPY=${spy.source}/${spy.candles.length} QQQ=${qqq.source}/${qqq.candles.length}`);
  console.log(`\nMUST: ${PROFILE_MUST.description}`);
  console.log(`ALL8: ${PROFILE_ALL8.description}\n`);

  type Row = {
    symbol: string;
    mustTrades: number;
    mustWin: string;
    mustAvg: string;
    mustTotal: string;
    allTrades: number;
    allWin: string;
    allAvg: string;
    allTotal: string;
  };
  const rows: Row[] = [];
  let mustTotR = 0;
  let allTotR = 0;
  let mustTrades = 0;
  let allTrades = 0;
  let mustWins = 0;
  let allWins = 0;

  for (const symbol of symbols) {
    const bars = await fetchDailyCandlesResolved(symbol, keys);
    const first = bars.candles[0];
    const last = bars.candles[bars.candles.length - 1];
    const from = first ? fmt(first.time) : '2025-01-01';
    const to = last
      ? new Date(last.time * 1000 + 2 * 86400000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const earningsDates =
      symbol === 'QQQ' ? [] : await fetchEarningsDates(symbol, keys.finnhubApiKey, from, to);
    const etf = sectorEtfForSymbol(symbol);
    const sectorCandles = etf ? sectorBars[etf] ?? [] : [];

    const common = {
      symbol,
      setups: defaultSetups,
      candles: bars.candles,
      spyCandles: spy.candles,
      qqqCandles: qqq.candles,
      sectorCandles,
      earningsDates,
      sourceLabel: bars.source,
      warnings: bars.warnings,
      evalBars: 30,
    };

    const must = runCombinedPlaybookBacktest({ ...common, profile: PROFILE_MUST });
    const all8 = runCombinedPlaybookBacktest({ ...common, profile: PROFILE_ALL8 });

    mustTotR += must.totalR ?? 0;
    allTotR += all8.totalR ?? 0;
    mustTrades += must.trades.length;
    allTrades += all8.trades.length;
    mustWins += must.trades.filter((t) => t.rMultiple > 0).length;
    allWins += all8.trades.filter((t) => t.rMultiple > 0).length;

    rows.push({
      symbol,
      mustTrades: must.trades.length,
      mustWin: pct(must.winRate),
      mustAvg: r(must.avgR),
      mustTotal: r(must.totalR),
      allTrades: all8.trades.length,
      allWin: pct(all8.winRate),
      allAvg: r(all8.avgR),
      allTotal: r(all8.totalR),
    });

    console.log(`==== ${symbol} (earnings=${earningsDates.join(',') || 'none'}, sector=${etf ?? '—'}) ====`);
    console.log(
      `  MUST  trades=${must.trades.length} win=${pct(must.winRate)} avgR=${r(must.avgR)} totalR=${r(must.totalR)} overlaps=${must.skippedOverlaps}`
    );
    console.log(
      `  ALL8  trades=${all8.trades.length} win=${pct(all8.winRate)} avgR=${r(all8.avgR)} totalR=${r(all8.totalR)} overlaps=${all8.skippedOverlaps} cooldown=${all8.skippedCooldown}`
    );
  }

  console.log('\n=== Summary ===');
  console.log(
    'Ticker | MUST trades/win/avgR/totalR | ALL8 trades/win/avgR/totalR'
  );
  for (const row of rows) {
    console.log(
      `${row.symbol.padEnd(5)} | ${row.mustTrades}/${row.mustWin}/${row.mustAvg}/${row.mustTotal} | ${row.allTrades}/${row.allWin}/${row.allAvg}/${row.allTotal}`
    );
  }
  console.log(
    `\nPORTFOLIO MUST: trades=${mustTrades} win=${mustTrades ? pct(mustWins / mustTrades) : 'n/a'} totalR=${r(mustTotR)} avgR=${r(mustTrades ? mustTotR / mustTrades : null)}`
  );
  console.log(
    `PORTFOLIO ALL8: trades=${allTrades} win=${allTrades ? pct(allWins / allTrades) : 'n/a'} totalR=${r(allTotR)} avgR=${r(allTrades ? allTotR / allTrades : null)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
