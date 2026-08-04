# Trading exit strategies
_Exported on 8/4/2026 at 10:14:03 EDT from Cursor (3.12.30)_

---

**User**

what are these concepts in trading "you were wrong, exit now" and "exit with profit at this point" and risk of how many dollars per share? what are the names for these? and how the app uses these concepts

---

**Cursor**

I'll look up how the app defines stop-loss, take-profit, and per-share risk, then map those to the names you described.

Those map to three core trade-plan levels:

| Plain English | Common name | App field |
|---|---|---|
| “You were wrong — exit now” | **Stop loss** (also called **invalidation**) | `stop` |
| “Exit with profit at this point” | **Take profit** / **profit target** | `target` |
| Dollars of risk per share | **Risk per share** (stop distance) | `entry − stop` |

### What they mean

- **Stop loss / invalidation** — Price where the thesis is wrong. For longs, below entry. Hit it → exit for a planned loss.
- **Take profit / target** — Price where you take gains. Often expressed in **R** (risk units): if risk is $5/share and target is $10 above entry, that’s **2R**.
- **Risk per share** — `|entry − stop|`. If you buy at $100 and stop at $95, risk is **$5/share**. Total account risk = shares × that amount.

### How Signal Desk uses them

1. **Desk / Playbook signals** propose buy zone, stop, and target from structure + ATR. Targets are usually ~**2R** (`entry + 2 × risk`). UI labels them “Get out (stop)” and “Take profit”.

2. **Watchlist & trades** store `entryLow`/`entryHigh`, `stop`, and `target` on every name and journaled trade.

3. **Position sizing** (`lib/positionSize.ts`) uses Settings risk % and risk per share:
   - `riskAmount = accountSize × riskPercent / 100`
   - `shares = floor(riskAmount / |entry − stop|)`

4. **R:R** is `(target − entry) / (entry − stop)` — shown on Desk cards and Act from Desk.

5. **Live status** — close at/below stop → thesis invalidated; price touching stop without a closed break → “stop threatened”.

6. **Backtests** exit on stop, target (~2R), or a time stop; results are measured in **R multiples**.

---

**User**

the ui shows the following numbers, how are these calculated, explain in simple terms

---

**Cursor**

I'll trace how Desk derives that buy zone, stop, and ~2R target from the price data.

Here’s what those three boxes mean, in plain terms.

### Get in — **$496.73 – $511.32**
The **buy zone**: where the playbook says it’s reasonable to buy.

Built from recent daily candles for that setup (last ~12 days), using things like:
- recent highs / lows  
- the 20-day average  
- current price  

Different setups place the zone differently (e.g. near a breakout level vs near the moving average). The range is “buy around here,” not one exact price.

### Get out (stop) — **$459.18**
The **stop loss**: “thesis is wrong — exit.”

Roughly: put the stop under a recent swing low, with a buffer from volatility (ATR). Then the app **caps** how far the stop can sit so risk isn’t huge (about **8%** of the entry mid, or **2.5× ATR**, whichever is tighter). That’s why you don’t get absurd stops like $377 on a ~$500 stock.

### Take profit — **$578.87** · **~2.0R**
The **profit target**.

1. Mid of the buy zone ≈ **($496.73 + $511.32) / 2 ≈ $504**  
2. **Risk per share** ≈ mid − stop ≈ **$504 − $459 ≈ $45**  
3. Target aims for about **2× that risk** above the mid → that’s **2R** (risk about $45, aim to make about $90)

So **~2.0R** means: if you lose 1 unit when stopped out, the planned win is about 2 units.

---

**One-line summary:** buy zone from recent structure → stop under “I’m wrong” with a risk cap → target set so planned reward is roughly **twice** that risk.

---

**User**

do a deep analysis to verify the program is correctly setting up the buy zone, stop and take profit targets for every playbook. How could you verify it, explain it in a simple way?

---

**Cursor**

I'll do this in two steps: first map every playbook setup to the code path that computes its levels, then write and run an automated check that feeds real candle histories through each setup and verifies the numbers obey the rules (stop below buy zone, target above it, risk capped, ~2R). Let me gather the pieces.

Now let me see how the backtest actually enters and exits trades using these raw levels — that's where a bad level would corrupt results.

Done. The verdict: **the geometry is correct for every playbook, but the risk cap is not always honored** — I verified this with a new automated test suite that now runs with your other tests (all 24 suites pass, 108 tests).

