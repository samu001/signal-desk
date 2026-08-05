import { avgVolume } from '@/lib/indicators';
import type { Candle } from '@/types/trading';

/** Default retail-realistic friction for daily-bar Playbook backtests. */
export type BacktestCostModel = {
  /** Slippage applied against you on each fill (e.g. 0.0005 = 5 bps). */
  slippagePct: number;
  /** Commission per side as a fraction of fill price (e.g. 0.0001 = 1 bp). */
  commissionPct: number;
  /**
   * Half bid-ask spread paid against you each side (e.g. 0.0001 = 1 bp).
   * Entry pays the ask; exit hits the bid. Optional — defaults to 0.
   */
  halfSpreadPct?: number;
  /**
   * When the open gaps through the stop (long), worsen the fill by this
   * fraction of the gap below the open. 0 = fill at the open (gap-aware only);
   * 0.15 = 15% worse into the gap. Optional — defaults to 0.
   */
  gapBeyondFraction?: number;
  /**
   * Overnight stock-loan borrow as a fraction of notional per calendar day held.
   * Playbook is long-only — always 0 (shorts would pay this). Optional.
   */
  overnightBorrowPctPerDay?: number;
};

/** Resolved costs with defaults filled in. */
export type ResolvedBacktestCosts = Required<BacktestCostModel>;

export const DEFAULT_BACKTEST_COSTS: BacktestCostModel = {
  slippagePct: 0.0005,
  commissionPct: 0.0001,
  halfSpreadPct: 0.0001,
  gapBeyondFraction: 0.1,
  overnightBorrowPctPerDay: 0,
};

/** Trading days to wait after a stop-out before re-entering the same ticker/setup. */
export const DEFAULT_STOP_COOLDOWN_BARS = 3;

/**
 * Liquidity tiers from trailing avg daily dollar volume (ADV), not hardcoded
 * symbol lists — new tickers classify themselves from their bars.
 * Thresholds align with Desk liquidity: mid floor ≈ $20M (ok), big ≥ $100M.
 */
export const LIQUIDITY_ADV_MID = 20_000_000;
export const LIQUIDITY_ADV_BIG = 100_000_000;

export type SlippageTier = 'big' | 'mid' | 'small';

/** Trailing ADV ≈ avg volume × last close. Null when volume/price unavailable. */
export function avgDollarVolume(candles: Candle[], period = 20): number | null {
  if (!candles.length) return null;
  const vol = avgVolume(candles, period);
  const price = candles[candles.length - 1]?.close ?? 0;
  if (vol == null || !(price > 0) || !(vol > 0)) return null;
  return vol * price;
}

export function slippageTierFromAdv(adv: number | null): SlippageTier {
  if (adv == null || !(adv > 0)) return 'small';
  if (adv >= LIQUIDITY_ADV_BIG) return 'big';
  if (adv >= LIQUIDITY_ADV_MID) return 'mid';
  return 'small';
}

/** Classify from bars; missing/zero volume → small (safe). */
export function slippageTierFromCandles(candles: Candle[]): SlippageTier {
  return slippageTierFromAdv(avgDollarVolume(candles));
}

/**
 * Symbol-only fallback when bars are not available — always small (safe).
 * Prefer `slippageTierFromCandles` / `costsFromCandles` at call sites that have data.
 */
export function slippageTierForSymbol(_symbol: string): SlippageTier {
  return 'small';
}

export function resolveCosts(costs: BacktestCostModel): ResolvedBacktestCosts {
  return {
    slippagePct: costs.slippagePct,
    commissionPct: costs.commissionPct,
    halfSpreadPct: costs.halfSpreadPct ?? 0,
    gapBeyondFraction: costs.gapBeyondFraction ?? 0,
    overnightBorrowPctPerDay: costs.overnightBorrowPctPerDay ?? 0,
  };
}

/** Friction model for a liquidity tier ($0 commission, long-only borrow 0). */
export function costsForTier(tier: SlippageTier): BacktestCostModel {
  if (tier === 'big') {
    return {
      slippagePct: 0.0005,
      commissionPct: 0,
      halfSpreadPct: 0.0001,
      gapBeyondFraction: 0.1,
      overnightBorrowPctPerDay: 0,
    };
  }
  if (tier === 'mid') {
    return {
      slippagePct: 0.001,
      commissionPct: 0,
      halfSpreadPct: 0.0002,
      gapBeyondFraction: 0.15,
      overnightBorrowPctPerDay: 0,
    };
  }
  return {
    slippagePct: 0.002,
    commissionPct: 0,
    halfSpreadPct: 0.0005,
    gapBeyondFraction: 0.25,
    overnightBorrowPctPerDay: 0,
  };
}

