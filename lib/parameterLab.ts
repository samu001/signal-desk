/**
 * Parameter lab: rerun the same trade universe through alternative stop/target
 * settings and judge whether any setting is robustly better than production —
 * or whether the differences are within luck. Same philosophy as pickerLab:
 * one knob at a time, everything else frozen, walk-forward windows, and a
 * verdict about stability instead of a single "best" number.
 *
 * Tuning is EXITS-ONLY (see lib/levelTuning.ts): every variant takes the same
 * entries, so any difference in results comes from the exit geometry alone.
 *
 * Reading the verdict:
 * - edge: one setting wins overall AND on most tickers — worth considering.
 * - flat: production is within noise of the winner — keep current values.
 * - fragile: an overall winner that loses on most tickers — a lucky sample,
 *   not a real improvement.
 * - insufficient: too few trades to say anything.
 */

import { BacktestTrade, runBacktestVariants } from '@/lib/backtest';
import { BacktestCostModel } from '@/lib/backtestCosts';
import { PlaybookGateFlags } from '@/lib/backtestProfile';
import { describeTuning, LevelTuning } from '@/lib/levelTuning';
import { Candle, Setup } from '@/types/trading';

export type ParamKnob = 'targetR' | 'atrCapMult' | 'pctCap';

export type ParamVariant = {
  id: string;
  knob: ParamKnob;
  label: string;
  /** Undefined = production structure-based levels. */
  tuning: LevelTuning | undefined;
  isProduction: boolean;
};

export type LabTicker = { symbol: string; candles: Candle[] };

export type VariantWindowResult = {
  label: string;
  totalR: number;
  trades: number;
};

export type ParamVariantResult = {
  variant: ParamVariant;
  trades: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  maxDrawdownR: number | null;
  perTicker: { symbol: string; trades: number; totalR: number }[];
  /** Pooled trades split chronologically at the median exit — regime check. */
  windows: VariantWindowResult[];
};

export type ParamVerdictTone = 'edge' | 'flat' | 'fragile' | 'insufficient';

export type ParamKnobVerdict = {
  knob: ParamKnob;
  tone: ParamVerdictTone;
  headline: string;
  bullets: string[];
  winnerId: string | null;
  productionId: string;
};

export type ParameterLabKnobResult = {
  knob: ParamKnob;
  variants: ParamVariantResult[];
  verdict: ParamKnobVerdict;
};

export type ParameterLabResult = {
  knobs: ParameterLabKnobResult[];
  universe: string[];
  setupsUsed: string[];
};

/** Below this many pooled trades per variant, comparisons are noise. */
const MIN_TRADES = 10;
/** Below this many pooled trades for a whole knob, the verdict is "insufficient". */
const MIN_KNOB_TRADES = 30;

function knobLabel(knob: ParamKnob): string {
  if (knob === 'targetR') return 'Take-profit target';
  if (knob === 'atrCapMult') return 'ATR stop cap';
  return 'Percent stop cap';
}

/** One knob at a time; every other knob pinned at production. */
export function defaultParamVariants(): ParamVariant[] {
  const variants: ParamVariant[] = [];
  const prod = (knob: ParamKnob): ParamVariant => ({
    id: `${knob}:prod`,
    knob,
    label: 'Production',
    tuning: undefined,
    isProduction: true,
  });

  variants.push(prod('targetR'));
  for (const r of [1.0, 1.5, 2.0, 2.5, 3.0]) {
    variants.push({
      id: `targetR:${r}`,
      knob: 'targetR',
      label: `Target ${r}R`,
      tuning: { targetR: r },
      isProduction: false,
    });
  }

  variants.push(prod('atrCapMult'));
  for (const k of [3.0, 2.5, 2.0, 1.5]) {
    variants.push({
      id: `atrCapMult:${k}`,
      knob: 'atrCapMult',
      label: `Stop cap ${k}×ATR`,
      tuning: { atrCapMult: k },
      isProduction: false,
    });
  }

  variants.push(prod('pctCap'));
  for (const p of [0.1, 0.08, 0.05]) {
    variants.push({
      id: `pctCap:${p}`,
      knob: 'pctCap',
      label: `Stop cap ${(p * 100).toFixed(0)}%`,
      tuning: { pctCap: p },
      isProduction: false,
    });
  }

  return variants;
}

