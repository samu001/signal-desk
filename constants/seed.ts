import { AppSettings, Candle, FundamentalSnapshot, NewsItem, Setup, WatchlistItem } from '@/types/trading';

export const defaultSettings: AppSettings = {
  accountSize: 25000,
  riskPercent: 1,
  finnhubApiKey: '',
  tiingoApiKey: '',
  fmpApiKey: '',
  alphaVantageApiKey: '',
  marketBias: 'Neutral — wait for clean setups only.',
  displayName: 'Trader',
};

export const defaultSetups: Setup[] = [
  {
    id: 'setup-trend-pullback',
    name: 'Trend Pullback',
    summary: 'Buy strength after a controlled dip into support inside an uptrend.',
    entryRules: [
      'Price above the 50-day moving average',
      'Pullback into prior breakout or rising support',
      'Higher low forms with volume drying up',
      'Enter on reclaim of the pullback high',
    ],
    entryChecks: [
      'above_sma_50',
      'near_or_in_buy_zone',
      'higher_low',
      'volume_drying',
      'no_negative_catalyst',
      'rs_vs_spy',
      'session_tradable',
    ],
    exitRules: [
      'Hard stop under the pullback low',
      'Take first partial at 1.5R–2R',
      'Trail remainder under higher lows',
      'Exit if thesis level breaks on a closing basis',
    ],
    checklist: [
      'Uptrend structure still intact',
      'Entry zone is defined before clicking buy',
      'Stop distance and size calculated',
      'No open trade already in the same theme',
    ],
  },
  {
    id: 'setup-breakout-hold',
    name: 'Breakout Hold',
    summary: 'Enter after a level break when price holds above resistance as support.',
    entryRules: [
      'Clear horizontal level with multiple touches',
      'Break on expanding volume',
      'First hold above the breakout level',
      'No major opposing catalyst the same session',
    ],
    entryChecks: [
      'holding_breakout_level',
      'volume_expanding',
      'not_chasing_extension',
      'no_negative_catalyst',
      'rs_vs_spy',
      'session_tradable',
    ],
    exitRules: [
      'Stop just under the reclaimed level',
      'Scale out into measured move / prior swing',
      'Full exit if the level fails and closes back below',
    ],
    checklist: [
      'Level is marked and shared with plan',
      'Risk per share is acceptable',
      'I am not chasing after a 3R+ spike',
      'I know the invalidation before entry',
    ],
  },
  {
    id: 'setup-mean-reversion',
    name: 'Oversold Bounce',
    summary: 'Fade an extended flush into known support with a tight invalidation.',
    entryRules: [
      'Stock is extended below short-term average',
      'Touches a weekly support / prior demand zone',
      'Selling momentum slows (lower volume or wick rejection)',
      'Enter only with a defined bounce trigger candle',
    ],
    entryChecks: [
      'extended_below_sma_20',
      'at_support_zone',
      'rejection_wick',
      'no_negative_catalyst',
      'session_tradable',
    ],
    exitRules: [
      'Tight stop under the flush low',
      'Target mean reversion to VWAP or 20-day MA',
      'Time stop: exit if no bounce within 2 sessions',
    ],
    checklist: [
      'This is a bounce, not a catch-a-falling-knife',
      'Support is objective, not wishful',
      'Position size is smaller than trend trades',
      'News risk is checked',
    ],
  },
  {
    id: 'setup-simple-trend',
    name: 'Simple Trend Follow',
    summary: 'More active: buy strength while price holds above a rising 20-day average.',
    entryRules: [
      'Price closes above the 20-day moving average',
      'The 20-day average itself is rising',
      'Stay with the trend until the average breaks',
    ],
    entryChecks: ['above_sma_20', 'sma_20_rising', 'session_tradable'],
    exitRules: [
      'Stop under the recent swing low or ~3% below entry',
      'Target about 2R, or trail under the 20-day average',
    ],
    checklist: [
      'I am okay with more frequent signals',
      'Stop and size are defined before entry',
    ],
  },
  {
    id: 'setup-ma-cross',
    name: 'MA Crossover',
    summary: 'More active: buy when the 10-day average crosses above the 30-day average.',
    entryRules: [
      '10-day MA crosses above 30-day MA (within a couple sessions)',
      'Price is still above the 20-day average',
      'Avoid if a hard negative catalyst just hit',
    ],
    entryChecks: ['sma_cross_up', 'above_sma_20', 'session_tradable'],
    exitRules: [
      'Stop under the 30-day average or recent swing low',
      'Exit if the 10-day crosses back below the 30-day',
      'Scale out near 2R',
    ],
    checklist: [
      'Cross is fresh, not weeks old',
      'I am not buying into a vertical spike',
    ],
  },
  {
    id: 'setup-rsi-oversold',
    name: 'RSI Oversold Bounce',
    summary: 'More active: buy short-term washouts when RSI turns up from oversold.',
    entryRules: [
      'RSI(14) recently dipped to ~35 or lower',
      'RSI is turning up and still below 50',
      'Use a tight stop under the flush low',
    ],
    entryChecks: ['rsi_oversold_recovering', 'session_tradable'],
    exitRules: [
      'Tight stop under the recent low',
      'Take profits into the first bounce / toward the 20-day MA',
      'Time stop if no bounce within a few sessions',
    ],
    checklist: [
      'This is a bounce trade, size smaller',
      'I know the invalidation low',
    ],
  },
  {
    id: 'setup-momentum-gap',
    name: 'Momentum / Gap-and-Go',
    summary: 'More active: buy strong up days with expanding volume (momentum continuation).',
    entryRules: [
      'Strong up day (about +1.2% or more), preferably with a gap up',
      'Volume expands vs the 20-day average',
      'Do not chase already-extended multi-day spikes blindly',
    ],
    entryChecks: ['strong_up_day', 'volume_expanding', 'session_tradable'],
    exitRules: [
      'Stop under the signal-day low',
      'Take first profits near 2R',
      'Exit if momentum fades back into the signal-day range',
    ],
    checklist: [
      'I accept higher whipsaw risk for more activity',
      'Position size accounts for wider daily ranges',
    ],
  },
  {
    id: 'setup-trend-pullback-active',
    name: 'Trend Pullback (Active)',
    summary: 'Looser version of Trend Pullback — fewer filters so it triggers more often.',
    entryRules: [
      'Price above the 50-day moving average',
      'Near the pullback / buy zone',
      'Skip the stricter volume and relative-strength filters',
    ],
    entryChecks: ['above_sma_50', 'near_or_in_buy_zone', 'session_tradable'],
    exitRules: [
      'Hard stop under the pullback low',
      'Take first partial at 1.5R–2R',
      'Exit if the thesis level breaks on a closing basis',
    ],
    checklist: [
      'I know this fires more often than the strict pullback',
      'Stop distance and size are still calculated',
    ],
  },
];

