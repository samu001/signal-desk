import { expectancyMap } from '@/lib/expectancy';
import { fetchEarningsWindow, fetchMarketBundle } from '@/lib/finnhub';
import { buildRecommendation, Recommendation } from '@/lib/recommend';
import { blendSetupScores, scoreRecentSetupPerformance } from '@/lib/setupPerformance';
import { AppSettings, Setup, Trade } from '@/types/trading';

export async function fetchRecommendation(
  symbol: string,
  settings: Pick<
    AppSettings,
    'finnhubApiKey' | 'tiingoApiKey' | 'fmpApiKey' | 'alphaVantageApiKey'
  >,
  options?: {
    setups?: Setup[];
    trades?: Trade[];
  }
): Promise<Recommendation> {
  const upper = symbol.toUpperCase().trim();
  if (!upper) {
    throw new Error('Enter a stock ticker first.');
  }

  const bundle = await fetchMarketBundle([upper], {
    finnhubApiKey: settings.finnhubApiKey || undefined,
    tiingoApiKey: settings.tiingoApiKey || undefined,
    fmpApiKey: settings.fmpApiKey || undefined,
    alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
    days: 400,
  });

  const earnings = await fetchEarningsWindow(upper, settings.finnhubApiKey || undefined);
  const setups = options?.setups ?? [];
  const journal = setups.length ? expectancyMap(setups, options?.trades ?? []) : undefined;
  const recent =
    setups.length && bundle.candles[upper]?.length
      ? scoreRecentSetupPerformance({
          symbol: upper,
          setups,
          candles: bundle.candles[upper],
          spyCandles: bundle.candles.SPY ?? [],
        })
      : [];
  const expectancy = setups.length ? blendSetupScores(setups, journal, recent) : undefined;

  return buildRecommendation({
    symbol: upper,
    quote: bundle.quotes[upper] ?? null,
    candles: bundle.candles[upper] ?? [],
    spyCandles: bundle.candles.SPY ?? [],
    news: bundle.news[upper] ?? [],
    fundamentals: bundle.fundamentals[upper] ?? null,
    candleSource: bundle.candleSources[upper] ?? 'demo',
    warnings: bundle.warnings,
    setups,
    expectancy,
    earnings,
  });
}
