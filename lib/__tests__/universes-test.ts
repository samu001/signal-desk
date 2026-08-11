import {
  CURATED_UNIVERSES,
  SIZE_UNIVERSES,
  THEME_UNIVERSES,
  matchingUniversePresetId,
  normalizeSymbolList,
  symbolsToField,
} from '@/constants/universes';

describe('curated universes', () => {
  it('keeps Full as Big+Mid+Small without dupes', () => {
    const full = CURATED_UNIVERSES.find((u) => u.id === 'full');
    const big = CURATED_UNIVERSES.find((u) => u.id === 'big');
    const mid = CURATED_UNIVERSES.find((u) => u.id === 'mid');
    const small = CURATED_UNIVERSES.find((u) => u.id === 'small');
    expect(full?.symbols).toEqual([
      ...(big?.symbols ?? []),
      ...(mid?.symbols ?? []),
      ...(small?.symbols ?? []),
    ]);
    expect(new Set(full?.symbols).size).toBe(full?.symbols.length);
  });

  it('exposes size buckets plus a broad theme catalog', () => {
    expect(SIZE_UNIVERSES.map((u) => u.id)).toEqual(['smoke', 'big', 'mid', 'small', 'full']);
    expect(THEME_UNIVERSES.length).toBeGreaterThanOrEqual(15);
    expect(CURATED_UNIVERSES).toEqual([...SIZE_UNIVERSES, ...THEME_UNIVERSES]);
  });

  it('keeps preset ids and normalized symbol lists unique', () => {
    const ids = CURATED_UNIVERSES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = CURATED_UNIVERSES.map((u) => normalizeSymbolList(symbolsToField(u.symbols)));
    expect(new Set(keys).size).toBe(keys.length);

    for (const preset of CURATED_UNIVERSES) {
      expect(preset.symbols.length).toBeGreaterThan(0);
      expect(new Set(preset.symbols).size).toBe(preset.symbols.length);
    }
  });

  it('matches preset ids from field text', () => {
    expect(matchingUniversePresetId('AAPL, JPM, CFG')).toBe('smoke');
    expect(matchingUniversePresetId('aapl jpm cfg')).toBe('smoke');
    expect(matchingUniversePresetId('AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA')).toBe('mag7');
    expect(matchingUniversePresetId('AAPL,ZZZ')).toBeNull();
  });

  it('normalizes symbol lists', () => {
    expect(normalizeSymbolList(' aapl, aapl  jpm ')).toBe('AAPL,JPM');
  });
});
