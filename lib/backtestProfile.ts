import { BacktestCostModel } from '@/lib/backtestCosts';
import { RuleCheckId } from '@/types/trading';

/** Optional Playbook accuracy gates appended on top of each setup's own checks. */
export type PlaybookGateFlags = {
  marketRegime: boolean;
  earningsBlackout: boolean;
  weeklyTrend: boolean;
  sectorRs: boolean;
  volatility: boolean;
};

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
    'One best setup per day and 5 bps slippage. Commission 0 (Robinhood stocks). No other filters.',
  gates: {
    marketRegime: false,
    earningsBlackout: false,
    weeklyTrend: false,
    sectorRs: false,
    volatility: false,
  },
  costs: { slippagePct: 0.0005, commissionPct: 0 },
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
  costs: { slippagePct: 0.0005, commissionPct: 0 },
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
