import { DEFAULT_LIVE_GATES, PlaybookGateFlags } from '@/lib/backtestProfile';
import { CandleSource } from '@/lib/candles';
import {
  applyLiveExitTuning,
  LIVE_ENTRY_ENGINE_LABELS,
  StopCooldownStatus,
} from '@/lib/liveBehavior';
import { describeTuning, isProductionTuning, LevelTuning } from '@/lib/levelTuning';
import {
  deskNewsHardFail,
  matchNegativeCatalysts,
  matchPositiveCatalysts,
} from '@/lib/catalysts';
import { SetupExpectancy } from '@/lib/expectancy';
import { EarningsFetchStatus } from '@/lib/finnhub';
import {
  atr,
  avgVolume,
  closes,
  hasHigherLow,
  hasRejectionWick,
  latestCandle,
  percentFrom,
  relativeStrength,
  sma,
} from '@/lib/indicators';
import { rewardToRisk } from '@/lib/positionSize';
import {
  commonPlaybookBlockers,
  matchPlaybookSetups,
  PlaybookBlocker,
  rankMatchedSetups,
  SetupMatch,
} from '@/lib/setupMatch';
import { levelsForSetup } from '@/lib/setupLevels';
import {
  Candle,
  FundamentalSnapshot,
  LiveEntryEngine,
  NewsItem,
  Quote,
  Setup,
} from '@/types/trading';

export type Stance = 'strong_buy' | 'soft_buy' | 'wait' | 'avoid';

export type RecommendFactor = {
  name: string;
  pillar: 'technical' | 'company' | 'news';
  verdict: 'pass' | 'fail' | 'unknown';
  detail: string;
};

export type RecommendReason = {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  text: string;
};

export type TradeLevels = {
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
};

/** One Playbook setup option with its own get-in / get-out levels. */
export type SetupOption = {
  rank: number;
  setupId: string;
  setupName: string;
  summary: string;
  passRate: number;
  expectancyScore: number;
  levels: TradeLevels;
  rewardToRisk: number | null;
  inEntry: boolean;
  nearEntry: boolean;
  priceVsZone: string;
  entryRules: string[];
  exitRules: string[];
  passedChecks: string[];
  failedChecks: string[];
};

export const MAX_SETUP_OPTIONS = 5;

export type EarningsRisk = {
  date: string;
  daysUntil: number;
  blocked: boolean;
  detail: string;
};

export type Recommendation = {
  symbol: string;
  stance: Stance;
  label: string;
  summary: string;
  confidence: number;
  price: number;
  levels: TradeLevels;
  rewardToRisk: number | null;
  nearEntry: boolean;
  inEntry: boolean;
  technicalScore: number;
  fundamentalScore: number;
  newsScore: number;
  overallScore: number;
  factors: RecommendFactor[];
  reasons: RecommendReason[];
  news: NewsItem[];
  fundamentals: FundamentalSnapshot | null;
  matchedSetups: SetupMatch[];
  /** Shared hard gates that explain why no enabled Playbook setup passed. */
  playbookBlockers: PlaybookBlocker[];
  /** Top matching Playbook setups (up to 5), each with its own levels. */
  setupOptions: SetupOption[];
  bestSetupName: string | null;
  earnings: EarningsRisk | null;
  /** Interesting for research even when not tradeable today. */
  researchInteresting: boolean;
  researchLabel: string;
  /** True only for Soft/Strong buy trade stances. */
  tradeable: boolean;
  levelsSource: 'desk' | 'playbook';
  relativeStrength20d: number | null;
  dollarVolume20d: number | null;
  candleSource: CandleSource;
  quoteSource: Quote['source'];
  warnings: string[];
};

const STANCE_LABEL: Record<Stance, string> = {
  strong_buy: 'Strong buy',
  soft_buy: 'Soft buy',
  wait: 'Wait',
  avoid: 'Avoid',
};

function roundPrice(n: number): number {
  if (n >= 100) return Math.round(n * 100) / 100;
  if (n >= 10) return Math.round(n * 100) / 100;
  return Math.round(n * 1000) / 1000;
}

/** Derive entry / stop / target from recent daily structure (+ ATR buffer). */
export function computeTradeLevels(candles: Candle[]): TradeLevels {
  const last = latestCandle(candles);
  const price = last?.close ?? 100;
  const window = candles.slice(-15);
  const swingLow = window.length ? Math.min(...window.map((c) => c.low)) : price * 0.97;
  const swingHigh = window.length ? Math.max(...window.map((c) => c.high)) : price * 1.03;
  const sma20 = sma(closes(candles), 20) ?? price;
  const atr14 = atr(candles, 14);
  const atrStop = atr14 != null ? price - 1.5 * atr14 : price * 0.97;
  const aboveSma50 = (() => {
    const s50 = sma(closes(candles), 50);
    return s50 != null ? price >= s50 : true;
  })();

  // Breakout-ish: price near recent highs → enter on hold above resistance.
  if (price >= swingHigh * 0.985 && aboveSma50) {
    const entryLow = roundPrice(swingHigh * 0.995);
    const entryHigh = roundPrice(swingHigh * 1.02);
    const stop = roundPrice(Math.min(swingLow, atrStop, entryLow * 0.97));
    const entryMid = (entryLow + entryHigh) / 2;
    const risk = Math.max(entryMid - stop, entryMid * 0.01);
    return {
      entryLow,
      entryHigh,
      stop,
      target: roundPrice(entryMid + 2 * risk),
    };
  }

  // Default trend pullback: buy near 20-day average with stop under swing low / ATR.
  const entryLow = roundPrice(Math.min(sma20 * 0.985, price * 0.99));
  const entryHigh = roundPrice(Math.max(sma20 * 1.015, price * 1.005));
  const stop = roundPrice(Math.min(swingLow * 0.995, atrStop));
  const entryMid = (entryLow + entryHigh) / 2;
  const risk = Math.max(entryMid - stop, entryMid * 0.01);
  return {
    entryLow: Math.min(entryLow, entryHigh),
    entryHigh: Math.max(entryLow, entryHigh),
    stop,
    target: roundPrice(entryMid + 2 * risk),
  };
}

