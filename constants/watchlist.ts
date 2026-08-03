import { WatchlistItem } from '@/types/trading';

/** Thesis placeholder for tickers added without manual levels. */
export const AWAITING_DESK_THESIS = 'Awaiting Desk signal';

export function isAwaitingDeskSignal(thesis: string): boolean {
  const t = thesis.trim();
  return !t || t === AWAITING_DESK_THESIS;
}

/** True when buy zone, stop, and target are all set (needed for trade plans). */
export function hasWatchlistLevels(
  item: Pick<WatchlistItem, 'entryLow' | 'entryHigh' | 'stop' | 'target'>
): boolean {
  return item.entryHigh > 0 && item.entryLow > 0 && item.stop > 0 && item.target > 0;
}
