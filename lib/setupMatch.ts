import { SetupExpectancy } from '@/lib/expectancy';
import { evaluateSetupRules, scoreRuleResults } from '@/lib/rules';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import { levelsForSetup } from '@/lib/setupLevels';
import { Candle, NewsItem, Quote, Setup, WatchlistItem } from '@/types/trading';

export type SetupMatch = {
  setupId: string;
  setupName: string;
  pass: boolean;
  passRate: number;
  expectancyScore: number;
};

const MIN_PASS_RATE = 0.7;
/** In Desk confirmation, skip session so after-hours research still can match setups. */
const SKIP_FOR_DESK = new Set(['session_tradable']);

export function matchPlaybookSetups(input: {
  symbol: string;
  setups: Setup[];
  quote: Quote | null;
  candles: Candle[];
  spyCandles: Candle[];
  news?: NewsItem[];
  session?: SessionInfo;
  /** When true, also skip news catalyst checks (Desk historical mode). */
  historicalMode?: boolean;
  expectancy?: Record<string, SetupExpectancy>;
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
      news: input.news ?? [],
      session,
    });
    const usable = results.filter((r) => !skip.has(r.id));
    const scored = scoreRuleResults(usable.length ? usable : results);
    const hardFails = usable.filter((r) => r.verdict === 'fail').length;
    const pass = scored.passRate >= MIN_PASS_RATE && hardFails === 0;
    return {
      setupId: setup.id,
      setupName: setup.name,
      pass,
      passRate: scored.passRate,
      expectancyScore: input.expectancy?.[setup.id]?.score ?? 0,
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
