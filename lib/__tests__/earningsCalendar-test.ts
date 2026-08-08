import {
  earningsFailClosedDetail,
  fetchEarningsDates,
  fetchEarningsWindow,
  summarizeEarningsFetches,
  type EarningsFetchResult,
} from '@/lib/finnhub';
import { parseAlphaVantageEarningsCalendarCsv } from '@/lib/alphavantage';
import { evaluateSetupRules } from '@/lib/rules';
import { defaultSetups } from '@/constants/seed';
import { Candle, Quote, WatchlistItem } from '@/types/trading';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

function candle(close: number, i: number): Candle {
  return {
    time: 1_700_000_000 + i * 86400,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1_000_000,
  };
}

const candles = Array.from({ length: 80 }, (_, i) => candle(100 + (i % 5), i));
const item: WatchlistItem = {
  id: 't',
  symbol: 'TEST',
  thesis: 't',
  buyZoneLow: 95,
  buyZoneHigh: 105,
  stop: 90,
  target: 120,
  setupId: defaultSetups[0]?.id ?? null,
  notes: '',
  createdAt: '',
};
const quote: Quote = {
  symbol: 'TEST',
  price: 100,
  changePct: 0,
  asOf: Date.now(),
  previousClose: 99,
  source: 'yahoo',
};

describe('earnings calendar status (honesty UX)', () => {
  it('summarizeEarningsFetches separates no-key, error, empty, and ok', () => {
    const rows: EarningsFetchResult[] = [
      { dates: ['2024-01-01'], status: 'ok', detail: '1 date' },
      { dates: ['2024-02-01'], status: 'ok', detail: '1 date' },
      { dates: [], status: 'error', detail: 'HTTP 429' },
      { dates: [], status: 'empty', detail: 'empty' },
      { dates: [], status: 'no_key', detail: 'no key' },
    ];
    const s = summarizeEarningsFetches(rows);
    expect(s.ok).toBe(2);
    expect(s.error).toBe(1);
    expect(s.empty).toBe(1);
    expect(s.noKey).toBe(1);
    expect(s.anyBlocked).toBe(true);
    expect(s.headline).toMatch(/2\/5/);
    expect(s.headline).toMatch(/fetch error/);
  });

  it('no-key rollup is explicit about ~0 trades', () => {
    const rows: EarningsFetchResult[] = Array.from({ length: 3 }, () => ({
      dates: [],
      status: 'no_key' as const,
      detail: earningsFailClosedDetail('no_key'),
    }));
    const s = summarizeEarningsFetches(rows);
    expect(s.headline).toMatch(/No Finnhub \/ FMP \/ Alpha Vantage \/ Yahoo proxy/i);
    expect(s.headline).toMatch(/almost no trades/i);
  });

  it('earnings_clear fail detail names no-key vs fetch-error vs empty', () => {
    const setup = defaultSetups[0];
    const base = {
      item,
      quote,
      candles,
      spyCandles: candles,
      news: [] as never[],
      gates: { marketRegime: false, earningsBlackout: true, weeklyTrend: false, sectorRs: false, volatility: false },
    };

    const noKey = evaluateSetupRules(setup, {
      ...base,
      earningsDates: [],
      earningsCalendarStatus: 'no_key',
    });
    expect(noKey.find((r) => r.id === 'earnings_clear')?.detail).toMatch(
      /No Finnhub \/ FMP \/ Alpha Vantage \/ Yahoo proxy/i
    );

    const err = evaluateSetupRules(setup, {
      ...base,
      earningsDates: [],
      earningsCalendarStatus: 'error',
    });
    expect(err.find((r) => r.id === 'earnings_clear')?.detail).toMatch(/fetch failed/i);

    const empty = evaluateSetupRules(setup, {
      ...base,
      earningsDates: [],
      earningsCalendarStatus: 'empty',
    });
    expect(empty.find((r) => r.id === 'earnings_clear')?.detail).toMatch(/empty/i);
    expect(empty.find((r) => r.id === 'earnings_clear')?.verdict).toBe('fail');

    // Live Desk near-term: verified-empty window must pass (not fail-closed).
    const clear = evaluateSetupRules(setup, {
      ...base,
      earningsDates: [],
      earningsCalendarStatus: 'ok',
    });
    expect(clear.find((r) => r.id === 'earnings_clear')?.verdict).toBe('pass');
    expect(clear.find((r) => r.id === 'earnings_clear')?.detail).toMatch(/No earnings/i);
  });
});

