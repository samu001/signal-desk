export type Setup = {
  id: string;
  name: string;
  summary: string;
  entryRules: string[];
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
  source: 'finnhub' | 'demo';
};

export type AppState = {
  settings: AppSettings;
  setups: Setup[];
  watchlist: WatchlistItem[];
  trades: Trade[];
};
