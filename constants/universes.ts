/**
 * Curated symbol baskets for Lab / universe scan / portfolio backtest.
 * Size buckets (Smoke→Full) match the deep-backtest performance-picked roster.
 * Thematic baskets are liquid US names for out-of-sample style testing — not
 * performance-picked on the same history as Full.
 */

export type UniversePreset = {
  id: string;
  /** Short chip label. */
  label: string;
  symbols: string[];
};

/** Optional grouping for denser chip UIs. */
export type UniversePresetGroup = {
  id: string;
  label: string;
  presets: UniversePreset[];
};

// ——— Deep-script / performance-picked size buckets ————————————————————————

export const UNIVERSE_BIG = ['AAPL', 'AMZN', 'JPM', 'XOM'] as const;
export const UNIVERSE_MID = ['FANG', 'CFG', 'WSM', 'DDOG'] as const;
export const UNIVERSE_SMALL = ['CROX', 'DUOL', 'FIX', 'IOT', 'PATH', 'RKLB'] as const;

/** Full curated basket used across Lab tools. */
export const UNIVERSE_FULL = [...UNIVERSE_BIG, ...UNIVERSE_MID, ...UNIVERSE_SMALL] as const;

/** Tiny set for a cheap API smoke test. */
export const UNIVERSE_SMOKE = ['AAPL', 'JPM', 'CFG'] as const;

// ——— Thematic liquid baskets (for broader testing) ————————————————————————

export const UNIVERSE_MAG7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'] as const;
export const UNIVERSE_MEGACAP = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'LLY',
  'AVGO',
  'JPM',
  'V',
] as const;
export const UNIVERSE_NDX = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'META',
  'GOOGL',
  'AVGO',
  'COST',
  'NFLX',
  'AMD',
] as const;
export const UNIVERSE_DOW10 = [
  'AAPL',
  'MSFT',
  'UNH',
  'GS',
  'HD',
  'CAT',
  'MCD',
  'V',
  'JPM',
  'BA',
] as const;

export const UNIVERSE_SEMIS = ['NVDA', 'AMD', 'AVGO', 'TSM', 'MU', 'AMAT', 'LRCX', 'QCOM'] as const;
export const UNIVERSE_SOFTWARE = ['MSFT', 'CRM', 'NOW', 'ORCL', 'ADBE', 'PANW', 'CRWD', 'DDOG'] as const;
export const UNIVERSE_GROWTH = ['NVDA', 'META', 'AVGO', 'LLY', 'COST', 'NFLX', 'AMD', 'ISRG'] as const;

export const UNIVERSE_BANKS = ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'BLK', 'SCHW', 'CFG'] as const;
export const UNIVERSE_REGIONAL_BANKS = ['CFG', 'KEY', 'RF', 'HBAN', 'FITB', 'MTB', 'ZION', 'CMA'] as const;
export const UNIVERSE_VALUE = ['XOM', 'JPM', 'BAC', 'CVX', 'WFC', 'IBM', 'VZ', 'PFE'] as const;

export const UNIVERSE_ENERGY = ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY', 'FANG', 'MPC'] as const;
export const UNIVERSE_HEALTH = ['UNH', 'JNJ', 'LLY', 'ABBV', 'MRK', 'TMO', 'ISRG', 'AMGN'] as const;
export const UNIVERSE_STAPLES = ['PG', 'KO', 'PEP', 'WMT', 'COST', 'MDLZ', 'CL', 'PM'] as const;
export const UNIVERSE_DEFENSIVE = ['JNJ', 'PG', 'KO', 'MRK', 'PEP', 'WMT', 'VZ', 'MCD'] as const;

export const UNIVERSE_INDUSTRIALS = ['CAT', 'DE', 'HON', 'UNP', 'GE', 'RTX', 'BA', 'EMR'] as const;
export const UNIVERSE_DEFENSE = ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'HII', 'LHX', 'TDG'] as const;
export const UNIVERSE_RETAIL = ['WMT', 'COST', 'TGT', 'HD', 'LOW', 'TJX', 'ROST', 'WSM'] as const;

export const UNIVERSE_ETFS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV'] as const;
export const UNIVERSE_SECTOR_ETFS = [
  'XLK',
  'XLF',
  'XLE',
  'XLV',
  'XLI',
  'XLY',
  'XLP',
  'XLU',
  'XLB',
  'XLRE',
] as const;

