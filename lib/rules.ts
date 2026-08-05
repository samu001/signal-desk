import {
  atr,
  avgVolume,
  closes,
  ema,
  emaSeries,
  hasHigherLow,
  hasRejectionWick,
  isBreakOfHigh,
  isSmaRising,
  lastCompletedCandle,
  latestCandle,
  percentFrom,
  relativeStrength,
  rsiSeries,
  sma,
  smaCrossedUp,
} from '@/lib/indicators';
import {
  DEFAULT_LIVE_GATES,
  PlaybookGateFlags,
  gateChecksFromFlags,
} from '@/lib/backtestProfile';
import {
  assessSectorRelativeStrength,
  assessVolatilityBand,
  assessWeeklyTrend,
} from '@/lib/playbookExtras';
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
  weekly_trend_ok: 'Weekly trend OK',
  sector_rs_ok: 'Sector relative strength OK',
  volatility_ok: 'Volatility band OK',
  prior_day_high_break: 'Broke prior-day high',
  ema_stack_bull: 'EMA 8>21>50 stack',
  near_ema_21: 'Near 21 EMA',
  twenty_day_high: '20-day high break',
  volume_thrust_after_dryup: 'Thrust after volume dry-up',
  mean_reclaim: 'Reclaim of 20-day mean',
  post_earnings_hold: 'Post-earnings hold',
  bull_flag_break: 'Bull flag break',
  atr_expansion_day: '2x ATR expansion day',
  two_day_flush_reversal: 'Two-day flush reversal',
  inside_day_breakout: 'Inside-day breakout',
  near_52w_high: 'Near 52-week high',
  first_touch_sma_20: 'First touch of 20-day MA',
};

export function ruleCheckLabel(id: RuleCheckId | string): string {
  return LABELS[id as RuleCheckId] ?? id.replace(/_/g, ' ');
}

