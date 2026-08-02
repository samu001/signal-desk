import { defaultSetups } from '../constants/seed';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { runBacktest } from '../lib/backtest';

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
    const first = bars.candles[0];
    const last = bars.candles[bars.candles.length - 1];
    console.log(
      `\n==== ${symbol} source=${bars.source} bars=${bars.candles.length} ${
        first ? fmt(first.time) : '?'
      } → ${last ? fmt(last.time) : '?'} ====`
    );

    for (const setup of defaultSetups) {
      const result = runBacktest({
        setup,
        symbol,
        candles: bars.candles,
        spyCandles: spy.candles,
        sourceLabel: bars.source,
        warnings: bars.warnings,
        evalBars: 30,
      });
      const win = result.winRate == null ? 'n/a' : `${(result.winRate * 100).toFixed(0)}%`;
      const avg = result.avgR == null ? 'n/a' : result.avgR.toFixed(2);
      console.log(`\n${result.setupName}`);
      console.log(`  Trades: ${result.trades.length} | Win rate: ${win} | Avg R: ${avg}`);
      if (!result.trades.length) {
        console.log('  No trades in the last ~30 trading days.');
      } else {
        for (const t of result.trades) {
          console.log(
            `  ${fmt(t.entryTime)} → ${fmt(t.exitTime)} | entry ${t.entry.toFixed(2)} exit ${t.exit.toFixed(2)} | R ${t.rMultiple.toFixed(2)} | ${t.reason}`
          );
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
