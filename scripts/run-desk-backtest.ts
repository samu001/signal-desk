import { defaultSetups } from '../constants/seed';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { runDeskBacktest } from '../lib/deskBacktest';

const keys = {
  tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
  fmpApiKey: process.env.FMP_API_KEY || undefined,
  finnhubApiKey: process.env.FINNHUB_API_KEY || undefined,
  days: 140,
};

function fmt(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function main() {
  const symbols = ['AAPL', 'NVDA', 'MSFT'];
  const spy = await fetchDailyCandlesResolved('SPY', keys);
  console.log(`SPY source=${spy.source} bars=${spy.candles.length}`);

  for (const symbol of symbols) {
    const bars = await fetchDailyCandlesResolved(symbol, keys);
    const result = runDeskBacktest({
      symbol,
      candles: bars.candles,
      spyCandles: spy.candles,
      sourceLabel: bars.source,
      warnings: bars.warnings,
      evalBars: 30,
      setups: defaultSetups,
    });

    const win = result.winRate == null ? 'n/a' : `${(result.winRate * 100).toFixed(0)}%`;
    const avg = result.avgR == null ? 'n/a' : result.avgR.toFixed(2);
    console.log(`\n==== ${symbol} source=${result.sourceLabel} ====`);
    console.log(
      `Signals: strong=${result.signals.strong_buy} soft=${result.signals.soft_buy} wait=${result.signals.wait} avoid=${result.signals.avoid}`
    );
    console.log(`Trades: ${result.trades.length} | Win rate: ${win} | Avg R: ${avg}`);
    for (const t of result.trades) {
      console.log(
        `  [${t.stance}] ${fmt(t.entryTime)} → ${fmt(t.exitTime)} | ${t.entry.toFixed(2)} → ${t.exit.toFixed(2)} | R ${t.rMultiple.toFixed(2)} | ${t.reason}`
      );
    }
    if (!result.trades.length) console.log('  No Soft/Strong zone entries in window.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
