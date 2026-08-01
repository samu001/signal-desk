import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { actionableCandidates, buildCandidates, Candidate } from '@/lib/candidates';
import { computeSetupExpectancy, SetupExpectancy } from '@/lib/expectancy';
import { fetchMarketBundle } from '@/lib/finnhub';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import { createId, loadAppState, saveAppState } from '@/lib/storage';
import { CandleSource } from '@/lib/candles';
import {
  AppSettings,
  AppState,
  Candle,
  FundamentalSnapshot,
  NewsItem,
  Quote,
  Setup,
  Trade,
  WatchlistItem,
} from '@/types/trading';

type TradingContextValue = {
  ready: boolean;
  settings: AppSettings;
  setups: Setup[];
  watchlist: WatchlistItem[];
  trades: Trade[];
  quotes: Record<string, Quote>;
  candles: Record<string, Candle[]>;
  news: Record<string, NewsItem[]>;
  fundamentals: Record<string, FundamentalSnapshot>;
  dataSource: CandleSource | 'mixed';
  dataWarnings: string[];
  quotesLoading: boolean;
  candidates: Candidate[];
  actionable: Candidate[];
  session: SessionInfo;
  setupExpectancy: SetupExpectancy[];
  refreshQuotes: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  upsertWatchlistItem: (item: Omit<WatchlistItem, 'id' | 'createdAt'> & { id?: string }) => string;
  removeWatchlistItem: (id: string) => void;
  updateSetup: (setup: Setup) => void;
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
  const [dataSource, setDataSource] = useState<CandleSource | 'mixed'>('demo');
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [session, setSession] = useState<SessionInfo>(() => getUsEquitySession());

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

  const refreshQuotes = useCallback(async () => {
    if (!state) return;
    setQuotesLoading(true);
    setSession(getUsEquitySession());
    try {
      const symbols = [
        ...state.watchlist.map((w) => w.symbol),
        ...state.trades.filter((t) => t.status !== 'closed').map((t) => t.symbol),
      ];
      const bundle = await fetchMarketBundle(symbols, {
        finnhubApiKey: state.settings.finnhubApiKey || undefined,
        tiingoApiKey: state.settings.tiingoApiKey || undefined,
        fmpApiKey: state.settings.fmpApiKey || undefined,
        alphaVantageApiKey: state.settings.alphaVantageApiKey || undefined,
      });
      setQuotes(bundle.quotes);
      setCandles(bundle.candles);
      setNews(bundle.news);
      setFundamentals(bundle.fundamentals);
      setDataSource(bundle.sourceSummary);
      setDataWarnings(bundle.warnings);
    } finally {
      setQuotesLoading(false);
    }
  }, [state]);

  useEffect(() => {
    if (!ready || !state) return;
    void refreshQuotes();
  }, [
    ready,
    state?.watchlist,
    state?.settings.finnhubApiKey,
    state?.settings.tiingoApiKey,
    state?.settings.fmpApiKey,
    state?.settings.alphaVantageApiKey,
  ]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
  }, []);

  const upsertWatchlistItem = useCallback(
    (item: Omit<WatchlistItem, 'id' | 'createdAt'> & { id?: string }) => {
      const id = item.id ?? createId('wl');
      setState((prev) => {
        if (!prev) return prev;
        const exists = prev.watchlist.some((w) => w.id === id);
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
          createdAt: exists
            ? prev.watchlist.find((w) => w.id === id)!.createdAt
            : new Date().toISOString(),
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

  const candidates = useMemo(() => {
    if (!state) return [];
    return buildCandidates(state.watchlist, state.setups, quotes, {
      candles,
      news,
      trades: state.trades,
      session,
    });
  }, [state, quotes, candles, news, session]);

  const actionable = useMemo(() => actionableCandidates(candidates), [candidates]);

  const setupExpectancy = useMemo(
    () => (state ? computeSetupExpectancy(state.setups, state.trades) : []),
    [state]
  );

  const value = useMemo<TradingContextValue>(() => {
    const emptySettings: AppSettings = {
      accountSize: 0,
      riskPercent: 0,
      finnhubApiKey: '',
      tiingoApiKey: '',
      fmpApiKey: '',
      alphaVantageApiKey: '',
      marketBias: '',
      displayName: 'Trader',
    };

    return {
      ready,
      settings: state?.settings ?? emptySettings,
      setups: state?.setups ?? [],
      watchlist: state?.watchlist ?? [],
      trades: state?.trades ?? [],
      quotes,
      candles,
      news,
      fundamentals,
      dataSource,
      dataWarnings,
      quotesLoading,
      candidates,
      actionable,
      session,
      setupExpectancy,
      refreshQuotes,
      updateSettings,
      upsertWatchlistItem,
      removeWatchlistItem,
      updateSetup,
      addTrade,
      updateTrade,
      getSetup,
    };
  }, [
    ready,
    state,
    quotes,
    candles,
    news,
    fundamentals,
    dataSource,
    dataWarnings,
    quotesLoading,
    candidates,
    actionable,
    session,
    setupExpectancy,
    refreshQuotes,
    updateSettings,
    upsertWatchlistItem,
    removeWatchlistItem,
    updateSetup,
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
