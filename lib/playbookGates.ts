import { closes, isSmaRising, sma } from '@/lib/indicators';
import { Candle } from '@/types/trading';

export type MarketRegime = {
  ok: boolean;
  label: string;
  detail: string;
};

export type EarningsGate = {
  blocked: boolean;
  detail: string;
  nearestDate: string | null;
  daysUntil: number | null;
};

/** Bullish regime for long playbook entries: SPY above 50-day MA and 20-day MA rising. */
export function assessMarketRegime(spyCandles: Candle[], qqqCandles?: Candle[]): MarketRegime {
  const spy = assessBenchmark(spyCandles, 'SPY');
  const qqq = qqqCandles?.length ? assessBenchmark(qqqCandles, 'QQQ') : null;

  if (spy.ok || (qqq?.ok ?? false)) {
    const parts = [spy.detail];
    if (qqq) parts.push(qqq.detail);
    return {
      ok: true,
      label: 'Risk-on',
      detail: `Regime OK — ${parts.join('; ')}`,
    };
  }

  return {
    ok: false,
    label: 'Risk-off',
    detail: `Regime blocked — ${spy.detail}${qqq ? `; ${qqq.detail}` : ''}`,
  };
}

function assessBenchmark(candles: Candle[], name: string): { ok: boolean; detail: string } {
  if (candles.length < 55) {
    return { ok: true, detail: `${name} history short (regime unchecked)` };
  }
  const series = closes(candles);
  const price = series[series.length - 1];
  const sma50 = sma(series, 50);
  const sma20 = sma(series, 20);
  const rising = isSmaRising(series, 20, 5);
  if (sma50 == null || sma20 == null) {
    return { ok: true, detail: `${name} MAs unavailable` };
  }
  const above50 = price > sma50;
  const above20 = price > sma20;
  const ok = above50 && rising;
  return {
    ok,
    detail: `${name} ${above50 ? '>' : '≤'} SMA50, SMA20 ${rising ? 'rising' : 'flat/down'}${
      above20 ? '' : ', below SMA20'
    }`,
  };
}

export function dayKeyFromUnix(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** True when `day` (YYYY-MM-DD) is within ±1 calendar day of any earnings date. */
export function isEarningsBlackout(day: string, earningsDates: string[] | undefined): boolean {
  if (!earningsDates?.length) return false;
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return earningsDates.some((d) => {
    const e = Date.parse(`${d}T12:00:00Z`);
    if (!Number.isFinite(e)) return false;
    const diffDays = Math.abs(e - t) / 86400000;
    return diffDays <= 1;
  });
}

export function assessEarningsGate(
  day: string,
  earningsDates: string[] | undefined
): EarningsGate {
  if (!earningsDates?.length) {
    return {
      blocked: false,
      detail: 'No earnings dates loaded',
      nearestDate: null,
      daysUntil: null,
    };
  }
  const t = Date.parse(`${day}T12:00:00Z`);
  let nearest: string | null = null;
  let nearestAbs = Infinity;
  let nearestSigned = 0;
  for (const d of earningsDates) {
    const e = Date.parse(`${d}T12:00:00Z`);
    if (!Number.isFinite(e)) continue;
    const signed = (e - t) / 86400000;
    const abs = Math.abs(signed);
    if (abs < nearestAbs) {
      nearestAbs = abs;
      nearest = d;
      nearestSigned = signed;
    }
  }
  const blocked = nearestAbs <= 1;
  return {
    blocked,
    nearestDate: nearest,
    daysUntil: nearest == null ? null : Math.round(nearestSigned),
    detail: blocked
      ? `Earnings blackout around ${nearest}`
      : nearest
        ? `Next/nearest earnings ${nearest} (~${Math.round(nearestSigned)}d)`
        : 'Earnings clear',
  };
}

/** Collect unique YYYY-MM-DD earnings dates from Finnhub-style rows / strings. */
export function normalizeEarningsDates(dates: Array<string | undefined | null>): string[] {
  return [...new Set(dates.filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}/.test(d))))].sort();
}