/** Tiered friction from bars (ADV). Prefer this at portfolio / deep-script sites. */
export function costsFromCandles(candles: Candle[]): BacktestCostModel {
  return costsForTier(slippageTierFromCandles(candles));
}

/**
 * Tiered friction for a symbol. Pass `candles` so ADV classifies the tier;
 * without bars, defaults to small (safe) — no hardcoded megacap/mid lists.
 */
export function costsForSymbol(symbol: string, candles?: Candle[]): BacktestCostModel {
  void symbol;
  if (candles?.length) return costsFromCandles(candles);
  return costsForTier('small');
}

export function slippageBpsLabel(symbol: string, candles?: Candle[]): string {
  const c = resolveCosts(costsForSymbol(symbol, candles));
  const slip = Math.round(c.slippagePct * 10_000);
  const spread = Math.round(c.halfSpreadPct * 10_000);
  const tier = candles?.length ? slippageTierFromCandles(candles) : 'small';
  const adv = candles?.length ? avgDollarVolume(candles) : null;
  const advLabel =
    adv != null && adv > 0
      ? adv >= 1_000_000_000
        ? `~$${(adv / 1_000_000_000).toFixed(1)}B ADV`
        : `~$${(adv / 1_000_000).toFixed(0)}M ADV`
      : 'ADV n/a';
  return `${slip} bps slip + ${spread} bps½ spread (${tier}, ${advLabel})`;
}

/** Per-side adverse friction (slip + commission + half-spread). */
export function perSideAdversePct(costs: BacktestCostModel): number {
  const c = resolveCosts(costs);
  return c.slippagePct + c.commissionPct + c.halfSpreadPct;
}

export function applyLongEntryFill(rawOpen: number, costs: BacktestCostModel): number {
  return rawOpen * (1 + perSideAdversePct(costs));
}

export function applyLongExitFill(rawExit: number, costs: BacktestCostModel): number {
  return rawExit * (1 - perSideAdversePct(costs));
}

/**
 * Raw stop exit before side friction. Gap-aware: fill at the open when it gaps
 * through the stop. Gap-beyond: worsen further into the gap by `gapBeyondFraction`.
 */
export function gapAwareLongStopRaw(
  stop: number,
  barOpen: number,
  gapBeyondFraction = 0
): number {
  if (!(barOpen < stop)) return stop;
  const gap = stop - barOpen;
  const f = Math.max(0, Math.min(1, gapBeyondFraction));
  return barOpen - gap * f;
}

/** Favorable target gap: fill at the open when it gaps through the target. */
export function gapAwareLongTargetRaw(target: number, barOpen: number): number {
  return Math.max(target, barOpen);
}

/**
 * Overnight stock-loan drag in R units. Long-only playbook keeps this at 0;
 * wired so a non-zero rate (shorts / HTB) would reduce R by notional×days / risk.
 */
export function overnightBorrowDragR(input: {
  entryFill: number;
  stop: number;
  holdCalendarDays: number;
  costs: BacktestCostModel;
}): number {
  const c = resolveCosts(input.costs);
  if (!(c.overnightBorrowPctPerDay > 0) || !(input.holdCalendarDays > 0)) return 0;
  const risk = input.entryFill - input.stop;
  if (!(risk > 0)) return 0;
  return (c.overnightBorrowPctPerDay * input.holdCalendarDays * input.entryFill) / risk;
}

/** Net R after entry/exit friction; risk uses the worse (filled) entry vs structural stop. */
export function netLongR(input: {
  entryFill: number;
  exitFill: number;
  stop: number;
  /** Optional overnight borrow drag already expressed in R. */
  borrowDragR?: number;
}): number {
  const risk = input.entryFill - input.stop;
  if (risk <= 0) return 0;
  const gross = (input.exitFill - input.entryFill) / risk;
  const drag = input.borrowDragR ?? 0;
  return gross - Math.max(0, drag);
}

export function describeCostModel(costs: BacktestCostModel): string {
  const c = resolveCosts(costs);
  const slipBps = Math.round(c.slippagePct * 10_000);
  const feeBps = Math.round(c.commissionPct * 10_000);
  const spreadBps = Math.round(c.halfSpreadPct * 10_000);
  const gapPct = Math.round(c.gapBeyondFraction * 100);
  const borrow =
    c.overnightBorrowPctPerDay > 0
      ? `${(c.overnightBorrowPctPerDay * 10_000).toFixed(1)} bps/day overnight borrow`
      : 'borrow n/a (long-only)';
  return `Costs: ${slipBps} bps slip + ${spreadBps} bps½ spread + ${feeBps} bps commission per side; gap-beyond ${gapPct}% of stop-gap; ${borrow}.`;
}
