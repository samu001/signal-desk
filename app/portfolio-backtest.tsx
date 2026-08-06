import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, EmptyState, Field, Pill, Screen, SectionTitle } from '@/components/ui';
import { palette, spacing } from '@/constants/theme';
import { useTrading } from '@/context/TradingContext';
import { PROFILE_MUST } from '@/lib/backtestProfile';
import { costsForSymbol, slippageBpsLabel } from '@/lib/backtestCosts';
import {
  analyzeBuyingPower,
  buyingPowerNeedsWarning,
  BuyingPowerReport,
  scaleDollarsForBuyingPower,
} from '@/lib/buyingPower';
import {
  AdjustmentStatus,
  fetchDailyCandlesResolved,
  isLiveCandleSource,
} from '@/lib/candles';
import {
  EarningsFetchResult,
  EarningsFetchStatus,
  fetchEarningsDates,
  summarizeEarningsFetches,
} from '@/lib/finnhub';
import { ParamVerdictTone } from '@/lib/parameterLab';
import {
  ParameterSweepResult,
  runParameterSweep,
} from '@/lib/parameterSweep';
import {
  applyPickerRule,
  bestSelectablePicker,
  comparePickerRules,
  interpretPickerLab,
  pickerLabel,
  PickerRuleResult,
  PickerTrade,
  PickerVerdictTone,
  relativeStrength20,
  SelectablePickerRuleId,
} from '@/lib/pickerLab';
import { runCombinedPlaybookBacktest } from '@/lib/playbookCombined';
import { CapacityTrade } from '@/lib/portfolioCapacity';
import { Candle } from '@/types/trading';

/** Same roster as scripts/run-deep-backtest.ts — picked on demonstrated combined R. */
const DEFAULT_SYMBOLS = 'AAPL, AMZN, JPM, XOM, FANG, CFG, WSM, DDOG, CROX, DUOL, FIX, IOT, PATH, RKLB';

function normalizeSymbolList(text: string): string {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((s) => s.toUpperCase().trim())
        .filter(Boolean)
    ),
  ]
    .sort()
    .join(',');
}

const DEFAULT_SYMBOLS_KEY = normalizeSymbolList(DEFAULT_SYMBOLS);

/** How complete/trustworthy this ticker's EOD was for the backtest window. */
type CoverageStatus = 'ok' | 'short' | 'none' | 'skipped' | 'suspect' | 'unadjusted';

type SymbolRow = {
  symbol: string;
  source: string;
  bars: number;
  trades: number;
  winRate: number | null;
  totalR: number;
  coverage: CoverageStatus;
  /** Split/dividend adjustment of the bars this row was scored on. */
  adjusted: AdjustmentStatus;
  /** Provider failures / backups that applied to this symbol. */
  notes: string[];
  /** Earnings calendar fetch outcome (when the ticker was scored). */
  earningsStatus?: EarningsFetchStatus;
  /** Only set on cappedRows — how many signals were skipped by max-open. */
  skipped?: number;
};

/** SPY/QQQ used for market-regime gates (not traded as portfolio rows). */
type BenchmarkRow = {
  symbol: 'SPY' | 'QQQ';
  source: string;
  bars: number;
  coverage: CoverageStatus;
  adjusted: AdjustmentStatus;
  notes: string[];
};

type PortfolioSummary = {
  rows: SymbolRow[];
  benchmarks: BenchmarkRow[];
  all: { trades: number; winRate: number | null; totalR: number };
  concurrency: { max: number; median: number; avg: number; overCapPct: number };
  /** Same capped sim under alternative ranking rules (picker lab). */
  pickers: PickerRuleResult[];
  /** Exit-parameter sweep under the same cap (parameter lab, portfolio-level). */
  paramSweep: ParameterSweepResult | null;
  /** Usable trades kept so picker switches recompute without re-fetching. */
  usableTrades: PickerTrade[];
  maxOpen: number;
  requestedDays: number;
  /** Tickers included in All / Max-open totals (coverage === ok). */
  usableSymbols: number;
  /** Tickers left out of totals (no data / short / skipped). */
  excludedSymbols: number;
  /** Earnings calendar rollup for the scored basket. */
  earningsSummary: ReturnType<typeof summarizeEarningsFetches> | null;
  warnings: string[];
};

type PerSymbolMode = 'all' | 'capped';

type CoverageFilter = 'all' | 'ok' | 'issues';
type ResultFilter = 'all' | 'winners' | 'losers' | 'flat';
type SymbolSort =
  | 'totalR_desc'
  | 'totalR_asc'
  | 'winRate_desc'
  | 'trades_desc'
  | 'skipped_desc'
  | 'symbol_asc';

function chipLabel(sort: SymbolSort): string {
  if (sort === 'totalR_desc') return 'R ↓';
  if (sort === 'totalR_asc') return 'R ↑';
  if (sort === 'winRate_desc') return 'Win % ↓';
  if (sort === 'trades_desc') return 'Trades ↓';
  if (sort === 'skipped_desc') return 'Skipped ↓';
  return 'A–Z';
}

function filterAndSortSymbolRows(
  rows: SymbolRow[],
  coverageFilter: CoverageFilter,
  resultFilter: ResultFilter,
  sort: SymbolSort
): SymbolRow[] {
  let list = rows;
  if (coverageFilter === 'ok') {
    list = list.filter((r) => r.coverage === 'ok');
  } else if (coverageFilter === 'issues') {
    list = list.filter((r) => r.coverage !== 'ok');
  }
  if (resultFilter === 'winners') {
    list = list.filter((r) => r.totalR > 0);
  } else if (resultFilter === 'losers') {
    list = list.filter((r) => r.totalR < 0);
  } else if (resultFilter === 'flat') {
    list = list.filter((r) => r.totalR === 0 || r.trades === 0);
  }

  const sorted = [...list];
  sorted.sort((a, b) => {
    if (sort === 'symbol_asc') return a.symbol.localeCompare(b.symbol);
    if (sort === 'totalR_asc') {
      if (a.totalR !== b.totalR) return a.totalR - b.totalR;
      return a.symbol.localeCompare(b.symbol);
    }
    if (sort === 'totalR_desc') {
      if (a.totalR !== b.totalR) return b.totalR - a.totalR;
      return a.symbol.localeCompare(b.symbol);
    }
    if (sort === 'winRate_desc') {
      const aw = a.winRate ?? -1;
      const bw = b.winRate ?? -1;
      if (aw !== bw) return bw - aw;
      return b.totalR - a.totalR;
    }
    if (sort === 'trades_desc') {
      if (a.trades !== b.trades) return b.trades - a.trades;
      return b.totalR - a.totalR;
    }
    // skipped_desc
    const as = a.skipped ?? 0;
    const bs = b.skipped ?? 0;
    if (as !== bs) return bs - as;
    return b.totalR - a.totalR;
  });
  return sorted;
}

function classifyCoverage(
  source: string,
  barCount: number,
  requestedDays: number
): CoverageStatus {
  if (!isLiveCandleSource(source) || source === 'demo' || source === 'none') return 'none';
  if (barCount < 60) return 'skipped';
  // ~252 trading days/year; allow some slack vs calendar-day request.
  const expected = Math.min(500, Math.max(60, Math.round(requestedDays * 0.55)));
  if (barCount < expected * 0.7) return 'short';
  return 'ok';
}

