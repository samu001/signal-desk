import { fetchMarketBundle } from '@/lib/finnhub';
import { buildRecommendation, Recommendation } from '@/lib/recommend';
import { AppSettings } from '@/types/trading';

export async function fetchRecommendation(
  symbol: string,
  settings: Pick<
    AppSettings,
    'finnhubApiKey' | 'tiingoApiKey' | 'fmpApiKey' | 'alphaVantageApiKey'
  >
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

  return buildRecommendation({
    symbol: upper,
    quote: bundle.quotes[upper] ?? null,
    candles: bundle.candles[upper] ?? [],
    spyCandles: bundle.candles.SPY ?? [],
    news: bundle.news[upper] ?? [],
    fundamentals: bundle.fundamentals[upper] ?? null,
    candleSource: bundle.candleSources[upper] ?? 'demo',
    warnings: bundle.warnings,
  });
}