## How I verified it, in simple terms

You can't check this by eyeballing one stock — the levels change with every price history. So the trick is to test the **rules** instead of the numbers. For any stock, any day, any playbook, a valid plan must obey four laws:

1. **Stop < buy zone < target** — you can't have "exit at a loss" above "get in", or "take profit" inside the buy zone.
2. **All numbers positive and finite** — no NaN, no $0 stops.
3. **Planned reward ≤ ~2.5× risk** — targets are designed as ~2R, so anything above 2.6R means broken math.
4. **Risk per share ≤ min(2.5×ATR, 8% of entry)** — the cap the code itself promises, to avoid the old MSFT bug (stop $377 on a $487 stock).

I then threw **all 19 playbooks** (8 active + 11 retired) at **19 different market shapes** — the app's demo histories, 10 synthetic tickers, plus adversarial ones: a violent gap-up, a steady crash, dead-flat tape, a V-shaped flush, a parabolic run, a $4 stock, and an 8-bar history — 361 combinations per rule. The suite lives at `lib/__tests__/levelsInvariants-test.ts`.

## Results

**Passed everywhere (laws 1–3):** ordering, sanity, and R:R hold for every setup on every history, on both code paths — the clamped one that feeds the Desk UI cards, and the raw one that feeds backtests and setup matching. No crashes even on 8 bars of data.

**Failed (law 4):** the risk cap is breached, including for setups that genuinely match and would appear on your Desk cards. Example: **Mean Reclaim on the NVDA demo history plans 10.3% risk per share** against the promised 8% max. The cause is this fallback:

```538:541:lib/recommend.ts
  let stop = Math.max(raw.stop, entryMid - maxRisk);
  if (!(stop < entryLow)) {
    stop = entryLow * 0.97;
  }
```

When the capped stop would land *inside* the buy zone, the code silently abandons the cap and puts the stop 3% under the zone instead. That's fine for narrow zones, but mean-reversion-style setups build wide zones (bottom anchored to the 20-day average, top anchored to price), so "3% under the zone" can be 10–15% away from the middle where sizing is computed. Affected active playbooks: **Oversold Bounce, Mean Reclaim, Two-Day Flush Reversal, 52-Week High Pullback** (and mildly, the breakout family on low-volatility names).

**How bad is it?** Your account is not at risk — position sizing divides your dollar risk by the stop distance, so a wider stop just means fewer shares. The real effects are: stops sit farther than the design intends, positions get smaller than they should, and the code comment overpromises. It's a quality issue, not a money-losing bug.

I encoded that as a documented known-failure test (`it.failing`), so the suite stays green today but will flag itself the moment someone fixes the fallback. If you'd like, I can fix `clampLevelsRisk` so the cap wins — likely by narrowing the entry zone when it's wider than the allowed risk — and flip that test on.

---

**User**

can you fix it pls?

---

**Cursor**

I'll fix `clampLevelsRisk` in `lib/recommend.ts`. The right move when the capped stop would land inside the buy zone is to **narrow the zone from the bottom** (the zone was too generous for the risk budget) rather than pushing the stop past the cap. Geometrically, once `entryLow ≥ entryHigh − 1.9 × maxRisk`, the capped stop always clears the zone.

Fixed. All 24 test suites pass (108 tests), including the risk-cap invariant that previously failed — it's now a permanent regression guard instead of a documented known issue.

## What changed

**`lib/recommend.ts` — `clampLevelsRisk`.** Before, when the risk-capped stop would land inside the buy zone, the code gave up on the cap and dropped the stop to 3% below the zone — on wide zones that planned 10–15% risk per share. Now it does the opposite: it **narrows the buy zone from the bottom** so the capped stop always clears it.

```543:556:lib/recommend.ts
  let stop = Math.max(raw.stop, entryMid - maxRisk);
  if (!(stop < entryLow)) {
    // Zone too wide for the cap (or raw stop inside the zone). Raise the zone
    // floor to entryHigh - 1.9*maxRisk: from there the capped stop measured
    // off the new mid always lands below the zone. maxRisk stays anchored to
    // the original mid, which is the conservative (tighter) choice.
    entryLow = Math.max(entryLow, entryHigh - 1.9 * maxRisk);
    entryMid = (entryLow + entryHigh) / 2;
    stop = entryMid - maxRisk;
    // Prefer a tighter structural stop when it still clears the zone.
    if (raw.stop > stop && raw.stop < entryLow) {
      stop = raw.stop;
    }
  }
```

