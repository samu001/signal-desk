import { expectancyMap } from '@/lib/expectancy';
import { fetchMarketBundle } from '@/lib/finnhub';
import { buildRecommendation, EarningsRisk, Recommendation } from '@/lib/recommend';
import { blendSetupScores, scoreRecentSetupPerformance } from '@/lib/setupPerformance';
import { AppSettings, Setup, Trade } from '@/types/trading';

type ApiSettings = Pick<
  AppSettings,
  'finnhubApiKey' | 'tiingoApiKey' | 'fmpApiKey' | 'alphaVantageApiKey'
>;

type RecommendOptions = {
  setups?: Setup[];
  trades?: Trade[];
};

function earningsFromDates(dates: string[] | undefined): EarningsRisk | null {
  if (!dates?.length) return null;
  const next = dates[0];
  const today = new Date();
  const earnDate = new Date(`${next}T12:00:00Z`);
  const daysUntil = Math.round((earnDate.getTime() - today.getTime()) / 86400000);
  const blocked = daysUntil >= -1 && daysUntil <= 1;
  return {
    date: next,
    daysUntil,
    blocked,
    detail: blocked
      ? `Earnings ${next} is inside the ±1 day blackout`
      : `Next earnings ${next} (~${daysUntil}d)`,
  };
}

/** Desk recommendations for many tickers — one market-data pull, then per-symbol Playbook match. */
export async function fetchRecommendations(
  symbols: string[],
  settings: ApiSettings,
  options?: RecommendOptions
): Promise<Recommendation[]> {
  const unique = [
    ...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)),
  ];
  if (!unique.length) return [];

  const bundle = await fetchMarketBundle(unique, {
    finnhubApiKey: settings.finnhubApiKey || undefined,
    tiingoApiKey: settings.tiingoApiKey || undefined,
    fmpApiKey: settings.fmpApiKey || undefined,
    alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
    days: 400,
  });

  const setups = options?.setups ?? [];
  const journal = setups.length ? expectancyMap(setups, options?.trades ?? []) : undefined;

  return unique.map((symbol) => {
    const candles = bundle.candles[symbol] ?? [];
    const earningsDates = bundle.earningsDates[symbol] ?? [];
    const earnings = earningsFromDates(earningsDates);
    const recent =
      setups.length && candles.length
        ? scoreRecentSetupPerformance({
            symbol,
            setups,
            candles,
            spyCandles: bundle.candles.SPY ?? [],
            qqqCandles: bundle.candles.QQQ ?? [],
            earningsDates,
          })
        : [];
    const expectancy = setups.length ? blendSetupScores(setups, journal, recent) : undefined;

    return buildRecommendation({
      symbol,
      quote: bundle.quotes[symbol] ?? null,
      candles,
      spyCandles: bundle.candles.SPY ?? [],
      qqqCandles: bundle.candles.QQQ ?? [],
      news: bundle.news[symbol] ?? [],
      fundamentals: bundle.fundamentals[symbol] ?? null,
      candleSource: bundle.candleSources[symbol] ?? 'demo',
      warnings: bundle.warnings,
      setups,
      expectancy,
      earnings,
      earningsDates,
    });
  });
}

export async function fetchRecommendation(
  symbol: string,
  settings: ApiSettings,
  options?: RecommendOptions
): Promise<Recommendation> {
  const upper = symbol.toUpperCase().trim();
  if (!upper) {
    throw new Error('Enter a stock ticker first.');
  }

  const [result] = await fetchRecommendations([upper], settings, options);
  if (!result) {
    throw new Error('Could not build a recommendation.');
  }
  return result;
}