export const UNIVERSE_QUALITY = ['MSFT', 'V', 'MA', 'COST', 'UNH', 'ACN', 'ADP', 'TXN'] as const;
export const UNIVERSE_DIVIDEND = ['JNJ', 'PG', 'KO', 'PEP', 'XOM', 'CVX', 'ABBV', 'MRK'] as const;
export const UNIVERSE_MOMENTUM = ['NVDA', 'META', 'AVGO', 'LLY', 'GE', 'ANET', 'KLAC', 'CRWD'] as const;

/** Size-bucket presets (deep-script roster). */
export const SIZE_UNIVERSES: UniversePreset[] = [
  { id: 'smoke', label: 'Smoke', symbols: [...UNIVERSE_SMOKE] },
  { id: 'big', label: 'Big', symbols: [...UNIVERSE_BIG] },
  { id: 'mid', label: 'Mid', symbols: [...UNIVERSE_MID] },
  { id: 'small', label: 'Small', symbols: [...UNIVERSE_SMALL] },
  { id: 'full', label: 'Full', symbols: [...UNIVERSE_FULL] },
];

/** Broader liquid baskets for testing beyond the performance-picked Full set. */
export const THEME_UNIVERSES: UniversePreset[] = [
  { id: 'mag7', label: 'Mag7', symbols: [...UNIVERSE_MAG7] },
  { id: 'megacap', label: 'Megacap', symbols: [...UNIVERSE_MEGACAP] },
  { id: 'ndx', label: 'NDX', symbols: [...UNIVERSE_NDX] },
  { id: 'dow10', label: 'Dow10', symbols: [...UNIVERSE_DOW10] },
  { id: 'semis', label: 'Semis', symbols: [...UNIVERSE_SEMIS] },
  { id: 'software', label: 'Software', symbols: [...UNIVERSE_SOFTWARE] },
  { id: 'growth', label: 'Growth', symbols: [...UNIVERSE_GROWTH] },
  { id: 'banks', label: 'Banks', symbols: [...UNIVERSE_BANKS] },
  { id: 'regional', label: 'Regional', symbols: [...UNIVERSE_REGIONAL_BANKS] },
  { id: 'value', label: 'Value', symbols: [...UNIVERSE_VALUE] },
  { id: 'energy', label: 'Energy', symbols: [...UNIVERSE_ENERGY] },
  { id: 'health', label: 'Health', symbols: [...UNIVERSE_HEALTH] },
  { id: 'staples', label: 'Staples', symbols: [...UNIVERSE_STAPLES] },
  { id: 'defensive', label: 'Defensive', symbols: [...UNIVERSE_DEFENSIVE] },
  { id: 'industrials', label: 'Industrials', symbols: [...UNIVERSE_INDUSTRIALS] },
  { id: 'defense', label: 'Defense', symbols: [...UNIVERSE_DEFENSE] },
  { id: 'retail', label: 'Retail', symbols: [...UNIVERSE_RETAIL] },
  { id: 'quality', label: 'Quality', symbols: [...UNIVERSE_QUALITY] },
  { id: 'dividend', label: 'Dividend', symbols: [...UNIVERSE_DIVIDEND] },
  { id: 'momentum', label: 'Momentum', symbols: [...UNIVERSE_MOMENTUM] },
  { id: 'etfs', label: 'ETFs', symbols: [...UNIVERSE_ETFS] },
  { id: 'sectors', label: 'Sectors', symbols: [...UNIVERSE_SECTOR_ETFS] },
];

export const UNIVERSE_PRESET_GROUPS: UniversePresetGroup[] = [
  { id: 'size', label: 'Size buckets', presets: SIZE_UNIVERSES },
  { id: 'themes', label: 'Themes', presets: THEME_UNIVERSES },
];

/** All chip presets (size buckets first, then themes). */
export const CURATED_UNIVERSES: UniversePreset[] = [...SIZE_UNIVERSES, ...THEME_UNIVERSES];

export function symbolsToField(symbols: readonly string[]): string {
  return symbols.join(', ');
}

export function normalizeSymbolList(text: string): string {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ].join(',');
}

/** Which curated preset matches the field (if any). */
export function matchingUniversePresetId(text: string): string | null {
  const key = normalizeSymbolList(text);
  for (const preset of CURATED_UNIVERSES) {
    if (normalizeSymbolList(symbolsToField(preset.symbols)) === key) return preset.id;
  }
  return null;
}