The `1.9 × maxRisk` floor comes from the geometry: risk is measured from the zone midpoint, so a zone no wider than 1.9× the risk budget guarantees the capped stop lands below the zone bottom. The cap stays anchored to the original midpoint, which is the stricter choice, and a tighter structural stop (swing low) still wins when it's valid.

**Effect on the Mean Reclaim × NVDA example:** planned risk drops from 10.3% of entry to the 2.5×ATR cap (~5%), with the zone floor raised from "4% below the 20-day average" to a level the risk budget actually supports. Trading-wise this is more sensible anyway — for a reclaim you want to buy near the reclaim level, not several percent below it.

**What did *not* change:** the raw levels used by backtests and setup matching, the MSFT gap-up regression behavior (verified by the existing test), targets (still ~2R, rebuilt from capped risk), and position sizing.

One nuance I confirmed while chasing residual test noise: prices are rounded to cent precision by design, so a stop placed exactly at the cap can drift by up to one cent after rounding. The invariant tests in `lib/__tests__/levelsInvariants-test.ts` allow exactly that one cent and nothing more — the suite would catch any real regression, including via the test that runs the full rule-matching pipeline and checks only the setups Desk would actually show you.

---

**User**

you mentioned "Different setups place the zone differently" how can I know the zone is being placed at the right number.

Same with the stop you said "put the stop under a recent swing low, with a buffer from volatility (ATR). Then the app caps how far the stop can sit so risk isn’t huge (about 8% of the entry mid, or 2.5× ATR, whichever is tighter)"

and take profit at 2.0R, how don't I know 1.5R is better? I'm not traying to check if they are sticking to the numbers, but that the numbers that they are sticking to are the correct ones, does that make sense what im trying to say? can you explain it back to me

---

**Cursor**

Yes, that makes complete sense. Let me check what evidence the app already has that could answer the deeper question.

Yes, it makes total sense. Let me play it back so we're aligned:

**Two different questions:**

1. *"Does the code compute what it claims to compute?"* — That's what we just verified. The zone formula, the stop formula, the cap, the 2R target — the math obeys the written rules on every playbook and every history. This is **correctness of implementation**.

2. *"Are those rules the right rules?"* — Is `entryLow × 0.96` a good zone floor? Is a swing-low stop with ATR buffer better than a tighter one? Is 2.5×ATR / 8% the right cap? And crucially — would 1.5R beat 2.0R? This is **correctness of design**, and nothing we did so far answers it. The tests passing just means the app faithfully executes someone's opinions about where levels should go.

You're asking question 2.

**Why question 2 has no proof, only evidence.** There's no formula that derives "2R is optimal" from first principles. The only honest definition of "correct" in trading is: *this choice made more money (per unit of risk, after costs) than the alternatives, across many stocks and many market conditions, and keeps doing so on data it wasn't tuned on.* Anything less than that is a guess wearing a lab coat.

**How you'd actually answer it — a parameter sweep.** You already own the machine for this: `lib/backtest.ts` replays history bar-by-bar, enters on real signals, exits on the stop/target, includes fill costs, and scores everything in R. So the experiment is:

- Re-run every playbook backtest with target = **1.0R, 1.5R, 2.0R, 2.5R, 3.0R** and compare average R per trade, win rate, and max drawdown. The tradeoff is fundamental: tighter targets win more often but smaller; the winner is whichever **average R** (win rate × reward − loss rate × 1) is highest — not whichever feels right.
- Same for the stop: sweep **1.5×ATR vs 2.5×ATR caps**, and 5% vs 8%. Tighter stops lose more often but cheaper; you find where the curve bends.
- Same for zone placement, though zone matters less than stop/target because the entry fill is the next open regardless.

Two traps to avoid, or the sweep lies to you:

- **Curve-fitting:** if you test 20 parameter combos and pick the best, you've fit the noise. The guard is what `pickerLab.ts` already does — split history into periods, tune on the past, validate on the future, and prefer a parameter whose neighbors also work (a *flat plateau* of good results) over a lucky spike.
- **Small samples:** one setup firing 12 times proves nothing. You want the result pooled across many tickers and setups, like the combined backtest mode already does.

