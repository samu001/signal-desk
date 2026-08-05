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

  it('falls back to raw /full when the plan rejects adjusted, then skips adjusted for the session', async () => {
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
      expect(first.candles).toHaveLength(2);
      expect(first.candles[0]).toMatchObject({ open: 40, close: 42 });
      expect(first.warning).toMatch(/RAW unadjusted/i);
      // Discovery cost: adjusted + full = 2 calls, once.
      expect(urls).toHaveLength(2);

      const second = await fetchFmpDailyCandles('MSFT', 'k', 400);
      expect(second.adjusted).toBe('raw');
      // Session flag set: MSFT goes straight to /full (1 more call, not 2).
      expect(urls).toHaveLength(3);
      expect(urls[2]).toContain('/historical-price-eod/full');
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
