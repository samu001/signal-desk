import {
  avgVolume,
  closes,
  hasHigherLow,
  hasRejectionWick,
  isSmaRising,
  lastCompletedCandle,
  latestCandle,
  percentFrom,
  relativeStrength,
  rsiSeries,
  sma,
  smaCrossedUp,
} from '@/lib/indicators';
import { assessEarningsGate, assessMarketRegime, dayKeyFromUnix } from '@/lib/playbookGates';
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
  above_sma_20: 'Above 20-day MA',
  sma_20_rising: '20-day MA rising',
  sma_cross_up: '10/30 MA bullish cross',
  rsi_oversold_recovering: 'RSI oversold recovery',
  strong_up_day: 'Strong up / momentum day',
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
  market_regime_ok: 'Market regime OK',
  earnings_clear: 'Outside earnings blackout',
};

export function evaluateCheck(
  id: RuleCheckId,
  ctx: {
    item: WatchlistItem;
    quote: Quote | null;
    candles: Candle[];
    spyCandles: Candle[];
    qqqCandles?: Candle[];
    news: NewsItem[];
    session: SessionInfo;
    /** YYYY-MM-DD earnings dates for blackout (±1 day). */
    earningsDates?: string[];
    /** Signal day override for historical evaluation (unix seconds). */
    asOfTime?: number;
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
    case 'above_sma_20': {
      if (price == null || sma20 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need 20 daily bars' };
      }
      const ok = price > sma20;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `Price ${price.toFixed(2)} vs SMA20 ${sma20.toFixed(2)}`,
      };
    }
    case 'sma_20_rising': {
      const ok = isSmaRising(closeSeries, 20, 3);
      return {
        id,
        label: LABELS[id],
        verdict: closeSeries.length < 23 ? 'unknown' : ok ? 'pass' : 'fail',
        detail: ok ? '20-day average sloping up' : '20-day average flat/down',
      };
    }
    case 'sma_cross_up': {
      const ok = smaCrossedUp(closeSeries, 10, 30, 5);
      const s10 = sma(closeSeries, 10);
      const s30 = sma(closeSeries, 30);
      return {
        id,
        label: LABELS[id],
        verdict: closeSeries.length < 36 ? 'unknown' : ok ? 'pass' : 'fail',
        detail:
          s10 != null && s30 != null
            ? ok
              ? `SMA10 ${s10.toFixed(2)} crossed above SMA30 ${s30.toFixed(2)}`
              : `No recent cross (SMA10 ${s10.toFixed(2)} / SMA30 ${s30.toFixed(2)})`
            : 'Need 30 daily bars',
      };
    }
    case 'rsi_oversold_recovering': {
      const series = rsiSeries(closeSeries, 14);
      if (series.length < 5) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need RSI history' };
      }
      const cur = series[series.length - 1];
      const prev = series[series.length - 2];
      const recentLow = Math.min(...series.slice(-6));
      const ok = recentLow <= 35 && cur > prev && cur <= 50;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `RSI ${cur.toFixed(1)} (recent low ${recentLow.toFixed(1)})`,
      };
    }
    case 'strong_up_day': {
      if (!last || candles.length < 2) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need prior bar' };
      }
      const prev = candles[candles.length - 2];
      const dayRet = percentFrom(last.close, prev.close);
      const gapUp = last.open >= prev.close * 1.003;
      const strongClose = last.close >= last.open && dayRet >= 1.2;
      const ok = strongClose && (gapUp || dayRet >= 2.0);
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `${dayRet >= 0 ? '+' : ''}${dayRet.toFixed(1)}% day${gapUp ? ', gap up' : ''}`,
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
    case 'market_regime_ok': {
      const regime = assessMarketRegime(spyCandles, ctx.qqqCandles);
      if (spyCandles.length < 55) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: regime.detail };
      }
      return {
        id,
        label: LABELS[id],
        verdict: regime.ok ? 'pass' : 'fail',
        detail: regime.detail,
      };
    }
    case 'earnings_clear': {
      if (!ctx.earningsDates?.length) {
        return {
          id,
          label: LABELS[id],
          verdict: 'unknown',
          detail: 'No earnings calendar loaded',
        };
      }
      const asOf =
        ctx.asOfTime ??
        latestCandle(candles)?.time ??
        Math.floor(Date.now() / 1000);
      const gate = assessEarningsGate(dayKeyFromUnix(asOf), ctx.earningsDates);
      return {
        id,
        label: LABELS[id],
        verdict: gate.blocked ? 'fail' : 'pass',
        detail: gate.detail,
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
    qqqCandles?: Candle[];
    news: NewsItem[];
    session?: SessionInfo;
    earningsDates?: string[];
    asOfTime?: number;
  }
): RuleResult[] {
  const session = ctx.session ?? getUsEquitySession();
  const checks = setup?.entryChecks ?? ['near_or_in_buy_zone', 'no_negative_catalyst', 'session_tradable'];
  // Always append accuracy gates so every playbook setup respects regime + earnings.
  const withGates = [...checks, 'market_regime_ok' as const, 'earnings_clear' as const];
  const unique = [...new Set(withGates)];
  return unique.map((id) => evaluateCheck(id, { ...ctx, session }));
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
  const known = passed + failed;
  return {
    passed,
    failed,
    unknown,
    total: results.length,
    // Unknown checks should not tank readiness (e.g. missing earnings calendar).
    passRate: known > 0 ? passed / known : 0,
  };
}
