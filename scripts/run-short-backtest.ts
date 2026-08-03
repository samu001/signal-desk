import { defaultSetups } from '../constants/seed';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { fetchEarningsDates } from '../lib/finnhub';
import { runCombinedPlaybookBacktest } from '../lib/playbookCombined';
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
  const [spy, qqq] = await Promise.all([
    fetchDailyCandlesResolved('SPY', keys),
    fetchDailyCandlesResolved('QQQ', keys),
  ]);
  console.log(`SPY source=${spy.source} bars=${spy.candles.length}`);
  console.log(`QQQ source=${qqq.source} bars=${qqq.candles.length}`);

  for (const symbol of symbols) {
    const bars = await fetchDailyCandlesResolved(symbol, keys);
    const first = bars.candles[0];
    const last = bars.candles[bars.candles.length - 1];
    const from = first ? fmt(first.time) : '2025-01-01';
    const to = last
      ? new Date(last.time * 1000 + 2 * 86400000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const earningsDates = await fetchEarningsDates(symbol, keys.finnhubApiKey, from, to);

    console.log(
      `\n==== ${symbol} source=${bars.source} bars=${bars.candles.length} ${
        first ? fmt(first.time) : '?'
      } → ${last ? fmt(last.time) : '?'} | earnings=${earningsDates.join(',') || 'none'} ====`
    );

    const combined = runCombinedPlaybookBacktest({
      symbol,
      setups: defaultSetups,
      candles: bars.candles,
      spyCandles: spy.candles,
      qqqCandles: qqq.candles,
      earningsDates,
      sourceLabel: bars.source,
      warnings: bars.warnings,
      evalBars: 30,
    });
    const win = combined.winRate == null ? 'n/a' : `${(combined.winRate * 100).toFixed(0)}%`;
    const avg = combined.avgR == null ? 'n/a' : combined.avgR.toFixed(2);
    console.log(
      `\nCOMBINED (de-duped): trades=${combined.trades.length} skippedOverlaps=${combined.skippedOverlaps} skippedCooldown=${combined.skippedCooldown} win=${win} avgR=${avg}`
    );
    for (const t of combined.trades) {
      console.log(
        `  ${fmt(t.entryTime)} → ${fmt(t.exitTime)} | ${t.setupName} | entry ${t.entry.toFixed(2)} exit ${t.exit.toFixed(2)} | R ${t.rMultiple.toFixed(2)} | ${t.reason}`
      );
    }

    for (const setup of defaultSetups) {
      const result = runBacktest({
        setup,
        symbol,
        candles: bars.candles,
        spyCandles: spy.candles,
        qqqCandles: qqq.candles,
        earningsDates,
        sourceLabel: bars.source,
        warnings: bars.warnings,
        evalBars: 30,
      });
      const sWin = result.winRate == null ? 'n/a' : `${(result.winRate * 100).toFixed(0)}%`;
      const sAvg = result.avgR == null ? 'n/a' : result.avgR.toFixed(2);
      console.log(
        `\n${result.setupName}: trades=${result.trades.length} win=${sWin} avgR=${sAvg}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
