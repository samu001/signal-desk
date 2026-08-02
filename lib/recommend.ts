import { CandleSource } from '@/lib/candles';
import { SetupExpectancy } from '@/lib/expectancy';
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
import { matchPlaybookSetups, rankMatchedSetups, SetupMatch } from '@/lib/setupMatch';
import { Candle, FundamentalSnapshot, NewsItem, Quote, Setup } from '@/types/trading';

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
  bestSetupName: string | null;
  earnings: EarningsRisk | null;
  candleSource: CandleSource;
  quoteSource: Quote['source'];
  warnings: string[];
};

const NEGATIVE_NEWS =
  /\b(downgrade|miss(?:es|ed)?|lawsuit|probe|investigation|fraud|recall|bankrupt|sec charges|cuts guidance|plunge|crash)\b/i;
const POSITIVE_NEWS =
  /\b(upgrade|beat|beats|raises guidance|record|surge|partnership|win|approval|strong demand)\b/i;

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
    return {
      score: 50,
      factors: [
        {
          name: 'Company data',
          pillar: 'company',
          verdict: 'unknown',
          detail: 'No fundamentals available',
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
    const m = fundamentals.profitMargin;
    const pct = m > 1 ? m : m * 100;
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
    // FMP / demo may store 0.38 (38%) or already-percent-like values.
    const roePct = Math.abs(fundamentals.roe) <= 5 ? fundamentals.roe * 100 : fundamentals.roe;
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
    const g =
      Math.abs(fundamentals.revenueGrowth) <= 5
        ? fundamentals.revenueGrowth * 100
        : fundamentals.revenueGrowth;
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

  const negatives = news.filter((n) => NEGATIVE_NEWS.test(n.headline));
  const positives = news.filter((n) => POSITIVE_NEWS.test(n.headline));

  if (negatives.length) {
    return {
      score: 18,
      hardFail: true,
      factors: [
        {
          name: 'Catalyst screen',
          pillar: 'news',
          verdict: 'fail',
          detail: negatives[0].headline,
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
          detail: positives[0].headline,
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
}): Stance {
  if (input.newsHardFail || input.price <= input.stop) return 'avoid';
  if (input.technical < 35) return 'avoid';
  if (input.earningsBlocked) return 'wait';
  // Desk is a confirmation layer: no buy stance without a Playbook match.
  if (!input.playbookMatched) return 'wait';

  const strong =
    input.overall >= 72 &&
    input.technical >= 65 &&
    input.news >= 60 &&
    input.fundamental >= 55 &&
    (input.inEntry || input.nearEntry) &&
    input.bestExpectancy >= -0.15;

  if (strong) return 'strong_buy';
  if (input.overall >= 55 && input.technical >= 45 && (input.inEntry || input.nearEntry)) {
    return 'soft_buy';
  }
  return 'wait';
}

function buildSummary(
  stance: Stance,
  symbol: string,
  nearEntry: boolean,
  inEntry: boolean,
  bestSetupName: string | null,
  earningsBlocked: boolean
): string {
  if (earningsBlocked) {
    return `${symbol} is too close to earnings — Desk waits even if the chart looks okay.`;
  }
  switch (stance) {
    case 'strong_buy':
      return `${symbol} is confirmed by Playbook${bestSetupName ? ` (${bestSetupName})` : ''} with clean technicals${
        inEntry ? ' and price already in the entry zone' : nearEntry ? ' and price near the entry zone' : ''
      }.`;
    case 'soft_buy':
      return `${symbol} has a Playbook match${bestSetupName ? ` (${bestSetupName})` : ''} and looks constructive — patient Soft buy only near the zone.`;
    case 'avoid':
      return `${symbol} fails a hard filter right now (trend damage, stop risk, or negative news). Stand aside.`;
    default:
      return bestSetupName
        ? `${symbol} matched ${bestSetupName}, but Desk still wants a cleaner zone/score before a buy label.`
        : `${symbol} has no Playbook confirmation yet — Desk waits instead of forcing a Soft/Strong buy.`;
  }
}

export function buildRecommendation(input: {
  symbol: string;
  quote: Quote | null;
  candles: Candle[];
  spyCandles: Candle[];
  news?: NewsItem[];
  fundamentals?: FundamentalSnapshot | null;
  candleSource?: CandleSource;
  warnings?: string[];
  setups?: Setup[];
  expectancy?: Record<string, SetupExpectancy>;
  earnings?: EarningsRisk | null;
  /**
   * Historical replay mode: company/news are treated as neutral placeholders
   * (not point-in-time), so stance is driven mainly by technicals + Playbook match.
   */
  historicalMode?: boolean;
}): Recommendation {
  const symbol = input.symbol.toUpperCase().trim();
  const candles = input.candles;
  const price = input.quote?.price ?? latestCandle(candles)?.close ?? 0;
  const levels = computeTradeLevels(candles);
  const technical = scoreTechnical({
    price,
    candles,
    spyCandles: input.spyCandles,
    levels,
  });
  const historical = Boolean(input.historicalMode);
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

  const setups = input.setups ?? [];
  const allMatches =
    setups.length && candles.length
      ? matchPlaybookSetups({
          symbol,
          setups,
          quote: input.quote,
          candles,
          spyCandles: input.spyCandles,
          news: historical ? [] : input.news ?? [],
          historicalMode: historical,
          expectancy: input.expectancy,
        })
      : [];
  const matchedSetups = rankMatchedSetups(allMatches);
  const best = matchedSetups[0] ?? null;
  const playbookMatched = matchedSetups.length > 0;
  const earnings = input.earnings ?? null;
  const earningsBlocked = Boolean(earnings?.blocked);

  const playbookBoost = playbookMatched ? Math.min(12, 6 + matchedSetups.length * 2) : 0;
  const expectancyBoost = best ? Math.max(-6, Math.min(8, best.expectancyScore * 8)) : 0;
  const baseOverall = historical
    ? technical.score * 0.75 + fundamental.score * 0.15 + news.score * 0.1
    : technical.score * 0.5 + fundamental.score * 0.3 + news.score * 0.2;
  const overallScore = Math.round(
    Math.max(0, Math.min(100, baseOverall + playbookBoost + expectancyBoost - (earningsBlocked ? 20 : 0)))
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
  });

  const factors = [...technical.factors, ...fundamental.factors, ...news.factors];
  if (playbookMatched && best) {
    factors.unshift({
      name: 'Playbook confirmation',
      pillar: 'technical',
      verdict: 'pass',
      detail: `${matchedSetups.length} setup(s) matched — best: ${best.setupName}`,
    });
  } else if (setups.length) {
    factors.unshift({
      name: 'Playbook confirmation',
      pillar: 'technical',
      verdict: 'fail',
      detail: 'No playbook setup currently passes',
    });
  }
  if (earnings) {
    factors.push({
      name: 'Earnings window',
      pillar: 'news',
      verdict: earnings.blocked ? 'fail' : 'pass',
      detail: earnings.detail,
    });
  }

  const reasons: RecommendReason[] = [];
  for (const f of factors) {
    if (f.verdict === 'pass') reasons.push({ tone: 'good', text: `${f.name}: ${f.detail}` });
    else if (f.verdict === 'fail') reasons.push({ tone: 'bad', text: `${f.name}: ${f.detail}` });
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
  const confidence = Math.max(
    20,
    Math.min(
      94,
      Math.round(
        overallScore * 0.8 +
          (input.candleSource === 'demo' ? -8 : 4) +
          (technical.nearEntry ? 4 : 0) +
          (playbookMatched ? 8 : -10) +
          (earningsBlocked ? -12 : 0)
      )
    )
  );

  const warnings = [...(input.warnings ?? [])];
  if (historical) {
    warnings.push(
      'Historical Desk mode: company/news neutralized; buys still require Playbook confirmation.'
    );
  }
  if (!playbookMatched && setups.length) {
    warnings.push('No Playbook setup matched — Desk will not issue Soft/Strong buy.');
  }

  return {
    symbol,
    stance,
    label: STANCE_LABEL[stance],
    summary: buildSummary(
      stance,
      symbol,
      technical.nearEntry,
      technical.inEntry,
      best?.setupName ?? null,
      earningsBlocked
    ),
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
    reasons: reasons.slice(0, 10),
    news: historical ? [] : (input.news ?? []).slice(0, 6),
    fundamentals: historical ? null : input.fundamentals ?? null,
    matchedSetups,
    bestSetupName: best?.setupName ?? null,
    earnings,
    candleSource: input.candleSource ?? 'demo',
    quoteSource: input.quote?.source ?? 'demo',
    warnings,
  };
}
