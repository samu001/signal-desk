import { buildCandidates } from '@/lib/candidates';
import { defaultSetups } from '@/constants/seed';
import { Quote, WatchlistItem } from '@/types/trading';

const item: WatchlistItem = {
  id: 'wl-1',
  symbol: 'AAPL',
  thesis: 'Test',
  entryLow: 200,
  entryHigh: 210,
  stop: 190,
  target: 230,
  setupId: 'setup-trend-pullback',
  notes: '',
  createdAt: new Date().toISOString(),
};

function quote(price: number): Quote {
  return {
    symbol: 'AAPL',
    price,
    change: 0,
    percentChange: 0,
    high: price,
    low: price,
    open: price,
    previousClose: price,
    source: 'demo',
  };
}

describe('buildCandidates', () => {
  it('flags names inside the buy zone', () => {
    const [candidate] = buildCandidates([item], defaultSetups, { AAPL: quote(205) });
    expect(candidate.status).toBe('in_zone');
  });

  it('flags invalidated names below stop', () => {
    const [candidate] = buildCandidates([item], defaultSetups, { AAPL: quote(185) });
    expect(candidate.status).toBe('invalidated');
  });
});
