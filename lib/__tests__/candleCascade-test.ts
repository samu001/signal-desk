import { Platform } from 'react-native';

import { clearCandleCache, fetchDailyCandlesResolved } from '@/lib/candles';
import { Candle } from '@/types/trading';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockTiingoProxy = jest.fn();
const mockTiingoDirect = jest.fn();
const mockYahooFetch = jest.fn();
const mockFmpFetch = jest.fn();

jest.mock('@/lib/tiingo', () => ({
  fetchTiingoDailyCandlesViaProxy: (...args: unknown[]) => mockTiingoProxy(...args),
  fetchTiingoDailyCandles: (...args: unknown[]) => mockTiingoDirect(...args),
}));

jest.mock('@/lib/yahoo', () => ({
  fetchYahooDailyCandles: (...args: unknown[]) => mockYahooFetch(...args),
}));

jest.mock('@/lib/fmp', () => ({
  fetchFmpDailyCandles: (...args: unknown[]) => mockFmpFetch(...args),
}));

function bars(n: number, seed = 100): Candle[] {
  const out: Candle[] = [];
  const start = Math.floor(new Date('2024-01-02T16:00:00Z').getTime() / 1000);
  for (let i = 0; i < n; i++) {
    const close = seed + i * 0.01;
    out.push({
      time: start + i * 86400,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    });
  }
  return out;
}

describe('EOD cascade Tiingo → Yahoo → FMP', () => {
  beforeEach(async () => {
    await clearCandleCache();
    mockTiingoProxy.mockReset();
    mockTiingoDirect.mockReset();
    mockYahooFetch.mockReset();
    mockFmpFetch.mockReset();
    // Native path uses direct Tiingo when no proxy URL.
    (Platform as { OS: string }).OS = 'ios';
  });

  it('stops on Tiingo adjusted ≥60 and does not call Yahoo/FMP', async () => {
    mockTiingoDirect.mockResolvedValue({
      candles: bars(80),
      warning: 'Tiingo EOD (80 bars).',
    });
    const result = await fetchDailyCandlesResolved('CASC1', {
      tiingoApiKey: 't',
      yahooProxyUrl: 'https://yahoo.example',
      fmpApiKey: 'f',
    });
    expect(result.source).toBe('tiingo');
    expect(result.adjusted).toBe('adjusted');
    expect(mockYahooFetch).not.toHaveBeenCalled();
    expect(mockFmpFetch).not.toHaveBeenCalled();
  });

  it('uses Yahoo adjusted when Tiingo fails (no rate limit) before FMP', async () => {
    mockTiingoDirect.mockResolvedValue({ candles: [], warning: 'Tiingo empty' });
    mockYahooFetch.mockResolvedValue({
      candles: bars(90),
      adjusted: 'adjusted',
      warning: 'Yahoo EOD (90 adjusted).',
    });
    const result = await fetchDailyCandlesResolved('CASC2', {
      tiingoApiKey: 't',
      yahooProxyUrl: 'https://yahoo.example',
      fmpApiKey: 'f',
    });
    expect(result.source).toBe('yahoo');
    expect(result.adjusted).toBe('adjusted');
    expect(mockFmpFetch).not.toHaveBeenCalled();
  });

  it('skips FMP after Tiingo 429 but still tries Yahoo', async () => {
    mockTiingoDirect.mockResolvedValue({
      candles: [],
      warning: 'Tiingo rate limit: 429',
    });
    mockYahooFetch.mockResolvedValue({
      candles: bars(70),
      adjusted: 'adjusted',
      warning: 'Yahoo EOD (70 adjusted).',
    });
    const result = await fetchDailyCandlesResolved('CASC3', {
      tiingoApiKey: 't',
      yahooProxyUrl: 'https://yahoo.example',
      fmpApiKey: 'f',
    });
    expect(result.source).toBe('yahoo');
    expect(mockYahooFetch).toHaveBeenCalled();
    expect(mockFmpFetch).not.toHaveBeenCalled();
  });

  it('falls through to FMP adjusted when Tiingo/Yahoo miss', async () => {
    mockTiingoDirect.mockResolvedValue({ candles: [], warning: 'Tiingo empty' });
    mockYahooFetch.mockResolvedValue({ candles: [], warning: 'Yahoo empty' });
    mockFmpFetch.mockResolvedValue({
      candles: bars(100),
      adjusted: 'adjusted',
      warning: 'FMP EOD (100 adjusted daily bars).',
    });
    const result = await fetchDailyCandlesResolved('CASC4', {
      tiingoApiKey: 't',
      yahooProxyUrl: 'https://yahoo.example',
      fmpApiKey: 'f',
    });
    expect(result.source).toBe('fmp');
    expect(result.adjusted).toBe('adjusted');
  });

  it('soft-keeps Yahoo unknown and skips FMP when Tiingo was rate-limited', async () => {
    mockTiingoDirect.mockResolvedValue({
      candles: [],
      warning: 'Tiingo rate limit: 429',
    });
    mockYahooFetch.mockResolvedValue({
      candles: bars(65),
      adjusted: 'unknown',
      warning: 'Yahoo EOD (65 bars).',
    });
    const result = await fetchDailyCandlesResolved('CASC5', {
      tiingoApiKey: 't',
      yahooProxyUrl: 'https://yahoo.example',
      fmpApiKey: 'f',
    });
    expect(result.source).toBe('yahoo');
    expect(result.adjusted).toBe('unknown');
    expect(mockFmpFetch).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => /Skipping FMP after Tiingo rate limit/i.test(w))).toBe(
      true
    );
  });
});
