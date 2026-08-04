import { expectancyMap } from '@/lib/expectancy';
import {
  fetchMarketBundle,
  MarketBundle,
  shouldReuseMarketBundle,
} from '@/lib/finnhub';
import {
  buildNoDataRecommendation,
  buildRecommendation,
  EarningsRisk,
  Recommendation,
} from '@/lib/recommend';
import { blendSetupScores, scoreRecentSetupPerformance } from '@/lib/setupPerformance';
import { AppSettings, Setup, Trade } from '@/types/trading';

type ApiSettings = Pick<
  AppSettings,
  | 'finnhubApiKey'
  | 'tiingoApiKey'
  | 'fmpApiKey'
  | 'alphaVantageApiKey'
  | 'yahooProxyUrl'
  | 'yahooProxyToken'
>;

export type RecommendOptions = {
  setups?: Setup[];
  trades?: Trade[];
  /**
   * Recent market snapshot from TradingContext. When it covers the requested
   * symbols and is fresh enough, Desk skips a second full bundle fetch.
   */
  market?: MarketBundle | null;
  marketFetchedAt?: number | null;
};

export type RecommendBatchResult = {
  recommendations: Recommendation[];
  bundle: MarketBundle;
  /** True when Desk reused context data instead of calling fetchMarketBundle. */
  reusedMarket: boolean;
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

function buildFromBundle(
  unique: string[],
  bundle: MarketBundle,
  setups: Setup[],
  trades: Trade[]
): Recommendation[] {
  const journal = setups.length ? expectancyMap(setups, trades) : undefined;

  return unique.map((symbol) => {
    const candles = bundle.candles[symbol] ?? [];
    const candleSource = bundle.candleSources[symbol] ?? 'none';
    const earningsDates = bundle.earningsDates[symbol] ?? [];
    const earnings = earningsFromDates(earningsDates);
    if (!candles.length || candleSource === 'none' || candleSource === 'demo') {
      return buildNoDataRecommendation(symbol, bundle.warnings, bundle.quotes[symbol] ?? null);
    }
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
      candleSource,
      warnings: bundle.warnings,
      setups,
      expectancy,
      earnings,
      earningsDates,
    });
  });
}

/** Desk recommendations for many tickers — reuses context market data when possible. */
export async function fetchRecommendationsWithBundle(
  symbols: string[],
  settings: ApiSettings,
  options?: RecommendOptions
): Promise<RecommendBatchResult> {
  const unique = [
    ...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)),
  ];
  if (!unique.length) {
    return {
      recommendations: [],
      bundle: {
        quotes: {},
        candles: {},
        candleSources: {},
        news: {},
        fundamentals: {},
        earningsDates: {},
        sourceSummary: 'none',
        warnings: [],
      },
      reusedMarket: false,
    };
  }

  const setups = options?.setups ?? [];
  const trades = options?.trades ?? [];

  let bundle: MarketBundle;
  let reusedMarket = false;

  if (shouldReuseMarketBundle(options?.market, unique, options?.marketFetchedAt)) {
    bundle = options!.market!;
    reusedMarket = true;
  } else {
    bundle = await fetchMarketBundle(unique, {
      finnhubApiKey: settings.finnhubApiKey || undefined,
      tiingoApiKey: settings.tiingoApiKey || undefined,
      fmpApiKey: settings.fmpApiKey || undefined,
      alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
      yahooProxyUrl: settings.yahooProxyUrl || undefined,
      yahooProxyToken: settings.yahooProxyToken || undefined,
      days: 400,
    });
  }

  return {
    recommendations: buildFromBundle(unique, bundle, setups, trades),
    bundle,
    reusedMarket,
  };
}

/** Desk recommendations for many tickers — one market-data pull, then per-symbol Playbook match. */
export async function fetchRecommendations(
  symbols: string[],
  settings: ApiSettings,
  options?: RecommendOptions
): Promise<Recommendation[]> {
  const { recommendations } = await fetchRecommendationsWithBundle(symbols, settings, options);
  return recommendations;
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

  const { recommendations } = await fetchRecommendationsWithBundle([upper], settings, options);
  const result = recommendations[0];
  if (!result) {
    throw new Error('Could not build a recommendation.');
  }
  return result;
}