**What evidence exists today, honestly:** the codebase shows signs this was done historically — `retiredSetups` exist because backtests showed they were weak, the regime gate is on only "where 5y backtests showed it helps," and the 8%/2.5×ATR cap was a reaction to a real observed failure (the MSFT $742 target). But there is **no test or artifact in the repo that justifies 2.0R over 1.5R**, or the specific cap values, or the zone multipliers. Those are currently conventions, not verified results.

So the straight answer to your question: **today you don't know — and the app doesn't either.** You know the numbers are computed faithfully; you don't yet know they're the best numbers. The way to know is a one-off parameter-sweep study on top of the backtest engine you already have.

If you want, I can build that: a script/test that sweeps target-R and stop-cap multipliers across all active playbooks and demo/synthetic histories, reports avg R and drawdown per combination, and tells you whether 2.0R sits on a plateau or just happens to be where someone stopped typing.

---

**User**

so the new issue that we have is that what parameter is best would change depending on the tickers, time samples etc. In the backest in the same way we did for the picker lab, can we implement something similar for these paramenters. can yu explain back to me what I'm traying to do

---

**Cursor**

Yes — let me play it back, because I think you've landed on exactly the right idea.

**What you're saying:** The parameter sweep I proposed has a hidden flaw. If I run it once and announce "1.5R beats 2.0R," that answer is only true *for that basket of tickers, in that date range, in that market regime*. Rerun it on different tickers or a different two years and you might get 2.5R as the winner. So a single sweep doesn't find "the best parameter" — it finds *a* best parameter for *one sample*. You already solved this exact problem once, for trade *selection*: `pickerLab.ts` doesn't trust any ranking rule on one run — it reruns the same trade universe through alternative rules (priority / RS / expectancy / random), walk-forward only, with a random baseline to expose luck, and then issues a verdict about whether any rule shows a real edge or just noise.

**What you want to build:** the same lab pattern, but for the *level parameters* instead of the *picker rules*. In other words:

