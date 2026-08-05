import { Candle } from '@/types/trading';

const AV_BASE = 'https://www.alphavantage.co/query';

export type AlphaVantageCandleResult = {
  candles: Candle[];
  warning?: string;
};

export type AlphaVantageEarningsResult = {
  dates: string[];
  status: 'ok' | 'empty' | 'error' | 'no_key';
  detail: string;
};

/**
 * Free Alpha Vantage daily bars.
 * Compact output ≈ last 100 sessions (free-tier friendly).
 * Full history is often premium-only — we request compact on purpose.
 */
export async function fetchAlphaVantageDailyCandles(
  symbol: string,
  apiKey: string
): Promise<AlphaVantageCandleResult> {
  const upper = symbol.toUpperCase().trim();
  try {
    const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(upper)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { candles: [], warning: `Alpha Vantage HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      Note?: string;
      Information?: string;
      'Error Message'?: string;
      'Time Series (Daily)'?: Record<
        string,
        {
          '1. open': string;
          '2. high': string;
          '3. low': string;
          '4. close': string;
          '5. volume': string;
        }
      >;
    };

    if (data.Note || data.Information) {
      return {
        candles: [],
        warning:
          data.Note ||
          data.Information ||
          'Alpha Vantage rate limit hit (free: ~25 calls/day, 5/min).',
      };
    }
    if (data['Error Message']) {
      return { candles: [], warning: data['Error Message'] };
    }

    const series = data['Time Series (Daily)'];
    if (!series) {
      return { candles: [], warning: 'Alpha Vantage returned no daily series.' };
    }

    const candles = Object.entries(series)
      .map(([date, bar]) => ({
        time: Math.floor(new Date(`${date}T16:00:00Z`).getTime() / 1000),
        open: Number(bar['1. open']),
        high: Number(bar['2. high']),
        low: Number(bar['3. low']),
        close: Number(bar['4. close']),
        volume: Number(bar['5. volume']),
      }))
      .filter((c) => c.close > 0)
      .sort((a, b) => a.time - b.time);

    return {
      candles,
      warning:
        candles.length > 0
          ? `Alpha Vantage free compact series (~${candles.length} daily bars).`
          : 'Alpha Vantage returned an empty series.',
    };
  } catch {
    return { candles: [], warning: 'Alpha Vantage request failed.' };
  }
}

function isAvThrottle(data: { Note?: string; Information?: string }): string | null {
  const msg = data.Note || data.Information;
  if (!msg) return null;
  return String(msg).slice(0, 160);
}

function filterDatesInRange(dates: string[], fromDate: string, toDate: string): string[] {
  const from = fromDate.slice(0, 10);
  const to = toDate.slice(0, 10);
  return [...new Set(dates.filter((d) => d >= from && d <= to))].sort();
}

/** Parse EARNINGS_CALENDAR CSV (symbol,name,reportDate,...). */
export function parseAlphaVantageEarningsCalendarCsv(csv: string, symbol: string): string[] {
  const upper = symbol.toUpperCase();
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',');
  const reportIdx = header.findIndex((h) => h === 'reportdate');
  const symbolIdx = header.findIndex((h) => h === 'symbol');
  if (reportIdx < 0) return [];
  const dates: string[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const sym = (symbolIdx >= 0 ? cols[symbolIdx] : upper)?.toUpperCase();
    if (sym && sym !== upper) continue;
    const d = (cols[reportIdx] ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.push(d);
  }
  return dates;
}

/**
 * Earnings announcement dates for blackout windows.
 * Historical: `EARNINGS` quarterly `reportedDate`.
 * Near-term future: also `EARNINGS_CALENDAR` when `toDate` reaches today+.
 * Free tier is tight (~25 calls/day) — use only as last-resort backup.
 */
export async function fetchAlphaVantageEarningsDates(
  symbol: string,
  apiKey: string | undefined,
  fromDate: string,
  toDate: string
): Promise<AlphaVantageEarningsResult> {
  const upper = symbol.toUpperCase().trim();
  if (!apiKey?.trim() || !upper) {
    return {
      dates: [],
      status: 'no_key',
      detail: 'No Alpha Vantage key — earnings calendar unavailable.',
    };
  }

  const key = apiKey.trim();
  const collected: string[] = [];

  try {
    const earningsUrl = `${AV_BASE}?function=EARNINGS&symbol=${encodeURIComponent(upper)}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(earningsUrl);
    if (!res.ok) {
      return {
        dates: [],
        status: 'error',
        detail: `Alpha Vantage earnings HTTP ${res.status} — blackout fails closed for ${upper}.`,
      };
    }
    const data = (await res.json()) as {
      Note?: string;
      Information?: string;
      'Error Message'?: string;
      quarterlyEarnings?: Array<{ reportedDate?: string; fiscalDateEnding?: string }>;
    };

    const throttle = isAvThrottle(data);
    if (throttle) {
      return {
        dates: [],
        status: 'error',
        detail: `Alpha Vantage rate-limited — blackout fails closed for ${upper}. (${throttle})`,
      };
    }
    if (data['Error Message']) {
      return {
        dates: [],
        status: 'error',
        detail: `Alpha Vantage earnings error: ${String(data['Error Message']).slice(0, 120)} — blackout fails closed for ${upper}.`,
      };
    }

    for (const row of data.quarterlyEarnings ?? []) {
      const d = typeof row.reportedDate === 'string' ? row.reportedDate.slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) collected.push(d);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (toDate.slice(0, 10) >= today) {
      const daysAhead =
        (new Date(`${toDate.slice(0, 10)}T12:00:00Z`).getTime() - Date.now()) / 86400000;
      const horizon = daysAhead > 180 ? '12month' : daysAhead > 70 ? '6month' : '3month';
      const calUrl = `${AV_BASE}?function=EARNINGS_CALENDAR&symbol=${encodeURIComponent(
        upper
      )}&horizon=${horizon}&apikey=${encodeURIComponent(key)}`;
      const calRes = await fetch(calUrl);
      if (calRes.ok) {
        const text = await calRes.text();
        if (!/Thank you for using Alpha Vantage|API call frequency|rate limit/i.test(text)) {
          collected.push(...parseAlphaVantageEarningsCalendarCsv(text, upper));
        }
      }
    }

    const dates = filterDatesInRange(collected, fromDate, toDate);
    if (!dates.length) {
      return {
        dates: [],
        status: 'empty',
        detail: `Alpha Vantage returned no earnings dates for ${upper} in ${fromDate.slice(0, 10)}…${toDate.slice(0, 10)} — blackout fails closed.`,
      };
    }
    return {
      dates,
      status: 'ok',
      detail: `${dates.length} earnings date${dates.length === 1 ? '' : 's'} via Alpha Vantage.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      dates: [],
      status: 'error',
      detail: `Alpha Vantage earnings request failed (${msg.slice(0, 80)}) — blackout fails closed for ${upper}.`,
    };
  }
}
