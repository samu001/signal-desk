import {
  avgVolume,
  closes,
  hasHigherLow,
  hasRejectionWick,
  lastCompletedCandle,
  latestCandle,
  percentFrom,
  relativeStrength,
  sma,
} from '@/lib/indicators';
import { getUsEquitySession, SessionInfo } from '@/lib/session';
import {
  Candle,
  NewsItem,
  Quote,
  RuleCheckId,
  Setup,
  WatchlistItem,
} from '@/types/trading';

export type RuleVerdict = 'pass' | 'fail' | 'unknown';

export type RuleResult = {
  id: RuleCheckId;
  label: string;
  verdict: RuleVerdict;
  detail: string;
};

const NEGATIVE_NEWS =
  /\b(downgrade|miss(?:es|ed)?|lawsuit|probe|investigation|fraud|recall|bankrupt|sec charges|cuts guidance|plunge|crash)\b/i;

const LABELS: Record<RuleCheckId, string> = {
  above_sma_50: 'Above 50-day MA',
  in_buy_zone: 'Inside buy zone',
  near_or_in_buy_zone: 'In/near buy zone',
  higher_low: 'Higher low structure',
  volume_expanding: 'Volume expanding',
  volume_drying: 'Volume drying on pullback',
  holding_breakout_level: 'Holding breakout level',
  not_chasing_extension: 'Not chasing extension',
  extended_below_sma_20: 'Extended below 20-day MA',
  at_support_zone: 'At support / demand zone',
  rejection_wick: 'Rejection wick present',
  no_negative_catalyst: 'No negative catalyst',
  rs_vs_spy: 'Relative strength vs SPY',
  session_tradable: 'Session OK for entry',
};

