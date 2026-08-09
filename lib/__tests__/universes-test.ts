import { CURATED_UNIVERSES, matchingUniversePresetId, normalizeSymbolList } from '@/constants/universes';

describe('curated universes', () => {
  it('keeps Full as Big+Mid+Small without dupes', () => {
    const full = CURATED_UNIVERSES.find((u) => u.id === 'full');
    const big = CURATED_UNIVERSES.find((u) => u.id === 'big');
    const mid = CURATED_UNIVERSES.find((u) => u.id === 'mid');
    const small = CURATED_UNIVERSES.find((u) => u.id === 'small');
    expect(full?.symbols).toEqual([...(big?.symbols ?? []), ...(mid?.symbols ?? []), ...(small?.symbols ?? [])]);
    expect(new Set(full?.symbols).size).toBe(full?.symbols.length);
  });

  it('matches preset ids from field text', () => {
    expect(matchingUniversePresetId('AAPL, JPM, CFG')).toBe('smoke');
    expect(matchingUniversePresetId('aapl jpm cfg')).toBe('smoke');
    expect(matchingUniversePresetId('AAPL,ZZZ')).toBeNull();
  });

  it('normalizes symbol lists', () => {
    expect(normalizeSymbolList(' aapl, aapl  jpm ')).toBe('AAPL,JPM');
  });
});