function scoreTechnical(input: {
  price: number;
  candles: Candle[];
  spyCandles: Candle[];
  levels: TradeLevels;
}): { score: number; factors: RecommendFactor[]; nearEntry: boolean; inEntry: boolean } {
  const { price, candles, spyCandles, levels } = input;
  const factors: RecommendFactor[] = [];
  let points = 0;
  let weight = 0;

  const add = (factor: RecommendFactor, passPts: number, failPts = 0, unknownPts = passPts * 0.45) => {
    factors.push(factor);
    weight += passPts;
    if (factor.verdict === 'pass') points += passPts;
    else if (factor.verdict === 'fail') points += failPts;
    else points += unknownPts;
  };

  const closeSeries = closes(candles);
  const sma50 = sma(closeSeries, 50);
  const sma20 = sma(closeSeries, 20);
  const last = latestCandle(candles);
  const avgVol20 = avgVolume(candles, 20);
  const inEntry = price >= levels.entryLow && price <= levels.entryHigh;
  const nearEntry =
    inEntry ||
    (price > levels.entryHigh && price <= levels.entryHigh * 1.03) ||
    (price < levels.entryLow && price >= levels.entryLow * 0.97);

  if (sma50 == null) {
    add(
      { name: 'Above 50-day trend', pillar: 'technical', verdict: 'unknown', detail: 'Need more history' },
      25
    );
  } else {
    add(
      {
        name: 'Above 50-day trend',
        pillar: 'technical',
        verdict: price > sma50 ? 'pass' : 'fail',
        detail: `Price ${price.toFixed(2)} vs SMA50 ${sma50.toFixed(2)}`,
      },
      25
    );
  }

  add(
    {
      name: 'In / near entry zone',
      pillar: 'technical',
      verdict: nearEntry ? 'pass' : 'fail',
      detail: inEntry
        ? `Inside ${levels.entryLow}–${levels.entryHigh}`
        : nearEntry
          ? 'Within 3% of entry zone'
          : `Zone ${levels.entryLow}–${levels.entryHigh}`,
    },
    22
  );

  const hl = hasHigherLow(candles);
  add(
    {
      name: 'Higher-low structure',
      pillar: 'technical',
      verdict: candles.length < 6 ? 'unknown' : hl ? 'pass' : 'fail',
      detail: hl ? 'Recent swing lows are rising' : 'No clear higher low yet',
    },
    14
  );

  const rs = relativeStrength(candles, spyCandles, 20);
  if (rs == null) {
    add(
      { name: 'Relative strength vs SPY', pillar: 'technical', verdict: 'unknown', detail: 'Need SPY history' },
      14
    );
  } else {
    add(
      {
        name: 'Relative strength vs SPY',
        pillar: 'technical',
        verdict: rs >= 0 ? 'pass' : 'fail',
        detail: `20d RS ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}%`,
      },
      14
    );
  }

  const lastVol = last?.volume ?? null;
  if (lastVol == null || avgVol20 == null) {
    add(
      { name: 'Volume confirmation', pillar: 'technical', verdict: 'unknown', detail: 'Need volume history' },
      10
    );
  } else {
    const drying = lastVol <= avgVol20 * 0.9;
    const expanding = lastVol >= avgVol20 * 1.2;
    const ok = drying || expanding;
    add(
      {
        name: 'Volume confirmation',
        pillar: 'technical',
        verdict: ok ? 'pass' : 'fail',
        detail: drying ? 'Pullback volume cooling' : expanding ? 'Breakout volume expanding' : 'Volume mixed',
      },
      10
    );
  }

  const wick = hasRejectionWick(last);
  add(
    {
      name: 'Rejection / support wick',
      pillar: 'technical',
      verdict: last ? (wick ? 'pass' : 'fail') : 'unknown',
      detail: wick ? 'Buyers defended the lows on the last bar' : 'No clear rejection wick',
    },
    8,
    3
  );

  if (sma20 != null) {
    const dist = percentFrom(price, sma20);
    const chasing = dist > 6;
    add(
      {
        name: 'Not chasing extension',
        pillar: 'technical',
        verdict: chasing ? 'fail' : 'pass',
        detail: `${dist >= 0 ? '+' : ''}${dist.toFixed(1)}% vs 20-day average`,
      },
      7
    );
  }

  const score = weight > 0 ? Math.round((points / weight) * 100) : 50;
  return { score, factors, nearEntry, inEntry };
}

