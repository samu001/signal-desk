import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AWAITING_DESK_THESIS } from '@/constants/watchlist';
import { actionableCandidates, buildCandidates, Candidate } from '@/lib/candidates';
import { computeSetupExpectancy, SetupExpectancy } from '@/lib/expectancy';
import { preferLiveCandleQuotes, clearCandleCache, CandleSource } from '@/lib/candles';
import {
  clearMarketBundleInflight,
  EarningsFetchStatus,
  fetchMarketBundle,
  fetchQuotes,
  MarketBundle,
} from '@/lib/finnhub';
import { clearFundamentalsCache } from '@/lib/fmp';
import {
  committedPositionCount,
  normalizeLiveBehavior,
} from '@/lib/liveBehavior';
import { Recommendation } from '@/lib/recommend';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import { createId, enabledSetupsOf, loadAppState, saveAppState } from '@/lib/storage';
import {
  AppSettings,
  AppState,
  Candle,
  FundamentalSnapshot,
  LiveBehaviorConfig,
  NewsItem,
  Quote,
  Setup,
  Trade,
  WatchlistItem,
} from '@/types/trading';

type TradingContextValue = {
  ready: boolean;
  settings: AppSettings;
  /** Live dashboard signal behavior — same knobs as the Portfolio backtest. */
  liveBehavior: LiveBehaviorConfig;
  /** Merge a patch into the persisted live behavior config. */
  updateLiveBehavior: (patch: Partial<LiveBehaviorConfig>) => void;
  /** Open + planned trades (counts toward the live max-open cap). */
  openPositionCount: number;
  /** True when the Live behavior max-open cap is reached (0 cap = never). */
  maxOpenReached: boolean;
  /** Full Playbook roster (including toggled-off setups). */
  setups: Setup[];
  /** Setups currently on — Desk, candidates, and combined backtests use only these. */
  enabledSetups: Setup[];
  watchlist: WatchlistItem[];
  trades: Trade[];
  quotes: Record<string, Quote>;
  candles: Record<string, Candle[]>;
  news: Record<string, NewsItem[]>;
  fundamentals: Record<string, FundamentalSnapshot>;
  /** Last full market snapshot (for Desk reuse). */
  marketBundle: MarketBundle | null;
  dataSource: CandleSource | 'mixed';
  dataWarnings: string[];
  quotesLoading: boolean;
  /** Epoch ms of last successful quote refresh. */
  quotesUpdatedAt: number | null;
  /** Epoch ms of last applyDeskSignals write. */
  signalsUpdatedAt: number | null;
  /** True when quotes are newer than Desk levels — Refresh signals recommended. */
  signalsStale: boolean;
  candidates: Candidate[];
  actionable: Candidate[];
  session: SessionInfo;
  setupExpectancy: SetupExpectancy[];
  refreshQuotes: () => Promise<void>;
  /** Full quotes + EOD + news + fundamentals (cold start / API key change). */
  refreshMarketData: () => Promise<void>;
  /** Merge a Desk/market pull into context so later Desk calls can reuse it. */
  ingestMarketBundle: (bundle: MarketBundle) => void;
  /**
   * Drop EOD disk + in-memory API caches (candles, fundamentals, cooldowns, bundle).
   * Does not touch settings, watchlist, or trades.
   */
  clearDataCaches: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  upsertWatchlistItem: (
    item: Omit<WatchlistItem, 'id' | 'createdAt'> & { id?: string; deskTradeable?: boolean | null }
  ) => string;
  /** Add a ticker by symbol only — caller should run Desk to fill levels. */
  addWatchlistSymbol: (symbol: string) => { id: string; created: boolean };
  /** Write Desk recommendation levels / best setup back onto matching watchlist rows. */
  applyDeskSignals: (recommendations: Recommendation[]) => void;
  removeWatchlistItem: (id: string) => void;
  updateSetup: (setup: Setup) => void;
  setSetupEnabled: (id: string, enabled: boolean) => void;
  addTrade: (trade: Omit<Trade, 'id'>) => string;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  getSetup: (id: string | null | undefined) => Setup | null;
};

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [fundamentals, setFundamentals] = useState<Record<string, FundamentalSnapshot>>({});
  const [earningsDates, setEarningsDates] = useState<Record<string, string[]>>({});
  const [earningsCalendarStatus, setEarningsCalendarStatus] = useState<
    Record<string, EarningsFetchStatus>
  >({});
  const [marketBundle, setMarketBundle] = useState<MarketBundle | null>(null);
  const [dataSource, setDataSource] = useState<CandleSource | 'mixed'>('none');
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesUpdatedAt, setQuotesUpdatedAt] = useState<number | null>(null);
  const [signalsUpdatedAt, setSignalsUpdatedAt] = useState<number | null>(null);
  const [session, setSession] = useState<SessionInfo>(() => getUsEquitySession());

  const stateRef = useRef(state);
  stateRef.current = state;
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const marketBundleRef = useRef(marketBundle);
  marketBundleRef.current = marketBundle;
  const prevApiKeysRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const loaded = await loadAppState();
      if (mounted) {
        setState(loaded);
        setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    void saveAppState(state);
  }, [state]);

  useEffect(() => {
    const id = setInterval(() => setSession(getUsEquitySession()), 60_000);
    return () => clearInterval(id);
  }, []);

  const watchlistSymbolsKey = useMemo(
    () =>
      (state?.watchlist ?? [])
        .map((w) => w.symbol.toUpperCase())
        .sort()
        .join(','),
    [state?.watchlist]
  );

  const openTradeSymbolsKey = useMemo(
    () =>
      (state?.trades ?? [])
        .filter((t) => t.status !== 'closed')
        .map((t) => t.symbol.toUpperCase())
        .sort()
        .join(','),
    [state?.trades]
  );

  const apiKeysKey = useMemo(() => {
    const s = state?.settings;
    if (!s) return '';
    return [
      s.finnhubApiKey,
      s.tiingoApiKey,
      s.tiingoProxyUrl,
      s.tiingoProxyToken,
      s.fmpApiKey,
      s.alphaVantageApiKey,
      s.yahooProxyUrl,
      s.yahooProxyToken,
    ].join('|');
  }, [
    state?.settings.finnhubApiKey,
    state?.settings.tiingoApiKey,
    state?.settings.tiingoProxyUrl,
    state?.settings.tiingoProxyToken,
    state?.settings.fmpApiKey,
    state?.settings.alphaVantageApiKey,
    state?.settings.yahooProxyUrl,
    state?.settings.yahooProxyToken,
  ]);

  const symbolList = useCallback(() => {
    const current = stateRef.current;
    if (!current) return [] as string[];
    return [
      ...current.watchlist.map((w) => w.symbol),
      ...current.trades.filter((t) => t.status !== 'closed').map((t) => t.symbol),
    ];
  }, []);

  /** Pull-to-refresh / light updates — Finnhub quotes, Yahoo backup, keep cached EOD. */
  const refreshQuotes = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    setQuotesLoading(true);
    setSession(getUsEquitySession());
    try {
      const symbols = [...symbolList(), 'SPY', 'QQQ'];
      let nextQuotes = await fetchQuotes(
        symbols,
        current.settings.finnhubApiKey || undefined,
        {
          yahooProxyUrl: current.settings.yahooProxyUrl || undefined,
          yahooProxyToken: current.settings.yahooProxyToken || undefined,
        }
      );
      const cachedSources = marketBundleRef.current?.candleSources ?? {};
      const lifted = preferLiveCandleQuotes(nextQuotes, candlesRef.current, cachedSources);
      nextQuotes = lifted.quotes;
      setQuotes((prev) => ({ ...prev, ...nextQuotes }));
      setMarketBundle((prev) =>
        prev
          ? {
              ...prev,
              quotes: { ...prev.quotes, ...nextQuotes },
            }
          : prev
      );
      setQuotesUpdatedAt(Date.now());
    } finally {
      setQuotesLoading(false);
    }
  }, [symbolList]);

  /** Cold start / API key change — full market bundle (candles, news, fundamentals). */
  const refreshMarketData = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    setQuotesLoading(true);
    setSession(getUsEquitySession());
    try {
      const bundle = await fetchMarketBundle(symbolList(), {
        finnhubApiKey: current.settings.finnhubApiKey || undefined,
        tiingoApiKey: current.settings.tiingoApiKey || undefined,
        tiingoProxyUrl: current.settings.tiingoProxyUrl || undefined,
        tiingoProxyToken: current.settings.tiingoProxyToken || undefined,
        fmpApiKey: current.settings.fmpApiKey || undefined,
        alphaVantageApiKey: current.settings.alphaVantageApiKey || undefined,
        yahooProxyUrl: current.settings.yahooProxyUrl || undefined,
        yahooProxyToken: current.settings.yahooProxyToken || undefined,
      });
      setQuotes(bundle.quotes);
      setCandles(bundle.candles);
      setNews(bundle.news);
      setFundamentals(bundle.fundamentals);
      setEarningsDates(bundle.earningsDates);
      setEarningsCalendarStatus(bundle.earningsCalendarStatus ?? {});
      setMarketBundle(bundle);
      setDataSource(bundle.sourceSummary);
      setDataWarnings(bundle.warnings);
      setQuotesUpdatedAt(Date.now());
    } finally {
      setQuotesLoading(false);
    }
  }, [symbolList]);

  useEffect(() => {
    if (!ready || !stateRef.current) return;
    const keysChanged =
      prevApiKeysRef.current !== null && prevApiKeysRef.current !== apiKeysKey;
    prevApiKeysRef.current = apiKeysKey;

    const spyBars = candlesRef.current.SPY?.length ?? 0;
    const cold = spyBars < 60;

    // Full bundle only on cold start or API key change. Symbol-list edits use quotes-only;
    // Desk / Refresh signals fill EOD for new tickers (candle TTL keeps SPY/QQQ warm).
    if (cold || keysChanged) {
      void refreshMarketData();
    } else {
      void refreshQuotes();
    }
  }, [ready, watchlistSymbolsKey, openTradeSymbolsKey, apiKeysKey, refreshMarketData, refreshQuotes]);

  const ingestMarketBundle = useCallback((bundle: MarketBundle) => {
    setQuotes((prev) => ({ ...prev, ...bundle.quotes }));
    setCandles((prev) => ({ ...prev, ...bundle.candles }));
    setNews((prev) => ({ ...prev, ...bundle.news }));
    setFundamentals((prev) => ({ ...prev, ...bundle.fundamentals }));
    setEarningsDates((prev) => ({ ...prev, ...bundle.earningsDates }));
    setEarningsCalendarStatus((prev) => ({
      ...prev,
      ...(bundle.earningsCalendarStatus ?? {}),
    }));
    setMarketBundle((prev) =>
      prev
        ? {
            quotes: { ...prev.quotes, ...bundle.quotes },
            candles: { ...prev.candles, ...bundle.candles },
            candleSources: { ...prev.candleSources, ...bundle.candleSources },
            news: { ...prev.news, ...bundle.news },
            fundamentals: { ...prev.fundamentals, ...bundle.fundamentals },
            earningsDates: { ...prev.earningsDates, ...bundle.earningsDates },
            earningsCalendarStatus: {
              ...(prev.earningsCalendarStatus ?? {}),
              ...(bundle.earningsCalendarStatus ?? {}),
            },
            sourceSummary: bundle.sourceSummary,
            // Latest fetch wins — do not accumulate stale other-ticker provider noise.
            warnings: bundle.warnings,
          }
        : bundle
    );
    setDataSource(bundle.sourceSummary);
    setDataWarnings(bundle.warnings);
    setQuotesUpdatedAt(Date.now());
  }, []);

  const clearDataCaches = useCallback(async () => {
    await clearCandleCache();
    clearFundamentalsCache();
    clearMarketBundleInflight();
    setCandles({});
    setNews({});
    setFundamentals({});
    setEarningsDates({});
    setEarningsCalendarStatus({});
    setMarketBundle(null);
    setDataSource('none');
    setDataWarnings([]);
    setQuotesUpdatedAt(null);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
  }, []);

  const updateLiveBehavior = useCallback((patch: Partial<LiveBehaviorConfig>) => {
    setState((prev) => {
      if (!prev) return prev;
      const current = normalizeLiveBehavior(prev.settings.liveBehavior);
      return {
        ...prev,
        settings: {
          ...prev.settings,
          liveBehavior: normalizeLiveBehavior({ ...current, ...patch }),
        },
      };
    });
  }, []);

  const upsertWatchlistItem = useCallback(
    (item: Omit<WatchlistItem, 'id' | 'createdAt'> & { id?: string }) => {
      const id = item.id ?? createId('wl');
      setState((prev) => {
        if (!prev) return prev;
        const exists = prev.watchlist.some((w) => w.id === id);
        const existingItem = exists ? prev.watchlist.find((w) => w.id === id) : undefined;
        const nextItem: WatchlistItem = {
          id,
          symbol: item.symbol.toUpperCase().trim(),
          thesis: item.thesis,
          entryLow: item.entryLow,
          entryHigh: item.entryHigh,
          stop: item.stop,
          target: item.target,
          setupId: item.setupId,
          notes: item.notes,
          createdAt: existingItem?.createdAt ?? new Date().toISOString(),
          deskTradeable:
            item.deskTradeable !== undefined
              ? item.deskTradeable
              : existingItem?.deskTradeable ?? null,
        };
        return {
          ...prev,
          watchlist: exists
            ? prev.watchlist.map((w) => (w.id === id ? nextItem : w))
            : [nextItem, ...prev.watchlist],
        };
      });
      return id;
    },
    []
  );

  const addWatchlistSymbol = useCallback((symbol: string) => {
    const upper = symbol.toUpperCase().trim();
    if (!upper) {
      throw new Error('Enter a stock ticker first.');
    }
    let result = { id: '', created: false };
    setState((prev) => {
      if (!prev) return prev;
      const existing = prev.watchlist.find((w) => w.symbol.toUpperCase() === upper);
      if (existing) {
        result = { id: existing.id, created: false };
        return prev;
      }
      const id = createId('wl');
      result = { id, created: true };
      const nextItem: WatchlistItem = {
        id,
        symbol: upper,
        thesis: AWAITING_DESK_THESIS,
        entryLow: 0,
        entryHigh: 0,
        stop: 0,
        target: 0,
        setupId: null,
        notes: '',
        createdAt: new Date().toISOString(),
        deskTradeable: null,
      };
      return { ...prev, watchlist: [nextItem, ...prev.watchlist] };
    });
    return result;
  }, []);

  const applyDeskSignals = useCallback((recommendations: Recommendation[]) => {
    if (!recommendations.length) return;
    const bySymbol = Object.fromEntries(
      recommendations.map((r) => [r.symbol.toUpperCase(), r])
    );
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        watchlist: prev.watchlist.map((item) => {
          const rec = bySymbol[item.symbol.toUpperCase()];
          if (!rec) return item;
          const bestSetupId = rec.matchedSetups[0]?.setupId ?? item.setupId;
          return {
            ...item,
            // Keep thesis in sync with the latest Desk stance (machine-authored).
            thesis: rec.summary,
            entryLow: rec.levels.entryLow,
            entryHigh: rec.levels.entryHigh,
            stop: rec.levels.stop,
            target: rec.levels.target,
            setupId: bestSetupId,
            deskTradeable: rec.tradeable,
          };
        }),
      };
    });
    setSignalsUpdatedAt(Date.now());
  }, []);

  const removeWatchlistItem = useCallback((id: string) => {
    setState((prev) =>
      prev ? { ...prev, watchlist: prev.watchlist.filter((w) => w.id !== id) } : prev
    );
  }, []);

  const updateSetup = useCallback((setup: Setup) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            setups: prev.setups.map((s) => (s.id === setup.id ? setup : s)),
          }
        : prev
    );
  }, []);

  const setSetupEnabled = useCallback((id: string, enabled: boolean) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            setups: prev.setups.map((s) => (s.id === id ? { ...s, enabled } : s)),
          }
        : prev
    );
  }, []);

  const addTrade = useCallback((trade: Omit<Trade, 'id'>) => {
    const id = createId('tr');
    setState((prev) =>
      prev
        ? {
            ...prev,
            trades: [{ ...trade, id }, ...prev.trades],
          }
        : prev
    );
    return id;
  }, []);

  const updateTrade = useCallback((id: string, patch: Partial<Trade>) => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            trades: prev.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }
        : prev
    );
  }, []);

  const getSetup = useCallback(
    (id: string | null | undefined) => {
      if (!id || !state) return null;
      return state.setups.find((s) => s.id === id) ?? null;
    },
    [state]
  );

  const enabledSetups = useMemo(
    () => (state ? enabledSetupsOf(state.setups) : []),
    [state]
  );

  const liveBehavior = useMemo(
    () => normalizeLiveBehavior(state?.settings.liveBehavior),
    [state?.settings.liveBehavior]
  );

  const openPositionCount = useMemo(
    () => committedPositionCount(state?.trades ?? []),
    [state?.trades]
  );

  const maxOpenReached =
    liveBehavior.maxOpenPositions > 0 && openPositionCount >= liveBehavior.maxOpenPositions;

  const candidates = useMemo(() => {
    if (!state) return [];
    return buildCandidates(state.watchlist, enabledSetups, quotes, {
      candles,
      news,
      earningsDates,
      earningsCalendarStatus,
      trades: state.trades,
      session,
      gates: liveBehavior.gates,
    });
  }, [
    state,
    enabledSetups,
    quotes,
    candles,
    news,
    earningsDates,
    earningsCalendarStatus,
    session,
    liveBehavior.gates,
  ]);

  const actionable = useMemo(() => actionableCandidates(candidates), [candidates]);

  const setupExpectancy = useMemo(
    () => (state ? computeSetupExpectancy(state.setups, state.trades) : []),
    [state]
  );

  const signalsStale = useMemo(() => {
    if (!quotesUpdatedAt) return false;
    if (!state?.watchlist.some((w) => w.entryHigh > 0)) return false;
    // Levels exist from a prior session but Desk hasn't run this session yet.
    if (!signalsUpdatedAt) return true;
    return quotesUpdatedAt > signalsUpdatedAt;
  }, [quotesUpdatedAt, signalsUpdatedAt, state?.watchlist]);

  const value = useMemo<TradingContextValue>(() => {
    const emptySettings: AppSettings = {
      accountSize: 0,
      riskPercent: 0,
      finnhubApiKey: '',
      tiingoApiKey: '',
      tiingoProxyUrl: '',
      tiingoProxyToken: '',
      fmpApiKey: '',
      alphaVantageApiKey: '',
      yahooProxyUrl: '',
      yahooProxyToken: '',
      marketBias: '',
      displayName: 'Trader',
      liveBehavior: normalizeLiveBehavior(undefined),
    };

    return {
      ready,
      settings: state?.settings ?? emptySettings,
      liveBehavior,
      updateLiveBehavior,
      openPositionCount,
      maxOpenReached,
      setups: state?.setups ?? [],
      enabledSetups,
      watchlist: state?.watchlist ?? [],
      trades: state?.trades ?? [],
      quotes,
      candles,
      news,
      fundamentals,
      marketBundle,
      dataSource,
      dataWarnings,
      quotesLoading,
      quotesUpdatedAt,
      signalsUpdatedAt,
      signalsStale,
      candidates,
      actionable,
      session,
      setupExpectancy,
      refreshQuotes,
      refreshMarketData,
      ingestMarketBundle,
      clearDataCaches,
      updateSettings,
      upsertWatchlistItem,
      addWatchlistSymbol,
      applyDeskSignals,
      removeWatchlistItem,
      updateSetup,
      setSetupEnabled,
      addTrade,
      updateTrade,
      getSetup,
    };
  }, [
    ready,
    state,
    liveBehavior,
    updateLiveBehavior,
    openPositionCount,
    maxOpenReached,
    enabledSetups,
    quotes,
    candles,
    news,
    fundamentals,
    marketBundle,
    dataSource,
    dataWarnings,
    quotesLoading,
    quotesUpdatedAt,
    signalsUpdatedAt,
    signalsStale,
    candidates,
    actionable,
    session,
    setupExpectancy,
    refreshQuotes,
    refreshMarketData,
    ingestMarketBundle,
    clearDataCaches,
    updateSettings,
    upsertWatchlistItem,
    addWatchlistSymbol,
    applyDeskSignals,
    removeWatchlistItem,
    updateSetup,
    setSetupEnabled,
    addTrade,
    updateTrade,
    getSetup,
  ]);

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}

export function useTrading() {
  const ctx = useContext(TradingContext);
  if (!ctx) {
    throw new Error('useTrading must be used within TradingProvider');
  }
  return ctx;
}
