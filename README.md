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

In the app: **Playbook → "Portfolio backtest (with position cap)"** runs the
combined Playbook across a symbol list with a configurable max-open-positions
cap, and converts R to dollars from the account size / risk % you enter there
(saved back to Settings). It uses your API keys from Settings (FMP allows
~400 days on the free tier); without keys it falls back to demo data. The
per-symbol and Desk backtests live on the Playbook and Desk tabs.

For deeper runs (5y history via the Yahoo EOD fallback, walk-forward splits),
use the scripts:

```bash
# Deep Must backtest (~800 calendar days by default; Yahoo EOD fallback when no keys)
npx tsx scripts/run-deep-backtest.ts

# ~5y window; BT_REGIME=1 stacks the regime gate globally (experiment override)
BT_DAYS=1500 npx tsx scripts/run-deep-backtest.ts

# Walk-forward split: score a past era vs a recent era separately
BT_DAYS=1500 BT_END=2023-12-31 npx tsx scripts/run-deep-backtest.ts
BT_DAYS=1500 BT_START=2024-01-01 npx tsx scripts/run-deep-backtest.ts

# Short comparisons
npx tsx scripts/run-short-backtest.ts
npx tsx scripts/compare-must-vs-all8.ts
```

Realism features baked in: entries fill next-bar open; **stops/targets fill at
the open when a bar gaps through the level** (no perfect-stop fantasy); outlier
trades are kept, not trimmed; slippage is tiered by liquidity (5/10/20 bps);
and a portfolio report caps concurrent open positions (`BT_MAX_OPEN`, default 3)
to approximate a real account's capital limit. Expect the capped portfolio
number — not the all-signals number — to resemble live results. Remaining known
optimism: the roster and universe were selected on the same history they are
scored on (mitigate by re-checking walk-forward windows before trusting a change).

The engine needs ≥ 60 daily bars (55 warmup + 5). With API keys set
(`TIINGO_API_KEY`, `FMP_API_KEY`, `FINNHUB_API_KEY`), scripts prefer those
sources; mind Tiingo's ~50 req/hour free-tier cap.

## Portfolio backtest — honesty audit (Aug 2026)

A code audit of the Portfolio backtest pipeline (`app/portfolio-backtest.tsx`,
`lib/backtest.ts`, `lib/playbookCombined.ts`, `lib/portfolioCapacity.ts`,
`lib/pickerLab.ts`, `lib/parameterSweep.ts`, providers). Verdict: the fill
mechanics are conservative, but several layers around the engine inflate the
numbers users actually see. This section records the gaps and the agreed fix
plan, ranked by how much each distorts results.

### Already honest (keep)

- Signal on close → entry next-bar open; slippage applied against you on both fills.
- Gap-aware exits (stop/target fills at the open when a bar gaps through);
  same-bar stop+target resolves to **stop first**.
- Benchmark history truncated by date (no future SPY/QQQ leak); slot ranking
  never uses realized R; RS20/expectancy pickers are walk-forward only.
- Picker lab carries a 25-seed random baseline and calls "best" rules noise
  when they land inside the random range; negative pools are flagged as luck.

### Fix now

1. **Unadjusted prices on the FMP path (web default).** `lib/fmp.ts` mapped raw
   OHLC with no split/dividend adjustment, while `lib/tiingo.ts` uses adjusted
   fields — so web and native could disagree, dividends dragged long results,
   and a split inside the window printed one catastrophic fake trade (gap-aware
   stop fill on a −90% "bar"). The Yahoo proxy worker is out-of-repo; its
   adjustment is unverified.
   **Status: fixed.** FMP now calls the stable dividend-adjusted EOD endpoint
   (same one-call-per-symbol shape — no extra rate-limit cost; falls back to
   raw `/full` with a loud RAW warning only when the key's plan rejects it,
   remembered per session). Every provider reports `adjusted`/`raw`/`unknown`,
   surfaced as a pill per symbol. A ±40% overnight-gap guard
   (`detectSuspectGaps` in `lib/candles.ts`) marks raw/unknown feeds with
   split-sized gaps as **Suspect data** and the portfolio backtest excludes
   them from the run instead of scoring fake trades. Yahoo-proxy bars remain
   unverified (`adj?`) — covered by the gap guard.