function scoreFundamentals(fundamentals: FundamentalSnapshot | null): {
  score: number;
  factors: RecommendFactor[];
} {
  const factors: RecommendFactor[] = [];
  if (!fundamentals) {
    // Pass-neutral vs Strong gate (Company ≥ 55) so a missing FMP key does not
    // silently cap Soft/Strong-eligible charts at Soft forever.
    return {
      score: 55,
      factors: [
        {
          name: 'Company data',
          pillar: 'company',
          verdict: 'unknown',
          detail: 'No fundamentals available (neutral — add FMP key for company score)',
        },
      ],
    };
  }

  let points = 0;
  let weight = 0;
  const add = (
    name: string,
    verdict: RecommendFactor['verdict'],
    detail: string,
    passPts: number,
    failPts = 0,
    unknownPts = passPts * 0.5
  ) => {
    factors.push({ name, pillar: 'company', verdict, detail });
    weight += passPts;
    if (verdict === 'pass') points += passPts;
    else if (verdict === 'fail') points += failPts;
    else points += unknownPts;
  };

  if (fundamentals.pe == null) {
    add('Valuation (P/E)', 'unknown', 'P/E unavailable', 20);
  } else if (fundamentals.pe > 0 && fundamentals.pe <= 40) {
    add('Valuation (P/E)', 'pass', `P/E ${fundamentals.pe.toFixed(1)}`, 20);
  } else if (fundamentals.pe > 40 && fundamentals.pe <= 70) {
    add('Valuation (P/E)', 'unknown', `Rich P/E ${fundamentals.pe.toFixed(1)}`, 20, 8, 12);
  } else {
    add('Valuation (P/E)', 'fail', `P/E ${fundamentals.pe.toFixed(1)} looks stretched or distorted`, 20);
  }

  if (fundamentals.profitMargin == null) {
    add('Profit margin', 'unknown', 'Margin unavailable', 20);
  } else {
    // Unit fraction from provider (0.24 = 24%) — normalized at FMP ingest.
    const pct = fundamentals.profitMargin * 100;
    add(
      'Profit margin',
      pct >= 10 ? 'pass' : pct >= 3 ? 'unknown' : 'fail',
      `Net margin ~${pct.toFixed(1)}%`,
      20,
      4,
      10
    );
  }

  if (fundamentals.roe == null) {
    add('Return on equity', 'unknown', 'ROE unavailable', 20);
  } else {
    const roePct = fundamentals.roe * 100;
    add(
      'Return on equity',
      roePct >= 12 ? 'pass' : roePct >= 5 ? 'unknown' : 'fail',
      `ROE ${roePct.toFixed(1)}%`,
      20,
      4,
      10
    );
  }

  if (fundamentals.revenueGrowth == null) {
    add('Revenue growth', 'unknown', 'Growth unavailable', 20);
  } else {
    const g = fundamentals.revenueGrowth * 100;
    add(
      'Revenue growth',
      g >= 5 ? 'pass' : g >= 0 ? 'unknown' : 'fail',
      `Revenue growth ~${g.toFixed(1)}%`,
      20,
      3,
      10
    );
  }

  if (fundamentals.debtToEquity == null) {
    add('Balance sheet leverage', 'unknown', 'Debt/equity unavailable', 20);
  } else {
    add(
      'Balance sheet leverage',
      fundamentals.debtToEquity <= 1.5 ? 'pass' : fundamentals.debtToEquity <= 2.5 ? 'unknown' : 'fail',
      `Debt/equity ${fundamentals.debtToEquity.toFixed(2)}`,
      20,
      4,
      10
    );
  }

  return { score: weight > 0 ? Math.round((points / weight) * 100) : 50, factors };
}

function scoreNews(news: NewsItem[]): { score: number; factors: RecommendFactor[]; hardFail: boolean } {
  if (!news.length) {
    return {
      score: 55,
      hardFail: false,
      factors: [
        {
          name: 'Catalyst screen',
          pillar: 'news',
          verdict: 'unknown',
          detail: 'No recent headlines to screen',
        },
      ],
    };
  }

  const negatives = matchNegativeCatalysts(news);
  const positives = matchPositiveCatalysts(news);
  const hardFail = deskNewsHardFail(negatives);

  if (hardFail) {
    const lead = negatives.find((n) => n.severity === 'hard') ?? negatives[0];
    const softCount = negatives.filter((n) => n.severity === 'soft').length;
    const detail =
      lead.severity === 'hard'
        ? `Red flag: ${lead.headline}`
        : `${softCount} caution headlines (e.g. ${lead.headline})`;
    return {
      score: 18,
      hardFail: true,
      factors: [
        {
          name: 'Catalyst screen',
          pillar: 'news',
          verdict: 'fail',
          detail,
        },
      ],
    };
  }

  if (negatives.length) {
    // Lone soft caution — score down, surface the headline, do not force Avoid.
    return {
      score: 42,
      hardFail: false,
      factors: [
        {
          name: 'Catalyst screen',
          pillar: 'news',
          verdict: 'fail',
          detail: `Caution (not hard-fail): ${negatives[0].headline}`,
        },
      ],
    };
  }

  if (positives.length) {
    return {
      score: 88,
      hardFail: false,
      factors: [
        {
          name: 'Catalyst screen',
          pillar: 'news',
          verdict: 'pass',
          detail: positives[0],
        },
      ],
    };
  }

  return {
    score: 78,
    hardFail: false,
    factors: [
      {
        name: 'Catalyst screen',
        pillar: 'news',
        verdict: 'pass',
        detail: 'No red-flag headlines in the recent lookback',
      },
    ],
  };
}

function assessLiquidity(candles: Candle[], price: number): {
  dollarVolume: number | null;
  ok: boolean;
  thin: boolean;
  detail: string;
} {
  const vol = avgVolume(candles, 20);
  if (vol == null || price <= 0) {
    return { dollarVolume: null, ok: true, thin: false, detail: 'Volume history unavailable' };
  }
  const dollarVolume = vol * price;
  const thin = dollarVolume < 5_000_000;
  const ok = dollarVolume >= 20_000_000;
  return {
    dollarVolume,
    ok,
    thin,
    detail: `~$${(dollarVolume / 1_000_000).toFixed(1)}M avg daily dollar volume`,
  };
}

function assessMarketRelative(candles: Candle[], spyCandles: Candle[]): {
  rs: number | null;
  ok: boolean;
  weak: boolean;
  detail: string;
} {
  const rs = relativeStrength(candles, spyCandles, 20);
  if (rs == null) {
    return { rs: null, ok: true, weak: false, detail: 'Need SPY history for relative strength' };
  }
  return {
    rs,
    ok: rs >= -2,
    weak: rs < -5,
    detail: `20d RS vs SPY ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}%`,
  };
}

