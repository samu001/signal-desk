import { Quote, Setup, WatchlistItem } from '@/types/trading';

export type CandidateStatus = 'in_zone' | 'near_zone' | 'watching' | 'invalidated';

export type Candidate = {
  item: WatchlistItem;
  setup: Setup | null;
  quote: Quote | null;
  status: CandidateStatus;
  distanceToZonePct: number | null;
  label: string;
};

function statusFor(item: WatchlistItem, price: number | null): {
  status: CandidateStatus;
  distanceToZonePct: number | null;
  label: string;
} {
  if (price == null) {
    return { status: 'watching', distanceToZonePct: null, label: 'No quote yet' };
  }

  if (price <= item.stop) {
    return { status: 'invalidated', distanceToZonePct: null, label: 'Below stop — thesis invalidated' };
  }

  if (price >= item.entryLow && price <= item.entryHigh) {
    return { status: 'in_zone', distanceToZonePct: 0, label: 'In buy zone' };
  }

  const mid = (item.entryLow + item.entryHigh) / 2;
  const distance = ((price - mid) / mid) * 100;

  if (price > item.entryHigh && price <= item.entryHigh * 1.03) {
    return { status: 'near_zone', distanceToZonePct: distance, label: 'Just above zone' };
  }

  if (price < item.entryLow && price >= item.entryLow * 0.97) {
    return { status: 'near_zone', distanceToZonePct: distance, label: 'Approaching zone' };
  }

  return {
    status: 'watching',
    distanceToZonePct: distance,
    label: price > item.entryHigh ? 'Extended above zone' : 'Waiting for zone',
  };
}

export function buildCandidates(
  watchlist: WatchlistItem[],
  setups: Setup[],
  quotes: Record<string, Quote>
): Candidate[] {
  const setupMap = Object.fromEntries(setups.map((s) => [s.id, s]));

  return watchlist
    .map((item) => {
      const quote = quotes[item.symbol.toUpperCase()] ?? null;
      const { status, distanceToZonePct, label } = statusFor(item, quote?.price ?? null);
      return {
        item,
        setup: item.setupId ? setupMap[item.setupId] ?? null : null,
        quote,
        status,
        distanceToZonePct,
        label,
      };
    })
    .sort((a, b) => {
      const rank = { in_zone: 0, near_zone: 1, watching: 2, invalidated: 3 };
      return rank[a.status] - rank[b.status];
    });
}