export function evaluateCheck(
  id: RuleCheckId,
  ctx: {
    item: WatchlistItem;
    quote: Quote | null;
    candles: Candle[];
    spyCandles: Candle[];
    news: NewsItem[];
    session: SessionInfo;
  }
): RuleResult {
  const { item, quote, candles, spyCandles, news, session } = ctx;
  const price = quote?.price ?? latestCandle(candles)?.close ?? null;
  const closeSeries = closes(candles);
  const sma50 = sma(closeSeries, 50);
  const sma20 = sma(closeSeries, 20);
  const last = latestCandle(candles);
  const completed = lastCompletedCandle(candles);
  const avgVol20 = avgVolume(candles, 20);
  const lastVol = last?.volume ?? null;

  switch (id) {
    case 'above_sma_50': {
      if (price == null || sma50 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need 50 daily bars' };
      }
      const ok = price > sma50;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `Price ${price.toFixed(2)} vs SMA50 ${sma50.toFixed(2)}`,
      };
    }
    case 'in_buy_zone': {
      if (price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'No price' };
      }
      const ok = price >= item.entryLow && price <= item.entryHigh;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `Zone ${item.entryLow}–${item.entryHigh}`,
      };
    }
    case 'near_or_in_buy_zone': {
      if (price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'No price' };
      }
      const inZone = price >= item.entryLow && price <= item.entryHigh;
      const near =
        (price > item.entryHigh && price <= item.entryHigh * 1.03) ||
        (price < item.entryLow && price >= item.entryLow * 0.97);
      return {
        id,
        label: LABELS[id],
        verdict: inZone || near ? 'pass' : 'fail',
        detail: inZone ? 'Inside zone' : near ? 'Within 3% of zone' : 'Outside zone',
      };
    }
    case 'higher_low': {
      const ok = hasHigherLow(candles);
      return {
        id,
        label: LABELS[id],
        verdict: candles.length < 6 ? 'unknown' : ok ? 'pass' : 'fail',
        detail: ok ? 'Recent swing lows rising' : 'No clear higher low',
      };
    }
    case 'volume_expanding': {
      if (lastVol == null || avgVol20 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need volume history' };
      }
      const ok = lastVol >= avgVol20 * 1.2;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `Last vol ${(lastVol / 1e6).toFixed(1)}M vs 20d ${(avgVol20 / 1e6).toFixed(1)}M`,
      };
    }
    case 'volume_drying': {
      if (lastVol == null || avgVol20 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need volume history' };
      }
      const ok = lastVol <= avgVol20 * 0.9;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok ? 'Pullback volume cooling' : 'Volume still heavy',
      };
    }
    case 'holding_breakout_level': {
      if (price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'No price' };
      }
      const level = item.entryLow;
      const ok = price >= level && (completed?.close ?? price) >= level;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `Holding above ${level}`,
      };
    }
    case 'not_chasing_extension': {
      if (price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'No price' };
      }
      const ok = price <= item.entryHigh * 1.03;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok ? 'Still near breakout' : `${percentFrom(price, item.entryHigh).toFixed(1)}% above zone`,
      };
    }
    case 'extended_below_sma_20': {
      if (price == null || sma20 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need 20 daily bars' };
      }
      const dist = percentFrom(price, sma20);
      const ok = dist <= -2;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `${dist.toFixed(1)}% vs SMA20`,
      };
    }
    case 'at_support_zone': {
      if (price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'No price' };
      }
      const ok = price >= item.entryLow * 0.985 && price <= item.entryHigh * 1.01;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok ? 'At defined support zone' : 'Not at support zone',
      };
    }
    case 'rejection_wick': {
      const ok = hasRejectionWick(last);
      return {
        id,
        label: LABELS[id],
        verdict: last ? (ok ? 'pass' : 'fail') : 'unknown',
        detail: ok ? 'Lower wick rejection' : 'No rejection wick on last bar',
      };
    }
    case 'no_negative_catalyst': {
      const hits = news.filter((n) => NEGATIVE_NEWS.test(n.headline));
      if (!news.length) {
        return {
          id,
          label: LABELS[id],
          verdict: 'unknown',
          detail: 'No recent headlines (add Finnhub key for news)',
        };
      }
      return {
        id,
        label: LABELS[id],
        verdict: hits.length === 0 ? 'pass' : 'fail',
        detail: hits.length ? hits[0].headline : 'No red-flag headlines in lookback',
      };
    }
    case 'rs_vs_spy': {
      const rs = relativeStrength(candles, spyCandles, 20);
      if (rs == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need SPY + symbol history' };
      }
      return {
        id,
        label: LABELS[id],
        verdict: rs >= 0 ? 'pass' : 'fail',
        detail: `20d RS ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}% vs SPY`,
      };
    }
    case 'session_tradable': {
      return {
        id,
        label: LABELS[id],
        verdict: session.tradable ? 'pass' : 'fail',
        detail: `${session.label} — ${session.detail}`,
      };
    }
    default:
      return { id, label: id, verdict: 'unknown', detail: 'Unhandled check' };
  }
}

export function evaluateSetupRules(
  setup: Setup | null,
  ctx: {
    item: WatchlistItem;
    quote: Quote | null;
    candles: Candle[];
    spyCandles: Candle[];
    news: NewsItem[];
    session?: SessionInfo;
  }
): RuleResult[] {
  const session = ctx.session ?? getUsEquitySession();
  const checks = setup?.entryChecks ?? ['near_or_in_buy_zone', 'no_negative_catalyst', 'session_tradable'];
  return checks.map((id) => evaluateCheck(id, { ...ctx, session }));
}

export function scoreRuleResults(results: RuleResult[]): {
  passed: number;
  failed: number;
  unknown: number;
  total: number;
  passRate: number;
} {
  const passed = results.filter((r) => r.verdict === 'pass').length;
  const failed = results.filter((r) => r.verdict === 'fail').length;
  const unknown = results.filter((r) => r.verdict === 'unknown').length;
  const total = results.length || 1;
  return {
    passed,
    failed,
    unknown,
    total: results.length,
    passRate: passed / total,
  };
}
