# Signal Desk

Personal stocks trading guide (Expo / React Native, web-first). The **Desk** issues
Soft/Strong buy recommendations with entry/stop/target, acting as a confirmation
layer on top of the **Playbook** of rule-based setups. It does not auto-trade.

## Data sources

Daily candles resolve in order: **Tiingo → Yahoo proxy → FMP → Finnhub → Alpha Vantage → none**
(no synthetic bars). Web uses a Tiingo proxy Worker (CORS); native can use the
Tiingo token directly. After a Tiingo 429, FMP is skipped for that path (Yahoo
still tried). Portfolio scoring requires adjusted bars; RAW / adj? tickers are
excluded. API keys live in Settings (or env vars for scripts) — never committed.

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
# Deep Must + earnings blackout (~800 calendar days; same gates as Portfolio UI).
# Set FINNHUB_API_KEY and/or FMP_API_KEY / ALPHA_VANTAGE_API_KEY or the blackout
# fails closed (~0 trades). Chain: Finnhub → FMP → Alpha Vantage.
npx tsx scripts/run-deep-backtest.ts

# ~5y window; BT_REGIME=1 also stacks the regime gate
BT_DAYS=1500 FINNHUB_API_KEY=... npx tsx scripts/run-deep-backtest.ts

# Walk-forward split: score a past era vs a recent era separately
BT_DAYS=1500 BT_END=2023-12-31 npx tsx scripts/run-deep-backtest.ts
BT_DAYS=1500 BT_START=2024-01-01 npx tsx scripts/run-deep-backtest.ts

# Short comparisons
npx tsx scripts/run-short-backtest.ts
npx tsx scripts/compare-must-vs-all8.ts
```

Realism features baked in: entries fill next-bar open; **stops/targets fill at
the open when a bar gaps through the level**, and stop gaps take an extra
**gap-beyond** hit (tiered 10–25% of the gap); outlier trades are kept, not
trimmed; friction is tiered by trailing ADV (**slip + half-spread**: ≥$100M → 5+1 /
≥$20M → 10+2 / else 20+5 bps, missing volume → small; commission $0; stock-loan
borrow n/a for long-only); **earnings
blackout** matches live Desk / Portfolio (`FINNHUB_API_KEY` → `FMP_API_KEY` →
`ALPHA_VANTAGE_API_KEY` — empty/missing calendars fail closed); and a portfolio report caps concurrent
open positions (`BT_MAX_OPEN`, default 3) to approximate a real account's
capital limit. Expect the capped portfolio number — not the all-signals number
— to resemble live results. Remaining known optimism: the roster and universe
were originally selected on the same history they are scored on (without the
earnings blackout); re-runs with Finnhub will differ from those older totals
(mitigate by re-checking walk-forward windows before trusting a change).

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
   **Status: fixed.** FMP prefers the dividend-adjusted EOD endpoint (falls
   back to raw `/full` only when the plan rejects it; never stacks raw after a
   429). Cascade is **Tiingo → Yahoo → FMP**; after Tiingo 429, FMP is skipped.
   Adjusted hits win; soft RAW/unknown only when nothing better is available.
   Every provider reports `adjusted`/`raw`/`unknown`. Gap guard
   threshold is **±22%** (catches 4:3 / 3:2 / 2:1 splits). Portfolio totals
   score **adjusted EOD only** — RAW and unverified (`adj?`) tickers are
   excluded as **Unadjusted** (dividend drag / residual split risk), and
   split-sized gaps on non-adjusted feeds remain **Suspect data**.
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
   `earnings_clear` fails closed when the calendar is empty / missing a key /
   fetch-failed (omitted calendar stays soft-unknown for legacy call sites),
   with **distinct detail copy** per status. `fetchEarningsDates` returns
   `{ dates, status, detail }` (`ok` | `empty` | `no_key` | `error`) instead of
   a bare `[]`. Finnhub is primary; **FMP then Alpha Vantage** back up on
   rate-limit, empty, or missing Finnhub key (`FMP_API_KEY` /
   `ALPHA_VANTAGE_API_KEY` / Settings). Portfolio shows a pre-run banner when
   no calendar key is set, a post-run rollup when any symbol is fail-closed
   (partial loads still score symbols that got a calendar), and per-symbol
   `earn ok` / `earn: error` / `earn: empty` / `earn: no key` pills. Deep
   script (`scripts/run-deep-backtest.ts`) uses the same Must + earnings
   blackout profile and Finnhub→FMP→AV calendars as Portfolio. The default
   roster was historically selected without that
   blackout — re-score before comparing to older deep-script totals.

### Next tier

6. **Tiered slippage.** — **Status: fixed (extended).** Portfolio (and the deep
   script) share `costsFromCandles` / `costsForSymbol(symbol, candles)` in
   `lib/backtestCosts.ts`: trailing **ADV** (≥$100M → **5 bps slip + 1 bp½
   spread**, ≥$20M → **10+2**, else **20+5**; missing volume → small/safe). No
   hardcoded megacap/mid symbol lists. Commission $0. Stop exits that gap
   through the level fill gap-aware at the open and apply **gap-beyond**
   (10–25% of the gap worse than the open). Stock-loan **borrow is n/a** for
   this long-only playbook (rate field stays 0; wired if shorts are ever
   added). Per-symbol notes show the slip+spread tier and ADV.
7. **Dollar math ignores buying power.** — **Status: fixed.** After a capped
   run, `analyzeBuyingPower` (`lib/buyingPower.ts`) sizes each taken trade with
   Desk-style risk (`account × risk% / (entry−stop)`), tracks peak open notional
   through the exit calendar day, and **scales the displayed $** by
   `min(1, account / peakNotional)` via `scaleDollarsForBuyingPower`. R totals
   stay full-risk; the $ path is fundable (no silent leverage). Banner shows
   unconstrained → scaled when shrink applied.
8. **Curated defaults.** — **Status: fixed (label).** The portfolio symbols
   field shows a warning when the deep-script performance-picked default basket
   is still loaded, nudging toward a list you chose. The roster itself is
   unchanged (personal app — disclosure, not a new universe).

### Low priority

9. Exits on the final bar — **Status: fixed.** The exit loop now evaluates
   stop/target/time on the last bar; only positions that survive that bar are
   force-closed at the close. A last-bar stop breach fills gap-aware at the
   stop (not the close).
10. Post-stop cooldown calendar vs trading days — **Status: fixed.**
    `applyStopCooldown` takes the ticker's `barTimes` and spans
    `stopCooldownBars` trading days (same as the per-setup bar-index cooldown).
    Calendar-day fallback remains only for callers that omit barTimes.
11. Priority ties favored A–Z symbols — **Status: fixed.** Score is
    `plannedRR × 10 + passRate` (spreads the ~2R cluster), and contested slots
    tie-break FIFO by entryTime then a stable non-alphabetical hash of the
    symbol/setup id — not `localeCompare`.

### Defensible read (items 1–11)

Fix-now items 1–5, next-tier 6–8, and low-priority 9–11 are done: adjusted-only
portfolio scoring, Production headline default, max-open through exit day, no
same-ticker pyramiding, earnings blackout + fail-closed calendars (portfolio +
deep script parity), tiered slippage, fundable dollar figures, default-basket
label, last-bar stop fills, trading-day cooldown, and non-alphabetical priority
ties. Still treat "Best (this window)" as optimism until it survives a different
window, prefer a basket *you* chose over the curated default, and trust the
capped total over All signals.

## Tests

```bash
npm run test:ci
```