describe('earnings provider chain', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns no_key when no calendar providers are configured', async () => {
    const r = await fetchEarningsDates('AAPL', undefined, '2024-01-01', '2024-12-31');
    expect(r.status).toBe('no_key');
    expect(r.dates).toEqual([]);
  });

  it('falls back to FMP when Finnhub rate-limits', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('finnhub.io')) {
        return {
          ok: false,
          status: 429,
          text: async () => 'rate limit',
          json: async () => ({}),
        } as Response;
      }
      if (url.includes('financialmodelingprep.com') && url.includes('/earnings')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([
              { symbol: 'AAPL', date: '2024-05-02' },
              { symbol: 'AAPL', date: '2024-08-01' },
              { symbol: 'AAPL', date: '2023-01-01' },
            ]),
          json: async () => [],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await fetchEarningsDates(
      'AAPL',
      'fh-key',
      '2024-01-01',
      '2024-12-31',
      'fmp-key'
    );
    expect(r.status).toBe('ok');
    expect(r.dates).toEqual(['2024-05-02', '2024-08-01']);
    expect(r.detail).toMatch(/FMP/i);
  });

  it('falls back to Alpha Vantage when Finnhub and FMP fail', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('finnhub.io')) {
        return { ok: false, status: 429, text: async () => '', json: async () => ({}) } as Response;
      }
      if (url.includes('financialmodelingprep.com')) {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) } as Response;
      }
      if (url.includes('alphavantage.co') && url.includes('function=EARNINGS')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({
            quarterlyEarnings: [
              { reportedDate: '2024-04-25', fiscalDateEnding: '2024-03-31' },
              { reportedDate: '2024-07-25', fiscalDateEnding: '2024-06-30' },
              { reportedDate: '2023-01-01', fiscalDateEnding: '2022-12-31' },
            ],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await fetchEarningsDates(
      'AAPL',
      'fh',
      '2024-01-01',
      '2024-12-31',
      'fmp',
      'av'
    );
    expect(r.status).toBe('ok');
    expect(r.dates).toEqual(['2024-04-25', '2024-07-25']);
    expect(r.detail).toMatch(/Alpha Vantage/i);
  });

  it('uses Alpha Vantage alone when it is the only key', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toMatch(/alphavantage\.co/);
      expect(url).toMatch(/function=EARNINGS/);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          quarterlyEarnings: [{ reportedDate: '2024-02-01' }],
        }),
      } as Response;
    }) as typeof fetch;

    const r = await fetchEarningsDates(
      'MSFT',
      undefined,
      '2024-01-01',
      '2024-06-01',
      undefined,
      'av-key'
    );
    expect(r.status).toBe('ok');
    expect(r.dates).toEqual(['2024-02-01']);
  });

  it('parses Alpha Vantage earnings calendar CSV', () => {
    const csv = `symbol,name,reportDate,fiscalDateEnding,estimate,currency
AAPL,Apple,2024-05-02,2024-03-31,1.5,USD
MSFT,Microsoft,2024-05-03,2024-03-31,2.0,USD
AAPL,Apple,2024-08-01,2024-06-30,1.6,USD`;
    expect(parseAlphaVantageEarningsCalendarCsv(csv, 'AAPL')).toEqual([
      '2024-05-02',
      '2024-08-01',
    ]);
  });

  it('stays error when all providers fail', async () => {
    global.fetch = jest.fn(async () => {
      return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) } as Response;
    }) as typeof fetch;

    const r = await fetchEarningsDates('AAPL', 'fh', '2024-01-01', '2024-06-01', 'fmp', 'av');
    expect(r.status).toBe('error');
    expect(r.dates).toEqual([]);
    expect(r.detail).toMatch(/Finnhub/i);
    expect(r.detail).toMatch(/FMP/i);
    expect(r.detail).toMatch(/Alpha Vantage/i);
  });

  it('falls back to Yahoo proxy when Finnhub/FMP/AV fail', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('finnhub.io') || url.includes('financialmodelingprep.com') || url.includes('alphavantage.co')) {
        return { ok: false, status: 429, text: async () => 'limit', json: async () => ({}) } as Response;
      }
      if (url.includes('yahoo.example') && url.includes('/earnings')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              symbol: 'PATH',
              source: 'yahoo',
              dates: ['2024-05-29', '2024-09-05', '2025-03-12'],
            }),
          json: async () => ({}),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await fetchEarningsDates(
      'PATH',
      'fh',
      '2024-01-01',
      '2025-12-31',
      'fmp',
      'av',
      { url: 'https://yahoo.example', token: 't' }
    );
    expect(r.status).toBe('ok');
    expect(r.dates).toEqual(['2024-05-29', '2024-09-05', '2025-03-12']);
    expect(r.detail).toMatch(/Yahoo/i);
  });
});

describe('fetchEarningsWindow (live Desk near-term)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('remaps provider empty → ok so verified-clear does not fail-closed', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('finnhub.io') && url.includes('calendar/earnings')) {
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({ earningsCalendar: [] }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r = await fetchEarningsWindow('AAPL', 'fh-key');
    expect(r.status).toBe('ok');
    expect(r.dates).toEqual([]);
    expect(r.window).toBeNull();
    expect(r.detail).toMatch(/No earnings in the near-term/i);
  });

  it('returns no_key when no calendar providers are configured', async () => {
    const r = await fetchEarningsWindow('AAPL');
    expect(r.status).toBe('no_key');
    expect(r.dates).toEqual([]);
  });
});
