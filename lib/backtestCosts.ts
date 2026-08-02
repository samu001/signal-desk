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
