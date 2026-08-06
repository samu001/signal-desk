/**
 * Yahoo proxy for Signal Desk (browser-safe).
 *
 * GET /eod?symbol=AAPL&range=2y
 *   Bars scaled by Yahoo adjclose/close (split+dividend adjusted).
 *
 * GET /earnings?symbol=AAPL&from=2024-01-01&to=2026-08-01
 *   Announcement dates from Yahoo earnings calendar (last-resort blackout backup).
 *
 * Optional: ?token=YOUR_SECRET  (set PROXY_TOKEN in Worker Settings → Variables)
 * Deploy: paste into Cloudflare Workers → Save and Deploy.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token',
};

const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json,text/html,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

function checkAuth(request, env, url) {
  const required = env.PROXY_TOKEN;
  if (!required) return null;
  const token =
    url.searchParams.get('token') || request.headers.get('X-Proxy-Token') || '';
  if (token !== required) return json({ error: 'Unauthorized' }, 401);
  return null;
}

function cookieHeader(res) {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (list.length) return list.map((c) => c.split(';')[0]).join('; ');
  const single = res.headers.get('set-cookie');
  return single ? single.split(',').map((c) => c.split(';')[0].trim()).join('; ') : '';
}

function mergeCookies(...parts) {
  const map = new Map();
  for (const part of parts) {
    if (!part) continue;
    for (const pair of part.split(';')) {
      const p = pair.trim();
      if (!p || !p.includes('=')) continue;
      const eq = p.indexOf('=');
      map.set(p.slice(0, eq), p.slice(eq + 1));
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function yahooSession() {
  const home = await fetch('https://fc.yahoo.com', {
    headers: YAHOO_HEADERS,
    redirect: 'follow',
  });
  let cookies = cookieHeader(home);
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...YAHOO_HEADERS, Cookie: cookies, Accept: 'text/plain' },
  });
  cookies = mergeCookies(cookies, cookieHeader(crumbRes));
  const crumb = (await crumbRes.text()).trim();
  return { cookies, crumb: crumb && !crumb.includes(' ') ? crumb : '' };
}

function chartUrl(host, symbol, range) {
  return `https://${host}/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=${encodeURIComponent(range)}&events=div%7Csplit`;
}

async function fetchYahooChart(symbol, range) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastStatus = 0;
  for (const host of hosts) {
    const res = await fetch(chartUrl(host, symbol, range), { headers: YAHOO_HEADERS });
    lastStatus = res.status;
    if (!res.ok) continue;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0];
    const adjSeries = result?.indicators?.adjclose?.[0]?.adjclose || [];
    if (ts.length && q?.close?.length) {
      return { ts, q, adjSeries, host };
    }
  }
  return { error: `Yahoo HTTP ${lastStatus || 'empty'}`, ts: [], q: null, adjSeries: [] };
}

function ymdFromUnix(sec) {
  if (!(sec > 0)) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function ymdFromFmt(fmt) {
  if (typeof fmt !== 'string') return null;
  const iso = fmt.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  // "September 3, 2026 at 4 PM EDT" / "Sep 03, 2026"
  const m = fmt.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b/i
  );
  if (!m) return null;
  const months = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11,
  };
  const mi = months[m[1].toLowerCase()];
  if (mi == null) return null;
  const d = new Date(Date.UTC(Number(m[3]), mi, Number(m[2])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDate(set, value) {
  if (!value) return;
  if (typeof value === 'number') {
    const ymd = ymdFromUnix(value);
    if (ymd) set.add(ymd);
    return;
  }
  if (typeof value === 'object') {
    if (typeof value.raw === 'number') {
      const ymd = ymdFromUnix(value.raw);
      if (ymd) set.add(ymd);
      return;
    }
    if (typeof value.fmt === 'string') {
      const ymd = ymdFromFmt(value.fmt);
      if (ymd) set.add(ymd);
    }
    return;
  }
  if (typeof value === 'string') {
    const ymd = ymdFromFmt(value) || (/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : null);
    if (ymd) set.add(ymd);
  }
}

async function fetchEarningsFromQuoteSummary(symbol, session) {
  const dates = new Set();
  if (!session.crumb) return dates;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (const host of hosts) {
    const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(
      symbol
    )}?modules=earnings%2CcalendarEvents&crumb=${encodeURIComponent(session.crumb)}`;
    const res = await fetch(url, {
      headers: { ...YAHOO_HEADERS, Cookie: session.cookies, Accept: 'application/json' },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) continue;

    const quarterly = result.earnings?.earningsChart?.quarterly || [];
    for (const row of quarterly) addDate(dates, row.reportedDate);

    const earnDates = result.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(earnDates)) {
      for (const d of earnDates) addDate(dates, d);
    } else {
      addDate(dates, earnDates);
    }
    if (dates.size) return dates;
  }
  return dates;
}

async function fetchEarningsFromCalendarHtml(symbol, session) {
  const dates = new Set();
  const url = `https://finance.yahoo.com/calendar/earnings?symbol=${encodeURIComponent(
    symbol
  )}&size=40`;
  const res = await fetch(url, {
    headers: {
      ...YAHOO_HEADERS,
      Cookie: session.cookies,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) return dates;
  const html = await res.text();
  // Rows: <td data-testid-cell="startdatetime" ...> September 3, 2026 at 4 PM EDT </td>
  const re = /data-testid-cell="startdatetime"[^>]*>\s*([^<]+?)\s*</gi;
  let m;
  while ((m = re.exec(html))) {
    addDate(dates, m[1].trim());
  }
  return dates;
}

async function handleEarnings(symbol, from, to) {
  let session;
  try {
    session = await yahooSession();
  } catch (e) {
    return json(
      { error: `Yahoo session failed: ${String(e)}`, dates: [], source: 'yahoo' },
      502
    );
  }

  const fromCal = await fetchEarningsFromCalendarHtml(symbol, session);
  const fromQs = await fetchEarningsFromQuoteSummary(symbol, session);
  const merged = new Set([...fromCal, ...fromQs]);
  const dates = [...merged]
    .filter((d) => (!from || d >= from) && (!to || d <= to))
    .sort();

  if (!dates.length) {
    return json(
      {
        symbol,
        source: 'yahoo',
        dates: [],
        warning: `Yahoo returned no earnings dates for ${symbol} in ${from || '…'}…${to || '…'}.`,
      },
      200
    );
  }

  return json(
    {
      symbol,
      source: 'yahoo',
      dates,
      warning: `Yahoo earnings (${dates.length} dates; calendar${fromCal.size ? '' : ' miss'} + quoteSummary${
        fromQs.size ? '' : ' miss'
      }).`,
    },
    200,
    { 'Cache-Control': 'public, max-age=3600' }
  );
}

async function handleEod(symbol, range) {
  const payload = await fetchYahooChart(symbol, range);
  if (payload.error || !payload.q || !payload.ts.length) {
    return json({ error: payload.error || 'Empty Yahoo payload', candles: [] }, 502);
  }

  const { ts, q, adjSeries } = payload;
  const candles = [];
  let adjPresent = 0;
  let adjScaled = 0;
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    const volume = q.volume?.[i] ?? 0;
    if (open == null || high == null || low == null || close == null || !(close > 0)) {
      continue;
    }

    const adj = adjSeries[i];
    const hasAdj = typeof adj === 'number' && Number.isFinite(adj) && adj > 0;
    const factor = hasAdj ? adj / close : 1;
    if (hasAdj) adjPresent += 1;
    if (hasAdj && Math.abs(factor - 1) > 1e-6) adjScaled += 1;

    candles.push({
      time: ts[i],
      open: open * factor,
      high: high * factor,
      low: low * factor,
      close: close * factor,
      volume,
    });
  }
  candles.sort((a, b) => a.time - b.time);

  const need = Math.max(1, Math.floor(candles.length * 0.9));
  const fullyAdjusted = adjPresent >= need;

  return json(
    {
      symbol,
      source: 'yahoo',
      adjusted: fullyAdjusted ? 'adjusted' : 'unknown',
      adjclosePresent: adjPresent,
      adjcloseScaled: adjScaled,
      candles,
      warning: fullyAdjusted
        ? `Yahoo EOD (${candles.length} daily bars, range=${range}, split+dividend adjusted via adjclose; ${adjScaled} bars scaled).`
        : `Yahoo EOD (${candles.length} daily bars, range=${range}; adjclose present on ${adjPresent}/${candles.length} — adjustment unverified).`,
    },
    200,
    { 'Cache-Control': 'public, max-age=120' }
  );
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const authErr = checkAuth(request, env, url);
    if (authErr) return authErr;

    const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
    if (!symbol) {
      return json({ error: 'Missing symbol' }, 400);
    }

    try {
      if (url.pathname === '/earnings') {
        const from = (url.searchParams.get('from') || '').slice(0, 10);
        const to = (url.searchParams.get('to') || '').slice(0, 10);
        return await handleEarnings(symbol, from, to);
      }

      if (url.pathname === '/eod' || url.pathname === '/') {
        const range = url.searchParams.get('range') || '2y';
        return await handleEod(symbol, range);
      }

      return json(
        { error: 'Use GET /eod?symbol=AAPL&range=2y or GET /earnings?symbol=AAPL&from=&to=' },
        404
      );
    } catch (e) {
      return json({ error: String(e), dates: [], candles: [] }, 500);
    }
  },
};