/** Keep actionable provider notes; drop pure cache-hit noise. */
function usefulNotes(warnings: string[]): string[] {
  return warnings.filter(
    (w) =>
      !/^Cached .+ EOD/i.test(w) &&
      /rate limit|429|cooldown|demo|No data|HTTP|cors|skipped|failed|auth|proxy|fallback|insufficient|only returned|No Tiingo|No FMP|No Yahoo|using built-in|unadjusted|suspect|split/i.test(
        w
      )
  );
}

function coverageLabel(status: CoverageStatus): string {
  if (status === 'ok') return 'Full';
  if (status === 'short') return 'Short history';
  if (status === 'none') return 'No data';
  if (status === 'suspect') return 'Suspect data';
  if (status === 'unadjusted') return 'Unadjusted';
  return 'Skipped';
}

function coverageTone(status: CoverageStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'ok') return 'good';
  if (status === 'short') return 'warn';
  if (status === 'none') return 'bad';
  if (status === 'unadjusted') return 'warn';
  return 'bad';
}

function adjustmentLabel(adjusted: AdjustmentStatus): string {
  if (adjusted === 'adjusted') return 'adj';
  if (adjusted === 'raw') return 'RAW';
  return 'adj?';
}

function adjustmentTone(adjusted: AdjustmentStatus): 'good' | 'warn' | 'neutral' {
  if (adjusted === 'adjusted') return 'good';
  if (adjusted === 'raw') return 'warn';
  return 'neutral';
}

function earningsStatusLabel(status: EarningsFetchStatus): string {
  if (status === 'ok') return 'earn ok';
  if (status === 'no_key') return 'earn: no key';
  if (status === 'error') return 'earn: error';
  return 'earn: empty';
}

function earningsStatusTone(status: EarningsFetchStatus): 'good' | 'warn' | 'bad' {
  if (status === 'ok') return 'good';
  if (status === 'error' || status === 'no_key') return 'bad';
  return 'warn';
}

/** Portfolio totals only count full live EOD — no-data / short / skipped stay in the table. */
function isUsableForTotals(coverage: CoverageStatus): boolean {
  return coverage === 'ok';
}

function aggregateCappedRows(
  baseRows: SymbolRow[],
  taken: CapacityTrade[],
  skippedTrades: CapacityTrade[]
): SymbolRow[] {
  const takenBy = new Map<string, CapacityTrade[]>();
  const skippedBy = new Map<string, number>();
  for (const t of taken) {
    const list = takenBy.get(t.symbol) ?? [];
    list.push(t);
    takenBy.set(t.symbol, list);
  }
  for (const t of skippedTrades) {
    skippedBy.set(t.symbol, (skippedBy.get(t.symbol) ?? 0) + 1);
  }
  return baseRows.map((row) => {
    if (!isUsableForTotals(row.coverage)) {
      return { ...row, trades: 0, winRate: null, totalR: 0, skipped: 0 };
    }
    const list = takenBy.get(row.symbol) ?? [];
    const wins = list.filter((t) => t.r > 0).length;
    return {
      ...row,
      trades: list.length,
      winRate: list.length ? wins / list.length : null,
      totalR: list.reduce((a, t) => a + t.r, 0),
      skipped: skippedBy.get(row.symbol) ?? 0,
    };
  });
}

type PortfolioTrade = CapacityTrade;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function concurrencyStats(allTrades: PortfolioTrade[], maxOpen: number) {
  if (!allTrades.length) return { max: 0, median: 0, avg: 0, overCapPct: 0 };
  const DAY = 86400;
  const minT = Math.min(...allTrades.map((t) => t.entryTime));
  const maxT = Math.max(...allTrades.map((t) => t.exitTime));
  const counts: number[] = [];
  for (let d = minT; d <= maxT; d += DAY) {
    counts.push(allTrades.filter((t) => t.entryTime <= d && t.exitTime > d).length);
  }
  const active = counts.filter((c) => c > 0);
  return {
    max: Math.max(0, ...counts),
    median: median(active),
    avg: active.length ? active.reduce((a, b) => a + b, 0) / active.length : 0,
    overCapPct: active.length ? active.filter((c) => c > maxOpen).length / active.length : 0,
  };
}

function paramVerdictTone(tone: ParamVerdictTone): 'good' | 'warn' | 'bad' | 'neutral' {
  if (tone === 'edge') return 'good';
  if (tone === 'fragile') return 'warn';
  if (tone === 'insufficient') return 'bad';
  return 'neutral';
}

function paramVerdictLabel(tone: ParamVerdictTone): string {
  if (tone === 'edge') return 'Robust edge';
  if (tone === 'fragile') return 'Fragile — likely luck';
  if (tone === 'insufficient') return 'Too few trades';
  return 'Flat — keep production';
}

function verdictBannerStyles(tone: PickerVerdictTone) {
  if (tone === 'losing') {
    return {
      box: { backgroundColor: palette.dangerSoft, borderColor: palette.danger },
      headline: { color: palette.danger },
    };
  }
  if (tone === 'noise' || tone === 'caution') {
    return {
      box: { backgroundColor: palette.warnSoft, borderColor: palette.warn },
      headline: { color: palette.warn },
    };
  }
  return {
    box: { backgroundColor: palette.mossSoft, borderColor: palette.moss },
    headline: { color: palette.leaf },
  };
}

