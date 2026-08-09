/**
 * Universe → Playbook match scan (Lab).
 *
 * Pure local evaluation of enabled setups against recent daily bars.
 * No Desk Soft/Strong stance, news, or fundamentals — just playbook rules.
 */
import { DEFAULT_LIVE_GATES, PlaybookGateFlags } from '@/lib/backtestProfile';
import { SetupExpectancy } from '@/lib/expectancy';
import { EarningsFetchStatus } from '@/lib/finnhub';
import { matchPlaybookSetups, rankMatchedSetups, SetupMatch } from '@/lib/setupMatch';
import { Candle, Setup } from '@/types/trading';

/** Calendar days of EOD history when 52-week checks are in the playbook. */
export const SCAN_HISTORY_DAYS_52W = 400;
/** Calendar days when only shorter lookbacks are needed (~60+ trading bars). */
export const SCAN_HISTORY_DAYS_SHORT = 120;

export type UniverseScanTicker = {
  symbol: string;
  candles: Candle[];
  earningsDates?: string[];
  earningsCalendarStatus?: EarningsFetchStatus;
};

export type UniverseScanRow = {
  symbol: string;
  /** All evaluated setups (pass and fail). */
  matches: SetupMatch[];
  /** Passing setups, ranked like Desk (expectancy → pass rate). */
  passed: SetupMatch[];
  topSetupId: string | null;
  topSetupName: string | null;
  topPassRate: number | null;
};

export type UniverseScanResult = {
  scannedAt: number;
  historyDays: number;
  minBars: number;
  earningsBlackout: boolean;
  setupsUsed: { id: string; name: string }[];
  rows: UniverseScanRow[];
  matchedCount: number;
  unmatchedCount: number;
};

export function playbookNeeds52WeekHistory(setups: Setup[]): boolean {
  return setups.some((s) => s.entryChecks.includes('near_52w_high'));
}

/** How many calendar days of EOD to request for a current-day match. */
export function historyDaysForPlaybookScan(setups: Setup[]): number {
  return playbookNeeds52WeekHistory(setups) ? SCAN_HISTORY_DAYS_52W : SCAN_HISTORY_DAYS_SHORT;
}

/** Minimum live bars before a ticker is eligible to scan. */
export function minBarsForPlaybookScan(setups: Setup[]): number {
  return playbookNeeds52WeekHistory(setups) ? 120 : 60;
}

/** Narrow earnings window for live ±1 day blackout (not multi-year history). */
export function liveEarningsWindow(asOf = new Date()): { fromDate: string; toDate: string } {
  const from = new Date(asOf);
  from.setUTCDate(from.getUTCDate() - 14);
  const to = new Date(asOf);
  to.setUTCDate(to.getUTCDate() + 14);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

export function scanUniverseAgainstPlaybook(input: {
  setups: Setup[];
  tickers: UniverseScanTicker[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  /** When false, skip the live earnings gate entirely (saves earnings API calls). */
  earningsBlackout?: boolean;
  /** Live behavior gate stack (defaults to live gates); earningsBlackout above still wins. */
  gates?: PlaybookGateFlags;
  expectancy?: Record<string, SetupExpectancy>;
  scannedAt?: number;
}): UniverseScanResult {
  const earningsBlackout = input.earningsBlackout !== false;
  const gates: PlaybookGateFlags = {
    ...(input.gates ?? DEFAULT_LIVE_GATES),
    earningsBlackout,
  };
  const historyDays = historyDaysForPlaybookScan(input.setups);
  const minBars = minBarsForPlaybookScan(input.setups);

  const rows: UniverseScanRow[] = input.tickers.map((ticker) => {
    const symbol = ticker.symbol.toUpperCase().trim();
    const matches = matchPlaybookSetups({
      symbol,
      setups: input.setups,
      quote: null,
      candles: ticker.candles,
      spyCandles: input.spyCandles,
      qqqCandles: input.qqqCandles,
      news: [],
      historicalMode: true,
      earningsDates: earningsBlackout ? ticker.earningsDates : undefined,
      earningsCalendarStatus: earningsBlackout ? ticker.earningsCalendarStatus : undefined,
      expectancy: input.expectancy,
      gates,
    });
    const passed = rankMatchedSetups(matches);
    const top = passed[0] ?? null;
    return {
      symbol,
      matches,
      passed,
      topSetupId: top?.setupId ?? null,
      topSetupName: top?.setupName ?? null,
      topPassRate: top?.passRate ?? null,
    };
  });

  const matched = rows.filter((r) => r.passed.length > 0);
  return {
    scannedAt: input.scannedAt ?? Date.now(),
    historyDays,
    minBars,
    earningsBlackout,
    setupsUsed: input.setups.map((s) => ({ id: s.id, name: s.name })),
    rows: [...matched, ...rows.filter((r) => r.passed.length === 0)],
    matchedCount: matched.length,
    unmatchedCount: rows.length - matched.length,
  };
}
