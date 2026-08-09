import { PlaybookGateFlags } from '@/lib/backtestProfile';
import { SetupExpectancy } from '@/lib/expectancy';
import { EarningsFetchStatus } from '@/lib/finnhub';
import { evaluateSetupRules, MIN_SETUP_PASS_RATE, setupSignalPasses } from '@/lib/rules';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import { levelsForSetup } from '@/lib/setupLevels';
import { Candle, NewsItem, Quote, RuleCheckId, Setup, WatchlistItem } from '@/types/trading';

export type SetupMatch = {
  setupId: string;
  setupName: string;
  pass: boolean;
  passRate: number;
  expectancyScore: number;
  /** Human-readable auto-check labels that passed (Desk detail). */
  passedChecks: string[];
  /** Human-readable auto-check labels that failed (Desk detail). */
  failedChecks: string[];
  /** Human-readable reasons for failed/unknown checks, including data-gate failures. */
  failedCheckDetails: string[];
};

/** In Desk confirmation, skip session so after-hours research still can match setups. */
const SKIP_FOR_DESK = new Set(['session_tradable']);
const SHARED_HARD_GATES = new Set<RuleCheckId>([
  'earnings_clear',
  'market_regime_ok',
  'no_negative_catalyst',
]);

export type PlaybookBlocker = {
  label: string;
  detail: string;
  affectedSetups: number;
};

/** Shared failed gates that explain why every evaluated setup was blocked. */
export function commonPlaybookBlockers(matches: SetupMatch[]): PlaybookBlocker[] {
  if (!matches.length) return [];
  const grouped = new Map<string, PlaybookBlocker>();
  for (const match of matches) {
    for (const detail of match.failedCheckDetails) {
      const label = detail.split(': ', 1)[0];
      const key = label.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.affectedSetups += 1;
      } else {
        grouped.set(key, {
          label,
          detail: detail.slice(label.length + 2),
          affectedSetups: 1,
        });
      }
    }
  }
  return [...grouped.values()]
    .filter(
      (blocker) =>
        blocker.affectedSetups === matches.length ||
        [...SHARED_HARD_GATES].some((id) => blocker.label === id.replace(/_/g, ' '))
    )
    .sort((a, b) => b.affectedSetups - a.affectedSetups || a.label.localeCompare(b.label));
}

export function matchPlaybookSetups(input: {
  symbol: string;
  setups: Setup[];
  quote: Quote | null;
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  news?: NewsItem[];
  session?: SessionInfo;
  /** YYYY-MM-DD earnings dates for ±1 day blackout. */
  earningsDates?: string[];
  /** Why the calendar is missing/present — required for verified-empty vs fail-closed. */
  earningsCalendarStatus?: EarningsFetchStatus;
  /** When true, also skip news catalyst checks (Desk historical mode). */
  historicalMode?: boolean;
  expectancy?: Record<string, SetupExpectancy>;
  /** Override live gate stack (defaults to earnings blackout only). */
  gates?: PlaybookGateFlags;
}): SetupMatch[] {
  const symbol = input.symbol.toUpperCase().trim();
  const session = input.session ?? getUsEquitySession();
  const skip = new Set(SKIP_FOR_DESK);
  if (input.historicalMode) skip.add('no_negative_catalyst');

  return input.setups.map((setup) => {
    const levels = levelsForSetup(setup, input.candles);
    const item: WatchlistItem = {
      id: `desk-${setup.id}`,
      symbol,
      thesis: 'desk-match',
      ...levels,
      setupId: setup.id,
      notes: '',
      createdAt: '',
    };
    const results = evaluateSetupRules(setup, {
      item,
      quote: input.quote,
      candles: input.candles,
      spyCandles: input.spyCandles,
      qqqCandles: input.qqqCandles,
      news: input.news ?? [],
      earningsDates: input.earningsDates,
      earningsCalendarStatus: input.earningsCalendarStatus,
      session,
      gates: input.gates,
    });
    const usable = results.filter((r) => !skip.has(r.id));
    const { pass, passRate } = setupSignalPasses(setup, results, {
      minPassRate: MIN_SETUP_PASS_RATE,
      skipCheckIds: skip,
    });
    const passedChecks = usable.filter((r) => r.verdict === 'pass').map((r) => r.label);
    const failedChecks = usable
      .filter((r) => r.verdict === 'fail' || r.verdict === 'unknown')
      .filter((r) => r.verdict === 'fail' || r.id === setup.entryChecks[0])
      .map((r) => r.label);
    const failedCheckDetails = usable
      .filter((r) => r.verdict === 'fail' || r.id === setup.entryChecks[0])
      .filter((r) => r.verdict === 'fail' || r.verdict === 'unknown')
      .map((r) => `${r.label}: ${r.detail}`);
    return {
      setupId: setup.id,
      setupName: setup.name,
      pass,
      passRate,
      expectancyScore: input.expectancy?.[setup.id]?.score ?? 0,
      passedChecks,
      failedChecks,
      failedCheckDetails,
    };
  });
}

export function rankMatchedSetups(matches: SetupMatch[]): SetupMatch[] {
  return matches
    .filter((m) => m.pass)
    .sort((a, b) => {
      if (b.expectancyScore !== a.expectancyScore) return b.expectancyScore - a.expectancyScore;
      return b.passRate - a.passRate;
    });
}