export default function PortfolioBacktestScreen() {
  const { settings, setups, updateSettings } = useTrading();
  const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS);
  const [days, setDays] = useState('400');
  const [maxOpen, setMaxOpen] = useState('3');
  const [accountSize, setAccountSize] = useState(String(settings.accountSize));
  const [riskPercent, setRiskPercent] = useState(String(settings.riskPercent));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [perSymbolMode, setPerSymbolMode] = useState<PerSymbolMode>('capped');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [symbolSort, setSymbolSort] = useState<SymbolSort>('totalR_desc');
  /** Drives Max-open totals + capped per-symbol after a run (no re-fetch). */
  const [activePicker, setActivePicker] = useState<SelectablePickerRuleId>('priority');
  /** Active exit variant from the sweep (null = production / main run). */
  const [activeParamId, setActiveParamId] = useState<string | null>(null);

  /**
   * The trade universe driving every stat below: the main run's trades when no
   * exit variant is selected, or the tapped variant's uncapped trades from the
   * sweep. Switching variants needs no re-run — the sweep stored each variant's
   * full trade list (with RS20) at run time.
   */
  const activeParam = useMemo(() => {
    if (activeParamId == null) return null;
    const found = summary?.paramSweep?.uncappedByVariant.find(
      (v) => v.variant.id === activeParamId
    );
    if (!found || found.variant.isProduction) return null;
    return { id: found.variant.id, label: found.variant.label, trades: found.trades };
  }, [summary, activeParamId]);

  const effectiveTrades = useMemo<PickerTrade[]>(
    () => activeParam?.trades ?? summary?.usableTrades ?? [],
    [activeParam, summary]
  );

  const effectiveRows = useMemo<SymbolRow[]>(() => {
    if (!summary) return [];
    if (!activeParam) return summary.rows;
    const bySymbol = new Map<string, { trades: number; wins: number; totalR: number }>();
    for (const t of activeParam.trades) {
      const cur = bySymbol.get(t.symbol) ?? { trades: 0, wins: 0, totalR: 0 };
      cur.trades += 1;
      if (t.r > 0) cur.wins += 1;
      cur.totalR += t.r;
      bySymbol.set(t.symbol, cur);
    }
    return summary.rows.map((row) => {
      if (!isUsableForTotals(row.coverage)) return { ...row, trades: 0, winRate: null, totalR: 0 };
      const c = bySymbol.get(row.symbol);
      return {
        ...row,
        trades: c?.trades ?? 0,
        winRate: c && c.trades ? c.wins / c.trades : null,
        totalR: c?.totalR ?? 0,
      };
    });
  }, [summary, activeParam]);

  const effectiveAll = useMemo(() => {
    const wins = effectiveTrades.filter((t) => t.r > 0).length;
    return {
      trades: effectiveTrades.length,
      winRate: effectiveTrades.length ? wins / effectiveTrades.length : null,
      totalR: effectiveTrades.reduce((a, t) => a + t.r, 0),
    };
  }, [effectiveTrades]);

  const effectivePickers = useMemo<PickerRuleResult[]>(() => {
    if (!activeParam) return summary?.pickers ?? [];
    return comparePickerRules(activeParam.trades, summary?.maxOpen ?? 3);
  }, [activeParam, summary]);

  const cappedView = useMemo(() => {
    if (!summary) return null;
    const sim = applyPickerRule(effectiveTrades, activePicker, summary.maxOpen);
    return {
      capped: {
        trades: sim.trades,
        skipped: sim.skipped,
        winRate: sim.winRate,
        totalR: sim.totalR,
        avgPriorityTaken: sim.avgPriorityTaken,
        avgPrioritySkipped: sim.avgPrioritySkipped,
      },
      taken: sim.taken,
      cappedRows: aggregateCappedRows(effectiveRows, sim.taken, sim.skippedTrades),
      pickerName: pickerLabel(activePicker),
    };
  }, [summary, effectiveTrades, effectiveRows, activePicker]);

  const buyingPower = useMemo<BuyingPowerReport | null>(() => {
    if (!cappedView?.taken.length) return null;
    const byKey = new Map(
      effectiveTrades.map((t) => [`${t.symbol}|${t.entryTime}`, t] as const)
    );
    const sized = cappedView.taken
      .map((t) => {
        const full = byKey.get(`${t.symbol}|${t.entryTime}`);
        if (!full || !(full.entry > 0) || !(full.stop > 0)) return null;
        return {
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entry: full.entry,
          stop: full.stop,
          symbol: t.symbol,
        };
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const acct = Number(accountSize) > 0 ? Number(accountSize) : settings.accountSize;
    const riskPct = Number(riskPercent) > 0 ? Number(riskPercent) : settings.riskPercent;
    return analyzeBuyingPower({
      trades: sized,
      accountSize: acct,
      riskPercent: riskPct,
    });
  }, [cappedView, effectiveTrades, accountSize, riskPercent, settings.accountSize, settings.riskPercent]);

  const riskPerTrade =
    (Number(accountSize) || settings.accountSize) *
    ((Number(riskPercent) || settings.riskPercent) / 100);

  const dollarPnL = useMemo(() => {
    if (!cappedView) return null;
    return scaleDollarsForBuyingPower({
      totalR: cappedView.capped.totalR,
      riskPerTrade,
      report: buyingPower,
    });
  }, [cappedView, riskPerTrade, buyingPower]);

  const perSymbolRows = useMemo(() => {
    if (!summary || !cappedView) return [] as SymbolRow[];
    const base = perSymbolMode === 'capped' ? cappedView.cappedRows : effectiveRows;
    return filterAndSortSymbolRows(base, coverageFilter, resultFilter, symbolSort);
  }, [summary, cappedView, effectiveRows, perSymbolMode, coverageFilter, resultFilter, symbolSort]);

  const run = async () => {
    setLoading(true);
    setSummary(null);
    setActiveParamId(null);
    try {
      // Persist account inputs so the rest of the app sizes positions the same way.
      const acct = Number(accountSize) > 0 ? Number(accountSize) : settings.accountSize;
      const riskPct = Number(riskPercent) > 0 ? Number(riskPercent) : settings.riskPercent;
      updateSettings({ accountSize: acct, riskPercent: riskPct });

      const cap = Math.max(1, Math.round(Number(maxOpen) || 3));
      const symbols = [
        ...new Set(
          symbolsText
            .split(/[,\s]+/)
            .map((s) => s.toUpperCase().trim())
            .filter(Boolean)
        ),
      ];
      const keys = {
        tiingoApiKey: settings.tiingoApiKey || undefined,
        tiingoProxyUrl: settings.tiingoProxyUrl || undefined,
        tiingoProxyToken: settings.tiingoProxyToken || undefined,
        fmpApiKey: settings.fmpApiKey || undefined,
        finnhubApiKey: settings.finnhubApiKey || undefined,
        alphaVantageApiKey: settings.alphaVantageApiKey || undefined,
        yahooProxyUrl: settings.yahooProxyUrl || undefined,
        yahooProxyToken: settings.yahooProxyToken || undefined,
        days: Math.max(140, Math.min(Number(days) || 400, 800)),
      };
      const requestedDays = keys.days;
      const warnings: string[] = [];

      setProgress('Fetching SPY / QQQ…');
      const spy = await fetchDailyCandlesResolved('SPY', keys);
      const qqq = await fetchDailyCandlesResolved('QQQ', keys);
      const spyNotes = usefulNotes(spy.warnings);
      const qqqNotes = usefulNotes(qqq.warnings);
      for (const w of spyNotes) {
        if (!warnings.includes(w)) warnings.push(`SPY: ${w}`);
      }
      for (const w of qqqNotes) {
        if (!warnings.includes(w)) warnings.push(`QQQ: ${w}`);
      }
      const benchmarks: BenchmarkRow[] = [
        {
          symbol: 'SPY',
          source: spy.source,
          bars: spy.candles.length,
          coverage: classifyCoverage(spy.source, spy.candles.length, requestedDays),
          adjusted: spy.adjusted ?? 'unknown',
          notes: spyNotes,
        },
        {
          symbol: 'QQQ',
          source: qqq.source,
          bars: qqq.candles.length,
          coverage: classifyCoverage(qqq.source, qqq.candles.length, requestedDays),
          adjusted: qqq.adjusted ?? 'unknown',
          notes: qqqNotes,
        },
      ];
      for (const b of benchmarks) {
        if (b.coverage === 'none' || b.coverage === 'skipped') {
          const msg = `${b.symbol}: No data for regime gate (${b.source}, ${b.bars} bars).`;
          if (!warnings.includes(msg)) warnings.push(msg);
        } else if (b.coverage === 'short') {
          const msg = `${b.symbol}: Thin history for regime (${b.bars} bars via ${b.source}).`;
          if (!warnings.includes(msg)) warnings.push(msg);
        }
      }

      const rows: SymbolRow[] = [];
      const usableTrades: PickerTrade[] = [];
      const candlesBySymbol = new Map<string, typeof spy.candles>();
      const earningsBySymbol = new Map<string, EarningsFetchResult>();
      // Must realism + live earnings blackout (parity with Desk / DEFAULT_LIVE_GATES).
      // Per-symbol tiered friction from trailing ADV (not hardcoded symbol lists).
      const portfolioProfile = {
        ...PROFILE_MUST,
        gates: { ...PROFILE_MUST.gates, earningsBlackout: true },
        description: `${PROFILE_MUST.description} Plus earnings blackout (live Desk parity). Tiered slippage by trailing ADV.`,
      };
      const hasEarningsKey = Boolean(
        settings.finnhubApiKey?.trim() ||
          settings.fmpApiKey?.trim() ||
          settings.alphaVantageApiKey?.trim() ||
          settings.yahooProxyUrl?.trim()
      );
      if (!hasEarningsKey) {
        warnings.push(
          'No Finnhub / FMP / Alpha Vantage / Yahoo proxy — earnings blackout fails closed on every symbol (expect ~0 trades). Add a key or Yahoo proxy in Settings.'
        );
      }

      const earningsFetches: EarningsFetchResult[] = [];

      for (const symbol of symbols) {
        setProgress(`Backtesting ${symbol} (${rows.length + 1}/${symbols.length})…`);
        const bars = await fetchDailyCandlesResolved(symbol, keys);
        const notes = usefulNotes(bars.warnings);
        for (const w of notes) {
          const tagged = w.includes(symbol) ? w : `${symbol}: ${w}`;
          if (!warnings.includes(tagged)) warnings.push(tagged);
        }
        const adjusted = bars.adjusted ?? 'unknown';
        // Big overnight moves on non-adjusted bars are treated as data
        // artifacts (unadjusted splits), not trades — the symbol is excluded.
        const suspectGaps = adjusted !== 'adjusted' ? (bars.suspectGaps ?? []) : [];
        let coverage = classifyCoverage(bars.source, bars.candles.length, requestedDays);
        if (suspectGaps.length && (coverage === 'ok' || coverage === 'short')) {
          coverage = 'suspect';
        } else if (
          adjusted !== 'adjusted' &&
          (coverage === 'ok' || coverage === 'short')
        ) {
          // Portfolio totals require split+dividend adjusted EOD. RAW still
          // has dividend drag; unknown (Yahoo) is unverifiable — both excluded
          // even when the gap guard is quiet.
          coverage = 'unadjusted';
        }
        if (coverage === 'suspect') {
          const worst = suspectGaps.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
          rows.push({
            symbol,
            source: bars.source,
            bars: bars.candles.length,
            trades: 0,
            winRate: null,
            totalR: 0,
            coverage,
            adjusted,
            notes: [
              `Overnight move of ${worst.pct >= 0 ? '+' : ''}${(worst.pct * 100).toFixed(0)}% on ${
                worst.date
              } on ${adjusted === 'raw' ? 'RAW unadjusted' : 'unknown-adjustment'} ${
                bars.source
              } bars — likely an unadjusted split, so trades on this feed would be fake. Excluded from the run; use Tiingo (adjusted) or FMP dividend-adjusted.`,
              ...notes,
            ],
          });
          continue;
        }
        if (coverage === 'unadjusted') {
          rows.push({
            symbol,
            source: bars.source,
            bars: bars.candles.length,
            trades: 0,
            winRate: null,
            totalR: 0,
            coverage,
            adjusted,
            notes: [
              adjusted === 'raw'
                ? `Bars from ${bars.source} are RAW (dividends/splits not adjusted) — excluded from portfolio totals. Use Tiingo or an FMP plan with the dividend-adjusted EOD endpoint.`
                : `Adjustment of ${bars.source} bars is unverified (adj?) — excluded from portfolio totals. Use Tiingo or FMP dividend-adjusted EOD so splits/dividends cannot silently distort R.`,
              ...notes,
            ],
          });
          continue;
        }
        if (coverage === 'none' || coverage === 'skipped' || bars.candles.length < 60) {
          rows.push({
            symbol,
            source: bars.source,
            bars: bars.candles.length,
            trades: 0,
            winRate: null,
            totalR: 0,
            coverage,
            adjusted,
            notes: notes.length
              ? notes
              : coverage === 'none'
                ? ['No data — live EOD unavailable. Synthetic demo bars are disabled.']
                : [`Only ${bars.candles.length} bars from ${bars.source} — need ≥60 to backtest.`],
          });
          continue;
        }
        candlesBySymbol.set(symbol, bars.candles);
        const firstBar = bars.candles[0]?.time;
        const lastBar = bars.candles[bars.candles.length - 1]?.time;
        const earnFrom = firstBar
          ? new Date(firstBar * 1000).toISOString().slice(0, 10)
          : new Date(Date.now() - requestedDays * 86400000).toISOString().slice(0, 10);
        const earnTo = lastBar
          ? new Date(lastBar * 1000 + 2 * 86400000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        setProgress(`Earnings ${symbol} (${rows.length + 1}/${symbols.length})…`);
        const earnings = await fetchEarningsDates(
          symbol,
          settings.finnhubApiKey || undefined,
          earnFrom,
          earnTo,
          settings.fmpApiKey || undefined,
          settings.alphaVantageApiKey || undefined,
          settings.yahooProxyUrl?.trim()
            ? { url: settings.yahooProxyUrl, token: settings.yahooProxyToken || undefined }
            : undefined
        );
        earningsBySymbol.set(symbol, earnings);
        earningsFetches.push(earnings);
        if (earnings.status !== 'ok') {
          notes.push(earnings.detail);
        }

        const symbolCosts = costsForSymbol(symbol, bars.candles);
        const combined = runCombinedPlaybookBacktest({
          symbol,
          setups,
          candles: bars.candles,
          spyCandles: spy.candles,
          qqqCandles: qqq.candles,
          earningsDates: earnings.dates,
          earningsCalendarStatus: earnings.status,
          sourceLabel: bars.source,
          profile: { ...portfolioProfile, costs: symbolCosts },
        });
        for (const t of combined.trades) {
          const trade: PickerTrade = {
            symbol,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            r: t.rMultiple,
            priorityScore: t.priorityScore,
            setupId: t.setupId,
            rs20: relativeStrength20(bars.candles, spy.candles, t.entryTime),
            entry: t.entry,
            stop: t.stop,
          };
          if (isUsableForTotals(coverage)) usableTrades.push(trade);
        }
        const rowNotes = [...notes];
        if (coverage === 'short') {
          rowNotes.unshift(
            `Thin history: ${bars.candles.length} bars via ${bars.source} (requested ~${requestedDays} calendar days).`
          );
        }
        rowNotes.push(`Slippage tier: ${slippageBpsLabel(symbol, bars.candles)} (ADV).`);
        if (earnings.status === 'ok') {
          rowNotes.push(`Earnings calendar: ${earnings.dates.length} dates in window.`);
        }
        rows.push({
          symbol,
          source: bars.source,
          bars: bars.candles.length,
          trades: combined.trades.length,
          winRate: combined.winRate,
          totalR: combined.totalR ?? 0,
          coverage,
          adjusted,
          earningsStatus: earnings.status,
          notes: rowNotes,
        });
      }

      const usableSymbolCount = rows.filter((r) => isUsableForTotals(r.coverage)).length;
      const excludedSymbolCount = rows.length - usableSymbolCount;
      const wins = usableTrades.filter((t) => t.r > 0).length;
      const earningsSummary =
        earningsFetches.length > 0 ? summarizeEarningsFetches(earningsFetches) : null;
      if (earningsSummary?.anyBlocked) {
        warnings.unshift(earningsSummary.headline);
      }
      setProgress('Comparing picker rules…');
      const pickers = comparePickerRules(usableTrades, cap);
      // Headline stays on Production — never auto-activate the in-sample "Best"
      // picker or exit variant (those remain tappable comparison rows).
      setActivePicker('priority');
      setActiveParamId(null);

      // Exit-parameter sweep over the same basket, under the same cap.
      let paramSweep: ParameterSweepResult | null = null;
      const sweepTickers = rows
        .filter((r) => isUsableForTotals(r.coverage))
        .map((r) => {
          const earn = earningsBySymbol.get(r.symbol);
          return {
            symbol: r.symbol,
            candles: candlesBySymbol.get(r.symbol)!,
            earningsDates: earn?.dates ?? [],
            earningsCalendarStatus: earn?.status,
            costs: costsForSymbol(r.symbol, candlesBySymbol.get(r.symbol)),
          };
        })
        .filter((t) => t.candles);
      if (sweepTickers.length) {
        setProgress('Sweeping exit parameters…');
        paramSweep = runParameterSweep({
          setups,
          tickers: sweepTickers,
          spyCandles: spy.candles,
          qqqCandles: qqq.candles,
          gates: portfolioProfile.gates,
          stopCooldownBars: portfolioProfile.stopCooldownBars,
          maxOpen: cap,
        });
      }

      setSummary({
        rows,
        benchmarks,
        all: {
          trades: usableTrades.length,
          winRate: usableTrades.length ? wins / usableTrades.length : null,
          totalR: usableTrades.reduce((a, t) => a + t.r, 0),
        },
        concurrency: concurrencyStats(usableTrades, cap),
        pickers,
        paramSweep,
        usableTrades,
        maxOpen: cap,
        requestedDays,
        usableSymbols: usableSymbolCount,
        excludedSymbols: excludedSymbolCount,
        earningsSummary,
        warnings,
      });
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const usingDefaultBasket =
    normalizeSymbolList(symbolsText) === DEFAULT_SYMBOLS_KEY;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Portfolio backtest' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle
          title="Portfolio backtest"
          subtitle="Runs the combined Playbook across a symbol list with gap-aware + gap-beyond stop fills, ADV-tiered slip/spread (≥$100M 5+1 / ≥$20M 10+2 / else 20+5 bps), earnings blackout (live Desk parity), then a max-open-positions capital cap. R is converted to dollars using your account settings — dollars scale down when peak open notional would exceed the account."
        />

        <Field
          label="Symbols (comma separated)"
          autoCapitalize="characters"
          value={symbolsText}
          onChangeText={setSymbolsText}
          multiline
        />
        {usingDefaultBasket ? (
          <Text style={styles.riskNote}>
            Default basket is performance-picked on the same history it scores (deep-script
            universe). Prefer your own watchlist or a liquid set you did not cherry-pick —
            otherwise treat the total as optimistic.
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Field
              label="History (calendar days)"
              keyboardType="number-pad"
              value={days}
              onChangeText={setDays}
            />
          </View>
          <View style={styles.rowItem}>
            <Field
              label="Max open positions"
              keyboardType="number-pad"
              value={maxOpen}
              onChangeText={setMaxOpen}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Field
              label="Account size ($)"
              keyboardType="decimal-pad"
              value={accountSize}
              onChangeText={setAccountSize}
            />
          </View>
          <View style={styles.rowItem}>
            <Field
              label="Risk per trade (%)"
              keyboardType="decimal-pad"
              value={riskPercent}
              onChangeText={setRiskPercent}
            />
          </View>
        </View>
        <Text style={styles.riskNote}>
          1R = ${riskPerTrade.toFixed(0)} per trade at these settings (saved to Settings on run).
        </Text>
        {!settings.finnhubApiKey?.trim() &&
        !settings.fmpApiKey?.trim() &&
        !settings.alphaVantageApiKey?.trim() &&
        !settings.yahooProxyUrl?.trim() ? (
          <View style={styles.losingBanner}>
            <Text style={styles.losingBannerText}>
              No Finnhub / FMP / Alpha Vantage / Yahoo proxy — earnings blackout fails closed, so a
              run will take almost no trades. Add a key or Yahoo proxy in Settings (Finnhub → FMP →
              Alpha Vantage → Yahoo) before trusting portfolio results.
            </Text>
          </View>
        ) : !settings.finnhubApiKey?.trim() ? (
          <View style={styles.losingBanner}>
            <Text style={styles.losingBannerText}>
              No Finnhub key — earnings calendars use FMP
              {settings.alphaVantageApiKey?.trim() ? ' / Alpha Vantage' : ''}
              {settings.yahooProxyUrl?.trim() ? ' / Yahoo' : ''} backup only. Finnhub is preferred
              when available.
            </Text>
          </View>
        ) : null}

        <Button label={loading ? 'Running…' : 'Run portfolio backtest'} onPress={() => run()} disabled={loading} />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.moss} />
            <Text style={styles.loadingText}>{progress || 'Working…'}</Text>
          </View>
        ) : null}

        {summary && cappedView ? (
          <View style={styles.results}>
            <SectionTitle
              title="Portfolio"
              subtitle={
                summary.excludedSymbols
                  ? `Totals use ${summary.usableSymbols} full-coverage tickers only — ${summary.excludedSymbols} no-data/short/skipped/suspect/unadjusted left out.`
                  : `Totals use all ${summary.usableSymbols} tickers (full live adjusted EOD).`
              }
            />
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>
                  All signals{activeParam ? ` · ${activeParam.label}` : ' (usable)'}
                </Text>
                <Text style={styles.statValue}>
                  {effectiveAll.totalR >= 0 ? '+' : ''}
                  {effectiveAll.totalR.toFixed(1)}R
                </Text>
                <Text style={styles.statSub}>
                  {effectiveAll.trades} trades ·{' '}
                  {effectiveAll.winRate == null ? '—' : `${Math.round(effectiveAll.winRate * 100)}%`} win
                </Text>
              </View>
              <View style={[styles.stat, styles.statPrimary]}>
                <Text style={styles.statLabel}>
                  Max {summary.maxOpen} open · {cappedView.pickerName}
                  {activeParam ? ` · ${activeParam.label}` : ''}
                </Text>
                <Text style={styles.statValue}>
                  {cappedView.capped.totalR >= 0 ? '+' : ''}
                  {cappedView.capped.totalR.toFixed(1)}R
                </Text>
                <Text style={styles.statSub}>
                  ≈ ${dollarPnL ? dollarPnL.scaledDollars.toFixed(0) : '—'}
                  {dollarPnL?.scaled ? ' fundable' : ''} · {cappedView.capped.trades} taken ·{' '}
                  {cappedView.capped.winRate == null
                    ? '—'
                    : `${Math.round(cappedView.capped.winRate * 100)}%`}{' '}
                  win · {cappedView.capped.skipped} skipped
                </Text>
              </View>
            </View>
            {effectiveAll.totalR < 0 ? (
              <View style={styles.losingBanner}>
                <Text style={styles.losingBannerText}>
                  All signals is negative ({effectiveAll.totalR.toFixed(1)}R) — do not treat the capped
                  total as strategy edge. Read the honesty check in Picker lab.
                </Text>
              </View>
            ) : null}

            {summary.earningsSummary?.anyBlocked ? (
              <View style={styles.losingBanner}>
                <Text style={styles.losingBannerText}>{summary.earningsSummary.headline}</Text>
              </View>
            ) : null}

            {summary.earningsSummary &&
            !summary.earningsSummary.anyBlocked &&
            summary.earningsSummary.ok > 0 ? (
              <Text style={styles.riskNote}>{summary.earningsSummary.headline}</Text>
            ) : null}

            {buyingPower && buyingPowerNeedsWarning(buyingPower) && dollarPnL?.scaled ? (
              <View style={styles.losingBanner}>
                <Text style={styles.losingBannerText}>
                  Buying power: peak open notional ≈ ${buyingPower.peakNotional.toFixed(0)} (
                  {(buyingPower.peakNotionalPct * 100).toFixed(0)}% of account
                  {buyingPower.peakPositions
                    ? ` · ${buyingPower.peakPositions} positions`
                    : ''}
                  )
                  {buyingPower.leverageDays
                    ? ` — above account on ${buyingPower.leverageDays}/${buyingPower.activeDays} active days`
                    : ''}
                  {buyingPower.oversizeTrades
                    ? ` · ${buyingPower.oversizeTrades} trade${
                        buyingPower.oversizeTrades === 1 ? '' : 's'
                      } alone exceed the account`
                    : ''}
                  . $ shown is scaled to{' '}
                  {Math.round(dollarPnL.scale * 100)}% of full-risk sizing (≈$
                  {dollarPnL.unconstrainedDollars.toFixed(0)} unconstrained → ≈$
                  {dollarPnL.scaledDollars.toFixed(0)} fundable). R is unchanged. Tighten risk %,
                  raise account, or cut max-open to size at full risk.
                </Text>
              </View>
            ) : null}

            <View style={styles.noteBox}>
              <Text style={styles.noteItem}>
                • Totals omit No data, short history, skipped, suspect-data, and unadjusted
                (RAW / adj?) tickers — portfolio scores adjusted EOD only (see Coverage). Use the
                Per symbol toggle for uncapped vs max-open breakdowns.
              </Text>
              <Text style={styles.noteItem}>
                • Max-open defaults to Production ({cappedView.pickerName}
                {activeParam ? ` · ${activeParam.label}` : ''}). Tap any Picker lab or Parameter lab
                row to compare alternatives — "Best (this window)" is in-sample, not the default.
                Random Active uses one seed; the lab row still shows the seed average.
              </Text>
              {cappedView.capped.skipped > 0 &&
              cappedView.capped.avgPriorityTaken != null &&
              cappedView.capped.avgPrioritySkipped != null ? (
                <Text style={styles.noteItem}>
                  • Active picker score avg · taken {cappedView.capped.avgPriorityTaken.toFixed(2)} vs
                  skipped {cappedView.capped.avgPrioritySkipped.toFixed(2)}.
                </Text>
              ) : null}
              <Text style={styles.noteItem}>
                • Concurrency without the cap: median {summary.concurrency.median} open, peak{' '}
                {summary.concurrency.max}, above your cap on{' '}
                {Math.round(summary.concurrency.overCapPct * 100)}% of active days.
              </Text>
              <Text style={styles.noteItem}>
                • Friction is tiered by trailing ADV (≥$100M → 5+1 bps, ≥$20M → 10+2,
                else 20+5; missing volume → small). Stop gaps fill at the open and
                worsen further into the gap (10–25% of the gap). Stock-loan borrow is n/a
                (long-only). Same ADV tiers as the deep-backtest script.
              </Text>
              <Text style={styles.noteItem}>
                • Earnings blackout matches live Desk (±1 day). Calendars: Finnhub → FMP → Alpha
                Vantage. No key, fetch errors, and empty windows each fail closed; banners and
                per-symbol notes say which. Partial loads still score symbols with a calendar.
              </Text>
              <Text style={styles.noteItem}>
                • Dollars use 1R = ${riskPerTrade.toFixed(0)} (account × risk %), then shrink
                uniformly if peak open notional would exceed the account — so the $ is fundable,
                not leveraged. R totals stay full-risk.
                {buyingPower && !buyingPowerNeedsWarning(buyingPower)
                  ? ` Peak open notional ≈ $${buyingPower.peakNotional.toFixed(0)} (${(
                      buyingPower.peakNotionalPct * 100
                    ).toFixed(0)}% of account).`
                  : ''}
              </Text>
            </View>

            <SectionTitle
              title="Picker lab"
              subtitle={
                activeParam
                  ? `Same trades as the active exit variant (${activeParam.label}), same max-${summary.maxOpen} cap. Active defaults to Production; tap a rule to compare.`
                  : `Same trades, same max-${summary.maxOpen} cap. Active defaults to Production; "Best (this window)" is a comparison only — read the honesty check before promoting it.`
              }
            />
            {(() => {
              const bestSelectableId = bestSelectablePicker(effectivePickers);
              const best = effectivePickers.find((p) => p.id === bestSelectableId) ?? effectivePickers[0];
              const verdict = interpretPickerLab({
                pickers: effectivePickers,
                allSignalsTotalR: effectiveAll.totalR,
                allSignalsTrades: effectiveAll.trades,
              });
              const toneStyles = verdictBannerStyles(verdict.tone);
              return (
                <View style={styles.pickerStack}>
                  <View style={[styles.honestyBox, toneStyles.box]}>
                    <Text style={[styles.honestyHeadline, toneStyles.headline]}>
                      {verdict.headline}
                    </Text>
                    {verdict.bullets.map((b) => (
                      <Text key={b} style={styles.honestyBullet}>
                        • {b}
                      </Text>
                    ))}
                  </View>

                  <View style={styles.pickerBox}>
                    {effectivePickers.map((p) => {
                      const active = p.id === activePicker;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setActivePicker(p.id)}
                          style={[
                            styles.pickerRow,
                            styles.pickerSelectable,
                            active && styles.pickerActive,
                          ]}>
                          <View style={styles.symbolHead}>
                            <Text style={styles.symbolName}>{p.label}</Text>
                            <View style={styles.pillRow}>
                              {active ? <Pill label="Active" tone="good" /> : null}
                              {p.id === best.id && effectivePickers.length > 1 ? (
                                <Pill label="Best (this window)" tone="warn" />
                              ) : null}
                              <Text
                                style={{
                                  fontFamily: 'SpaceMono',
                                  fontSize: 15,
                                  color: p.totalR >= 0 ? palette.leaf : palette.danger,
                                }}>
                                {p.totalR >= 0 ? '+' : ''}
                                {p.totalR.toFixed(1)}R
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.symbolMeta}>
                            {p.trades} taken · {p.skipped} skipped ·{' '}
                            {p.winRate == null ? '—' : `${Math.round(p.winRate * 100)}%`} win
                            {p.randomSpread
                              ? ` · seeds range ${p.randomSpread.minR >= 0 ? '+' : ''}${p.randomSpread.minR.toFixed(1)}R to ${p.randomSpread.maxR >= 0 ? '+' : ''}${p.randomSpread.maxR.toFixed(1)}R`
                              : ''}
                          </Text>
                          <Text style={styles.pickerDesc}>{p.description} Tap to apply.</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })()}

            {summary.paramSweep ? (
              <>
                <SectionTitle
                  title="Parameter lab"
                  subtitle={`Same basket, same max-${summary.maxOpen} cap — only exits changed. Active defaults to Production. Tap another row to drive every stat above with that variant's trades; tap Production to return. "Best (this window)" is in-sample — this never changes production.`}
                />
                <View style={styles.pickerStack}>
                  {summary.paramSweep.knobs.map(({ knob, variants, verdict }) => {
                    const sorted = [...variants].sort((a, b) => b.totalR - a.totalR);
                    const tone = paramVerdictTone(verdict.tone);
                    return (
                      <View key={knob} style={styles.paramCard}>
                        <View style={styles.symbolHead}>
                          <Text style={styles.paramTitle}>{verdict.headline}</Text>
                          <Pill label={paramVerdictLabel(verdict.tone)} tone={tone} />
                        </View>
                        {sorted.map((v) => {
                          const isWinner = verdict.winnerId === v.variant.id && sorted.length > 1;
                          const isActive = v.variant.isProduction
                            ? activeParam == null
                            : activeParam?.id === v.variant.id;
                          return (
                            <View key={v.variant.id}>
                              <Pressable
                                onPress={() =>
                                  setActiveParamId(v.variant.isProduction ? null : v.variant.id)
                                }
                                style={[
                                  styles.pickerRow,
                                  styles.pickerSelectable,
                                  isActive && styles.pickerActive,
                                ]}>
                                <View style={styles.symbolHead}>
                                  <Text style={styles.symbolName}>{v.variant.label}</Text>
                                  <View style={styles.pillRow}>
                                    {isActive ? <Pill label="Active" tone="good" /> : null}
                                    {isWinner ? (
                                      <Pill label="Best (this window)" tone="warn" />
                                    ) : null}
                                    <Text
                                      style={{
                                        fontFamily: 'SpaceMono',
                                        fontSize: 15,
                                        color: v.totalR >= 0 ? palette.leaf : palette.danger,
                                      }}>
                                      {v.totalR >= 0 ? '+' : ''}
                                      {v.totalR.toFixed(1)}R
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.symbolMeta}>
                                  {v.trades} taken
                                  {v.winRate == null
                                    ? ''
                                    : ` · ${Math.round(v.winRate * 100)}% win`}
                                  {v.avgR == null ? '' : ` · ${v.avgR >= 0 ? '+' : ''}${v.avgR.toFixed(2)}R avg`}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                        {verdict.bullets.map((b) => (
                          <Text key={b} style={styles.honestyBullet}>
                            • {b}
                          </Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}

            {summary.warnings.length ? (
              <View style={styles.warnBox}>
                <Text style={styles.warnTitle}>Data / API notes (run-wide)</Text>
                {summary.warnings.slice(0, 12).map((w) => (
                  <Text key={w} style={styles.warnItem}>
                    • {w}
                  </Text>
                ))}
                {summary.warnings.length > 12 ? (
                  <Text style={styles.warnItem}>
                    • …and {summary.warnings.length - 12} more (see per-symbol notes below).
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.coverageBox}>
              <Text style={styles.coverageTitle}>Benchmarks · SPY / QQQ (regime gate)</Text>
              <Text style={styles.coverageOk}>
                Not traded — used only for market regime. Same Full / source pills as names below.
              </Text>
              {summary.benchmarks.map((row) => (
                <View key={row.symbol} style={styles.coverageItem}>
                  <View style={styles.symbolHead}>
                    <Text style={styles.symbolName}>{row.symbol}</Text>
                    <View style={styles.pillRow}>
                      <Pill label={coverageLabel(row.coverage)} tone={coverageTone(row.coverage)} />
                      <Pill
                        label={row.source}
                        tone={row.source === 'demo' || row.source === 'none' ? 'warn' : 'good'}
                      />
                      <Pill label={adjustmentLabel(row.adjusted)} tone={adjustmentTone(row.adjusted)} />
                    </View>
                  </View>
                  <Text style={styles.symbolMeta}>
                    {row.bars} bars
                    {row.coverage === 'ok'
                      ? ' · live EOD OK for regime'
                      : row.coverage === 'short'
                        ? ' · thinner than requested window'
                        : row.coverage === 'none'
                          ? ' · no live EOD — regime unreliable'
                          : ' · not enough bars for regime'}
                  </Text>
                  {row.notes.slice(0, 3).map((n) => (
                    <Text key={n} style={styles.noteLine}>
                      → {n}
                    </Text>
                  ))}
                </View>
              ))}
            </View>

            {(() => {
              const issues = summary.rows.filter((r) => r.coverage !== 'ok');
              const okCount = summary.rows.length - issues.length;
              return (
                <View style={styles.coverageBox}>
                  <Text style={styles.coverageTitle}>
                    Coverage · {okCount}/{summary.rows.length} full live EOD (~{summary.requestedDays}d
                    request)
                  </Text>
                  {issues.length === 0 ? (
                    <Text style={styles.coverageOk}>All tickers used live bars (Yahoo/FMP/etc).</Text>
                  ) : (
                    issues.map((row) => (
                      <View key={`cov-${row.symbol}`} style={styles.coverageItem}>
                        <View style={styles.symbolHead}>
                          <Text style={styles.symbolName}>{row.symbol}</Text>
                          <View style={styles.pillRow}>
                            <Pill label={coverageLabel(row.coverage)} tone={coverageTone(row.coverage)} />
                            <Pill
                              label={row.source}
                              tone={
                                row.source === 'demo' || row.source === 'none' ? 'warn' : 'neutral'
                              }
                            />
                            <Pill
                              label={adjustmentLabel(row.adjusted)}
                              tone={adjustmentTone(row.adjusted)}
                            />
                          </View>
                        </View>
                        <Text style={styles.symbolMeta}>
                          {row.bars} bars
                          {row.coverage === 'none'
                            ? ' · no live EOD (backtest refused)'
                            : row.coverage === 'suspect'
                              ? ' · split-sized gap on non-adjusted bars (excluded)'
                              : row.coverage === 'unadjusted'
                                ? ' · RAW / unverified adjustment (excluded — adjusted EOD only)'
                                : row.coverage === 'short'
                                  ? ' · live source but thinner than requested window'
                                  : ' · not enough history to score'}
                        </Text>
                        {row.notes.slice(0, 4).map((n) => (
                          <Text key={n} style={styles.noteLine}>
                            → {n}
                          </Text>
                        ))}
                      </View>
                    ))
                  )}
                </View>
              );
            })()}

            <SectionTitle
              title="Per symbol"
              subtitle={
                perSymbolMode === 'capped'
                  ? `Only trades that filled a max-${summary.maxOpen} open slot under ${cappedView.pickerName}. Matches the realistic total.`
                  : 'Every signal per ticker with no portfolio capacity limit — same as All signals (usable).'
              }
            />
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setPerSymbolMode('capped')}
                style={[styles.chip, perSymbolMode === 'capped' && styles.chipOn]}>
                <Text style={[styles.chipText, perSymbolMode === 'capped' && styles.chipTextOn]}>
                  Max {summary.maxOpen} open
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPerSymbolMode('all');
                  if (symbolSort === 'skipped_desc') setSymbolSort('totalR_desc');
                }}
                style={[styles.chip, perSymbolMode === 'all' && styles.chipOn]}>
                <Text style={[styles.chipText, perSymbolMode === 'all' && styles.chipTextOn]}>
                  All signals
                </Text>
              </Pressable>
            </View>

            <Text style={styles.filterLabel}>Coverage</Text>
            <View style={styles.chipRow}>
              {(
                [
                  ['all', 'All'],
                  ['ok', 'Full only'],
                  ['issues', 'Issues only'],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setCoverageFilter(id)}
                  style={[styles.chip, coverageFilter === id && styles.chipOn]}>
                  <Text style={[styles.chipText, coverageFilter === id && styles.chipTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.filterLabel}>Result</Text>
            <View style={styles.chipRow}>
              {(
                [
                  ['all', 'All'],
                  ['winners', 'Winners'],
                  ['losers', 'Losers'],
                  ['flat', 'Flat / no trades'],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setResultFilter(id)}
                  style={[styles.chip, resultFilter === id && styles.chipOn]}>
                  <Text style={[styles.chipText, resultFilter === id && styles.chipTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.filterLabel}>Sort</Text>
            <View style={styles.chipRow}>
              {(
                [
                  'totalR_desc',
                  'totalR_asc',
                  'winRate_desc',
                  'trades_desc',
                  ...(perSymbolMode === 'capped' ? (['skipped_desc'] as const) : []),
                  'symbol_asc',
                ] as SymbolSort[]
              ).map((id) => (
                <Pressable
                  key={id}
                  onPress={() => setSymbolSort(id)}
                  style={[styles.chip, symbolSort === id && styles.chipOn]}>
                  <Text style={[styles.chipText, symbolSort === id && styles.chipTextOn]}>
                    {chipLabel(id)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.filterMeta}>
              Showing {perSymbolRows.length} of{' '}
              {(perSymbolMode === 'capped' ? cappedView.cappedRows : effectiveRows).length} tickers
              {coverageFilter !== 'all' || resultFilter !== 'all'
                ? ' (filters applied)'
                : ''}
              .
            </Text>

            {perSymbolRows.length === 0 ? (
              <EmptyState
                title="No tickers match"
                body="Loosen Coverage / Result filters, or switch Max-open ↔ All signals."
              />
            ) : (
              perSymbolRows.map((row) => (
                <View key={`${perSymbolMode}-${row.symbol}`} style={styles.symbolRow}>
                  <View style={styles.symbolHead}>
                    <Text style={styles.symbolName}>{row.symbol}</Text>
                    <View style={styles.pillRow}>
                      <Pill label={coverageLabel(row.coverage)} tone={coverageTone(row.coverage)} />
                      <Pill
                        label={row.source}
                        tone={row.source === 'demo' || row.source === 'none' ? 'warn' : 'good'}
                      />
                      <Pill label={adjustmentLabel(row.adjusted)} tone={adjustmentTone(row.adjusted)} />
                      {row.earningsStatus ? (
                        <Pill
                          label={earningsStatusLabel(row.earningsStatus)}
                          tone={earningsStatusTone(row.earningsStatus)}
                        />
                      ) : null}
                    </View>
                  </View>
                  {row.coverage === 'none' ? (
                    <Text style={styles.symbolMeta}>No data — backtest not run.</Text>
                  ) : row.coverage === 'suspect' ? (
                    <Text style={styles.symbolMeta}>
                      Suspected unadjusted split in the bars — backtest not run (see notes).
                    </Text>
                  ) : row.coverage === 'unadjusted' ? (
                    <Text style={styles.symbolMeta}>
                      Non-adjusted EOD (RAW / adj?) — excluded from portfolio totals (see notes).
                    </Text>
                  ) : row.bars < 60 ? (
                    <Text style={styles.symbolMeta}>
                      Insufficient history ({row.bars} bars) — skipped.
                    </Text>
                  ) : (
                    <Text style={styles.symbolMeta}>
                      {row.bars} bars · {row.trades} trades
                      {perSymbolMode === 'capped' && (row.skipped ?? 0) > 0
                        ? ` · ${row.skipped} capacity-skipped`
                        : ''}{' '}
                      · {row.winRate == null ? '—' : `${Math.round(row.winRate * 100)}%`} win ·{' '}
                      <Text
                        style={{
                          color: row.totalR >= 0 ? palette.leaf : palette.danger,
                          fontWeight: '700',
                        }}>
                        {row.totalR >= 0 ? '+' : ''}
                        {row.totalR.toFixed(1)}R
                      </Text>
                    </Text>
                  )}
                  {row.notes.length && row.coverage !== 'ok' ? (
                    <View style={styles.rowNotes}>
                      {row.notes.slice(0, 3).map((n) => (
                        <Text key={n} style={styles.noteLine}>
                          → {n}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
  },
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  riskNote: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.mist,
  },
  chipOn: {
    backgroundColor: palette.moss,
    borderColor: palette.moss,
  },
  chipBest: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: palette.moss,
    borderColor: palette.moss,
  },
  chipProd: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
  },
  chipChosen: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.moss,
    backgroundColor: palette.mossSoft,
  },
  chipTextProd: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  chipText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextOn: {
    color: '#fff',
  },
  filterLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  filterMeta: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  loading: {
    marginTop: spacing.md,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: { color: palette.muted },
  results: {
    marginTop: spacing.lg,
    gap: 10,
  },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: palette.sand,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.line,
  },
  statPrimary: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  statLabel: { color: palette.muted, fontSize: 12, marginBottom: 4 },
  statValue: { fontFamily: 'SpaceMono', fontSize: 20, color: palette.ink },
  statSub: { color: palette.muted, fontSize: 11, marginTop: 4 },
  warnBox: {
    backgroundColor: palette.warnSoft,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  warnTitle: { fontWeight: '700', color: palette.warn },
  warnItem: { color: palette.ink, lineHeight: 18, fontSize: 13 },
  noteBox: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  noteItem: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  symbolRow: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  symbolHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbolName: { fontWeight: '700', color: palette.ink, fontSize: 15 },
  symbolMeta: { color: palette.muted, fontSize: 13 },
  pillRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  coverageBox: {
    backgroundColor: palette.mist,
    borderRadius: 12,
    padding: spacing.md,
    gap: 10,
    borderWidth: 1,
    borderColor: palette.line,
  },
  coverageTitle: { fontWeight: '700', color: palette.ink },
  coverageOk: { color: palette.muted, fontSize: 13 },
  pickerBox: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    gap: 10,
  },
  pickerStack: { gap: 10 },
  losingBanner: {
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: palette.danger,
    borderRadius: 12,
    padding: spacing.md,
  },
  losingBannerText: {
    color: palette.danger,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  honestyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: 6,
  },
  honestyHeadline: {
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 20,
  },
  honestyBullet: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  pickerRow: { gap: 3 },
  paramCard: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: spacing.md,
    gap: 8,
  },
  paramTitle: { fontWeight: '700', color: palette.ink, fontSize: 14, lineHeight: 20, flex: 1 },
  pickerSelectable: {
    padding: spacing.sm,
    marginHorizontal: -spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickerActive: {
    backgroundColor: palette.mossSoft,
    borderColor: palette.moss,
  },
  pickerDesc: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  coverageItem: { gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: palette.line },
  rowNotes: { gap: 2, marginTop: 4 },
  noteLine: { color: palette.warn, fontSize: 12, lineHeight: 16 },
});
