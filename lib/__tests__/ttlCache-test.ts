import {
  BENCHMARK_CANDLE_TTL_MS,
  CANDLE_TTL_MS,
  clearCandleCache,
  clearProviderCooldowns,
  dropCandleMemoryCacheForTests,
  fetchDailyCandlesResolved,
  PROVIDER_COOLDOWN_MS,
} from '@/lib/candles';
import {
  flushPersistedEodCacheNow,
  resetPersistedEodCacheMemory,
} from '@/lib/candleDiskCache';
import { clearFundamentalsCache, FUNDAMENTALS_TTL_MS, fetchFmpFundamentals } from '@/lib/fmp';
import {
  clearMarketBundleInflight,
  marketBundleCovers,
  MarketBundle,
  shouldReuseMarketBundle,
} from '@/lib/finnhub';
import { createInflightMap, createTtlCache } from '@/lib/ttlCache';
import { Candle, FundamentalSnapshot } from '@/types/trading';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('createTtlCache', () => {
  it('returns cached values within TTL and expires after', () => {
    jest.useFakeTimers();
    const cache = createTtlCache<string>(1000);
    cache.set('a', 'one');
    expect(cache.get('a')).toBe('one');
    jest.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
    jest.useRealTimers();
  });

  it('restores via setUntil until absolute expiry', () => {
    jest.useFakeTimers();
    const cache = createTtlCache<string>(60_000);
    cache.setUntil('a', 'disk', Date.now() + 500);
    expect(cache.get('a')).toBe('disk');
    jest.advanceTimersByTime(501);
    expect(cache.get('a')).toBeUndefined();
    jest.useRealTimers();
  });

  it('coalesces concurrent getOrFetch callers', async () => {
    const cache = createTtlCache<number>(60_000);
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    };
    const [a, b] = await Promise.all([
      cache.getOrFetch('n', fetcher),
      cache.getOrFetch('n', fetcher),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });
});

describe('createInflightMap', () => {
  it('shares one in-flight promise per key', async () => {
    const map = createInflightMap<string>();
    let calls = 0;
    const run = () =>
      map.run('k', async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return 'ok';
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(calls).toBe(1);
  });
});

describe('market bundle reuse helpers', () => {
  const candle = (n: number): Candle[] =>
    Array.from({ length: n }, (_, i) => ({
      time: 1_700_000_000 + i * 86_400,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1,
    }));

  const bundle = (symbols: string[]): MarketBundle => {
    const quotes = Object.fromEntries(
      symbols.map((s) => [
        s,
        {
          symbol: s,
          price: 100,
          change: 0,
          percentChange: 0,
          high: 101,
          low: 99,
          open: 100,
          previousClose: 100,
          source: 'demo' as const,
        },
      ])
    );
    const candles = Object.fromEntries(symbols.map((s) => [s, candle(80)]));
    return {
      quotes,
      candles,
      candleSources: Object.fromEntries(symbols.map((s) => [s, 'demo' as const])),
      news: {},
      fundamentals: {},
      earningsDates: {},
      sourceSummary: 'demo',
      warnings: [],
    };
  };

  it('requires quotes + 60 bars for coverage including SPY/QQQ', () => {
    expect(marketBundleCovers(bundle(['AAPL', 'SPY', 'QQQ']), ['AAPL'])).toBe(true);
    expect(marketBundleCovers(bundle(['AAPL']), ['AAPL'])).toBe(false);
  });

  it('reuses only when fresh enough', () => {
    const b = bundle(['AAPL', 'SPY', 'QQQ']);
    expect(shouldReuseMarketBundle(b, ['AAPL'], Date.now())).toBe(true);
    expect(shouldReuseMarketBundle(b, ['AAPL'], Date.now() - 10 * 60_000)).toBe(false);
    expect(shouldReuseMarketBundle(null, ['AAPL'], Date.now())).toBe(false);
  });
});

describe('candle + fundamentals TTL wiring', () => {
  beforeEach(async () => {
    await clearCandleCache();
    clearFundamentalsCache();
    clearMarketBundleInflight();
    clearProviderCooldowns();
  });

  it('exports expected TTLs in the 6–24h band', () => {
    expect(CANDLE_TTL_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    expect(CANDLE_TTL_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(BENCHMARK_CANDLE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(PROVIDER_COOLDOWN_MS).toBe(10 * 60 * 1000);
    expect(FUNDAMENTALS_TTL_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    expect(FUNDAMENTALS_TTL_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('no-data candle resolve does not poison the live TTL cache', async () => {
    const first = await fetchDailyCandlesResolved('ZZZZCACHE', {});
    expect(first.source).toBe('none');
    expect(first.candles).toHaveLength(0);
    const second = await fetchDailyCandlesResolved('ZZZZCACHE', {});
    expect(second.source).toBe('none');
    expect(second.warnings.some((w) => /Cached .+ EOD/i.test(w))).toBe(false);
  });

  it('rehydrates live EOD from disk after a memory drop (reload)', async () => {
    const originalFetch = global.fetch;
    let hits = 0;
    const bars = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1_000,
    }));
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('financialmodelingprep')) {
        hits += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(bars),
          json: async () => bars,
          headers: { get: () => null },
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        text: async () => '',
        json: async () => ({}),
        headers: { get: () => null },
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const first = await fetchDailyCandlesResolved('DISK1', { fmpApiKey: 'k' });
      expect(first.source).toBe('fmp');
      expect(hits).toBe(1);
      await flushPersistedEodCacheNow();

      dropCandleMemoryCacheForTests();
      resetPersistedEodCacheMemory();

      const second = await fetchDailyCandlesResolved('DISK1', { fmpApiKey: 'k' });
      expect(second.source).toBe('fmp');
      expect(second.warnings.some((w) => /Cached fmp EOD/i.test(w))).toBe(true);
      expect(hits).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('skips Alpha Vantage after an FMP rate limit', async () => {
    const originalFetch = global.fetch;
    let urls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('financialmodelingprep')) {
        return {
          ok: false,
          status: 429,
          text: async () => 'Limit Reach',
          headers: { get: () => null },
        } as unknown as Response;
      }
      if (url.includes('alphavantage')) {
        return {
          ok: true,
          json: async () => ({ Note: 'API call frequency' }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        text: async () => '',
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    try {
      const result = await fetchDailyCandlesResolved('RATE1', {
        fmpApiKey: 'fmp-key',
        alphaVantageApiKey: 'av-key',
      });
      expect(result.source).toBe('none');
      expect(result.candles).toHaveLength(0);
      expect(result.warnings.some((w) => /rate limit/i.test(w))).toBe(true);
      expect(
        result.warnings.some((w) =>
          /Skipping Finnhub\/Alpha Vantage|Skipping Alpha Vantage|protecting free-tier/i.test(w)
        )
      ).toBe(true);
      expect(urls.some((u) => u.includes('alphavantage'))).toBe(false);

      urls = [];
      await fetchDailyCandlesResolved('RATE2', {
        fmpApiKey: 'fmp-key',
        alphaVantageApiKey: 'av-key',
      });
      expect(urls.some((u) => u.includes('alphavantage'))).toBe(false);
      expect(urls.some((u) => u.includes('financialmodelingprep'))).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('caches FMP fundamentals across calls', async () => {
    const originalFetch = global.fetch;
    let hits = 0;
    global.fetch = jest.fn(async () => {
      hits += 1;
      return {
        ok: true,
        json: async () => [
          {
            companyName: 'Test Co',
            sector: 'Tech',
            industry: 'Software',
            mktCap: 1e9,
          },
        ],
      } as Response;
    }) as typeof fetch;

    try {
      const a = await fetchFmpFundamentals('CACHE1', 'fake-key');
      const b = await fetchFmpFundamentals('CACHE1', 'fake-key');
      expect(a?.symbol).toBe('CACHE1');
      expect(b?.symbol).toBe('CACHE1');
      expect(hits).toBe(3);
      expect(a).toEqual(b as FundamentalSnapshot);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
