/**
 * Yahoo EOD proxy for Signal Desk (browser-safe).
 * GET /eod?symbol=AAPL&range=2y
 * Optional: ?token=YOUR_SECRET  (set PROXY_TOKEN in Worker Settings → Variables)
 *
 * Bars are scaled by Yahoo adjclose/close so OHLC is split+dividend adjusted
 * (same continuous series Tiingo / FMP dividend-adjusted aim for).
 * Deploy: paste into Cloudflare Workers → Save and Deploy.
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/eod' && url.pathname !== '/') {
      return json({ error: 'Use GET /eod?symbol=AAPL&range=2y' }, 404);
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

    const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
    if (!symbol) {
      return json({ error: 'Missing symbol' }, 400);
    }

    const range = url.searchParams.get('range') || '2y';
    const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=${encodeURIComponent(range)}`;

    try {
      const res = await fetch(yahoo, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SignalDesk/1.0)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        return json({ error: `Yahoo HTTP ${res.status}`, candles: [] }, 502);
      }

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const ts = result?.timestamp || [];
      const q = result?.indicators?.quote?.[0];
      const adjSeries = result?.indicators?.adjclose?.[0]?.adjclose || [];
      if (!ts.length || !q?.close?.length) {
        return json({ error: 'Empty Yahoo payload', candles: [] }, 502);
      }

      const candles = [];
      let usedAdjClose = 0;
      for (let i = 0; i < ts.length; i++) {
        const open = q.open?.[i];
        const high = q.high?.[i];
        const low = q.low?.[i];
        const close = q.close?.[i];
        const volume = q.volume?.[i] ?? 0;
        if (open == null || high == null || low == null || close == null || !(close > 0)) {
          continue;
        }

        // Scale OHLC by adjclose/close so dividends (and any residual adj) apply
        // to the whole bar. When adjclose is missing, keep quote OHLC as-is
        // (Yahoo quote is typically already split-smoothed).
        const adj = adjSeries[i];
        const factor =
          typeof adj === 'number' && Number.isFinite(adj) && adj > 0 ? adj / close : 1;
        if (factor !== 1) usedAdjClose += 1;

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

      const fullyAdjusted = usedAdjClose > 0 && usedAdjClose >= Math.floor(candles.length * 0.9);

      return json(
        {
          symbol,
          source: 'yahoo',
          /** App reads this: 'adjusted' | 'unknown' */
          adjusted: fullyAdjusted ? 'adjusted' : 'unknown',
          candles,
          warning: fullyAdjusted
            ? `Yahoo EOD (${candles.length} daily bars, range=${range}, split+dividend adjusted via adjclose).`
            : `Yahoo EOD (${candles.length} daily bars, range=${range}; adjclose sparse — adjustment unverified).`,
        },
        200,
        { 'Cache-Control': 'public, max-age=3600' }
      );
    } catch (e) {
      return json({ error: String(e), candles: [] }, 500);
    }
  },
};
