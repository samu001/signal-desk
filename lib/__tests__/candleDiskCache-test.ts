import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearPersistedEodCache,
  flushPersistedEodCacheNow,
  loadPersistedCandles,
  loadPersistedCooldowns,
  persistCandle,
  persistProviderCooldown,
  resetPersistedEodCacheMemory,
} from '@/lib/candleDiskCache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('candleDiskCache', () => {
  beforeEach(async () => {
    await clearPersistedEodCache();
    resetPersistedEodCacheMemory();
    await AsyncStorage.clear();
  });

  it('persists live EOD and reloads after memory reset', async () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      time: 1_700_000_000 + i * 86_400,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1,
    }));
    persistCandle(
      'AAPL:--y--',
      { candles: bars, source: 'yahoo', warnings: ['Cached yahoo EOD (noise)'] },
      Date.now() + 60_000
    );
    await flushPersistedEodCacheNow();
    resetPersistedEodCacheMemory();

    const loaded = await loadPersistedCandles();
    expect(loaded['AAPL:--y--']?.value.source).toBe('yahoo');
    expect(loaded['AAPL:--y--']?.value.candles).toHaveLength(80);
    expect(loaded['AAPL:--y--']?.value.warnings.some((w) => /Cached/i.test(w))).toBe(false);
  });

  it('skips demo and expired entries', async () => {
    persistCandle(
      'DEMO:-----',
      {
        candles: Array.from({ length: 80 }, () => ({
          time: 1,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        })),
        source: 'demo',
        warnings: [],
      },
      Date.now() + 60_000
    );
    persistCandle(
      'OLD:-----',
      {
        candles: Array.from({ length: 80 }, () => ({
          time: 1,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        })),
        source: 'fmp',
        warnings: [],
      },
      Date.now() - 1
    );
    await flushPersistedEodCacheNow();
    resetPersistedEodCacheMemory();
    const loaded = await loadPersistedCandles();
    expect(loaded['DEMO:-----']).toBeUndefined();
    expect(loaded['OLD:-----']).toBeUndefined();
  });

  it('persists provider cooldowns', async () => {
    persistProviderCooldown('fmp', 'FMP HTTP 429', Date.now() + 60_000);
    await flushPersistedEodCacheNow();
    resetPersistedEodCacheMemory();
    const cool = await loadPersistedCooldowns();
    expect(cool.fmp?.note).toMatch(/429/);
  });
});