export const defaultWatchlist: WatchlistItem[] = [
  {
    id: 'wl-aapl',
    symbol: 'AAPL',
    thesis: 'Trend pullback into rising support after earnings digestion.',
    entryLow: 205,
    entryHigh: 212,
    stop: 198,
    target: 230,
    setupId: 'setup-trend-pullback',
    notes: 'Wait for reclaim of prior day high inside the zone.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'wl-nvda',
    symbol: 'NVDA',
    thesis: 'Breakout hold above consolidation if breadth cooperates.',
    entryLow: 118,
    entryHigh: 122,
    stop: 112,
    target: 140,
    setupId: 'setup-breakout-hold',
    notes: 'Skip if market bias is defensive.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'wl-msft',
    symbol: 'MSFT',
    thesis: 'Quality name for controlled pullback entries only.',
    entryLow: 400,
    entryHigh: 410,
    stop: 392,
    target: 440,
    setupId: 'setup-trend-pullback',
    notes: 'Prefer opening range hold confirmation.',
    createdAt: new Date().toISOString(),
  },
];

/** Demo quotes used when no Finnhub key is set. */
export const demoQuotes: Record<
  string,
  { price: number; change: number; percentChange: number; high: number; low: number; open: number; previousClose: number }
> = {
  AAPL: { price: 208.4, change: 1.2, percentChange: 0.58, high: 209.1, low: 206.8, open: 207.2, previousClose: 207.2 },
  NVDA: { price: 120.6, change: -1.4, percentChange: -1.15, high: 123.0, low: 119.8, open: 122.0, previousClose: 122.0 },
  MSFT: { price: 406.2, change: 0.9, percentChange: 0.22, high: 407.5, low: 403.1, open: 405.0, previousClose: 405.3 },
  SPY: { price: 548.1, change: 0.4, percentChange: 0.07, high: 549.0, low: 546.2, open: 547.5, previousClose: 547.7 },
};

