import { expectancyMap } from '@/lib/expectancy';
import { filterDeskDataWarnings } from '@/lib/deskWarnings';
import {
  EarningsFetchStatus,
  fetchMarketBundle,
  MarketBundle,
  pickNearestEarnings,
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
  | 'tiingoProxyUrl'
  | 'tiingoProxyToken'
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
  const nearest = pickNearestEarnings(dates ?? []);
  if (!nearest) return null;
  return {
    date: nearest.date,
    daysUntil: nearest.daysUntil,
    blocked: nearest.blocked,
    detail: nearest.detail,
  };
}

function calendarStatusFor(
  symbol: string,
  bundle: MarketBundle,
  dates: string[]
): EarningsFetchStatus {
  const fromBundle = bundle.earningsCalendarStatus?.[symbol];
  if (fromBundle) return fromBundle;
  // Legacy / partial bundles: dates present ⇒ ok; bare [] ⇒ fail-closed empty.
  return dates.length ? 'ok' : 'empty';
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
    const earningsCalendarStatus = calendarStatusFor(symbol, bundle, earningsDates);
    const earnings = earningsFromDates(earningsDates);
    const fundamentals = bundle.fundamentals[symbol] ?? null;
    const scopedWarnings = filterDeskDataWarnings(symbol, bundle.warnings, candleSource, {
      hasFundamentals: Boolean(fundamentals),
      // Stance lines are added inside buildRecommendation when relevant.
      includeStance: false,
    });
    if (!candles.length || candleSource === 'none' || candleSource === 'demo') {
      return buildNoDataRecommendation(symbol, scopedWarnings, bundle.quotes[symbol] ?? null);
    }
    // Wide Desk calendar (lookback…+14d) supports point-in-time earnings in the
    // recent-performance replay; omit calendar when fetch failed closed.
    const recent =
      setups.length && candles.length
        ? scoreRecentSetupPerformance({
            symbol,
            setups,
            candles,
            spyCandles: bundle.candles.SPY ?? [],
            qqqCandles: bundle.candles.QQQ ?? [],
            ...(earningsCalendarStatus === 'ok' && earningsDates.length
              ? { earningsDates, earningsCalendarStatus }
              : {}),
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
      fundamentals,
      candleSource,
      warnings: scopedWarnings,
      setups,
      expectancy,
      earnings,
      earningsDates,
      earningsCalendarStatus,
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
        earningsCalendarStatus: {},
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
      tiingoProxyUrl: settings.tiingoProxyUrl || undefined,
      tiingoProxyToken: settings.tiingoProxyToken || undefined,
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
