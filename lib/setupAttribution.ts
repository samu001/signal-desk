/**
 * Post-constraint setup attribution for portfolio backtests.
 * Scores setups among trades that already passed the run's filters
 * (usable basket, then optionally max-open taken) — not solo setup edge.
 */

export type SetupAttributionTrade = {
  setupId: string;
  r: number;
};

export type SetupAttributionCatalogItem = {
  id: string;
  name: string;
};

export type SetupAttributionRow = {
  setupId: string;
  name: string;
  trades: number;
  wins: number;
  winRate: number | null;
  totalR: number;
  avgR: number | null;
};

/** Minimum trades before a setup can wear a "best" badge. */
export const SETUP_ATTRIBUTION_MIN_N = 5;

export function aggregateSetupAttribution(
  trades: SetupAttributionTrade[],
  catalog: SetupAttributionCatalogItem[]
): SetupAttributionRow[] {
  const buckets = new Map<string, { wins: number; trades: number; totalR: number }>();
  for (const item of catalog) {
    buckets.set(item.id, { wins: 0, trades: 0, totalR: 0 });
  }
  for (const t of trades) {
    if (!t.setupId) continue;
    const cur = buckets.get(t.setupId) ?? { wins: 0, trades: 0, totalR: 0 };
    cur.trades += 1;
    if (t.r > 0) cur.wins += 1;
    cur.totalR += t.r;
    buckets.set(t.setupId, cur);
  }

  const nameById = Object.fromEntries(catalog.map((c) => [c.id, c.name]));
  const rows: SetupAttributionRow[] = [];
  for (const [setupId, b] of buckets) {
    rows.push({
      setupId,
      name: nameById[setupId] ?? setupId,
      trades: b.trades,
      wins: b.wins,
      winRate: b.trades ? b.wins / b.trades : null,
      totalR: b.totalR,
      avgR: b.trades ? b.totalR / b.trades : null,
    });
  }

  // Stable: total R desc, then n desc, then name.
  rows.sort((a, b) => {
    if (b.totalR !== a.totalR) return b.totalR - a.totalR;
    if (b.trades !== a.trades) return b.trades - a.trades;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export function bestSetupByTotalR(
  rows: SetupAttributionRow[],
  minN = SETUP_ATTRIBUTION_MIN_N
): string | null {
  const eligible = rows.filter((r) => r.trades >= minN);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => (b.totalR > a.totalR ? b : a)).setupId;
}

export function bestSetupByWinRate(
  rows: SetupAttributionRow[],
  minN = SETUP_ATTRIBUTION_MIN_N
): string | null {
  const eligible = rows.filter((r) => r.trades >= minN && r.winRate != null);
  if (!eligible.length) return null;
  return eligible.reduce((a, b) => {
    const aw = a.winRate ?? -1;
    const bw = b.winRate ?? -1;
    if (bw !== aw) return bw > aw ? b : a;
    return b.totalR > a.totalR ? b : a;
  }).setupId;
}
