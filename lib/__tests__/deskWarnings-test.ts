import {
  filterDeskDataWarnings,
  isAboutOtherSymbol,
  userFacingDeskWarnings,
} from '@/lib/deskWarnings';

describe('deskWarnings', () => {
  const noisy = [
    'Finnhub returned no quote for TSMC.',
    'Yahoo proxy HTTP 502: Yahoo HTTP 404',
    'TSMC: No data — live quote unavailable.',
    'Tiingo EOD via proxy (549 adjusted daily bars, days=800).',
    "Tiingo proxy HTTP 502: Tiingo HTTP 404: {\"detail\":\"Error: Ticker 'TSMC' not found\"}",
    "HTTP 402: Premium Query Parameter: 'Special Endpoint",
    'Finnhub free plan does not include /stock/candle (OHLC). Prefer Tiingo or FMP for history.',
    'Invalid API call. Please retry or visit the documentation for TIME_SERIES_DAILY.',
    'No data — all live EOD sources failed (see Tiingo/FMP/Yahoo warnings above).',
    'FMP fundamentals returned no rows — check key/limits.',
    'Cached tiingo EOD (549 bars, ≤24h TTL).',
    'Tiingo EOD via proxy (275 adjusted daily bars, days=400).',
    'No Playbook setup matched — Desk will not issue Soft/Strong buy.',
    'Research-interesting only — not a tradeable Soft/Strong buy.',
    'SBUX: unreliable quote ignored — using last tiingo close $95.00.',
  ];

  it('detects other-symbol warnings', () => {
    expect(isAboutOtherSymbol('Finnhub returned no quote for TSMC.', 'SBUX')).toBe(true);
    expect(isAboutOtherSymbol('TSMC: No data — live quote unavailable.', 'SBUX')).toBe(true);
    expect(isAboutOtherSymbol("Ticker 'TSMC' not found", 'SBUX')).toBe(true);
    expect(isAboutOtherSymbol('SBUX: unreliable quote ignored', 'SBUX')).toBe(false);
  });

  it('keeps a clean scorecard when the ticker has live data', () => {
    const filtered = filterDeskDataWarnings('SBUX', noisy, 'tiingo', {
      hasFundamentals: true,
      includeStance: false,
    });
    expect(filtered).toEqual([
      'SBUX: unreliable quote ignored — using last tiingo close $95.00.',
    ]);
  });

  it('userFacingDeskWarnings hides stance duplicates', () => {
    const shown = userFacingDeskWarnings({
      symbol: 'SBUX',
      warnings: noisy,
      candleSource: 'tiingo',
      fundamentals: { symbol: 'SBUX' },
    });
    expect(shown.some((w) => /Playbook/i.test(w))).toBe(false);
    expect(shown.some((w) => /TSMC/i.test(w))).toBe(false);
  });

  it('keeps failure notes when the ticker has no live bars', () => {
    const filtered = filterDeskDataWarnings('SBUX', noisy, 'none', {
      hasFundamentals: false,
      includeStance: false,
    });
    expect(filtered.some((w) => /all live EOD sources failed/i.test(w))).toBe(true);
    expect(filtered.some((w) => /TSMC/i.test(w))).toBe(false);
  });
});