function summarizeTrades(trades: BacktestTrade[]): {
  totalR: number;
  winRate: number | null;
  avgR: number | null;
  maxDrawdownR: number | null;
} {
  const rs = trades.map((t) => t.rMultiple);
  const wins = rs.filter((r) => r > 0);
  const totalR = rs.reduce((a, b) => a + b, 0);
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return {
    totalR,
    winRate: rs.length ? wins.length / rs.length : null,
    avgR: rs.length ? totalR / rs.length : null,
    maxDrawdownR: rs.length ? maxDd : null,
  };
}

function splitWindows(trades: BacktestTrade[]): VariantWindowResult[] {
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const midExit = sorted[Math.floor(sorted.length / 2)].exitTime;
  const early = sorted.filter((t) => t.exitTime <= midExit);
  const late = sorted.filter((t) => t.exitTime > midExit);
  const sum = (ts: BacktestTrade[]) => ts.reduce((a, t) => a + t.rMultiple, 0);
  return [
    { label: 'Early half', totalR: sum(early), trades: early.length },
    { label: 'Late half', totalR: sum(late), trades: late.length },
  ];
}

function buildVerdict(knob: ParamKnob, results: ParamVariantResult[]): ParamKnobVerdict {
  const productionId = `${knob}:prod`;
  const name = knobLabel(knob);
  const totalKnobTrades = results.reduce((a, r) => a + r.trades, 0);
  if (totalKnobTrades < MIN_KNOB_TRADES) {
    return {
      knob,
      tone: 'insufficient',
      headline: `${name}: only ${totalKnobTrades} pooled trades — nothing to conclude`,
      bullets: ['Run more tickers or a longer history before trusting any setting.'],
      winnerId: null,
      productionId,
    };
  }

  const eligible = results.filter((r) => r.trades >= MIN_TRADES);
  const winner = eligible.length
    ? eligible.reduce((a, b) => (b.totalR > a.totalR ? b : a))
    : null;
  const production = results.find((r) => r.variant.isProduction) ?? null;

  if (!winner || !production) {
    return {
      knob,
      tone: 'insufficient',
      headline: `${name}: no variant reached ${MIN_TRADES} trades`,
      bullets: ['Samples per setting are too thin to compare.'],
      winnerId: null,
      productionId,
    };
  }

  // Stability: how many tickers does the overall winner also win head-to-head?
  const tickers = winner.perTicker.map((t) => t.symbol);
  let tickerWins = 0;
  let tickerCells = 0;
  for (const symbol of tickers) {
    const cells = eligible
      .map((r) => ({ r, t: r.perTicker.find((p) => p.symbol === symbol) }))
      .filter((c): c is { r: ParamVariantResult; t: { symbol: string; trades: number; totalR: number } } =>
        Boolean(c.t && c.t.trades > 0)
      );
    if (!cells.length) continue;
    tickerCells++;
    const best = cells.reduce((a, b) => (b.t.totalR > a.t.totalR ? b : a));
    if (best.r.variant.id === winner.variant.id) tickerWins++;
  }
  const winShare = tickerCells ? tickerWins / tickerCells : 0;
  const prodGap = winner.totalR - production.totalR;
  const fmtR = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}R`;

  const windowNote = winner.windows
    .map((w) => `${w.label.toLowerCase()} ${fmtR(w.totalR)}`)
    .join(' vs ');

  if (winner.variant.id === productionId || Math.abs(prodGap) < 0.05 * Math.abs(winner.totalR || 1)) {
    return {
      knob,
      tone: 'flat',
      headline: `${name}: production is within noise of the best setting`,
      bullets: [
        `Best: ${winner.variant.label} (${fmtR(winner.totalR)} pooled) vs production (${fmtR(production.totalR)}).`,
        `Winner takes ${tickerWins}/${tickerCells} tickers; ${windowNote}.`,
        'No evidence to change this parameter.',
      ],
      winnerId: winner.variant.id,
      productionId,
    };
  }

  if (winShare >= 0.6) {
    return {
      knob,
      tone: 'edge',
      headline: `${name}: ${winner.variant.label} robustly beats production`,
      bullets: [
        `${winner.variant.label} pooled ${fmtR(winner.totalR)} vs production ${fmtR(production.totalR)}.`,
        `Wins ${tickerWins}/${tickerCells} tickers; ${windowNote}.`,
        'Candidate for production — confirm on out-of-sample data before adopting.',
      ],
      winnerId: winner.variant.id,
      productionId,
    };
  }

  return {
    knob,
    tone: 'fragile',
    headline: `${name}: ${winner.variant.label} wins overall but flips by ticker`,
    bullets: [
      `Pooled ${fmtR(winner.totalR)} vs production ${fmtR(production.totalR)}, but wins only ${tickerWins}/${tickerCells} tickers.`,
      `${windowNote}.`,
      'Treat as a lucky sample, not an improvement — keep production.',
    ],
    winnerId: winner.variant.id,
    productionId,
  };
}

export function runParameterLab(input: {
  setups: Setup[];
  tickers: LabTicker[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  earningsDates?: Record<string, string[]>;
  costs?: BacktestCostModel;
  gates?: PlaybookGateFlags;
  stopCooldownBars?: number;
  variants?: ParamVariant[];
}): ParameterLabResult {
  const variants = input.variants ?? defaultParamVariants();
  const knobs: ParamKnob[] = [...new Set(variants.map((v) => v.knob))];

  // One shared pass per (ticker, setup) computes signals once; each variant
  // gets an independent position state machine over those same signals.
  const tunings = variants.map((v) => v.tuning);
  const pooledByVariant: BacktestTrade[][] = variants.map(() => []);
  const perTickerByVariant: { symbol: string; trades: number; totalR: number }[][] =
    variants.map(() => []);

  for (const ticker of input.tickers) {
    const tickerTrades: BacktestTrade[][] = variants.map(() => []);
    for (const setup of input.setups) {
      const results = runBacktestVariants(
        {
          setup,
          symbol: ticker.symbol,
          candles: ticker.candles,
          spyCandles: input.spyCandles,
          qqqCandles: input.qqqCandles,
          earningsDates: input.earningsDates?.[ticker.symbol.toUpperCase()],
          costs: input.costs,
          gates: input.gates,
          stopCooldownBars: input.stopCooldownBars,
          sourceLabel: 'parameter-lab',
        },
        tunings
      );
      results.forEach((result, vi) => {
        tickerTrades[vi].push(...result.trades);
      });
    }
    tickerTrades.forEach((trades, vi) => {
      pooledByVariant[vi].push(...trades);
      perTickerByVariant[vi].push({
        symbol: ticker.symbol,
        trades: trades.length,
        totalR: trades.reduce((a, t) => a + t.rMultiple, 0),
      });
    });
  }

  const resultsByVariant: ParamVariantResult[] = variants.map((variant, vi) => {
    const pooled = pooledByVariant[vi];
    const summary = summarizeTrades(pooled);
    return {
      variant,
      trades: pooled.length,
      winRate: summary.winRate,
      avgR: summary.avgR,
      totalR: summary.totalR,
      maxDrawdownR: summary.maxDrawdownR,
      perTicker: perTickerByVariant[vi],
      windows: splitWindows(pooled),
    };
  });

  const knobResults: ParameterLabKnobResult[] = knobs.map((knob) => {
    const results = resultsByVariant.filter((r) => r.variant.knob === knob);
    return { knob, variants: results, verdict: buildVerdict(knob, results) };
  });

  return {
    knobs: knobResults,
    universe: input.tickers.map((t) => t.symbol),
    setupsUsed: input.setups.map((s) => s.id),
  };
}

/** Console-friendly dump for a one-off study run. */
export function formatLabReport(result: ParameterLabResult): string {
  const lines: string[] = [
    `Parameter lab — ${result.universe.length} tickers × ${result.setupsUsed.length} setups`,
    '',
  ];
  for (const { variants, verdict } of result.knobs) {
    lines.push(`${verdict.headline}  [${verdict.tone}]`);
    const sorted = [...variants].sort((a, b) => b.totalR - a.totalR);
    for (const v of sorted) {
      const prod = v.variant.isProduction ? ' (production)' : '';
      const wr = v.winRate != null ? `${(v.winRate * 100).toFixed(0)}% win` : '—';
      const avg = v.avgR != null ? `${v.avgR >= 0 ? '+' : ''}${v.avgR.toFixed(2)}R avg` : '—';
      lines.push(
        `  ${v.variant.label}${prod}: ${v.totalR >= 0 ? '+' : ''}${v.totalR.toFixed(1)}R over ${v.trades} trades · ${wr} · ${avg}`
      );
    }
    for (const bullet of verdict.bullets) lines.push(`  → ${bullet}`);
    lines.push('');
  }
  return lines.join('\n');
}