- **Parameter variants** (like picker rules): target = 1.0R / 1.5R / 2.0R / 2.5R / 3.0R; stop cap = 1.5×ATR / 2.5×ATR; percent cap = 5% / 8%; maybe zone multipliers.
- **Same universe, rerun** (like `simulateMaxOpenByPriority` in `pickerLab.ts`): run the identical tickers, identical signals, identical entry logic through `backtest.ts` once per variant — only the stop/target math changes.
- **Walk-forward discipline** (like the expectancy rule in pickerLab, and `barsUpTo` date truncation in `backtest.ts:304`): never tune on data you'd trade through. Tune on the past window, score on the next window, slide forward.
- **Luck baseline + spread** (like `random` with its `randomSpread` in `pickerLab.ts:41`): the honest question isn't "which variant won?" but "does the winner beat the runner-up by more than luck would explain?" You'd slice results by ticker and by time window and look at the *distribution*: if 2.0R wins 7 of 10 windows by a little, that's a plateau — real. If it wins 3 windows by a lot and loses 7, that's a spike — noise.
- **A verdict layer** (like `PickerVerdict`'s `edge / caution / noise / losing` tones at `pickerLab.ts:74`): the output isn't a number, it's a judgment — "2R is robust across regimes" vs "target-R choice is basically coin-flip; don't trust any single value" vs "1.5R wins in trends but dies in chop — consider regime-conditional targets."

**And here's the sharpest part of your idea:** the honest conclusion might be that there is *no* universal best — and that's a useful answer too. If the lab shows target-R preference flips by regime (trending markets reward 2.5R, choppy markets reward 1.0R), then the right production change isn't picking one number — it's making the target regime-aware, the same way the playbook already regime-gates certain setups (`newSetups-test.ts:25-33`). The lab tells you *which kind of fix* the data supports.

So in one sentence: **you want a "parameter lab" that stress-tests the stop/target/zone constants the way pickerLab stress-tests trade-picking rules — walk-forward, across tickers and time slices, with luck baselines — to learn whether the current values are robust, fragile, or regime-dependent.**

One design question worth deciding before building: the level parameters interact (wider stop changes what 2R means in dollars). Do you sweep each knob independently while holding the others at production values — simpler, cleaner attribution — or full grid of combinations — more complete but more curve-fit surface? PickerLab's precedent (one rule swapped at a time, everything else frozen) suggests independent sweeps first.

If that matches your intent, I'm in Ask mode so I can't build it here — switch to Agent mode and I'll implement the parameter lab against `backtest.ts` following the pickerLab structure.

---

**User**

what do u recommend "sweep each knob independently while holding the others at production values" or grid? is the ROI worth it for a grid?

---

**Cursor**

My recommendation: **independent sweeps first, grid only as a targeted follow-up.** The full grid's ROI is poor as a first pass, for four concrete reasons:

**1. The math already tells you the interactions are second-order.** In R-space, the knobs are nearly separable. Stop width sets the unit (1R in dollars), target-R sets how many units you aim for. Average R per trade ≈ `p(target hit) × R − p(stop hit) × 1` — and while `p` depends on both, the dominant term is each knob's own effect. Where a real interaction *does* exist is through the ~12-bar time stop in `backtest.ts:270`: a wide stop makes a big R target take longer to reach, so "3.0R + 2.5×ATR" dies on the time stop more often than "3.0R + tight stop." That's one specific interaction worth checking — not the whole grid.

**2. Every cell you add is another chance to get fooled.** With, say, 5 target values × 3 stop caps × 2 percent caps = 30 cells, on small per-ticker samples you *will* see a lucky winner. That's exactly the trap `pickerLab.ts` guards against with its random baseline and seed spread — and it's harder to guard against in a grid because you'd need walk-forward stability *per cell*. Independent sweeps (≈13 runs) keep the multiple-comparison problem small enough that "wins 7 of 10 windows" actually means something.

**3. Cost isn't compute, it's your judgment.** Each run is a full multi-ticker walk-forward backtest — the machine time is cheap. The expensive part is you reading 30 regime-sliced result tables and trying to hold a mental model of what changed. PickerLab works because it changes one thing at a time and everything else is frozen — attribution is instant. Copy that.

**4. The grid rarely changes the decision.** The likely outcomes of the first pass are: (a) current values sit on a plateau → done, grid adds nothing; (b) one knob clearly wants to move → move it, re-sweep once; (c) results flip by regime → the answer is a regime-conditional rule, and no grid cell can give you that either. Only in case (d) — two knobs both matter *and* their effects visibly bend each other — does a grid earn its keep, and then a 2×2 or 3×3 on just those two knobs gets you 90% of the information at 15% of the noise surface.

So concretely: build the lab with **one-knob-at-a-time sweeps** (target-R, ATR cap, percent cap, zone floor), everything else pinned at production values, with the same walk-forward windows and per-window win/loss spread pickerLab uses. If the target-R and stop-cap curves both come back strong, add one targeted 3×3 confirmation between just those two — that's the only grid cell block I'd pay for upfront.

If you're good with that plan, I'll implement it: a `parameterLab.ts` modeled on `pickerLab.ts`'s structure (variants → identical trade universe → per-window results → verdict tone), wired to `backtest.ts` so each variant only changes the level math.

---

**User**

okay go ahead

---

**Cursor**

I'll build it. Let me set up the plan and read the backtest internals I need to wire into.

Now add the `levelTuning` option to `runBacktest` and apply it at the entry point.

`runBacktest` is wired. Now the lab itself, modeled on pickerLab's structure.

Now the test suite, then a full run.

Done. All 26 suites pass (121 tests), no lint errors. The parameter lab is built and already produced its first answers.

## What was built

**`lib/levelTuning.ts`** — the three knobs (`targetR`, `atrCapMult`, `pctCap`) as a pure transform applied at the fill. Critically, it's **exits-only**: every variant takes the exact same entries, so result differences come from exit geometry alone. Undefined = production, so nothing in the live app changes.

**`lib/backtest.ts`** — `runBacktest` now accepts an optional `levelTuning` and discloses it in result notes. Production callers are untouched.

**`lib/parameterLab.ts`** — the lab, modeled on pickerLab: one knob at a time (everything else pinned), pooled across tickers × setups, per-ticker win counts, early/late-half time windows, and a verdict tone — **edge / flat / fragile / insufficient** — instead of a naked "best" number.

**`lib/__tests__/parameterLab-test.ts`** — 12 tests proving the math, the exits-only guarantee (identical entry times across target-R variants), determinism, and window accounting.

**`lib/__tests__/parameterLab-study.ts`** — a repeatable study: 10 synthetic regime tickers (trend, chop, down, volatile, recovery), 260 bars each, 8 active playbooks, ~300 pooled trades per variant.

## First findings (synthetic data — validates the machine, not yet trading truth)

- **Target 1.5R vs 2R:** 1.5R pooled highest (+93.3R vs production's +83.0R), but won only **4 of 10 tickers** and faded from early-half to late-half → verdict **fragile**. Notice the whole curve 1R–3R is within ~10R over 300 trades — a plateau, exactly what you suspected: no single "correct" R.
- **ATR stop cap:** pooled results favor tighter caps monotonically (1.5×ATR: +155.6R vs production +83.0R) — but only 5/10 tickers and heavy early→late decay → **fragile**. Interesting enough to rerun on real data, not strong enough to adopt.
- **Percent stop cap:** everything within noise → **flat**, keep production.

The lab did its job perfectly: two tempting "winners" that a naive sweep would have crowned, both exposed as sample luck by the per-ticker and time-window stability checks.

**The honest caveat:** these tickers are seeded random walks — they prove the plumbing and show you the output format, but they carry no real market structure. The real answer comes from running `runParameterLab` over actual candles (your Tiingo/Yahoo history, the same universe the backtest screen already loads). Natural next step, whenever you want it: wire the lab into a screen next to Picker Lab so you can run it against live data with one tap.

---

**User**

proceed with the next step

---

**Cursor**

I'll wire the parameter lab into a screen against real candle data. First, let me see how the existing Picker Lab and backtest screens fetch data and render, so the new screen follows the same patterns.

Now I'll restructure `backtest.ts` into a shared multi-variant engine with `runBacktest` as a thin wrapper. Two sequential edits.

Now switch the lab to the shared engine — one pass per (ticker, setup) for all 13 variants.

Add the engine-equivalence test, then verify before building the screen.

No `clay` in the palette — fixing to `danger`, then registering the route and the Lab hub card.

Three type errors — let me confirm they're pre-existing and not from my changes (none are in files I created; `recommend.ts` I did touch, but at line 1064 my clamp edit is far away).

Done. The Parameter lab is now a first-class screen in the app, running against your real candle data. All 26 suites pass (123 tests), no lint errors.

## What you got

**New screen — `app/parameter-lab.tsx`**, reachable from the Lab hub (now "Four backtest tools"). Same workflow as Portfolio backtest: a comma-separated symbol basket (defaults to your 14-name list), a history-days field, one Run button. It fetches SPY/QQQ plus each ticker, **refuses synthetic/demo bars** (skipped symbols are listed with reasons), then runs the sweep and renders one card per knob: verdict headline, a badge (`Robust edge` / `Fragile — likely luck` / `Flat — keep production` / `Too few trades`), every variant ranked by pooled R with the production row highlighted and a ★ on the winner, the stability bullets, and a plain-English footer explaining how to read it.

**Engine refactor — `runBacktestVariants` in `lib/backtest.ts`.** The naive version would have re-computed entry signals 13 times (once per variant). Since tuning is exits-only, signals are identical for all variants — so the engine now evaluates each bar once and runs 13 independent position state machines over those shared signals. `runBacktest` is now a thin wrapper over it, and an equivalence test proves batched results are byte-identical to solo runs (the study output is exactly what it was before). The whole suite runs in ~2s; the 10-ticker study dropped from 6.5s to under a second — so a 14-ticker live run on-device should feel like the Portfolio backtest, not 13× slower.

**Wiring:** route registered in `app/_layout.tsx`, card added in `app/lab.tsx`.

## To get your real answer

Open Lab → Parameter lab → Run. The synthetic study's verdicts ("1.5R wins pooled but flips by ticker," "percent cap is flat") were plumbing validation on random-walk data — the screen now asks the same questions of real market history. Whatever badge each knob gets there is the answer to your original question: if target-R comes back **flat** or **fragile**, then 2.0R vs 1.5R genuinely doesn't matter on your universe and you can stop worrying about it; only a **robust edge** badge would justify touching production levels.

One caveat to keep in mind when you run it: with ~14 tickers and 400 days you'll get a few hundred pooled trades — enough for the verdicts to mean something, but the "insufficient" badge will tell you honestly if any knob's sample is too thin. Also note three pre-existing `tsc` errors (in `pickerLab-test.ts`, `candles.ts`, and an unrelated spot in `recommend.ts`) that predate this work — tests and lint don't trip on them, but say the word if you want them cleaned up.

