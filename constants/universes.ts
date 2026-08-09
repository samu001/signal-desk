/**
 * Curated symbol baskets for Lab / universe scan.
 * Same performance-picked roster as deep backtest (README).
 */

export type UniversePreset = {
  id: string;
  /** Short chip label. */
  label: string;
  symbols: string[];
};

export const UNIVERSE_BIG = ['AAPL', 'AMZN', 'JPM', 'XOM'] as const;
export const UNIVERSE_MID = ['FANG', 'CFG', 'WSM', 'DDOG'] as const;
export const UNIVERSE_SMALL = ['CROX', 'DUOL', 'FIX', 'IOT', 'PATH', 'RKLB'] as const;

/** Full curated basket used across Lab tools. */
export const UNIVERSE_FULL = [...UNIVERSE_BIG, ...UNIVERSE_MID, ...UNIVERSE_SMALL] as const;

/** Tiny set for a cheap API smoke test. */
export const UNIVERSE_SMOKE = ['AAPL', 'JPM', 'CFG'] as const;

export const CURATED_UNIVERSES: UniversePreset[] = [
  { id: 'smoke', label: 'Smoke', symbols: [...UNIVERSE_SMOKE] },
  { id: 'big', label: 'Big', symbols: [...UNIVERSE_BIG] },
  { id: 'mid', label: 'Mid', symbols: [...UNIVERSE_MID] },
  { id: 'small', label: 'Small', symbols: [...UNIVERSE_SMALL] },
  { id: 'full', label: 'Full', symbols: [...UNIVERSE_FULL] },
];

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