/** Widest stop allowed, as ATR multiple and as % of entry (whichever is tighter). */
const MAX_RISK_ATR_MULT = 2.5;
const MAX_RISK_PCT = 0.08;

/**
 * Keep stop/target anchored to current price action. After a violent gap-up the
 * 12-bar swing low can sit 20%+ below price; without this cap that stale low
 * becomes the stop and the 2R target lands at fantasy prices (MSFT gap: stop
 * $377 / target $742 on a $487 stock). Risk is capped at min(2.5×ATR, 8% of
 * entry), and the target is rebuilt from the capped risk when the raw target
 * runs past 2.5R. When the buy zone itself is wider than the risk budget
 * (mean-reversion zones span sma20*0.96 up to price), the zone is narrowed
 * from the bottom so the capped stop still clears it — never the other way
 * around (a stop pushed below a too-wide zone used to plan 10%+ risk).
 */
export function clampLevelsRisk(raw: TradeLevels, atr14: number | null): TradeLevels {
  let entryLow = Math.min(raw.entryLow, raw.entryHigh);
  const entryHigh = Math.max(raw.entryLow, raw.entryHigh);
  let entryMid = (entryLow + entryHigh) / 2;
  const atrCap =
    atr14 != null && atr14 > 0 ? MAX_RISK_ATR_MULT * atr14 : Number.POSITIVE_INFINITY;
  const maxRisk = Math.min(atrCap, entryMid * MAX_RISK_PCT);
  let stop = Math.max(raw.stop, entryMid - maxRisk);
  if (!(stop < entryLow)) {
    // Zone too wide for the cap (or raw stop inside the zone). Raise the zone
    // floor to entryHigh - 1.9*maxRisk: from there the capped stop measured
    // off the new mid always lands below the zone. maxRisk stays anchored to
    // the original mid, which is the conservative (tighter) choice.
    entryLow = Math.max(entryLow, entryHigh - 1.9 * maxRisk);
    entryMid = (entryLow + entryHigh) / 2;
    stop = entryMid - maxRisk;
    // Prefer a tighter structural stop when it still clears the zone.
    if (raw.stop > stop && raw.stop < entryLow) {
      stop = raw.stop;
    }
  }
  const risk = Math.max(entryMid - stop, entryMid * 0.01);
  let target = raw.target;
  if (!(target > entryHigh) || target > entryMid + 2.5 * risk) {
    target = entryMid + 2 * risk;
  }
  if (!(target > entryHigh)) {
    target = entryHigh + risk;
  }
  return {
    entryLow: roundPrice(entryLow),
    entryHigh: roundPrice(entryHigh),
    stop: roundPrice(stop),
    target: roundPrice(target),
  };
}

function mergeLevelsWithSetup(
  deskLevels: TradeLevels,
  setup: Setup | undefined,
  candles: Candle[]
): { levels: TradeLevels; source: 'desk' | 'playbook' } {
  if (!setup || candles.length < 20) return { levels: deskLevels, source: 'desk' };
  const setupLevels = levelsForSetup(setup, candles);
  const atr14 = atr(candles, 14);
  const price = latestCandle(candles)?.close ?? setupLevels.entryHigh;
  const atrFloor = atr14 != null ? price - 1.8 * atr14 : setupLevels.stop;
  const stop = Math.min(setupLevels.stop, deskLevels.stop, atrFloor);
  const entryLow = Math.min(setupLevels.entryLow, deskLevels.entryLow);
  const entryHigh = Math.max(setupLevels.entryHigh, deskLevels.entryHigh);
  const target = Math.max(setupLevels.target, deskLevels.target);
  return {
    source: 'playbook',
    levels: clampLevelsRisk({ entryLow, entryHigh, stop, target }, atr14),
  };
}

function zoneForLevels(
  price: number,
  levels: TradeLevels
): { inEntry: boolean; nearEntry: boolean; priceVsZone: string } {
  const inEntry = price >= levels.entryLow && price <= levels.entryHigh;
  const nearEntry =
    inEntry ||
    (price > levels.entryHigh && price <= levels.entryHigh * 1.03) ||
    (price < levels.entryLow && price >= levels.entryLow * 0.97);
  const priceVsZone = inEntry
    ? 'In entry zone'
    : nearEntry
      ? 'Near entry zone'
      : price > levels.entryHigh
        ? 'Above entry zone'
        : 'Waiting for entry zone';
  return { inEntry, nearEntry, priceVsZone };
}

/** Per-option levels from that setup only (not blended with Desk structure). */
function levelsForSetupOption(
  setup: Setup,
  candles: Candle[],
  exitTuning?: LevelTuning
): TradeLevels {
  const raw = levelsForSetup(setup, candles);
  const atr14 = atr(candles, 14);
  const price = latestCandle(candles)?.close ?? raw.entryHigh;
  const atrFloor = atr14 != null ? price - 1.8 * atr14 : raw.stop;
  const stop = Math.min(raw.stop, atrFloor);
  const clamped = clampLevelsRisk(
    { entryLow: raw.entryLow, entryHigh: raw.entryHigh, stop, target: raw.target },
    atr14
  );
  return applyLiveExitTuning(clamped, atr14, exitTuning);
}

