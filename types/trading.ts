export type RuleCheckId =
  | 'above_sma_50'
  | 'above_sma_20'
  | 'sma_20_rising'
  | 'sma_cross_up'
  | 'rsi_oversold_recovering'
  | 'strong_up_day'
  | 'in_buy_zone'
  | 'near_or_in_buy_zone'
  | 'higher_low'
  | 'volume_expanding'
  | 'volume_drying'
  | 'holding_breakout_level'
  | 'not_chasing_extension'
  | 'extended_below_sma_20'
  | 'at_support_zone'
  | 'rejection_wick'
  | 'no_negative_catalyst'
  | 'rs_vs_spy'
  | 'session_tradable'
  | 'market_regime_ok'
  | 'earnings_clear'

export type Setup = {
  id: string;
  name: string;
  summary: string;
  entryRules: string[];
  /** Machine-evaluated checks that drive Today accuracy scoring. */
  entryChecks: RuleCheckId[];
  exitRules: string[];
  checklist: string[];
};

export type WatchlistItem = {
  id: string;
  symbol: string;
  thesis: string;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  setupId: string | null;
  notes: string;
  createdAt: string;
};

export type TradeStatus = 'planned' | 'open' | 'closed';

export type Trade = {
  id: string;
  symbol: string;
  setupId: string | null;
  side: 'long';
  entry: number;
  stop: number;
  target: number;
  shares: number;
  riskAmount: number;
  checklist: { label: string; checked: boolean }[];
  notes: string;
  status: TradeStatus;
  followedPlan: boolean | null;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
};

export type AppSettings = {
  accountSize: number;
  riskPercent: number;
  finnhubApiKey: string;
  /** Best free long-history EOD for backtests. */
  tiingoApiKey: string;
  /** EOD fallback + fundamentals (“what to buy” context). */
  fmpApiKey: string;
  /** Short compact history fallback (~100 bars). */
  alphaVantageApiKey: string;
  marketBias: string;
  displayName: string;
};

export type Quote = {
  symbol: string;
  price: number;
  change: number;
  percentChange: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  source: 'finnhub' | 'tiingo' | 'fmp' | 'alphavantage' | 'demo';
};

export type FundamentalSnapshot = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  roe: number | null;
  debtToEquity: number | null;
  source: 'fmp' | 'demo';
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type NewsItem = {
  id: string;
  headline: string;
  datetime: number;
  source: string;
  url?: string;
};

export type AppState = {
  settings: AppSettings;
  setups: Setup[];
  watchlist: WatchlistItem[];
  trades: Trade[];
};
