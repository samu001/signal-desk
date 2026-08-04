/**
 * In-memory TTL cache with in-flight promise coalescing.
 * Pair with disk persistence (see candleDiskCache) when values must survive reload.
 */
export type TtlCache<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  /** Restore a value with an absolute expiry (e.g. from disk hydrate). */
  setUntil: (key: string, value: T, expiresAt: number) => void;
  has: (key: string) => boolean;
  delete: (key: string) => void;
  clear: () => void;
  /** Return cached value or run fetcher once; concurrent callers share the same promise. */
  getOrFetch: (key: string, fetcher: () => Promise<T>) => Promise<T>;
  size: () => number;
};

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();
  const inflight = new Map<string, Promise<T>>();

  const get = (key: string): T | undefined => {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  };

  const set = (key: string, value: T) => {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  };

  const setUntil = (key: string, value: T, expiresAt: number) => {
    if (Date.now() >= expiresAt) {
      store.delete(key);
      return;
    }
    store.set(key, { value, expiresAt });
  };

  return {
    get,
    set,
    setUntil,
    has: (key) => get(key) !== undefined,
    delete: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
      inflight.clear();
    },
    size: () => store.size,
    async getOrFetch(key, fetcher) {
      const cached = get(key);
      if (cached !== undefined) return cached;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = (async () => {
        try {
          const value = await fetcher();
          set(key, value);
          return value;
        } finally {
          inflight.delete(key);
        }
      })();

      inflight.set(key, promise);
      return promise;
    },
  };
}

/** Shared in-flight map (no TTL store) — coalesces concurrent identical work. */
export function createInflightMap<T>() {
  const inflight = new Map<string, Promise<T>>();

  return {
    async run(key: string, fetcher: () => Promise<T>): Promise<T> {
      const pending = inflight.get(key);
      if (pending) return pending;
      const promise = fetcher().finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, promise);
      return promise;
    },
    clear: () => inflight.clear(),
  };
}