function buildSetupOptions(input: {
  matches: SetupMatch[];
  setups: Setup[];
  candles: Candle[];
  price: number;
  exitTuning?: LevelTuning;
}): SetupOption[] {
  return input.matches.slice(0, MAX_SETUP_OPTIONS).map((match, index) => {
    const setup = input.setups.find((s) => s.id === match.setupId);
    const levels = setup
      ? levelsForSetupOption(setup, input.candles, input.exitTuning)
      : {
          entryLow: 0,
          entryHigh: 0,
          stop: 0,
          target: 0,
        };
    const zone = zoneForLevels(input.price, levels);
    const entryMid = (levels.entryLow + levels.entryHigh) / 2;
    return {
      rank: index + 1,
      setupId: match.setupId,
      setupName: match.setupName,
      summary: setup?.summary ?? '',
      passRate: match.passRate,
      expectancyScore: match.expectancyScore,
      levels,
      rewardToRisk: rewardToRisk(entryMid, levels.stop, levels.target),
      inEntry: zone.inEntry,
      nearEntry: zone.nearEntry,
      priceVsZone: zone.priceVsZone,
      entryRules: setup?.entryRules ?? [],
      exitRules: setup?.exitRules ?? [],
      passedChecks: match.passedChecks ?? [],
      failedChecks: match.failedChecks ?? [],
    };
  });
}

function pickStance(input: {
  overall: number;
  technical: number;
  fundamental: number;
  news: number;
  newsHardFail: boolean;
  nearEntry: boolean;
  inEntry: boolean;
  price: number;
  stop: number;
  playbookMatched: boolean;
  bestExpectancy: number;
  earningsBlocked: boolean;
  liquidityThin: boolean;
  liquidityOk: boolean;
  marketWeak: boolean;
  marketOk: boolean;
  engine: LiveEntryEngine;
  cooldownBlocked: boolean;
}): Stance {
  const deskGated = input.engine !== 'playbook';
  if (input.newsHardFail || input.price <= input.stop) return 'avoid';
  if (deskGated && input.technical < 35) return 'avoid';
  if (input.liquidityThin) return 'avoid';
  if (deskGated && input.marketWeak) return 'avoid';
  if (input.cooldownBlocked) return 'wait';
  if (input.earningsBlocked) return 'wait';
  // Desk is a confirmation layer: no buy stance without a Playbook match.
  if (!input.playbookMatched) return 'wait';
  // Playbook engine: rules alone decide — Desk scores/zone shown but not gating.
  // (Red-flag news, thin liquidity, cooldown, and stop risk still block above.)
  if (input.engine === 'playbook') {
    return input.inEntry ? 'strong_buy' : 'soft_buy';
  }
  if (!input.liquidityOk || !input.marketOk) return 'wait';

  const strong =
    input.overall >= 72 &&
    input.technical >= 65 &&
    input.news >= 60 &&
    input.fundamental >= 55 &&
    (input.inEntry || input.nearEntry) &&
    input.bestExpectancy >= -0.05 &&
    input.liquidityOk &&
    input.marketOk;

  if (strong) return 'strong_buy';
  if (input.overall >= 55 && input.technical >= 45 && (input.inEntry || input.nearEntry)) {
    return 'soft_buy';
  }
  return 'wait';
}

function buildSummary(input: {
  stance: Stance;
  symbol: string;
  nearEntry: boolean;
  inEntry: boolean;
  bestSetupName: string | null;
  earningsBlocked: boolean;
  researchInteresting: boolean;
  tradeable: boolean;
  marketWeak: boolean;
  liquidityThin: boolean;
  newsHardFail: boolean;
  weakTrend: boolean;
  stopRisk: boolean;
  newsDetail?: string | null;
  cooldownDetail?: string | null;
}): string {
  if (input.liquidityThin) {
    return `${input.symbol} looks too thin on liquidity — Desk avoids it for tradeable signals.`;
  }
  if (input.marketWeak) {
    return `${input.symbol} is lagging the market hard — Desk avoids buy labels until relative strength improves.`;
  }
  if (input.cooldownDetail) {
    return `${input.symbol} is in post-stop cooldown — Live behavior holds re-entry. ${input.cooldownDetail}.`;
  }
  if (input.earningsBlocked) {
    return `${input.symbol} is too close to earnings — Desk waits even if the chart looks okay.`;
  }
  if (input.tradeable) {
    if (input.stance === 'strong_buy') {
      return `${input.symbol} is tradeable: Playbook${input.bestSetupName ? ` (${input.bestSetupName})` : ''} confirms with clean technicals${
        input.inEntry ? ' and price in the entry zone' : input.nearEntry ? ' and price near the entry zone' : ''
      }.`;
    }
    return `${input.symbol} is a patient Soft buy — Playbook${input.bestSetupName ? ` (${input.bestSetupName})` : ''} matches and price is cooperating with the zone.`;
  }
  if (input.researchInteresting) {
    return `${input.symbol} is interesting for research, but not tradeable yet${
      input.bestSetupName ? ` (${input.bestSetupName} needs a cleaner trigger/zone)` : ' (no Playbook confirmation)'
    }.`;
  }
  if (input.stance === 'avoid') {
    const failed: string[] = [];
    if (input.newsHardFail) {
      failed.push(
        input.newsDetail?.trim()
          ? `news (${input.newsDetail.trim()})`
          : 'news (negative catalyst)'
      );
    }
    if (input.weakTrend) failed.push('weak trend (technical score under 35)');
    if (input.stopRisk) failed.push('stop risk (price at/under stop)');
    if (input.liquidityThin) failed.push('thin liquidity');
    if (input.marketWeak) failed.push('weak market relative strength');
    if (failed.length) {
      return `${input.symbol} fails a hard filter: ${failed.join('; ')}. Stand aside.`;
    }
    return `${input.symbol} fails a hard filter right now. Stand aside.`;
  }
  return `${input.symbol} is not clean enough yet. Keep it on watch.`;
}