function buildSeries(
  start: number,
  pattern: Array<{ close: number; volume: number; wick?: 'up' | 'down' | 'reject' }>
): Candle[] {
  const day = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  let prev = start;
  return pattern.map((bar, i) => {
    const close = bar.close;
    const open = prev;
    let high = Math.max(open, close) * 1.004;
    let low = Math.min(open, close) * 0.996;
    if (bar.wick === 'reject') {
      low = Math.min(open, close) * 0.985;
      high = Math.max(open, close) * 1.002;
    } else if (bar.wick === 'up') {
      high = Math.max(open, close) * 1.02;
    } else if (bar.wick === 'down') {
      low = Math.min(open, close) * 0.98;
    }
    prev = close;
    return {
      time: now - (pattern.length - i) * day,
      open,
      high,
      low,
      close,
      volume: bar.volume,
    };
  });
}

/** Demo daily history shaped to exercise the rule engine offline. */
export const demoCandles: Record<string, Candle[]> = {
  // Uptrend + pullback into zone with drying volume / higher low.
  AAPL: buildSeries(
    180,
    [
      ...Array.from({ length: 55 }, (_, i) => ({
        close: 180 + i * 0.55,
        volume: 60_000_000 + (i % 5) * 1_000_000,
      })),
      { close: 214, volume: 90_000_000 },
      { close: 211, volume: 70_000_000 },
      { close: 208.5, volume: 55_000_000 },
      { close: 207.2, volume: 48_000_000 },
      { close: 208.4, volume: 45_000_000, wick: 'reject' as const },
    ]
  ),
  // Breakout hold above ~118–122 with expanding volume.
  NVDA: buildSeries(
    100,
    [
      ...Array.from({ length: 45 }, (_, i) => ({
        close: 100 + Math.sin(i / 4) * 2 + i * 0.15,
        volume: 40_000_000,
      })),
      { close: 117, volume: 55_000_000 },
      { close: 121.5, volume: 95_000_000 },
      { close: 120.8, volume: 88_000_000 },
      { close: 120.6, volume: 82_000_000 },
    ]
  ),
  // Mild uptrend, currently above zone (waiting).
  MSFT: buildSeries(
    380,
    [
      ...Array.from({ length: 50 }, (_, i) => ({
        close: 380 + i * 0.55,
        volume: 25_000_000 + (i % 7) * 500_000,
      })),
      { close: 412, volume: 30_000_000 },
      { close: 409, volume: 24_000_000 },
      { close: 406.2, volume: 22_000_000 },
    ]
  ),
  SPY: buildSeries(
    520,
    Array.from({ length: 60 }, (_, i) => ({
      close: 520 + i * 0.45,
      volume: 70_000_000,
    }))
  ),
  // Tech-heavy benchmark for regime confirmation (mirrors SPY uptrend offline).
  QQQ: buildSeries(
    430,
    Array.from({ length: 60 }, (_, i) => ({
      close: 430 + i * 0.55,
      volume: 45_000_000,
    }))
  ),
};

