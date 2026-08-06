# Yahoo proxy (Cloudflare Worker)

Source of truth for the Worker behind Settings → Yahoo proxy URL
(e.g. `https://signal-desk-bars.…workers.dev`).

## Deploy

1. Open the Worker in the Cloudflare dashboard.
2. Paste the contents of `yahoo-eod-proxy.js`.
3. Save and Deploy.
4. Optional: set `PROXY_TOKEN` and the same token in Signal Desk Settings.

## Routes

- `GET /eod?symbol=AAPL&range=2y` — daily bars scaled by Yahoo `adjclose / close`
  (`adjusted: "adjusted"` when enough bars had adjclose).
- `GET /earnings?symbol=AAPL&from=2024-01-01&to=2026-08-01` — announcement dates from
  Yahoo’s earnings calendar + quoteSummary (last-resort blackout backup when
  Finnhub / FMP / Alpha Vantage miss).

Until you redeploy, the live Worker may lack `/earnings` (app falls through to
fail-closed for that symbol) and may still return unscaled quote OHLC.

---

# Tiingo EOD proxy (Cloudflare Worker)

File: `tiingo-eod-proxy.js`

**Why:** Tiingo’s API blocks browsers (CORS). On web the app currently skips
Tiingo entirely. A Worker calls Tiingo server-side and returns the same candle
JSON shape, so web can use **true adjusted** Tiingo bars.

## Deploy

1. Cloudflare → Workers → **Create application** → Create Worker.
2. Paste `tiingo-eod-proxy.js` → Save and Deploy.
3. Settings → Variables:
   - `TIINGO_TOKEN` = your Tiingo token (**Secret**)
   - `PROXY_TOKEN` = optional shared secret (same pattern as Yahoo)
4. Copy the `*.workers.dev` URL.

## Test

```
https://YOUR-WORKER.workers.dev/eod?symbol=AAPL&days=400
```

(add `&token=…` if `PROXY_TOKEN` is set)

You should see `"source":"tiingo"`, `"adjusted":"adjusted"`, and a `candles` array.

## App wiring

The Worker alone is not enough — Signal Desk must call this URL on web instead
of skipping Tiingo. **App wiring is in Settings → Tiingo proxy URL** (defaults
to `https://edge-stock-tiingo.samss01one.workers.dev`). On web the candle
cascade prefers that proxy first.
