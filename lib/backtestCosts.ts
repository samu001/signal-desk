/** Default retail-realistic friction for daily-bar Playbook backtests. */
export type BacktestCostModel = {
  /** Slippage applied against you on each fill (e.g. 0.0005 = 5 bps). */
  slippagePct: number;
  /** Commission per side as a fraction of fill price (e.g. 0.0001 = 1 bp). */
  commissionPct: number;
};

export const DEFAULT_BACKTEST_COSTS: BacktestCostModel = {
  slippagePct: 0.0005,
  commissionPct: 0.0001,
};

/** Trading days to wait after a stop-out before re-entering the same ticker/setup. */
export const DEFAULT_STOP_COOLDOWN_BARS = 3;

/**
 * Liquidity tiers for portfolio / deep-script slippage.
 * Megacaps get 5 bps; liquid mid-caps 10; everything else 20 (small/illiquid).
 * Keep in sync with the deep-backtest universe defaults.
 */
export const SLIPPAGE_TIER_BIG = ['AAPL', 'AMZN', 'JPM', 'XOM', 'MSFT', 'GOOGL', 'META', 'NVDA'] as const;
export const SLIPPAGE_TIER_MID = ['FANG', 'CFG', 'WSM', 'DDOG', 'CRWD', 'NET', 'SNOW', 'MDB'] as const;

export type SlippageTier = 'big' | 'mid' | 'small';

export function slippageTierForSymbol(symbol: string): SlippageTier {
  const upper = symbol.toUpperCase().trim();
  if ((SLIPPAGE_TIER_BIG as readonly string[]).includes(upper)) return 'big';
  if ((SLIPPAGE_TIER_MID as readonly string[]).includes(upper)) return 'mid';
  return 'small';
}

/** Tiered slippage, $0 commission (Robinhood-style) — used by portfolio + deep script. */
export function costsForSymbol(symbol: string): BacktestCostModel {
  const tier = slippageTierForSymbol(symbol);
  if (tier === 'big') return { slippagePct: 0.0005, commissionPct: 0 };
  if (tier === 'mid') return { slippagePct: 0.001, commissionPct: 0 };
  return { slippagePct: 0.002, commissionPct: 0 };
}

export function slippageBpsLabel(symbol: string): string {
  const bps = Math.round(costsForSymbol(symbol).slippagePct * 10_000);
  return `${bps} bps`;
}

export function applyLongEntryFill(rawOpen: number, costs: BacktestCostModel): number {
  return rawOpen * (1 + costs.slippagePct + costs.commissionPct);
}

export function applyLongExitFill(rawExit: number, costs: BacktestCostModel): number {
  return rawExit * (1 - costs.slippagePct - costs.commissionPct);
}

/** Net R after entry/exit friction; risk uses the worse (filled) entry vs structural stop. */
export function netLongR(input: {
  entryFill: number;
  exitFill: number;
  stop: number;
}): number {
  const risk = input.entryFill - input.stop;
  if (risk <= 0) return 0;
  return (input.exitFill - input.entryFill) / risk;
}

export function describeCostModel(costs: BacktestCostModel): string {
  const slipBps = Math.round(costs.slippagePct * 10_000);
  const feeBps = Math.round(costs.commissionPct * 10_000);
  return `Costs: ${slipBps} bps slippage + ${feeBps} bps commission per side (net of fills).`;
}
