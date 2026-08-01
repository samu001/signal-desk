import { AppSettings, Candle, Setup, WatchlistItem } from '@/types/trading';

export const defaultSettings: AppSettings = {
  accountSize: 25000,
  riskPercent: 1,
  finnhubApiKey: '',
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
};
