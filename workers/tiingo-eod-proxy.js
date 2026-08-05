/**
 * Tiingo EOD proxy for Signal Desk (browser-safe).
 * GET /eod?symbol=AAPL&days=800
 *
 * Secrets (Worker Settings → Variables / Secrets):
 *   TIINGO_TOKEN  — your Tiingo API token (stays on Cloudflare, not in the browser)
 *   PROXY_TOKEN   — optional shared secret (?token= or X-Proxy-Token), same idea as Yahoo proxy
 *
 * Deploy: Cloudflare Dashboard → Workers → Create → paste this → Save and Deploy.
 * Then put the worker URL in Signal Desk Settings (Tiingo proxy URL) once the app supports it.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

function toDate(d) {
  return d.toISOString().slice(0, 10);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/eod' && url.pathname !== '/') {
      return json({ error: 'Use GET /eod?symbol=AAPL&days=800' }, 404);
    }

    const required = env.PROXY_TOKEN;
    if (required) {
      const token =
        url.searchParams.get('token') ||
        request.headers.get('X-Proxy-Token') ||
        '';
      if (token !== required) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    const tiingoToken = (env.TIINGO_TOKEN || '').trim();
    if (!tiingoToken) {
      return json(
        { error: 'Worker missing TIINGO_TOKEN secret — set it in Cloudflare Variables.', candles: [] },
        500
      );
    }

    const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
    if (!symbol) {
      return json({ error: 'Missing symbol' }, 400);
    }

    const daysRaw = Number(url.searchParams.get('days') || '800');
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 30), 5000) : 800;
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const tiingoUrl =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices` +
      `?startDate=${toDate(start)}&endDate=${toDate(end)}&token=${encodeURIComponent(tiingoToken)}`;

    try {
      const res = await fetch(tiingoUrl, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${tiingoToken}`,
        },
      });
      const body = await res.text();

      if (res.status === 429 || /rate.?limit|too many requests|exceeded|quota/i.test(body)) {
        const retry = res.headers.get('Retry-After');
        return json(
          {
            error: retry
              ? `Tiingo rate limit — retry after ${retry}s`
              : 'Tiingo rate limit',
            candles: [],
          },
          429
        );
      }

      if (res.status === 401 || res.status === 403) {
        return json({ error: 'Tiingo auth failed — check TIINGO_TOKEN', candles: [] }, 502);
      }
      if (!res.ok) {
        return json(
          { error: `Tiingo HTTP ${res.status}: ${body.slice(0, 160)}`, candles: [] },
          502
        );
      }

      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return json({ error: 'Tiingo returned non-JSON', candles: [] }, 502);
      }

      if (!Array.isArray(data) || !data.length) {
        return json({ error: 'Tiingo returned no rows', candles: [] }, 502);
      }

      const candles = data
        .map((row) => {
          const open = Number(row.adjOpen ?? row.open) || 0;
          const high = Number(row.adjHigh ?? row.high) || 0;
          const low = Number(row.adjLow ?? row.low) || 0;
          const close = Number(row.adjClose ?? row.close) || 0;
          const volume = Number(row.adjVolume ?? row.volume) || 0;
          const time = row.date ? Math.floor(new Date(row.date).getTime() / 1000) : 0;
          return { time, open, high, low, close, volume };
        })
        .filter((c) => c.close > 0 && c.time > 0)
        .sort((a, b) => a.time - b.time);

      return json(
        {
          symbol,
          source: 'tiingo',
          adjusted: 'adjusted',
          candles,
          warning: `Tiingo EOD via proxy (${candles.length} adjusted daily bars, days=${days}).`,
        },
        200,
        { 'Cache-Control': 'public, max-age=3600' }
      );
    } catch (e) {
      return json({ error: String(e), candles: [] }, 500);
    }
  },
};
