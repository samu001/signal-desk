import { defaultSetups } from '../constants/seed';
import { fetchDailyCandlesResolved } from '../lib/candles';
import { runDeskBacktest } from '../lib/deskBacktest';
import { fetchEarningsDates } from '../lib/finnhub';

const keys = {
  tiingoApiKey: process.env.TIINGO_API_KEY || undefined,
  fmpApiKey: process.env.FMP_API_KEY || undefined,
  finnhubApiKey: process.env.FINNHUB_API_KEY || undefined,
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || undefined,
  yahooProxyUrl: process.env.YAHOO_PROXY_URL || undefined,
  yahooProxyToken: process.env.YAHOO_PROXY_TOKEN || undefined,
  days: 140,
};

const yahooProxy = keys.yahooProxyUrl
  ? { url: keys.yahooProxyUrl, token: keys.yahooProxyToken }
  : undefined;

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
    const earnings = await fetchEarningsDates(
      symbol,
      keys.finnhubApiKey,
      from,
      to,
      keys.fmpApiKey,
      keys.alphaVantageApiKey,
      yahooProxy
    );

    const result = runDeskBacktest({
      symbol,
      candles: bars.candles,
      spyCandles: spy.candles,
      qqqCandles: qqq.candles,
      earningsDates: earnings.dates,
      sourceLabel: bars.source,
      warnings: bars.warnings,
      evalBars: 30,
      setups: defaultSetups,
    });

    const win = result.winRate == null ? 'n/a' : `${(result.winRate * 100).toFixed(0)}%`;
    const avg = result.avgR == null ? 'n/a' : result.avgR.toFixed(2);
    console.log(
      `\n==== ${symbol} source=${result.sourceLabel} earnings=${earnings.dates.join(',') || earnings.status} ====`
    );
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
