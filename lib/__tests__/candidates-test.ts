import { buildCandidates } from '@/lib/candidates';
import { demoCandles, defaultSetups } from '@/constants/seed';
import { Quote, WatchlistItem } from '@/types/trading';

const item: WatchlistItem = {
  id: 'wl-1',
  symbol: 'AAPL',
  thesis: 'Test',
  entryLow: 200,
  entryHigh: 210,
  stop: 190,
  target: 230,
  setupId: 'setup-prior-day-high',
  notes: '',
  createdAt: new Date().toISOString(),
};

function quote(price: number, previousClose = price): Quote {
  return {
    symbol: 'AAPL',
    price,
    change: 0,
    percentChange: 0,
    high: price,
    low: price,
    open: price,
    previousClose,
    source: 'demo',
  };
}

describe('buildCandidates', () => {
  it('marks symbol-only rows as awaiting Desk signal', () => {
    const pending: WatchlistItem = {
      ...item,
      id: 'wl-pending',
      thesis: 'Awaiting Desk signal',
      entryLow: 0,
      entryHigh: 0,
      stop: 0,
      target: 0,
      setupId: null,
    };
    const [candidate] = buildCandidates([pending], defaultSetups, { AAPL: quote(205) }, {
      candles: demoCandles,
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    expect(candidate.status).toBe('watching');
    expect(candidate.label).toMatch(/awaiting desk signal/i);
  });

  it('flags names inside the buy zone', () => {
    const [candidate] = buildCandidates([item], defaultSetups, { AAPL: quote(205) }, {
      candles: demoCandles,
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    expect(['in_zone', 'ready']).toContain(candidate.status);
    expect(candidate.rules.length).toBeGreaterThan(0);
  });

  it('uses close-based invalidation instead of a single wick', () => {
    const [candidate] = buildCandidates([item], defaultSetups, { AAPL: quote(185, 192) }, {
      candles: {
        AAPL: [
          {
            time: 1,
            open: 195,
            high: 196,
            low: 191,
            close: 192,
            volume: 1,
          },
          {
            time: 2,
            open: 192,
            high: 193,
            low: 184,
            close: 185,
            volume: 1,
          },
        ],
      },
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    // Completed close is 192 (> stop 190), last is 185 → threatened, not invalidated.
    expect(candidate.status).toBe('stop_threatened');
  });

  it('invalidates when completed daily close is at/below stop', () => {
    const [candidate] = buildCandidates([item], defaultSetups, { AAPL: quote(188, 189) }, {
      candles: {
        AAPL: [
          {
            time: 1,
            open: 195,
            high: 196,
            low: 188,
            close: 189,
            volume: 1,
          },
          {
            time: 2,
            open: 189,
            high: 190,
            low: 187,
            close: 188,
            volume: 1,
          },
        ],
      },
    });
    expect(candidate.status).toBe('invalidated');
  });

  it('keeps Desk research-only names out of Ready / actionable', () => {
    const researchOnly: WatchlistItem = {
      ...item,
      thesis: 'AAPL is interesting for research, but not tradeable yet.',
      deskTradeable: false,
    };
    const candidates = buildCandidates([researchOnly], defaultSetups, { AAPL: quote(205) }, {
      candles: demoCandles,
      session: {
        phase: 'rth',
        label: 'RTH open',
        tradable: true,
        detail: 'ok',
      },
    });
    const [candidate] = candidates;
    expect(candidate.status).toBe('watching');
    expect(candidate.label).toMatch(/research only/i);
  });

  it('REGRESSION: verified-empty earnings calendar does not block Ready via fail-closed', () => {
    const session = {
      phase: 'rth' as const,
      label: 'RTH open',
      tradable: true,
      detail: 'ok',
    };
    const blocked = buildCandidates([item], defaultSetups, { AAPL: quote(205) }, {
      candles: demoCandles,
      earningsDates: { AAPL: [] },
      // omitted status → fail closed on earnings_clear
      session,
    });
    const clear = buildCandidates([item], defaultSetups, { AAPL: quote(205) }, {
      candles: demoCandles,
      earningsDates: { AAPL: [] },
      earningsCalendarStatus: { AAPL: 'ok' },
      session,
    });
    const earnBlocked = blocked[0].rules.find((r) => r.id === 'earnings_clear');
    const earnClear = clear[0].rules.find((r) => r.id === 'earnings_clear');
    expect(earnBlocked?.verdict).toBe('fail');
    expect(earnClear?.verdict).toBe('pass');
  });
});
