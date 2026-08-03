# Signal Desk

Personal stocks trading guide (Expo / React Native, web-first). The **Desk** issues
Soft/Strong buy recommendations with entry/stop/target, acting as a confirmation
layer on top of the **Playbook** of rule-based setups. It does not auto-trade.

## Data sources

Daily candles resolve in order: **Tiingo → FMP → Finnhub → Alpha Vantage → demo**.
API keys live in Settings (or env vars for scripts) — never committed. Tiingo is
blocked by CORS in the browser, so the web app relies on FMP for candles.

## Active Playbook setups

Roster is performance-driven (Must-profile backtests: de-dupe + 5 bps slippage,
$0 commission, `|R| > 3` outliers removed). Setups marked *(regime)* carry the
SPY/QQQ market-regime gate in their own entry checks because the gate improved
them over ~5 years; the others run ungated because the gate hurt them.

- Two-Day Flush Reversal — best risk-adjusted setup across 2y and 5y windows
- Mean Reclaim *(regime)*
- Inside-Day Breakout *(regime)*
- Prior-Day High Break *(regime — flips from negative to positive with it)*
- Oversold Bounce *(regime)*
- 52-Week High Pullback *(regime)*
- ATR Expansion Day
- Dry-Up Thrust

Retired (kept in `retiredSetups`, stripped from stored state on load): RSI
Oversold Bounce, Momentum / Gap-and-Go, MA Crossover, EMA Stack Pullback,
Bull Flag Break, Earnings Momentum, Trend Pullback (both variants),
Breakout Hold, Simple Trend Follow, RS Breakout.

## Lessons from deep backtests

**High-beta consumer/gaming names are systematically bad for long-only setups.**
Over a ~5y window (which includes the 2022 bear), PENN, LYFT, CZR, ETSY, and
DECK all produced meaningfully negative combined R — replacing one such ticker
with another of the same profile did not help. The losses are a property of the
name profile, not the individual ticker. Pick backtest/watchlist symbols by
demonstrated combined R (e.g. CFG, AAPL, XOM, RKLB were consistent winners),
not by sector-matching a removed loser.

**The market-regime gate is not universally good.** It roughly doubled portfolio
total R overall, but per-setup it helps trend/breakout entries (Prior-Day High,
Inside-Day, Mean Reclaim) and hurts flush/expansion entries (Two-Day Flush
Reversal, ATR Expansion Day) that do their best work in ugly tape. Hence
per-setup gating instead of a global gate.

## Backtesting

```bash
# Deep Must backtest (~800 calendar days by default; Yahoo EOD fallback when no keys)
npx tsx scripts/run-deep-backtest.ts

# ~5y window; BT_REGIME=1 stacks the regime gate globally (experiment override)
BT_DAYS=1500 npx tsx scripts/run-deep-backtest.ts

# Short comparisons
npx tsx scripts/run-short-backtest.ts
npx tsx scripts/compare-must-vs-all8.ts
```

The engine needs ≥ 60 daily bars (55 warmup + 5). With API keys set
(`TIINGO_API_KEY`, `FMP_API_KEY`, `FINNHUB_API_KEY`), scripts prefer those
sources; mind Tiingo's ~50 req/hour free-tier cap.

## Tests

```bash
npm run test:ci
```