/** Empty levels when live history is missing. */
const EMPTY_LEVELS: TradeLevels = {
  entryLow: 0,
  entryHigh: 0,
  stop: 0,
  target: 0,
};

/** Explicit No data Desk result — never invent Soft/Strong from missing/synthetic history. */
export function buildNoDataRecommendation(
  symbol: string,
  warnings: string[] = [],
  quote: Quote | null = null
): Recommendation {
  const upper = symbol.toUpperCase().trim();
  const price = quote?.price ?? 0;
  const note =
    warnings.find((w) => /No data/i.test(w)) ??
    'No data — live daily history unavailable. Check API keys / Yahoo proxy in Settings.';
  return {
    symbol: upper,
    stance: 'wait',
    label: 'No data',
    summary: `${upper}: No data. Desk will not score Soft/Strong without live EOD bars.`,
    confidence: 0,
    price,
    levels: EMPTY_LEVELS,
    rewardToRisk: null,
    nearEntry: false,
    inEntry: false,
    technicalScore: 0,
    fundamentalScore: 0,
    newsScore: 0,
    overallScore: 0,
    factors: [
      {
        name: 'Live EOD history',
        pillar: 'technical',
        verdict: 'fail',
        detail: note,
      },
    ],
    reasons: [{ tone: 'bad', text: note }],
    news: [],
    fundamentals: null,
    matchedSetups: [],
    playbookBlockers: [],
    setupOptions: [],
    bestSetupName: null,
    earnings: null,
    researchInteresting: false,
    researchLabel: 'No data',
    tradeable: false,
    levelsSource: 'desk',
    relativeStrength20d: null,
    dollarVolume20d: null,
    candleSource: 'none',
    quoteSource: quote?.source ?? 'none',
    warnings: warnings.length ? warnings : [note],
  };
}

