/**
 * Implied buying-power check for portfolio backtests.
 *
 * Dollar totals use `$ ≈ totalR × (account × risk%)`, which assumes every trade
 * can be sized to full risk. Tight stops imply large share counts / notional —
 * several open positions can silently exceed the account (leverage nobody said
 * you had). This module sizes each trade the same way the Desk does and reports
 * peak open notional so the UI can warn.
 */

import { calculatePositionSize } from '@/lib/positionSize';

export type SizedTrade = {
  entryTime: number;
  exitTime: number;
  entry: number;
  stop: number;
  symbol?: string;
};

export type BuyingPowerReport = {
  /** Largest sum of open position notionals on any calendar day. */
  peakNotional: number;
  /** peakNotional / accountSize (1 = fully invested, >1 = leverage). */
  peakNotionalPct: number;
  /** How many positions were open on the peak-notional day. */
  peakPositions: number;
  /** Calendar days where open notional exceeded the account. */
  leverageDays: number;
  /** Days that had at least one open position. */
  activeDays: number;
  /** Trades that alone would need more than the full account. */
  oversizeTrades: number;
  /** Trades that could not be sized at all (stop too wide / bad levels). */
  unsizableTrades: number;
  /** Widest stop as a fraction of entry among sizable trades (e.g. 0.02 = 2%). */
  tightestStopPct: number | null;
  /** Loosest stop as a fraction of entry among sizable trades. */
  widestStopPct: number | null;
};

function dayKey(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Size each trade at account × risk%, then walk calendar days.
 * A position occupies its notional through its exit calendar day (same rule as
 * the max-open capacity sim — entries fill at the open).
 */
export function analyzeBuyingPower(input: {
  trades: SizedTrade[];
  accountSize: number;
  riskPercent: number;
}): BuyingPowerReport {
  const accountSize = input.accountSize > 0 ? input.accountSize : 0;
  const empty: BuyingPowerReport = {
    peakNotional: 0,
    peakNotionalPct: 0,
    peakPositions: 0,
    leverageDays: 0,
    activeDays: 0,
    oversizeTrades: 0,
    unsizableTrades: 0,
    tightestStopPct: null,
    widestStopPct: null,
  };
  if (!input.trades.length || !(accountSize > 0) || !(input.riskPercent > 0)) {
    return empty;
  }

  type Sized = SizedTrade & { notional: number; stopPct: number };
  const sized: Sized[] = [];
  let oversizeTrades = 0;
  let unsizableTrades = 0;
  let tightestStopPct: number | null = null;
  let widestStopPct: number | null = null;

  for (const t of input.trades) {
    const size = calculatePositionSize({
      accountSize,
      riskPercent: input.riskPercent,
      entry: t.entry,
      stop: t.stop,
    });
    if (!size.valid || size.shares <= 0) {
      unsizableTrades += 1;
      continue;
    }
    const stopPct = Math.abs(t.entry - t.stop) / t.entry;
    if (tightestStopPct == null || stopPct < tightestStopPct) tightestStopPct = stopPct;
    if (widestStopPct == null || stopPct > widestStopPct) widestStopPct = stopPct;
    if (size.positionValue > accountSize) oversizeTrades += 1;
    sized.push({ ...t, notional: size.positionValue, stopPct });
  }

  if (!sized.length) {
    return {
      ...empty,
      oversizeTrades,
      unsizableTrades,
      tightestStopPct,
      widestStopPct,
    };
  }

  const days = new Set<string>();
  for (const t of sized) {
    // Sample entry day and exit day (occupy through exit day).
    days.add(dayKey(t.entryTime));
    days.add(dayKey(t.exitTime));
  }
  const sortedDays = [...days].sort();

  let peakNotional = 0;
  let peakPositions = 0;
  let leverageDays = 0;
  let activeDays = 0;

  for (const day of sortedDays) {
    const open = sized.filter(
      (t) => dayKey(t.entryTime) <= day && dayKey(t.exitTime) >= day
    );
    if (!open.length) continue;
    activeDays += 1;
    const notional = open.reduce((a, t) => a + t.notional, 0);
    if (notional > peakNotional) {
      peakNotional = notional;
      peakPositions = open.length;
    }
    if (notional > accountSize) leverageDays += 1;
  }

  return {
    peakNotional,
    peakNotionalPct: peakNotional / accountSize,
    peakPositions,
    leverageDays,
    activeDays,
    oversizeTrades,
    unsizableTrades,
    tightestStopPct,
    widestStopPct,
  };
}

/** True when the book would have needed more cash than the account (or a single oversized trade). */
export function buyingPowerNeedsWarning(report: BuyingPowerReport): boolean {
  return (
    report.peakNotionalPct > 1 ||
    report.oversizeTrades > 0 ||
    report.leverageDays > 0
  );
}
