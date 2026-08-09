import { BacktestCostModel } from '@/lib/backtestCosts';
import { PlaybookGateFlags, RuleCheckId } from '@/types/trading';

// Defined in types/trading.ts (shared with LiveBehaviorConfig); re-exported so
// existing imports from this module keep working.
export type { PlaybookGateFlags };

export type BacktestProfile = {
  id: 'must' | 'all8';
  label: string;
  description: string;
  gates: PlaybookGateFlags;
  costs: BacktestCostModel;
  /** Trading days after a stop-out before re-entry (0 = off). */
  stopCooldownBars: number;
};

/** Robinhood-style session realism: one trade/day + light slippage, $0 commission. */
export const PROFILE_MUST: BacktestProfile = {
  id: 'must',
  label: 'Must (de-dupe + slippage)',
  description:
    'One best setup per day and tiered slip+spread. Commission 0 (Robinhood stocks). No other filters.',
  gates: {
    marketRegime: false,
    earningsBlackout: false,
    weeklyTrend: false,
    sectorRs: false,
    volatility: false,
  },
  costs: { slippagePct: 0.0005, commissionPct: 0, halfSpreadPct: 0.0001, gapBeyondFraction: 0.1, overnightBorrowPctPerDay: 0 },
  stopCooldownBars: 0,
};

/** Full first-eight accuracy/realism stack. */
export const PROFILE_ALL8: BacktestProfile = {
  id: 'all8',
  label: 'All 8',
  description:
    'De-dupe + slippage, regime, earnings blackout, cooldown, weekly trend, sector RS, volatility band.',
  gates: {
    marketRegime: true,
    earningsBlackout: true,
    weeklyTrend: true,
    sectorRs: true,
    volatility: true,
  },
  costs: { slippagePct: 0.0005, commissionPct: 0, halfSpreadPct: 0.0001, gapBeyondFraction: 0.1, overnightBorrowPctPerDay: 0 },
  stopCooldownBars: 3,
};

export function gateChecksFromFlags(flags: PlaybookGateFlags): RuleCheckId[] {
  const out: RuleCheckId[] = [];
  if (flags.marketRegime) out.push('market_regime_ok');
  if (flags.earningsBlackout) out.push('earnings_clear');
  if (flags.weeklyTrend) out.push('weekly_trend_ok');
  if (flags.sectorRs) out.push('sector_rs_ok');
  if (flags.volatility) out.push('volatility_ok');
  return out;
}

/**
 * Live/default: earnings blackout only. The market-regime gate is applied
 * per-setup via `market_regime_ok` in entryChecks — 5y backtests showed it
 * helps trend/breakout setups but hurts flush/expansion setups.
 */
export const DEFAULT_LIVE_GATES: PlaybookGateFlags = {
  marketRegime: false,
  earningsBlackout: true,
  weeklyTrend: false,
  sectorRs: false,
  volatility: false,
};

/** Portfolio UI default: Must + live earnings blackout (cooldown off). */
export const DEFAULT_PORTFOLIO_GATES: PlaybookGateFlags = {
  ...PROFILE_MUST.gates,
  earningsBlackout: true,
};

/** Human-readable list of active accuracy extras (beyond de-dupe + costs). */
export function describeActiveExtras(
  gates: PlaybookGateFlags,
  stopCooldownBars: number
): string[] {
  const bits: string[] = [];
  if (gates.earningsBlackout) bits.push('earnings blackout');
  if (gates.marketRegime) bits.push('market regime');
  if (gates.weeklyTrend) bits.push('weekly trend');
  if (gates.sectorRs) bits.push('sector RS');
  if (gates.volatility) bits.push('volatility band');
  if (stopCooldownBars > 0) {
    bits.push(
      `${stopCooldownBars}-day stop cooldown`
    );
  }
  return bits;
}

export function isAll8Extras(
  gates: PlaybookGateFlags,
  stopCooldownBars: number
): boolean {
  return (
    gates.marketRegime &&
    gates.earningsBlackout &&
    gates.weeklyTrend &&
    gates.sectorRs &&
    gates.volatility &&
    stopCooldownBars === PROFILE_ALL8.stopCooldownBars
  );
}

export function isDefaultPortfolioExtras(
  gates: PlaybookGateFlags,
  stopCooldownBars: number
): boolean {
  return (
    !gates.marketRegime &&
    gates.earningsBlackout &&
    !gates.weeklyTrend &&
    !gates.sectorRs &&
    !gates.volatility &&
    stopCooldownBars === 0
  );
}
