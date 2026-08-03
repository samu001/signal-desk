/** Thesis placeholder for tickers added without manual levels. */
export const AWAITING_DESK_THESIS = 'Awaiting Desk signal';

export function isAwaitingDeskSignal(thesis: string): boolean {
  const t = thesis.trim();
  return !t || t === AWAITING_DESK_THESIS;
}
