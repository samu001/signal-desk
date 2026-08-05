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
  | 'weekly_trend_ok'
  | 'sector_rs_ok'
  | 'volatility_ok'
  | 'prior_day_high_break'
  | 'ema_stack_bull'
  | 'near_ema_21'
  | 'twenty_day_high'
  | 'volume_thrust_after_dryup'
  | 'mean_reclaim'
  | 'post_earnings_hold'
  | 'bull_flag_break'
  | 'atr_expansion_day'
  | 'two_day_flush_reversal'
  | 'inside_day_breakout'
  | 'near_52w_high'
  | 'first_touch_sma_20'

export type Setup = {
  id: string;
  name: string;
  summary: string;
  entryRules: string[];
  /** Machine-evaluated checks that drive Dashboard pass/fail scoring (not editable in UI). */
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
  /**
   * Last Desk Soft/Strong gate. false = research-only (Wait/Avoid).
   * null/undefined = not signaled yet (or legacy row).
   */
  deskTradeable?: boolean | null;
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
  /**
   * Cloudflare Worker base URL for Tiingo EOD on web (no trailing slash).
   * Example: https://edge-stock-tiingo.xxx.workers.dev
   * Token stays in the Worker (TIINGO_TOKEN); optional PROXY_TOKEN via tiingoProxyToken.
   */
  tiingoProxyUrl: string;
  /** Optional Worker auth token (PROXY_TOKEN) for the Tiingo proxy. */
  tiingoProxyToken: string;
  /**
   * Cloudflare Worker base URL for Yahoo EOD (no trailing slash).
   * Example: https://signal-desk-bars.xxx.workers.dev
   */
  yahooProxyUrl: string;
  /** Optional Worker auth token (PROXY_TOKEN). */
  yahooProxyToken: string;
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
  source: 'finnhub' | 'tiingo' | 'fmp' | 'yahoo' | 'alphavantage' | 'demo' | 'none';
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