2. **Headline defaults to the in-sample maximum.** After each run the screen
   auto-activated the best-R picker (`bestSelectablePicker`) *and* the best-R
   exit variant (`bestParamVariantId`) chosen on the same window — a double
   in-sample selection presented as the default number.
   **Status: fixed.** Active picker and exit variant now default to
   **Production** after every run. "Best (this window)" remains a tappable
   comparison row with the existing honesty banner; promoting it is an
   explicit choice, not the headline.
3. **Max-open cap leaks on transition days.** `simulateMaxOpenByPriority`
   counted a position as open only while `exitTime > dayStart`, so a trade
   exiting on day X freed its slot for a day-X entry — but entries fill at the
   open, before intraday/close exits happen. The sim briefly held more than
   the cap and booked extra trades.
   **Status: fixed.** A position occupies its slot through its exit calendar
   day; the slot frees the next day. Same rule applied in the deep-backtest
   script's portfolio report. Regression: same-day exit→entry is skipped.
4. **Same-symbol position stacking.** `selectBestTradesPerDay` de-duped by
   entry *day* only; different setups could pyramid the same ticker across a
   trend, so All-signals counted one move several times and the capped book
   could fill every slot with one symbol.
   **Status: fixed.** `enforceOneOpenPosition` runs after same-day dedup (and
   before stop cooldown) in the combined Playbook and the parameter-sweep
   pipeline — at most one open position per ticker; same-day exit→re-entry is
   blocked. Pyramiding would need an explicit opt-in if ever wanted.
5. **Missing-data checks fail open, and the portfolio run has no earnings
   data.** `scoreRuleResults` dropped `unknown` checks from the pass-rate
   denominator, and the portfolio run passed no earnings calendar while the
   Must profile disabled the blackout — so nothing blocked entries into
   earnings reports (live Desk would), and a setup whose defining check could
   not be evaluated silently traded on its generic checks (e.g. Earnings
   Momentum, currently retired, degraded to `above_sma_20` + `volume_expanding`
   if re-enabled).
   **Status: fixed.** `setupSignalPasses` treats `entryChecks[0]` unknown as
   no signal (shared by backtest / Desk match / setup perf / candidates).
   `earnings_clear` fails closed when the calendar fetch returns empty
   (omitted calendar stays soft-unknown for legacy call sites). Portfolio
   backtest fetches Finnhub earnings dates per symbol (same helper as the
   single-symbol backtest), enables the earnings blackout gate (live Desk
   parity), and threads dates into the parameter sweep.

### Next tier

6. **Tiered slippage.** — **Status: fixed.** Portfolio (and the deep script)
   share `costsForSymbol` in `lib/backtestCosts.ts`: megacap **5 bps**, mid
   **10 bps**, everything else **20 bps**, commission $0. Per-symbol notes show
   which tier applied. (Previously the app used a flat slippage for every name.)
7. **Dollar math ignores buying power.** — **Status: fixed.** After a capped
   run, `analyzeBuyingPower` (`lib/buyingPower.ts`) sizes each taken trade with
   Desk-style risk (`account × risk% / (entry−stop)`), tracks peak open notional
   through the exit calendar day, and warns when peak > account or any single
   trade notionals above the account. Does **not** rewrite R totals — flags the
   dollar path as optimistic when leverage would have been required.
8. **Curated defaults.** The default symbol list and the active roster were
   both selected on the history they are scored on (see `run-deep-backtest.ts`
   universe comment above). Fix: label the default basket as
   performance-picked, nudge users toward their own lists, and surface the
   early/late window split more prominently as the in-app out-of-sample check.

### Low priority

9. Exits are not evaluated on the final bar (loop ends one bar early), so a
   last-bar stop breach scores at the close via force-close instead of the stop.
10. Post-stop cooldown windows use calendar days while labeled trading days
    (inactive on the portfolio screen — Must sets cooldown to 0).

### Defensible read (items 1–7)

Fix-now items 1–5 and next-tier 6–7 are done: adjusted EOD + split-gap guard,
Production headline default, max-open slots held through the exit day, no
same-ticker pyramiding, earnings blackout + fail-closed core checks, tiered
5/10/20 bps slippage, and buying-power / peak-notional warnings on the dollar
path. Still treat "Best (this window)" as optimism until it survives a
different window, prefer a basket *you* chose over the curated default, and
trust the capped total over All signals. Item 8 (curated-defaults labeling)
remains open.

## Tests

```bash
npm run test:ci
```
