/**
 * Portfolio capacity: fill max-open slots with highest entry-time priority each day.
 */

export type CapacityTrade = {
  symbol: string;
  entryTime: number;
  exitTime: number;
  r: number;
  priorityScore: number;
};

export type CapacitySimResult = {
  trades: number;
  skipped: number;
  winRate: number | null;
  totalR: number;
  avgPriorityTaken: number | null;
  avgPrioritySkipped: number | null;
  /** Trades that filled a free max-open slot. */
  taken: CapacityTrade[];
  /** Trades skipped because capacity was full that day. */
  skippedTrades: CapacityTrade[];
};

function dayKey(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Walk calendar days in order. On each day, among candidates that want to enter,
 * take the highest priorityScore up to free slots (maxOpen − still-open positions).
 * Never ranks on realized R.
 *
 * A position occupies its slot through its exit calendar day (not just until
 * exitTime). Entries fill at the open; exits are intraday or at the close, so
 * freeing the slot on the exit day would let the sim briefly hold more than
 * maxOpen. The slot frees the next calendar day.
 */
export function simulateMaxOpenByPriority(
  allTrades: CapacityTrade[],
  maxOpen: number
): CapacitySimResult {
  const cap = Math.max(1, Math.round(maxOpen) || 1);
  if (!allTrades.length) {
    return {
      trades: 0,
      skipped: 0,
      winRate: null,
      totalR: 0,
      avgPriorityTaken: null,
      avgPrioritySkipped: null,
      taken: [],
      skippedTrades: [],
    };
  }

  const byDay = new Map<string, CapacityTrade[]>();
  for (const t of allTrades) {
    const key = dayKey(t.entryTime);
    const list = byDay.get(key) ?? [];
    list.push(t);
    byDay.set(key, list);
  }

  const days = [...byDay.keys()].sort();
  const taken: CapacityTrade[] = [];
  const skippedList: CapacityTrade[] = [];

  for (const day of days) {
    const dayEntries = byDay.get(day)!;
    // Occupy through exit day: exit on day D still blocks day-D entries.
    const openNow = taken.filter((o) => dayKey(o.exitTime) >= day).length;
    const free = Math.max(0, cap - openNow);
    const ranked = [...dayEntries].sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return a.entryTime - b.entryTime;
    });
    for (let i = 0; i < ranked.length; i++) {
      if (i < free) taken.push(ranked[i]);
      else skippedList.push(ranked[i]);
    }
  }

  const wins = taken.filter((t) => t.r > 0).length;
  const avg = (list: CapacityTrade[]) =>
    list.length ? list.reduce((a, t) => a + t.priorityScore, 0) / list.length : null;

  return {
    trades: taken.length,
    skipped: skippedList.length,
    winRate: taken.length ? wins / taken.length : null,
    totalR: taken.reduce((a, t) => a + t.r, 0),
    avgPriorityTaken: avg(taken),
    avgPrioritySkipped: avg(skippedList),
    taken,
    skippedTrades: skippedList,
  };
}