function hashSymbol(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic synthetic history for unknown tickers when no API keys are set. */
export function buildSyntheticDemoCandles(symbol: string, endPrice?: number): Candle[] {
  const upper = symbol.toUpperCase().trim() || 'DEMO';
  const h = hashSymbol(upper);
  const price = endPrice && endPrice > 0 ? endPrice : 40 + (h % 260);
  const bars = 70;
  const start = price * (0.78 + (h % 17) / 100);
  const pattern = Array.from({ length: bars }, (_, i) => {
    const t = i / (bars - 1);
    const wave = Math.sin(i / 5 + (h % 7)) * price * 0.012;
    const drift = (price - start) * t;
    const close = Math.max(1, start + drift + wave);
    const volume = 8_000_000 + ((h + i * 997) % 20) * 400_000;
    const wick = i === bars - 1 && h % 3 === 0 ? ('reject' as const) : undefined;
    return { close, volume, wick };
  });
  // Pin the last close near the quoted demo price when available.
  pattern[pattern.length - 1] = {
    ...pattern[pattern.length - 1],
    close: price,
  };
  return buildSeries(start, pattern);
}

export function getDemoCandles(symbol: string): Candle[] {
  const upper = symbol.toUpperCase().trim();
  if (demoCandles[upper]) return demoCandles[upper];
  const quote = demoQuotes[upper];
  return buildSyntheticDemoCandles(upper, quote?.price);
}

/** Demo company snapshots used when no FMP key is set. */
export const demoFundamentals: Record<string, FundamentalSnapshot> = {
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 3_200_000_000_000,
    pe: 32.4,
    pb: 48.1,
    profitMargin: 0.24,
    revenueGrowth: 0.06,
    roe: 1.47,
    debtToEquity: 1.5,
    source: 'demo',
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    sector: 'Technology',
    industry: 'Semiconductors',
    marketCap: 2_900_000_000_000,
    pe: 55.2,
    pb: 48.0,
    profitMargin: 0.55,
    revenueGrowth: 0.72,
    roe: 1.15,
    debtToEquity: 0.25,
    source: 'demo',
  },
  MSFT: {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    sector: 'Technology',
    industry: 'Software',
    marketCap: 3_100_000_000_000,
    pe: 35.8,
    pb: 12.4,
    profitMargin: 0.36,
    revenueGrowth: 0.14,
    roe: 0.38,
    debtToEquity: 0.45,
    source: 'demo',
  },
};

export function getDemoFundamentals(symbol: string): FundamentalSnapshot {
  const upper = symbol.toUpperCase().trim();
  if (demoFundamentals[upper]) return { ...demoFundamentals[upper] };
  const h = hashSymbol(upper);
  return {
    symbol: upper,
    name: `${upper} (demo)`,
    sector: ['Technology', 'Healthcare', 'Industrials', 'Consumer'][h % 4],
    industry: 'Demo industry',
    marketCap: (10 + (h % 90)) * 1_000_000_000,
    pe: 12 + (h % 28),
    pb: 2 + (h % 10),
    profitMargin: 0.04 + (h % 20) / 100,
    revenueGrowth: -0.02 + (h % 18) / 100,
    roe: 0.06 + (h % 25) / 100,
    debtToEquity: 0.2 + (h % 15) / 10,
    source: 'demo',
  };
}

/** Demo headlines used when no Finnhub key is set. */
export const demoNews: Record<string, NewsItem[]> = {
  AAPL: [
    {
      id: 'demo-aapl-1',
      headline: 'Apple suppliers see steady demand into next product cycle',
      datetime: Math.floor(Date.now() / 1000) - 3600 * 8,
      source: 'Demo Wire',
    },
    {
      id: 'demo-aapl-2',
      headline: 'Services growth remains the quiet stabilizer for Apple margins',
      datetime: Math.floor(Date.now() / 1000) - 3600 * 26,
      source: 'Demo Wire',
    },
  ],
  NVDA: [
    {
      id: 'demo-nvda-1',
      headline: 'Chip demand stays firm as AI infrastructure spending continues',
      datetime: Math.floor(Date.now() / 1000) - 3600 * 5,
      source: 'Demo Wire',
    },
    {
      id: 'demo-nvda-2',
      headline: 'Traders watch consolidation after recent breakout attempt',
      datetime: Math.floor(Date.now() / 1000) - 3600 * 20,
      source: 'Demo Wire',
    },
  ],
  MSFT: [
    {
      id: 'demo-msft-1',
      headline: 'Cloud backlog supports Microsoft quality-growth narrative',
      datetime: Math.floor(Date.now() / 1000) - 3600 * 10,
      source: 'Demo Wire',
    },
  ],
};

export function getDemoNews(symbol: string): NewsItem[] {
  const upper = symbol.toUpperCase().trim();
  if (demoNews[upper]) return demoNews[upper];
  return [
    {
      id: `demo-${upper}-1`,
      headline: `${upper} trading in a quiet stretch with no major catalyst headlines`,
      datetime: Math.floor(Date.now() / 1000) - 3600 * 12,
      source: 'Demo Wire',
    },
  ];
}