export function evaluateCheck(
  id: RuleCheckId,
  ctx: {
    item: WatchlistItem;
    quote: Quote | null;
    candles: Candle[];
    spyCandles: Candle[];
    qqqCandles?: Candle[];
    /** Sector ETF daily history for sector RS gate. */
    sectorCandles?: Candle[];
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
      // undefined = caller did not supply a calendar (soft unknown for legacy
      // call sites). [] = fetch ran and returned nothing → fail closed so a
      // missing Finnhub key / empty window cannot silently allow entries.
      if (ctx.earningsDates == null) {
        return {
          id,
          label: LABELS[id],
          verdict: 'unknown',
          detail: 'No earnings calendar loaded',
        };
      }
      if (!ctx.earningsDates.length) {
        return {
          id,
          label: LABELS[id],
          verdict: 'fail',
          detail: 'Earnings calendar empty — treating as blocked (fail closed)',
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
    case 'weekly_trend_ok': {
      const gate = assessWeeklyTrend(candles);
      if (candles.length < 60) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: gate.detail };
      }
      return {
        id,
        label: LABELS[id],
        verdict: gate.ok ? 'pass' : 'fail',
        detail: gate.detail,
      };
    }
    case 'sector_rs_ok': {
      const gate = assessSectorRelativeStrength(item.symbol, candles, ctx.sectorCandles);
      if (!ctx.sectorCandles?.length && gate.etf) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: gate.detail };
      }
      return {
        id,
        label: LABELS[id],
        verdict: gate.ok ? 'pass' : 'fail',
        detail: gate.detail,
      };
    }
    case 'volatility_ok': {
      const gate = assessVolatilityBand(candles);
      if (candles.length < 20) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: gate.detail };
      }
      return {
        id,
        label: LABELS[id],
        verdict: gate.ok ? 'pass' : 'fail',
        detail: gate.detail,
      };
    }
    case 'prior_day_high_break': {
      if (candles.length < 2 || !last) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need prior daily bar' };
      }
      const prev = candles[candles.length - 2];
      const ok = last.close > prev.high;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Close ${last.close.toFixed(2)} > prior high ${prev.high.toFixed(2)}`
          : `Close still ≤ prior high ${prev.high.toFixed(2)}`,
      };
    }
    case 'ema_stack_bull': {
      const e8 = ema(closeSeries, 8);
      const e21 = ema(closeSeries, 21);
      const e50 = ema(closeSeries, 50);
      if (e8 == null || e21 == null || e50 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need ~50 bars for EMA stack' };
      }
      const series21 = emaSeries(closeSeries, 21);
      const prev21 = series21[series21.length - 4];
      const rising = prev21 != null && e21 > prev21;
      const ok = e8 > e21 && e21 > e50 && rising;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `EMA8 ${e8.toFixed(2)} / EMA21 ${e21.toFixed(2)} / EMA50 ${e50.toFixed(2)}${
          rising ? '' : ' (21 not rising)'
        }`,
      };
    }
    case 'near_ema_21': {
      const e21 = ema(closeSeries, 21);
      if (price == null || e21 == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need EMA21' };
      }
      const dist = Math.abs(percentFrom(price, e21));
      const ok = dist <= 1.5;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: `${dist.toFixed(1)}% from EMA21`,
      };
    }
    case 'twenty_day_high': {
      if (candles.length < 21) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need 21 daily bars' };
      }
      const ok = isBreakOfHigh(candles, 20);
      const priorHigh = Math.max(...candles.slice(-21, -1).map((c) => c.high));
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Broke 20-day high ${priorHigh.toFixed(2)}`
          : `Below 20-day high ${priorHigh.toFixed(2)}`,
      };
    }
    case 'volume_thrust_after_dryup': {
      if (candles.length < 8 || lastVol == null || avgVol20 == null || !last) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need volume history' };
      }
      const pullback = candles.slice(-6, -1);
      const dryBars = pullback.filter((c) => c.volume <= avgVol20 * 0.9).length;
      const upDay = last.close > last.open && last.close > candles[candles.length - 2].close;
      const thrust = lastVol >= avgVol20 * 1.25;
      const ok = dryBars >= 2 && upDay && thrust;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Dry-up (${dryBars}/5) then thrust vol`
          : `Dry bars ${dryBars}/5 · up ${upDay} · thrust ${thrust}`,
      };
    }
    case 'mean_reclaim': {
      if (candles.length < 25 || price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need 20-day mean history' };
      }
      const maNow = sma(closeSeries, 20);
      if (maNow == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'SMA20 unavailable' };
      }
      const aboveNow = price > maNow;
      let wasBelow = false;
      for (let i = candles.length - 6; i < candles.length - 1; i++) {
        if (i < 20) continue;
        const maThen = sma(closeSeries.slice(0, i + 1), 20);
        if (maThen != null && candles[i].close < maThen) {
          wasBelow = true;
          break;
        }
      }
      const ok = aboveNow && wasBelow;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? 'Reclaimed SMA20 after recent dip below'
          : aboveNow
            ? 'Above SMA20 but no recent dip below'
            : 'Still below SMA20',
      };
    }
    case 'post_earnings_hold': {
      if (!ctx.earningsDates?.length) {
        return {
          id,
          label: LABELS[id],
          verdict: 'unknown',
          detail: 'No earnings calendar for post-report hold',
        };
      }
      if (price == null || !last || candles.length < 25) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need price history' };
      }
      const asOf =
        ctx.asOfTime ?? last.time ?? Math.floor(Date.now() / 1000);
      const day = dayKeyFromUnix(asOf);
      const t = Date.parse(`${day}T12:00:00Z`);
      let daysSince: number | null = null;
      let earnDate: string | null = null;
      for (const d of ctx.earningsDates) {
        const e = Date.parse(`${d}T12:00:00Z`);
        if (!Number.isFinite(e) || e > t) continue;
        const since = Math.round((t - e) / 86400000);
        if (daysSince == null || since < daysSince) {
          daysSince = since;
          earnDate = d;
        }
      }
      if (daysSince == null || earnDate == null) {
        return { id, label: LABELS[id], verdict: 'fail', detail: 'No recent past earnings date' };
      }
      const inWindow = daysSince >= 2 && daysSince <= 10;
      const ma20 = sma(closeSeries, 20);
      const holding = ma20 != null && price > ma20 && last.close >= last.open;
      const ok = inWindow && holding;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Holding strength ${daysSince}d after earnings ${earnDate}`
          : `Earnings ${earnDate} (~${daysSince}d) · window ${inWindow} · hold ${holding}`,
      };
    }
    case 'bull_flag_break': {
      if (candles.length < 16 || !last) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need ~16 bars for flag' };
      }
      const impulse = candles.slice(-15, -6);
      const flag = candles.slice(-6, -1);
      if (impulse.length < 5 || flag.length < 3) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Flag windows incomplete' };
      }
      const impulseRet =
        (impulse[impulse.length - 1].close - impulse[0].open) / Math.max(impulse[0].open, 1e-9);
      const flagHigh = Math.max(...flag.map((c) => c.high));
      const flagLow = Math.min(...flag.map((c) => c.low));
      const mid = (flagHigh + flagLow) / 2;
      const flagWidthPct = mid > 0 ? ((flagHigh - flagLow) / mid) * 100 : 99;
      const atr14 = atr(candles.slice(0, -1), 14);
      const tight =
        flagWidthPct <= 5.5 || (atr14 != null && flagHigh - flagLow <= atr14 * 1.35);
      const broke = last.close > flagHigh;
      const ok = impulseRet >= 0.04 && tight && broke;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Flag break after ${(impulseRet * 100).toFixed(1)}% impulse (width ${flagWidthPct.toFixed(1)}%)`
          : `Impulse ${(impulseRet * 100).toFixed(1)}% · tight ${tight} · break ${broke}`,
      };
    }
    case 'atr_expansion_day': {
      if (!last || candles.length < 16) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need ATR history' };
      }
      const atr14 = atr(candles, 14);
      if (atr14 == null || atr14 <= 0) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'ATR unavailable' };
      }
      const range = last.high - last.low;
      const expanded = range >= 2 * atr14;
      const loc = range > 0 ? (last.close - last.low) / range : 0;
      const nearHighs = loc >= 0.7;
      const up = last.close > last.open;
      const ok = expanded && nearHighs && up;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Range ${(range / atr14).toFixed(1)}x ATR, close near highs`
          : `Range ${(range / atr14).toFixed(1)}x ATR · nearHighs ${nearHighs} · up ${up}`,
      };
    }
    case 'two_day_flush_reversal': {
      if (!last || candles.length < 5) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need flush + reversal bars' };
      }
      const prev = candles[candles.length - 2];
      const isFlushBar = (c: Candle) => {
        const range = c.high - c.low;
        const nearLow = range > 0 ? (c.close - c.low) / range <= 0.35 : false;
        return nearLow && c.close < c.open;
      };
      // 2–3 down closes ending at prior bar, each closing near lows.
      const flush2 = isFlushBar(candles[candles.length - 3]) && isFlushBar(prev);
      const flush3 =
        isFlushBar(candles[candles.length - 4]) &&
        isFlushBar(candles[candles.length - 3]) &&
        isFlushBar(prev);
      const flushOk = flush2 || flush3;
      const reclaim = last.close > prev.high;
      const ok = flushOk && reclaim;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Flush (${flush3 ? '3' : '2'}d) then close above prior high ${prev.high.toFixed(2)}`
          : `Flush ${flushOk} · reclaim ${reclaim}`,
      };
    }
    case 'inside_day_breakout': {
      if (!last || candles.length < 3) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need impulse + inside + break bars' };
      }
      const impulse = candles[candles.length - 3];
      const inside = candles[candles.length - 2];
      const impulseRet = (impulse.close - impulse.open) / Math.max(impulse.open, 1e-9);
      const strongUp = impulse.close > impulse.open && impulseRet >= 0.012;
      const isInside =
        inside.high <= impulse.high &&
        inside.low >= impulse.low &&
        inside.high - inside.low < impulse.high - impulse.low;
      const broke = last.close > inside.high;
      const ok = strongUp && isInside && broke;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `Broke inside-day high ${inside.high.toFixed(2)} after ${(impulseRet * 100).toFixed(1)}% up day`
          : `StrongUp ${strongUp} · inside ${isInside} · break ${broke}`,
      };
    }
    case 'near_52w_high': {
      if (!last || candles.length < 120) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need ~120+ bars toward 52-week high' };
      }
      const lookback = Math.min(252, candles.length - 1);
      const window = candles.slice(-(lookback + 1), -1);
      const high52 = Math.max(...window.map((c) => c.high));
      if (high52 <= 0 || price == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: '52-week high unavailable' };
      }
      const distPct = ((high52 - price) / high52) * 100;
      const ok = distPct >= -0.5 && distPct <= 5;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `${distPct.toFixed(1)}% below 52-week high ${high52.toFixed(2)}`
          : `${distPct.toFixed(1)}% from 52-week high ${high52.toFixed(2)}`,
      };
    }
    case 'first_touch_sma_20': {
      if (price == null || candles.length < 30) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'Need SMA20 history' };
      }
      const maNow = sma(closeSeries, 20);
      if (maNow == null) {
        return { id, label: LABELS[id], verdict: 'unknown', detail: 'SMA20 unavailable' };
      }
      const dist = Math.abs(percentFrom(price, maNow));
      const touching = dist <= 1.5 && price >= maNow * 0.985;
      let wasExtended = false;
      for (let i = candles.length - 8; i < candles.length - 1; i++) {
        if (i < 20) continue;
        const maThen = sma(closeSeries.slice(0, i + 1), 20);
        if (maThen != null && candles[i].close > maThen * 1.02) {
          wasExtended = true;
          break;
        }
      }
      const ok = touching && wasExtended;
      return {
        id,
        label: LABELS[id],
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `First pullback touch of SMA20 (${dist.toFixed(1)}% away)`
          : `Touch ${touching} · prior extension ${wasExtended}`,
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
    sectorCandles?: Candle[];
    news: NewsItem[];
    session?: SessionInfo;
    earningsDates?: string[];
    asOfTime?: number;
    /** Which accuracy gates to append (defaults to live regime + earnings). */
    gates?: PlaybookGateFlags;
  }
): RuleResult[] {
  const session = ctx.session ?? getUsEquitySession();
  const checks = setup?.entryChecks ?? ['near_or_in_buy_zone', 'no_negative_catalyst', 'session_tradable'];
  const gateFlags = ctx.gates ?? DEFAULT_LIVE_GATES;
  const withGates = [...checks, ...gateChecksFromFlags(gateFlags)];
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
    // Unknown soft checks (volume history, etc.) do not tank the rate.
    // Core-check unknown and earnings_clear are handled in setupSignalPasses /
    // evaluateCheck (fail closed) — do not rely on this rate alone.
    passRate: known > 0 ? passed / known : 0,
  };
}

export const MIN_SETUP_PASS_RATE = 0.7;

/**
 * Whether evaluated rules count as a tradeable signal.
 * - passRate ≥ 0.7 on known (pass/fail) checks
 * - no hard fails
 * - core check = setup.entryChecks[0] must not be unknown (fail closed — a
 *   setup whose defining rule cannot be evaluated is not a signal)
 */
export function setupSignalPasses(
  setup: Setup | null | undefined,
  results: RuleResult[],
  options?: { minPassRate?: number; skipCheckIds?: Iterable<string> }
): { pass: boolean; passRate: number } {
  const skip = new Set(options?.skipCheckIds ?? []);
  const usable = results.filter((r) => !skip.has(r.id));
  const pool = usable.length ? usable : results;
  const scored = scoreRuleResults(pool);
  const hardFails = pool.filter((r) => r.verdict === 'fail').length;
  const coreId = setup?.entryChecks?.[0];
  const core = coreId ? pool.find((r) => r.id === coreId) : undefined;
  const coreUnknown = core?.verdict === 'unknown';
  const min = options?.minPassRate ?? MIN_SETUP_PASS_RATE;
  return {
    pass: scored.passRate >= min && hardFails === 0 && !coreUnknown,
    passRate: scored.passRate,
  };
}
