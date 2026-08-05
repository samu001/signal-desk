import { fetchFmpDailyCandles, resetFmpAdjustedAvailability } from '@/lib/fmp';

type MockRoute = (url: string) => {
  ok: boolean;
  status: number;
  body: string;
};

function installFetch(route: MockRoute): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const original = global.fetch;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const res = route(url);
    return {
      ok: res.ok,
      status: res.status,
      text: async () => res.body,
      json: async () => JSON.parse(res.body),
      headers: { get: () => null },
    } as unknown as Response;
  }) as typeof fetch;
  return { urls, restore: () => (global.fetch = original) };
}

const adjRows = [
  { symbol: 'AAPL', date: '2024-06-03', adjOpen: 10, adjHigh: 11, adjLow: 9.5, adjClose: 10.5, volume: 100 },
  { symbol: 'AAPL', date: '2024-06-04', adjOpen: 10.5, adjHigh: 12, adjLow: 10.2, adjClose: 11.8, volume: 120 },
];

const rawRows = [
  { symbol: 'AAPL', date: '2024-06-03', open: 40, high: 44, low: 38, close: 42, volume: 100 },
  { symbol: 'AAPL', date: '2024-06-04', open: 42, high: 48, low: 40.8, close: 47.2, volume: 120 },
];

describe('fetchFmpDailyCandles (dividend-adjusted first)', () => {
  beforeEach(() => resetFmpAdjustedAvailability());

  it('uses the dividend-adjusted endpoint and maps adj* fields — one call per symbol', async () => {
    const { urls, restore } = installFetch((url) => {
      if (url.includes('/historical-price-eod/dividend-adjusted')) {
        return { ok: true, status: 200, body: JSON.stringify(adjRows) };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    try {
      const result = await fetchFmpDailyCandles('AAPL', 'k', 400);
      expect(urls).toHaveLength(1);
      expect(result.adjusted).toBe('adjusted');
      expect(result.candles).toHaveLength(2);
      expect(result.candles[0]).toMatchObject({ open: 10, high: 11, low: 9.5, close: 10.5 });
      expect(result.warning).toMatch(/adjusted daily bars/i);
    } finally {
      restore();
    }
  });

  it('per-symbol 402 (index ETF) blocks only that symbol — other symbols still get adjusted', async () => {
    const { urls, restore } = installFetch((url) => {
      if (!url.includes('dividend-adjusted')) {
        return { ok: true, status: 200, body: JSON.stringify(rawRows) };
      }
      if (url.includes('symbol=QQQ')) {
        return {
          ok: false,
          status: 402,
          body: JSON.stringify({
            'Error Message':
              'Premium Query Parameter: symbol is not available under your current subscription',
          }),
        };
      }
      return { ok: true, status: 200, body: JSON.stringify(adjRows) };
    });
    try {
      const qqq = await fetchFmpDailyCandles('QQQ', 'k', 400);
      expect(qqq.adjusted).toBe('raw');

      const aapl = await fetchFmpDailyCandles('AAPL', 'k', 400);
      expect(aapl.adjusted).toBe('adjusted');
      // QQQ: adjusted 402 + full; AAPL: adjusted only (QQQ did NOT poison AAPL).
      const aaplAdjCalls = urls.filter((u) => u.includes('dividend-adjusted') && u.includes('symbol=AAPL'));
      expect(aaplAdjCalls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('per-symbol blocklist skips the adjusted retry on a second fetch of the same symbol', async () => {
    const { urls, restore } = installFetch((url) => {
      if (url.includes('dividend-adjusted')) {
        return { ok: false, status: 402, body: JSON.stringify({ 'Error Message': 'symbol not available' }) };
      }
      return { ok: true, status: 200, body: JSON.stringify(rawRows) };
    });
    try {
      await fetchFmpDailyCandles('QQQ', 'k', 400);
      await fetchFmpDailyCandles('QQQ', 'k', 400);
      const qqqAdjCalls = urls.filter((u) => u.includes('dividend-adjusted') && u.includes('symbol=QQQ'));
      expect(qqqAdjCalls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('plan-wide rejection (exclusive endpoint) still skips adjusted for the whole session', async () => {
    const { urls, restore } = installFetch((url) => {
      if (url.includes('dividend-adjusted')) {
        return {
          ok: false,
          status: 403,
          body: JSON.stringify({ 'Error Message': 'Exclusive Endpoint: upgrade your plan' }),
        };
      }
      return { ok: true, status: 200, body: JSON.stringify(rawRows) };
    });
    try {
      const first = await fetchFmpDailyCandles('AAPL', 'k', 400);
      expect(first.adjusted).toBe('raw');
      const second = await fetchFmpDailyCandles('MSFT', 'k', 400);
      expect(second.adjusted).toBe('raw');
      // MSFT goes straight to /full — plan-wide lock still honored.
      expect(urls.filter((u) => u.includes('dividend-adjusted'))).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('does not burn a fallback call on a rate limit', async () => {
    const { urls, restore } = installFetch(() => ({
      ok: false,
      status: 429,
      body: 'Limit Reach',
    }));
    try {
      const result = await fetchFmpDailyCandles('AAPL', 'k', 400);
      expect(result.candles).toHaveLength(0);
      expect(result.warning).toMatch(/rate limit/i);
      expect(urls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('tolerates raw field names on the adjusted endpoint (no extra call)', async () => {
    const { urls, restore } = installFetch((url) => {
      if (url.includes('dividend-adjusted')) {
        return { ok: true, status: 200, body: JSON.stringify(rawRows) };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    try {
      const result = await fetchFmpDailyCandles('AAPL', 'k', 400);
      expect(result.candles).toHaveLength(2);
      expect(result.adjusted).toBe('adjusted');
      expect(urls).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
