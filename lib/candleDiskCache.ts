import AsyncStorage from '@react-native-async-storage/async-storage';

import { Candle } from '@/types/trading';

const STORAGE_KEY = 'signal_desk_eod_cache_v1';
/** Cap how many live EOD series we keep on disk (AsyncStorage / localStorage limits). */
const MAX_CANDLE_ENTRIES = 64;
const FLUSH_DEBOUNCE_MS = 400;

export type PersistedCandleResult = {
  candles: Candle[];
  source: string;
  warnings: string[];
};

type CandleEntry = { value: PersistedCandleResult; expiresAt: number };
type CooldownEntry = { note: string; expiresAt: number };

type DiskStore = {
  candles: Record<string, CandleEntry>;
  cooldowns: Record<string, CooldownEntry>;
};

function emptyStore(): DiskStore {
  return { candles: {}, cooldowns: {} };
}

let store: DiskStore | null = null;
let loadPromise: Promise<DiskStore> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;
/** Serialize mutations so flush/tests don't race loadStore().then(...) */
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(mutator: (s: DiskStore) => void): void {
  writeChain = writeChain
    .then(async () => {
      const s = await loadStore();
      mutator(s);
      scheduleFlush();
    })
    .catch(() => {
      // Keep chain alive after a failed mutation.
    });
}

function pruneExpired(s: DiskStore, now = Date.now()): DiskStore {
  const candles: Record<string, CandleEntry> = {};
  for (const [key, entry] of Object.entries(s.candles)) {
    if (entry.expiresAt > now && entry.value?.source !== 'demo' && entry.value?.candles?.length >= 60) {
      candles[key] = entry;
    }
  }
  const cooldowns: Record<string, CooldownEntry> = {};
  for (const [key, entry] of Object.entries(s.cooldowns)) {
    if (entry.expiresAt > now) cooldowns[key] = entry;
  }
  return { candles, cooldowns };
}

function trimCandleEntries(s: DiskStore): DiskStore {
  const entries = Object.entries(s.candles);
  if (entries.length <= MAX_CANDLE_ENTRIES) return s;
  entries.sort((a, b) => b[1].expiresAt - a[1].expiresAt);
  const candles = Object.fromEntries(entries.slice(0, MAX_CANDLE_ENTRIES));
  return { ...s, candles };
}

async function loadStore(): Promise<DiskStore> {
  if (store) return store;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        store = emptyStore();
        return store;
      }
      const parsed = JSON.parse(raw) as Partial<DiskStore>;
      store = pruneExpired({
        candles: parsed.candles ?? {},
        cooldowns: parsed.cooldowns ?? {},
      });
      return store;
    } catch {
      store = emptyStore();
      return store;
    }
  })();
  return loadPromise;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPromise = (async () => {
      if (!store) return;
      const next = trimCandleEntries(pruneExpired(store));
      store = next;
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Quota / private mode — keep memory; next write may succeed.
      }
    })();
  }, FLUSH_DEBOUNCE_MS);
}

/** Load disk once; returns live EOD entries still within TTL. */
export async function loadPersistedCandles(): Promise<Record<string, CandleEntry>> {
  await writeChain;
  const s = await loadStore();
  return { ...s.candles };
}

export async function loadPersistedCooldowns(): Promise<Record<string, CooldownEntry>> {
  await writeChain;
  const s = await loadStore();
  return { ...s.cooldowns };
}

/** Persist a live EOD hit (fire-and-forget flush). */
export function persistCandle(key: string, value: PersistedCandleResult, expiresAt: number) {
  if (value.source === 'demo' || value.candles.length < 60 || expiresAt <= Date.now()) return;
  enqueueWrite((s) => {
    s.candles[key] = {
      value: {
        candles: value.candles,
        source: value.source,
        // Drop cache-hit noise so disk stays small / readable.
        warnings: value.warnings.filter((w) => !/^Cached .+ EOD/i.test(w)).slice(0, 8),
      },
      expiresAt,
    };
  });
}

export function persistProviderCooldown(provider: string, note: string, expiresAt: number) {
  if (expiresAt <= Date.now()) return;
  enqueueWrite((s) => {
    s.cooldowns[provider] = { note: note.slice(0, 160), expiresAt };
  });
}

export async function clearPersistedEodCache(): Promise<void> {
  await writeChain.catch(() => undefined);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  store = emptyStore();
  loadPromise = Promise.resolve(store);
  writeChain = Promise.resolve();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Test helper — await pending writes + debounce flush. */
export async function flushPersistedEodCacheNow(): Promise<void> {
  await writeChain;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (store) {
    const next = trimCandleEntries(pruneExpired(store));
    store = next;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  if (flushPromise) await flushPromise;
}

/** Test helper — drop in-memory mirror so the next load hits AsyncStorage again. */
export function resetPersistedEodCacheMemory(): void {
  store = null;
  loadPromise = null;
  writeChain = Promise.resolve();
}