export function buildRecommendation(input: {
  symbol: string;
  quote: Quote | null;
  candles: Candle[];
  spyCandles: Candle[];
  qqqCandles?: Candle[];
  /** Sector ETF history for the sector RS gate (soft-unknown when absent). */
  sectorCandles?: Candle[];
  news?: NewsItem[];
  fundamentals?: FundamentalSnapshot | null;
  candleSource?: CandleSource;
  warnings?: string[];
  setups?: Setup[];
  expectancy?: Record<string, SetupExpectancy>;
  earnings?: EarningsRisk | null;
  /** Full YYYY-MM-DD earnings calendar for Playbook ±1 day blackout. */
  earningsDates?: string[];
  /** Why the calendar is missing/present (verified-empty `ok` vs fail-closed). */
  earningsCalendarStatus?: EarningsFetchStatus;
  /** Override the Playbook accuracy gate stack (defaults to live gates). */
  gates?: PlaybookGateFlags;
  /**
   * Historical replay mode: company/news are treated as neutral placeholders
   * (not point-in-time), so stance is driven mainly by technicals + Playbook match.
   */
  historicalMode?: boolean;
  /** Live entry engine (mirrors the Portfolio backtest engines). Default = production Desk gate. */
  entryEngine?: LiveEntryEngine;
  /** Exits-only stop/target overrides from Live behavior settings. */
  exitTuning?: LevelTuning;
  /** Post-stop cooldown for this symbol — forces Wait while active. */
  stopCooldown?: StopCooldownStatus | null;
}): Recommendation {
  const symbol = input.symbol.toUpperCase().trim();
  const candleSource = input.candleSource ?? 'none';
  // Refuse demo / empty history — no inventing levels or Soft/Strong from filler data.
  if (!input.candles.length || candleSource === 'none' || candleSource === 'demo') {
    return buildNoDataRecommendation(symbol, input.warnings ?? [], input.quote ?? null);
  }
  const candles = input.candles;
  const candleLast = latestCandle(candles)?.close ?? 0;
  const quote = input.quote;
  // Demo Finnhub fallback can disagree wildly with live EOD (IOVA $273 vs ~$4).
  const quoteUnreliable =
    quote?.source === 'demo' &&
    candleLast > 0 &&
    input.candleSource &&
    input.candleSource !== 'demo' &&
    Math.abs(quote.price - candleLast) / candleLast > 0.15;
  const price = quoteUnreliable
    ? candleLast
    : quote?.price ?? candleLast ?? 0;
  const effectiveQuote: Quote | null =
    quoteUnreliable && quote && input.candleSource
      ? {
          ...quote,
          price,
          change: 0,
          percentChange: 0,
          high: price,
          low: price,
          open: price,
          previousClose: price,
          source: input.candleSource as Quote['source'],
        }
      : quote;
  const deskLevels = computeTradeLevels(candles);
  const historical = Boolean(input.historicalMode);
  const setups = input.setups ?? [];
  const allMatches =
    setups.length && candles.length
      ? matchPlaybookSetups({
          symbol,
          setups,
          quote: effectiveQuote,
          candles,
          spyCandles: input.spyCandles,
          qqqCandles: input.qqqCandles,
          sectorCandles: input.sectorCandles,
          news: historical ? [] : input.news ?? [],
          earningsDates:
            input.earningsDates ??
            (input.earnings?.date ? [input.earnings.date] : undefined),
          earningsCalendarStatus:
            input.earningsCalendarStatus ??
            (input.earningsDates != null
              ? input.earningsDates.length
                ? 'ok'
                : 'empty'
              : input.earnings?.date
                ? 'ok'
                : undefined),
          historicalMode: historical,
          expectancy: input.expectancy,
          gates: input.gates,
        })
      : [];
  // Top Playbook matches per ticker (up to 5), ranked by edge then pass rate.
  const matchedSetups = rankMatchedSetups(allMatches).slice(0, MAX_SETUP_OPTIONS);
  const playbookBlockers =
    matchedSetups.length === 0 && allMatches.length ? commonPlaybookBlockers(allMatches) : [];
  const engine: LiveEntryEngine = input.entryEngine ?? 'playbook_desk';
  const exitTuning = input.exitTuning;
  const atr14 = atr(candles, 14);
  const setupOptions = buildSetupOptions({
    matches: matchedSetups,
    setups,
    candles,
    price,
    exitTuning,
  });
  const best = matchedSetups[0] ?? null;
  const bestSetup = best ? setups.find((s) => s.id === best.setupId) : undefined;
  const merged = mergeLevelsWithSetup(deskLevels, bestSetup, candles);
  const mergedTuned = applyLiveExitTuning(merged.levels, atr14, exitTuning);
  // Primary levels: prefer #1 option's own levels; fall back to Desk blend.
  // Desk engine anchors to the Desk blend instead (Desk card levels).
  const levels =
    engine === 'desk' ? mergedTuned : setupOptions[0]?.levels ?? mergedTuned;

  const technical = scoreTechnical({
    price,
    candles,
    spyCandles: input.spyCandles,
    levels,
  });
  const fundamental = historical
    ? {
        score: 60,
        factors: [
          {
            name: 'Company data',
            pillar: 'company' as const,
            verdict: 'unknown' as const,
            detail: 'Neutral placeholder — fundamentals are not point-in-time historically',
          },
        ],
      }
    : scoreFundamentals(input.fundamentals ?? null);
  const news = historical
    ? {
        score: 70,
        hardFail: false,
        factors: [
          {
            name: 'Catalyst screen',
            pillar: 'news' as const,
            verdict: 'unknown' as const,
            detail: 'News archive skipped in historical Desk backtest',
          },
        ],
      }
    : scoreNews(input.news ?? []);

  const playbookMatched = matchedSetups.length > 0;
  const earnings = input.earnings ?? null;
  // The stance-level earnings block honors the same gate flag the Playbook
  // rule stack uses — turning the gate off in Live behavior disables both.
  const earningsGateOn = (input.gates ?? DEFAULT_LIVE_GATES).earningsBlackout;
  const earningsBlocked = earningsGateOn && Boolean(earnings?.blocked);
  const cooldown = input.stopCooldown ?? null;
  const liquidity = assessLiquidity(candles, price);
  const market = assessMarketRelative(candles, input.spyCandles);

  const playbookBoost = playbookMatched ? Math.min(12, 6 + matchedSetups.length * 2) : 0;
  const expectancyBoost = best ? Math.max(-8, Math.min(10, best.expectancyScore * 10)) : 0;
  const baseOverall = historical
    ? technical.score * 0.75 + fundamental.score * 0.15 + news.score * 0.1
    : technical.score * 0.5 + fundamental.score * 0.3 + news.score * 0.2;
  const overallScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        baseOverall +
          playbookBoost +
          expectancyBoost -
          (earningsBlocked ? 20 : 0) -
          (market.weak ? 15 : market.ok ? 0 : 8) -
          (liquidity.thin ? 20 : liquidity.ok ? 0 : 8)
      )
    )
  );

  const stance = pickStance({
    overall: overallScore,
    technical: technical.score,
    fundamental: fundamental.score,
    news: news.score,
    newsHardFail: news.hardFail,
    nearEntry: technical.nearEntry,
    inEntry: technical.inEntry,
    price,
    stop: levels.stop,
    playbookMatched,
    bestExpectancy: best?.expectancyScore ?? 0,
    earningsBlocked,
    liquidityThin: liquidity.thin,
    liquidityOk: liquidity.ok,
    marketWeak: market.weak,
    marketOk: market.ok,
    engine,
    cooldownBlocked: Boolean(cooldown),
  });

  const tradeable = stance === 'soft_buy' || stance === 'strong_buy';
  const researchInteresting =
    !liquidity.thin &&
    !market.weak &&
    !news.hardFail &&
    (playbookMatched ||
      technical.score >= 55 ||
      fundamental.score >= 70 ||
      (technical.score >= 45 && fundamental.score >= 55));

  const factors = [...technical.factors, ...fundamental.factors, ...news.factors];
  if (playbookMatched && best) {
    factors.unshift({
      name: 'Playbook confirmation',
      pillar: 'technical',
      verdict: 'pass',
      detail: `${matchedSetups.length} setup(s) matched — top: ${best.setupName} (score ${best.expectancyScore.toFixed(2)})`,
    });
  } else if (setups.length) {
    factors.unshift({
      name: 'Playbook confirmation',
      pillar: 'technical',
      verdict: 'fail',
      detail: 'No playbook setup currently passes',
    });
  }
  factors.push({
    name: 'Liquidity',
    pillar: 'technical',
    verdict: liquidity.thin ? 'fail' : liquidity.ok ? 'pass' : 'unknown',
    detail: liquidity.detail,
  });
  factors.push({
    name: 'Market relative strength',
    pillar: 'technical',
    verdict: market.weak ? 'fail' : market.ok ? 'pass' : 'unknown',
    detail: market.detail,
  });
  if (earnings) {
    factors.push({
      name: 'Earnings window',
      pillar: 'news',
      verdict: earnings.blocked ? (earningsGateOn ? 'fail' : 'unknown') : 'pass',
      detail:
        earnings.blocked && !earningsGateOn
          ? `${earnings.detail} (blackout gate off in Live behavior — not blocking)`
          : earnings.detail,
    });
  }
  if (cooldown) {
    factors.push({
      name: 'Stop cooldown',
      pillar: 'technical',
      verdict: 'fail',
      detail: cooldown.detail,
    });
  }
  if (!isProductionTuning(exitTuning)) {
    factors.push({
      name: 'Exit tuning',
      pillar: 'technical',
      verdict: 'pass',
      detail: `${describeTuning(exitTuning)} (from Live behavior settings)`,
    });
  }
  if (engine !== 'playbook_desk') {
    factors.push({
      name: 'Entry engine',
      pillar: 'technical',
      verdict: 'pass',
      detail:
        engine === 'playbook'
          ? `${LIVE_ENTRY_ENGINE_LABELS.playbook} — Playbook rules alone decide Soft/Strong; Desk scores shown for context.`
          : `${LIVE_ENTRY_ENGINE_LABELS.desk} — levels anchored to the Desk blend.`,
    });
  }
  if (merged.source === 'playbook' && best) {
    factors.push({
      name: 'Level source',
      pillar: 'technical',
      verdict: 'pass',
      detail: `Entry/stop/target anchored to ${best.setupName} + ATR`,
    });
  }

  const reasons: RecommendReason[] = [];
  for (const f of factors) {
    if (f.verdict === 'pass') reasons.push({ tone: 'good', text: `${f.name}: ${f.detail}` });
    else if (f.verdict === 'fail') reasons.push({ tone: 'bad', text: `${f.name}: ${f.detail}` });
  }
  if (researchInteresting && !tradeable) {
    reasons.unshift({
      tone: 'warn',
      text: 'Marked interesting for research, but not tradeable yet.',
    });
  }
  if (technical.inEntry) {
    reasons.unshift({
      tone: 'good',
      text: `Price is inside the suggested entry zone (${levels.entryLow}–${levels.entryHigh}).`,
    });
  } else if (technical.nearEntry) {
    reasons.unshift({
      tone: 'warn',
      text: `Price is near the entry zone (${levels.entryLow}–${levels.entryHigh}) — wait for a touch or reclaim.`,
    });
  } else {
    reasons.unshift({
      tone: 'neutral',
      text: `Suggested entry zone is ${levels.entryLow}–${levels.entryHigh}; current price is ${price.toFixed(2)}.`,
    });
  }

  const entryMid = (levels.entryLow + levels.entryHigh) / 2;
  const rr = rewardToRisk(entryMid, levels.stop, levels.target);
  // Live EOD is guaranteed here (demo/none already returned buildNoDataRecommendation).
  const confidence = Math.max(
    20,
    Math.min(
      94,
      Math.round(
        overallScore * 0.8 +
          4 +
          (technical.nearEntry ? 4 : 0) +
          (playbookMatched ? 8 : -10) +
          (earningsBlocked ? -12 : 0) +
          (tradeable ? 4 : -4) +
          (best && best.expectancyScore > 0 ? 4 : 0)
      )
    )
  );

  const warnings = [...(input.warnings ?? [])];
  if (quoteUnreliable) {
    warnings.push(
      `${symbol}: unreliable quote ignored — using last ${candleSource} close $${candleLast.toFixed(2)}.`
    );
  }
  if (historical) {
    warnings.push(
      'Historical Desk mode: company/news neutralized; buys still require Playbook confirmation.'
    );
  }
  if (!playbookMatched && setups.length) {
    warnings.push('No Playbook setup matched — Desk will not issue Soft/Strong buy.');
  }
  if (researchInteresting && !tradeable) {
    warnings.push('Research-interesting only — not a tradeable Soft/Strong buy.');
  }
  if (cooldown) {
    warnings.push(`${symbol}: post-stop cooldown active — ${cooldown.detail}.`);
  }
  if (engine === 'playbook' && tradeable) {
    warnings.push(
      'Playbook engine: Desk scores/zone shown for context but do not gate this signal.'
    );
  }

  return {
    symbol,
    stance,
    label: STANCE_LABEL[stance],
    summary: buildSummary({
      stance,
      symbol,
      nearEntry: technical.nearEntry,
      inEntry: technical.inEntry,
      bestSetupName: best?.setupName ?? null,
      earningsBlocked,
      researchInteresting,
      tradeable,
      marketWeak: market.weak,
      liquidityThin: liquidity.thin,
      newsHardFail: news.hardFail,
      weakTrend: technical.score < 35,
      stopRisk: price > 0 && levels.stop > 0 && price <= levels.stop,
      newsDetail:
        news.factors.find((f) => f.verdict === 'fail')?.detail ??
        news.factors.find((f) => /catalyst|news/i.test(f.name))?.detail ??
        null,
      cooldownDetail: cooldown?.detail ?? null,
    }),
    confidence,
    price,
    levels,
    rewardToRisk: rr,
    nearEntry: technical.nearEntry,
    inEntry: technical.inEntry,
    technicalScore: technical.score,
    fundamentalScore: fundamental.score,
    newsScore: news.score,
    overallScore,
    factors,
    reasons: reasons.slice(0, 12),
    news: historical ? [] : (input.news ?? []).slice(0, 6),
    fundamentals: historical ? null : input.fundamentals ?? null,
    matchedSetups,
    playbookBlockers,
    setupOptions,
    bestSetupName: best?.setupName ?? null,
    earnings,
    researchInteresting,
    researchLabel: researchInteresting
      ? tradeable
        ? 'Tradeable setup'
        : 'Interesting (research only)'
      : 'Not interesting',
    tradeable,
    // Primary levels prefer #1 setup option; fall back to Desk/playbook blend.
    // Desk engine always reports the blend it anchors to.
    levelsSource:
      engine === 'desk' ? merged.source : setupOptions[0] ? 'playbook' : merged.source,
    relativeStrength20d: market.rs,
    dollarVolume20d: liquidity.dollarVolume,
    candleSource,
    quoteSource: effectiveQuote?.source ?? 'finnhub',
    warnings,
  };
}
