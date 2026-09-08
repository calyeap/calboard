# Calboard: Valuation Methodology

**Version 1.0.2 — FROZEN 5 September 2026.**
Supersedes all earlier drafts and the v1.0-named file (see Appendix A). **The filename carries no version number: the version lives in this header and in Appendix A, and this file is edited in place.** That is the fix for the drift that put three drafts into circulation. Nothing in Calboard should be built against any other copy.

Status: validated by three completed manual tests (Microsoft, NVIDIA, OKLO), one full audit of those tests, the four blocking reruns that audit required (all 4 Sep 2026), and one independent red-team review (5 Sep 2026) whose four blocking guard-and-state defects are fixed in v1.0.2. **No figure anywhere in this document changed in v1.0.2; the four fixes add states and gates where software following the earlier text would have returned a confident number with no warning.** Seven methodology changes required by that audit are incorporated. **Every illustration below has been reconciled against the completed v1.0.1 reruns; where a rerun changed a figure, the rerun figure is the one shown.**

Purpose: understand how a strong analyst values a public equity, and reduce that to a method that can be encoded as software without smuggling in judgment the software is not entitled to make.

Legend used throughout:
- **FACT** — reported financial data or a deterministic calculation from it.
- **ASSUMPTION** — an input you must choose.
- **INFERENCE** — a conclusion that follows from facts plus assumptions.
- **[S]** — should be deterministic software.
- **[C]** — appropriate for Claude to interpret, flag or explain (never to decide).

---

## 0. The core idea (read this even if you skip the rest)

Valuation is not "compute the true value." Nobody can. Valuation is translating a story about the business into numbers, then comparing those numbers with the story the current share price already tells.

Three consequences that shape everything below:

1. **The point estimate is the least valuable output.** A DCF that says "$412.37" is theatre. The valuable outputs are: which 2–3 assumptions drive the value, what the price already assumes, and whether those assumptions are plausible against base rates.
2. **Method follows the business, not the analyst's habit.** A DCF on OKLO is a fabrication with a discount rate attached. P/E on NVIDIA at peak margins is a trap. The first job is classification.
3. **Every method is the same thing wearing different clothes.** P/E, EV/EBITDA, FCF yield and DCF all price the same future cash flows. Multiples are compressed DCFs with hidden assumptions. Knowing what a multiple hides is most of the skill.

A fourth, added by the v1.0 audit: **a rule that is stated but not computed will be broken.** Every safeguard in this document that can be expressed as a test is now written as a test with a defined pass/fail state, because in all three manual tests the rules that were merely asserted were the rules that got violated.

---

## 1. Choosing the method: classification comes first

### Gates, evaluated before anything else

**Gate 0 — supported profile [S].** v1 has validated three profiles on three companies. The asset-based row appears in the table below for completeness and has been validated on nothing. Software must be able to detect that without judgment, so the gate is computable.

Return **UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1** when any of:
- sector classification is Financials or Real Estate; or
- interest income exceeds 50% of revenue; or
- insurance premium or policy-reserve line items appear in the primary financial statements; or
- industry classification is reserve-based extraction (oil and gas exploration and production, mining).

Return **UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE** when the sector classification is missing and those tests cannot be evaluated. **The gate fails closed:** an unclassifiable company is unsupported, never mature-profitable by default.

Under either state all valuation outputs are suppressed. Facts, multiples where arithmetically defined, and history diagnostics may still display, each carrying the state. A human may override; the override, its reason, and the fact that nothing under it has been validated are recorded with the analysis, exactly as with any classification override.

Why it exists: for a bank or an insurer, debt is funding rather than capital structure, so the EV bridge, EBITDA, free cash flow and PVGO are all arithmetically computable and none of them means anything. A property-casualty insurer with low reported debt and stable operating cash flow passes every other test in this document into the mature-profitable row and produces a full page of correct, meaningless numbers.

**Gate 1 — history sufficiency [S].** Count the fiscal years of filed annual data available.

| Years available | State | Effect |
|---|---|---|
| **< 5** | **HISTORY INSUFFICIENT** | The own-history multiple percentile is **suppressed**. Every range, median and worst-change statistic is labelled with the window actually used and is never described as ten-year. The margin and stress diagnostics **still run**, with stress margin levels set by policy — the current margin, and that margin reduced by one quarter and by one half in relative terms — because a company with four filed years and a record margin is exactly where the peak-earnings question matters most and exactly where history cannot answer it. |
| **5–9** | **SHORT HISTORY** | Compute normally; print the window length beside every history statistic; evaluate the overlay triggers on the available window. |
| **≥ 10** | — | As written throughout. |

**HISTORY INSUFFICIENT does not license a cyclicality claim.** Trigger B below requires an *observed* margin decline. A short window in which none was observed is absence of evidence, not evidence of absence: the software must not label such a company CYCLICAL, must not attach a PEAK EARNINGS warning on that basis, and must not force a revenue-decline bear case on it. It runs the margin diagnostics and says the window is short. That is the whole of what the data supports.

**Classification inputs (FACT and [S] except where marked):**
- Revenue: zero / small / large.
- Free cash flow: negative / positive but volatile / positive and stable (3+ years).
- Revenue growth: >30%, 10–30%, <10%.
- **Capital intensity: (capex + acquisitions + finance-lease right-of-use assets obtained in the period) as % of revenue.** The lease term is not optional — capacity acquired under lease is capacity acquired — and the *ROU-assets-obtained* disclosure is the input, not the change in lease liability (§3.3). Operating leases are excluded here on the same consistency rule as the EV bridge (§2.1). Microsoft FY26: $140.6B, or 42.4% of revenue, against $115.9B and 34.9% on cash capex alone.
- **Cyclicality: the ten-year operating-margin range and the worst single-year margin change.** This is a primary input, not a tiebreaker.
- **Balance-sheet nature.** The *financial and asset-based* case is decided deterministically by Gate 0. The asset-light / asset-heavy distinction remaining inside the supported profiles is an **ASSUMPTION the analyst confirms**, informed by capital intensity above and by the CAPITAL-LIGHT flag in §3.3. It was marked FACT [S] in earlier versions and is not one.

**Decision logic (INFERENCE from those facts). [S] recommends a profile with the facts that drove it; you confirm or override; overrides are recorded.** Hard auto-assignment is too crude: a cyclical in a peak year looks like a growth company, and a mature company in a capex spike looks unstable. The table is the recommendation rule, not the final word.

| Profile | Primary | Secondary cross-checks | Do not use |
|---|---|---|---|
| Mature, profitable, stable FCF (Microsoft) | DCF + reverse DCF | FCF yield, P/E vs own history, EV/EBIT vs peers | EV/Revenue, P/B |
| High-growth, profitable, uncertain durability (NVIDIA) | Reverse DCF + scenario DCF with explicit revenue paths | Normalised (through-cycle) P/E, EV/EBIT, market-cap vs addressable-profit-pool | Trailing P/E at peak margins, EV/Revenue standalone |
| Pre-revenue / unprofitable (OKLO) | Implied probability of success + "what has to be true" reverse calc | Cash-per-share floor, runway and dilution path, unit-economics breakeven, implied future revenue at exit multiple | DCF as a point estimate, any current multiple |
| Asset-based (banks, REITs, resources) | P/B or NAV | ROE vs cost of equity, dividend/FCF yield | Standard DCF, EV/EBITDA |

**The margin-at-high overlay [S].** Independently of which row is chosen, two things are evaluated **separately**, because they are different claims and they need different evidence.

**Trigger A — MARGIN AT HISTORICAL HIGH.** A description. The current operating margin is at or within 2 points of the maximum of the available window **and** that window's margin range exceeds 15 points.

**Trigger B — CYCLICAL.** A claim about the business. The company has recorded a single-year operating-margin decline of more than 10 points within the available window.

*Mandatory whenever A **or** B fires — the diagnostic set:*
- PVGO computed on normalised NOPAT as well as current NOPAT, with the gap reported.
- P/E computed at three margin levels (current, the window median, and one stress level between them; policy stress levels where Gate 1 returned HISTORY INSUFFICIENT).
- The reverse DCF run at all three margin levels, not one.
- A bear scenario in which the **margin reverts** — not merely growth slowing.

*Additional, and only when B fires — the cyclicality set:*
- The **PEAK EARNINGS** label on the own-history multiple percentile, or its suppression.
- A bear scenario containing an actual revenue **decline**.

**A alone is not evidence of cyclicality.** A software company whose operating margin rose twenty points over a decade of scaling fires A and is not cyclical; asserting a revenue decline in its bear case on that evidence would be a fabrication. Microsoft fires A only — and its $265 bear contains margin reversion and no revenue decline, which under the earlier single-trigger wording made the document's own worked example violate its own mandatory rule. NVIDIA fires both: its margin is a ten-year maximum *and* it has cut its operating margin 21 points in a single year within the window. That is the distinction the split encodes.

Rationale (NVIDIA, 4 Sep 2026): the classification rules could not separate "high-growth profitable" from "cyclical at peak", because those two profiles share every observable fact except margin variance. Forcing a label was the wrong response; running both sets of diagnostics was the right one.

The three running examples sit in three different rows on purpose. If your method cannot tell them apart, it is not a method.

---

## 2. The approaches, one by one

For each: what it is, what it assumes, when it works, when it lies.

### 2.1 DCF (discounted cash flow)

**FACT [S]:** Given a forecast of free cash flow to the firm, a discount rate and a terminal value, present value is arithmetic. Enterprise value − net debt − other claims (preferred, minority interests, pension deficits, finance leases; operating leases only under the condition in the box below) = equity value; ÷ diluted shares = value per share. For any company expected to raise equity, the share count is the *post-financing* count in that scenario, not today's.

**Enterprise value definition [S], one definition only, applied to every company:**

> EV = market capitalisation + total debt + **finance** lease liabilities − cash and marketable debt securities − non-operating equity investments.
>
> **Operating leases [S]:** included only if operating lease cost is also removed from operating expense and the asset capitalised. Adding the liability while leaving the rent in opex double-counts the cost. The default is the consistent treatment above — operating leases stay in opex and out of the bridge — with the operating-lease-inclusive net-debt ratio shown as a memo in the §3.4 leverage test.
>
> Market capitalisation = the most recent **shares outstanding** from the filing cover page or balance sheet, **plus** the treasury-method dilution from options, RSUs and warrants per the equity note. Not the weighted-average diluted share count, which is a backward-looking average of the period.
>
> The equity bridge reverses this exactly: equity value = operating EV + cash + investments − debt − finance leases. Non-operating investments are carried at **book value** for both companies and both directions, with the carrying value and the direction of the likely error stated beside it.

Rationale: in the manual tests, Microsoft's EV left equity investments inside and NVIDIA's took them out; both used the weighted-average diluted count. The amounts were small (≈1% and ≈0.4%) but a valuation system cannot hold two definitions of its own central quantity.

**ASSUMPTION:** revenue path, margin path, reinvestment needs, discount rate, terminal growth or exit multiple, forecast horizon.

**INFERENCE:** the value per share, and, more usefully, the share of value sitting in the terminal.

Works well when FCF is positive, reasonably predictable, and reinvestment is tied to growth in a way you can see in history. Microsoft qualifies.

Misleading when:
- Terminal value is >75% of total value (caution) or >85% (the model is largely terminal value). Then the "DCF" is just a terminal multiple with ten years of decoration in front of it.
- FCF is negative for most of the forecast. Every year is a guess and the terminal is 100% of value. OKLO.
- Margins are at a cyclical peak and you extrapolate them. NVIDIA risk.
- Growth exceeds the discount rate for long stretches; the maths still works but the value becomes hypersensitive to the year growth stops.

Microsoft illustration: revenue $332B (FY26), operating margin 46.8% — its ten-year maximum — but capital spending has pushed cash flow well below net income. A DCF that uses current FCF understates it; one that ignores the spending overstates it. The honest version forecasts capital intensity normalising and asks *when*.

### 2.2 Reverse DCF

**FACT [S]:** same arithmetic, inverted. Hold price, discount rate and terminal fixed; solve for the growth rate (or margin) that makes present value equal price.

**ASSUMPTION:** discount rate, terminal assumptions, which variable you solve for.

**INFERENCE:** "The market price requires roughly X% revenue CAGR for 10 years at Y% margins." That is a sentence you can judge; "fair value is $412" is not.

Works for anything with positive cash flow. It is the single most useful tool for Microsoft and NVIDIA because it removes the temptation to pick inputs that confirm a view. You are forced to argue with the market's inputs instead of your own.

Misleading when you solve for one variable while quietly fixing another at a flattering level. Solve for growth at several margin levels — three, mandatory whenever §1 trigger A or B has fired.

For OKLO the reverse DCF becomes a **"what has to be true" calculation**: at a chosen future year, discount rate and exit multiple, what revenue and margin must exist for today's market cap to be justified? Then ask what that implies in reactors built, MW deployed and price per MWh. That is answerable. A DCF is not.

### 2.3 P/E

**FACT [S]:** price ÷ earnings per share, trailing or forward. Also: the inverse, earnings yield.

**ASSUMPTION (hidden):** that earnings are representative, that growth and risk are similar to whatever you compare the P/E against, and that earnings convert to cash.

**INFERENCE:** relative cheapness vs peers, own history, or the market.

Works for mature, profitable, low-cyclicality companies with clean accounting.

Misleading when:
- Earnings are cyclical. NVIDIA's same price is 15× or 68× earnings depending on which revenue year and which margin you assume. A single P/E carries almost no information there.
- Earnings contain material non-operating gains. NVIDIA recognised ~$24B of equity-investment gains in one half-year; Microsoft ~$5.0B from OpenAI in FY26. **Rule [S]: where non-operating gains exceed 5% of pre-tax income, the P/E is computed on NOPAT and the GAAP version is shown only with the gain quantified beside it.**
- One-offs, tax changes, or large buybacks distort EPS.
- Comparing companies with different capital intensity or leverage. P/E ignores debt.
- Earnings are negative or near zero. The number is meaningless.

A justified P/E can be derived rather than eyeballed: trailing P/E ≈ payout × (1+g) ÷ (r−g). Two conditions or it produces nonsense: payout and growth are not independent (sustainable payout ≈ 1 − g/ROE), and "payout" must include buybacks. Use it to back out the growth a P/E implies, not to set a target.

### 2.4 EV/EBITDA

**FACT [S]:** enterprise value (per the §2.1 definition) ÷ EBITDA.

**ASSUMPTION (hidden):** that EBITDA approximates cash generation and that peers are comparable.

**INFERENCE:** capital-structure-neutral relative valuation.

Misleading when:
- Capex is large and recurring. EBITDA ignores it. EV/EBIT or EV/(EBITDA − maintenance capex) is safer.
- Stock-based compensation is large and excluded. It is a real cost.
- Lease-funded capacity is material. EBITDA before lease depreciation and interest flatters an operator that leases what a peer buys.
- EBITDA is negative or tiny. OKLO: undefined.
- Peers have different growth rates. A low EV/EBITDA on a shrinking company is not cheap.

### 2.5 EV/Revenue

**FACT [S]:** EV ÷ revenue.

**ASSUMPTION (hidden and large):** a future margin. EV/Revenue = EV/Profit × margin. Anyone quoting a revenue multiple has assumed a margin whether they know it or not.

**INFERENCE:** only meaningful when paired with an explicit margin assumption and a growth rate.

Works as a last resort when profits are temporarily suppressed by deliberate investment and the mature margin is visible from peers.

Misleading almost everywhere else. Pre-revenue: undefined — OKLO's EV/revenue runs into the thousands and the denominator itself could not be isolated to a single quarter from the filing. That is a statement about the denominator, not the company. Use "EV ÷ revenue in year N" from your scenarios instead.

**Rule for Calboard: never surface EV/Revenue on its own. Surface it with the implied margin needed to reach a normal profit multiple.**

### 2.6 FCF yield

**FACT [S]:** free cash flow ÷ market cap. Define FCF explicitly:

> Cash FCF = operating cash flow − cash capex. This is what the company generated in cash and is reported as such.
>
> FCF after lease-funded capacity = cash FCF − **finance-lease right-of-use assets obtained in the period**. This is the economic number and both are shown, because a company that leases its growth reports a cash free cash flow it has not economically earned.
>
> Unlevered FCF = NOPAT + D&A − cash capex − finance-lease ROU additions − ΔNWC.
>
> SBC and working-capital swings are shown separately in all three.

The lease term is the change from v0. Capacity funded by lease does not appear in cash capex and its principal repayment sits in financing, so a company that leases its growth reports a free cash flow it has not earned.

**Pairing rule:** OCF − capex is after interest, so it is an equity-holder cash flow and pairs with market cap. For a yield on EV, use unlevered FCF. Mixing the two is negligible for net-cash companies and wrong for levered ones.

**ASSUMPTION:** whether current FCF is representative; how to treat SBC.

**INFERENCE:** a direct cash return you can compare with a bond yield or your required return.

Misleading when capex is temporarily elevated or starved; when working capital moves are large and one-directional; when SBC is added back silently; or when the company is pre-FCF, where the yield tells you burn, not value.

### 2.7 P/B

**FACT [S]:** price ÷ book value per share.

**INFERENCE:** justified P/B ≈ (ROE − g) ÷ (r − g).

Works for banks, insurers, and asset-heavy businesses where book is a real thing. Misleading for asset-light businesses. Skip for all three running examples.

### 2.8 NAV / sum-of-parts

**FACT [S]:** value of identifiable assets less liabilities, each valued separately.

**INFERENCE:** a floor or a reference for conglomerates, REITs, resource companies, holding companies.

For OKLO, NAV collapses to one useful number: **net cash per share**, computed on the most recent share count and adjusted for burn between the balance-sheet date and today. That is the floor value if the technology never commercialises and the company winds down (in practice lower, because burn continues). Everything above cash is option value on future reactors.

### 2.9 Scenario-based (probability-weighted) valuation

**FACT [S]:** given scenario values V₁…Vₙ and probabilities p₁…pₙ, expected value is Σ pᵢVᵢ. Deterministic. Each Vᵢ is per *current* share, so a scenario that requires equity raises is valued on its post-financing share count and then expressed per today's share.

**ASSUMPTION:** the scenarios themselves and the probabilities. Both are pure judgment, and the probabilities are the weakest input in the whole methodology.

**INFERENCE:** the distribution of outcomes and where the price sits within it.

#### Implied probability (preferred for pre-revenue) [S]

Instead of guessing probabilities, hold the price fixed and solve for the probability the market requires:

> p_implied = (Price − V_fail) ÷ (V_success − V_fail)

**Basis rule (mandatory).** V_fail and V_success must be on the **same basis**: both a present value as of today, both per **current** share, both after the same dilution treatment. A failure value expressed as cash in a future year cannot be subtracted from a success value discounted to today.

> V_fail = (net cash at the decision point, less wind-down costs) ÷ current shares, **discounted to today.**

Each value is discounted at **the rate appropriate to its own risk**, and both rates are displayed. Forcing one rate onto both would contradict the leverage precondition in §3.4: a wind-down cash balance is an unlevered claim and takes the unlevered band, while a success case funded by project debt is a levered residual and takes the levered rate. "Same basis" means same date, same share base and same dilution treatment — not the same discount rate.

**Three defined states [S].** The formula is degenerate outside one of them, and the software must return the state, never a raw number:

| Condition | State returned | Meaning |
|---|---|---|
| V_fail < Price < V_success | the probability, rounded to the nearest 5% | the price implies roughly this chance of that outcome |
| Price ≥ V_success > V_fail | **PRICE NOT JUSTIFIABLE BY THIS OUTCOME** | even certainty of this success does not support the price |
| V_success ≤ V_fail | **THIS SUCCESS IS WORTH LESS THAN FAILURE** | the outcome destroys value; scale does not help |

The third state is a finding, not an error. In the OKLO rerun two of six success definitions returned it — values of **$0 and $1 against a $3.10 failure value** — because reactors cost approximately what they are worth once running. Rows in that state are the most informative output the model produced and must be displayed, not dropped.

Probability is reported **per success definition, never as one number.** Six definitions gave six answers; "implied probability of success" is meaningless without saying which success.

The probability-weighted mean is kept only as a distribution display, never as a headline value. Three hand-chosen probabilities multiplied by three modelled values is how a guess acquires two decimal places.

Misleading when probabilities are tuned until the weighted value lands near the price; when "scenarios" are the same story with growth ±5%; or when the expected value is reported without the distribution.

---

## 3. Choosing assumptions without guessing

The fix is not better intuition; it is anchoring every assumption to something observable and writing down the anchor.

### 3.1 Revenue growth

Anchors, in rough order of weight:
- **Base rates (FACT, [S] if data available):** historical distribution of growth rates for companies of similar revenue size. Sustaining >15% CAGR for a decade from a revenue base above ~$100B is historically rare.
- **Own history (FACT):** 3, 5, 10 year CAGR, and whether growth is decelerating. **Computed on a consistent accounting basis.** Where an accounting standard changed within the window (ASC 606 for Microsoft at FY2016/17), use restated figures for every year or shorten the window — and say which was done, because the two give different answers. Microsoft: 14.6% on the mixed basis originally used, **13.8%** on a restated FY2016, **14.7%** on the nine-year FY2017–FY2026 window that needs no restatement. The rule is about disclosing the basis, not about a single correct number; all three are defensible once labelled, and the mixed-basis one is not.
- **Consensus (FACT):** not truth, but a reference for what is already priced.
- **Driver decomposition (ASSUMPTION built from FACTS):** units × price, or TAM × share × penetration.
- **Fade rule (ASSUMPTION, [S] as a default):** growth converges toward nominal GDP (2–4%) over the forecast horizon.

**Base-year rule [S]:** where sequential revenue growth exceeds ~10%, the annualised latest-quarter run-rate is shown alongside TTM for revenue, NOPAT, every multiple and the steady-state value. NVIDIA's TTM understated its run-rate by 27%, so every "current" multiple was overstated by that much.

**[C] role:** check the chosen path against base rates and history, and say in plain English what would have to be true. Not choose it.

### 3.2 Margins

Anchors:
- **Own history (FACT):** ten-year range of gross, operating and FCF margin, **the ten-year median, and the worst single-year change**, all displayed beside the current margin as standard.
- **Structural ceiling (INFERENCE):** gross margin caps operating margin; opex as % of revenue tends to fall with scale.
- **Peer terminal margins (FACT):** what do the most mature comparable businesses earn at steady state?
- **Cyclicality check (FACT → INFERENCE):** the base case must not hold a margin sitting at the top of the company's own history. **The triggers are defined once, in §1** (A: at or within 2 points of the window maximum with a range above 15 points; B: an observed single-year decline above 10 points). The earlier "top decile" wording here was a second, different trigger for the same test and is deleted.

### 3.3 Reinvestment

The consistency check almost every retail DCF fails: **growth is not free.**

- **Rule (deterministic, [S]):** reinvestment rate ≈ growth ÷ return on *new* invested capital.
- **Reinvestment is measured on the full capital base [S]:**

> Reinvestment = capex + acquisitions + **finance-lease right-of-use assets obtained in the period** − D&A (which already contains finance-lease ROU amortisation) + ΔNWC.
>
> Use the *ROU assets obtained* disclosure, not the year-over-year change in the lease liability: the change nets off principal repayments and understates the period's investment. For Microsoft FY26 the ROU additions were $24.6B against a $20.4B liability change. Operating-lease additions are excluded on the same consistency rule as the EV bridge.

  Microsoft FY26 illustrates why the lease term is not optional. Reinvestment is 66% of NOPAT on cash capex alone and **86%** once the **$24.6B of finance-lease ROU assets obtained** are included. The implied return on new capital at FY26's 18% growth is **20.9%**, not 27.2% — a six-point move on the definition alone. Read alongside the computed anchors below (**17.8%** five-year, **22.0%** excluding ~$69B of Activision goodwill), it is the whole empirical basis for a base-case RONIC assumption. Corroboration that this is the right measure: management guided FY27 to ~$175B of *capex including finance leases*, so the company already reports on the combined basis.
- **Return on new capital (RONIC) is computed, not chosen [S]:**

> RONIC = trailing five-year change in NOPAT ÷ trailing five-year change in invested capital, invested capital including lease-funded assets.

  **RONIC state ladder [S].** The ratio is meaningless, or the model that consumes it degenerates, outside a narrow band. Evaluated in order, the software returns a state rather than a bare number:

| Condition | State | Effect |
|---|---|---|
| Δ invested capital ≤ 0 | **RONIC NOT MEANINGFUL** | No incremental return exists to measure. Diagnostic reverse DCF returns **NOT COMPUTABLE**. |
| Δ NOPAT ≤ 0, or computed RONIC ≤ 0 | **RONIC NOT MEANINGFUL** | A negative RONIC makes reinvestment negative, so the model treats growth as a *source* of cash and free cash flow exceeds NOPAT — a company that built capacity while earnings fell would be reported as cheap because growth pays for itself. Diagnostic reverse DCF returns **NOT COMPUTABLE**. |
| 0 < RONIC < the rate being used | **LOW RONIC — VALUE-DESTROYING GROWTH** | **Not invalid — a finding.** Growth earning less than the cost of capital destroys value, and the reverse DCF's value function is then *decreasing* in growth. The cell is computed and returned carrying the flag and the direction of the value–growth relationship. Where value decreases in growth the figure is additionally labelled **INVERTED — HIGHER GROWTH LOWERS VALUE** and read as a ceiling, not a floor. |
| RONIC > 200% | computed at 200%, labelled **RONIC CAPPED AT 200%** | Makes explicit the cap the reruns applied silently. It bounds a ratio whose denominator is near zero. A display guard, not a valuation. |
| otherwise | computed | — |

  The ladder is evaluated **per grid cell**, because "the rate being used" differs across the 8 / 10 / 12% grid: a company with a computed RONIC of 9% is fine in the 8% column and LOW RONIC in the other two. The CAPITAL-LIGHT flag below is independent of the ladder and can fire alongside the cap.

  **Degenerate solver outputs [S].** Independently of the ladder, the diagnostic reverse DCF returns a state rather than a number when:
  - the solver's search bracket contains no solution — **NO SOLUTION IN RANGE**, reported with the bracket and the value at each end;
  - the value function is not monotone in growth across the bracket, so bisection has no defined answer — **NOT COMPUTABLE**;
  - the terminal share of value exceeds 100%, meaning the explicit period's present value is negative and the growth the price "requires" is a decade of cash burn — **DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE**. Four Microsoft cells on the v1.0.1 grid are in this state and were printed as numbers with a warning glyph. Returning the state is this document's own principle and it applies to itself.

  When RONIC is NOT MEANINGFUL everything not built on it still runs: PVGO, every multiple, the history and margin diagnostics, and any terminal share produced by another route.

  Where the computed value exceeds 60%, the software flags **CAPITAL-LIGHT** and additionally expresses reinvestment as **working-capital intensity (ΔNWC ÷ Δrevenue)**, because for a fabless or asset-light business the g ÷ RONIC rule is not wrong, it is simply not where the capital goes. NVIDIA's growth consumes working capital and TSMC's capital, not its own; its RONIC computes above 200% and the rule went inert in the manual test, moving value by 11% across a 50%–500% range.
- **FACT anchors:** historical sales-to-capital ratio, historical ROIC, capex + lease additions + R&D as % of revenue.
- OKLO: reinvestment is the whole story. Reactor capex per MW, financing of that capex, and the resulting dilution or debt are the model. See §3.6.

### 3.4 Discount rate

Do not build a WACC to two decimal places. Betas are noisy, the equity risk premium is contested, and false precision here infects everything downstream.

- **Bands (ASSUMPTION, fixed by policy, [S]):** ~8–9% for large, stable, low-leverage compounders; ~10–12% for high-growth or cyclical profitable companies.
- **Pre-revenue, one rule only:** failure risk lives in the scenario probabilities (or the implied probability), not in the discount rate. Discount each scenario's cash flows at the band a going business of that type would earn (~10–12%). Do not also apply a venture-style hurdle; that counts the same risk twice.
- **Safeguards:**
  1. The same rate is used in the DCF, the reverse DCF and the steady-state value for a given company. Never change the rate to move the answer.
  2. Rate minus terminal growth must be at least ~4–5 points, or the Gordon terminal becomes explosive and meaningless.
  3. The bands are nominal USD rates for nominal USD cash flows. Do not mix real and nominal.
  4. **LEVERAGE PRECONDITION TEST (computed, [S], not asserted).**

     > Compute: net debt ratio = (total debt + **finance** lease liabilities − cash and marketable debt securities) ÷ enterprise value, consistent with §2.1. The operating-lease-inclusive ratio is shown beside it as a memo.
     >
     > **< 10% → PASS.** The band may be applied to firm cash flows as an approximate cost of equity.
     >
     > **≥ 10% → FAIL → LEVERAGE UNSUPPORTED IN v1.** Every rate-dependent output returns that state and no number: the scenario DCF and its value per share, the diagnostic reverse DCF, steady-state EV and PVGO, the implied exit multiple, the ±1% rate sensitivity, the rate at which the base case equals the price, and the fair-value range. What still displays: the ratio itself, all facts, every multiple that is arithmetically defined, the history and margin diagnostics, the three FCF definitions, the run-rate comparison and the 52-week range.
     >
     > The two remedies earlier versions offered — build a WACC, or switch to equity cash flows at a levered cost of equity — are **both excluded by §10**. Naming a remedy that does not exist is how a safety test comes to be ignored, so v1 refuses instead. Both remedies are v2 scope.
     >
     > **Fail closed.** Where the inputs needed to compute the ratio are missing, the state is LEVERAGE UNSUPPORTED IN v1, not PASS.
     >
     > **A cash flow that is a residual after debt is a separate case and is not refused**, because it has a working remedy. It is levered by construction regardless of the company-level ratio, and this includes every pre-revenue success case in which project debt or customer prepayments fund the asset. For those:
     >
     > r_equity = r_unlevered + (r_unlevered − r_debt) × D/E, with D and E measured at the exit year.

     The test result is displayed. Microsoft passes at 0.8% (net debt of $30.0B once $66.6B of finance leases are counted, against a $3.78T EV) — but it passes *as a computed result*, and the sign of its net cash position flips once leases are included, which the manual test asserted away. The operating-lease-inclusive memo is 1.37%, also PASS. NVIDIA passes at −0.4%. OKLO passes today and **fails in every success case**: at 60% project debt, D/E at exit runs 0.20–3.95 across the six success definitions, giving levered costs of equity from 12.0% up to the 30% cap, against the flat 11% originally used.
  5. Always show ±1% sensitivity. On the v1.0.1 reruns: Microsoft, with r − g ≈ 5.5 points and a 68–75% terminal share, moves **+27% / −18%** per point; NVIDIA, with a 42–52% terminal share, moves **+14% / −11%**. Both calibration companies now sit outside the "normal 15–25%" band recorded in Appendix B — one above, one below — which is the clearest evidence that the band is not measuring what it was meant to measure.

     **This sensitivity is close to a deterministic function of terminal share, not an independent signal about the company.** It is reported beside the terminal share, with that stated, and it is not used as a standalone red flag.

### 3.5 Terminal assumptions

The terminal is where DCFs go to hide their sins.

- **Terminal growth (ASSUMPTION, bounded [S]):** never above nominal GDP; ideally at or below the risk-free rate. Anything above 3–3.5% is a red flag. **Policy default: 3.0%.**
- **Terminal returns.** In the **scenario DCF**, terminal ROIC is an analyst input with a written anchor and must fade toward the cost of capital unless a durable moat is argued explicitly. In the **diagnostic reverse DCF** (§6.2) it is not an input at all: it is fixed by rule at **r + 3 percentage points (PROVISIONAL — see Appendix B)**.
- **Terminal cash flow must be internally consistent (deterministic, [S]):** terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC). Do not take final-year FCF × (1+g). On the v1.0.1 Microsoft base case this is worth **4.5%** of value ($399 consistent vs $417 naive; it was 7% at the higher RONIC originally assumed), so it earns its place even for a mature company.
- **Cross-check both ways (deterministic, [S]):** compute the exit multiple implied by your Gordon-growth terminal and compare with today's multiples; compute the growth implied by an exit multiple you consider reasonable.

  **The implied exit multiple is labelled by the metric it actually divides.** In the manual test a row headed "terminal value / FY36 revenue" was in fact terminal value ÷ FY36 **EBIT**, so the required cross-check was never performed. Performed correctly it is informative: Microsoft's terminal implies EV/EBIT falling from **24.4× today to 10.8–12.5× in FY36** — the model assumes substantial multiple *compression*, which supports rather than undermines the base case, and nobody saw it.
- **Terminal share of value (deterministic, [S]):** report it every time. With a ten-year explicit period, 60–75% is normal for a healthy mature company. Treat >75% as a caution and >85% as the model being a multiple in disguise. A **low** terminal share is also information: NVIDIA's 42–52% says its value lives in FY28–FY31, not in perpetuity, and that the stock should be more sensitive to guidance than to interest rates.

### 3.6 Pre-revenue funding stack (new in v1.0)

Capital expenditure in a pre-revenue success case is funded, in this order, and the software must show all four lines:

> 1. **Project debt** (ASSUMPTION: share of capex, and cost)
> 2. **Customer prepayments and non-dilutive funding** (FACT where contracted, ASSUMPTION otherwise)
> 3. **Retained operating cash flow from assets already in service** (INFERENCE from the capacity ramp)
> 4. **New equity — the residual, not the first resort**

**Line 3 is mandatory and was missing from the OKLO manual test**, which funded every dollar of an eight-year fleet build from debt and new equity while the plants already running contributed nothing. On the corrected timed model the 8 GW utility-multiple case is worth **$31** per current share on the back-loaded reference ramp and **$48** on the steady ramp, against a $40.16 price — versus $34 as originally published. The headline conclusion that this outcome does not support the price **survives on the back-loaded ramp and fails on the steady one**, which is why both are mandatory. An untimed correction of this model gives $58 and looks like a reversal; that number is wrong, and the reason it is wrong is the timing rule below.

Line 3 requires an explicit **capacity ramp** (ASSUMPTION, displayed): the profile of capacity entering service between first power and the exit year. **Two ramps are always shown — back-loaded and steady — because the spread between them is the honest uncertainty**, and because the back-loaded case is the conservative one and should be the reference.

**Timing rule [S], without which line 3 is wrong in the generous direction.** The funding stack is solved **year by year**, not in aggregate:

> Construction cash spend **leads capacity in service** by an explicit build period (PROVISIONAL default: two years). New equity is raised **only in the years the cash balance would otherwise go negative**, and only in the amount needed.

Solving the stack in aggregate lets cash flow from the last reactors pay for the first ones. On OKLO that error is worth $27 per share on the 8 GW case — larger than most of the assumptions the analysis argues about.

Retained cash flow is computed after cash operating costs, corporate overhead, interest on drawn project debt, and tax.

---

## 4. Constructing bear, base and bull scenarios

A scenario is a coherent world, not a dial.

Rules:
1. **Start from the narrative, then set drivers together.** Moving growth alone while holding everything else is a sensitivity, not a scenario.
2. **Bear is plausible-bad, not apocalypse**, unless apocalypse is genuinely plausible. Where §1 trigger **B** has fired the bear must contain an actual revenue **decline**; where only trigger **A** has fired the bear must contain **margin reversion**. Requiring a revenue decline on trigger A alone would assert cyclicality the evidence does not support.
3. **Base should sit near the centre of your honest probability mass.**
4. **Assign probabilities, then stress them.** Shift 10 points from base to bear; if the conclusion flips, the analysis is fragile and you should say so.
5. **Locate the price.** Which scenario does today's price most resemble? That single sentence is often the whole analysis.
6. **Where the guided or known near-term path is not a constant growth rate, scenarios use explicit year-by-year revenue paths, not a growth rate.** NVIDIA's guided year made a fixed-shape growth assumption meaningless; explicit paths handled it cleanly and produced the most informative object in the three tests, a bear case with an actual revenue decline.

Running examples, in structure not numbers:
- **Microsoft:** three worlds differ in cloud/AI growth, capital-intensity normalisation timing, and terminal margin. Values landed within a 2× band ($265–553 on the v1.0.1 reruns; $286–578 as originally published). That narrowness is itself a finding.
- **NVIDIA:** worlds differ mainly in the *durability* of margins and the shape of the data-centre capex cycle: sharp cyclical peak and normalisation vs plateau vs continued growth. Values spanned 3.5× ($69–243). Terminal margin, not near-term growth, is the crux.
- **OKLO:** worlds differ in *whether* commercial power is ever sold, *when*, and *how much dilution* it takes. The weighted mean is close to useless; the shape of the distribution and the funding stack are the analysis.

---

## 5. Sensitivity analysis: what it is for

Sensitivity is a research-allocation tool, not a range-generation tool.

- **One-at-a-time (tornado), [S]:** move each input across a plausible range, record the swing in value, rank. The top 2–3 inputs are where research time goes.
- **Two-way tables, [S]:** value across growth × margin, and across discount rate × terminal growth. **Each row and column of a two-way table must be a coherent path, not a spliced one.**
- **Suppress by profile [S]:** an input whose full plausible range moves value by less than ~10% is not displayed. NVIDIA's RONIC (50%–500%) and terminal-ROIC sensitivities each moved value under $25 on a $148 base and printing them implied a precision the model did not have.
- **What to look for [C]:** hypersensitivity is a signal the model is fragile, usually because the terminal dominates or because growth and discount rate are close.
- **Anti-pattern:** presenting a sensitivity table whose range spans the current price as evidence of "fair value". A wide enough table always contains the price.

---

## 6. Inferring what the price already assumes

This is the standard, deterministic output for every profitable company in Calboard, because it is the most honest thing a tool can say without issuing a verdict.

Three calculations, all [S]:

**1. Steady-state value and PVGO, on an enterprise basis.** Steady-state EV = normalised NOPAT ÷ discount rate. PVGO = current EV − steady-state EV. PVGO ÷ EV is the fraction of value that is a bet on future growth. The comparison must be EV to EV, and NOPAT must be normalised. Whenever §1 trigger A or B has fired, both current and normalised are shown with the gap called out: Microsoft's gap was 4 points (61% → 65%), NVIDIA's was 14 (72% → 86%). Suppressed where there is no NOPAT to normalise, and where LEVERAGE UNSUPPORTED IN v1 is active.

**2. Implied growth (diagnostic reverse DCF) — every input is a filed fact or a policy rule.**

> **Policy constants, identical for every company:**
> - Path shape: constant growth years 1–5, linear fade to terminal growth by year 10, terminal thereafter.
> - Terminal growth: 3.0%.
> - Terminal ROIC: **r + 3 percentage points — PROVISIONAL** (encodes "moat fades but does not vanish"; not an analyst input). The level is a policy choice validated on two companies only; what matters for comparability is that it is the same rule everywhere. Revisit as companies are added.
> - Rate grid: **8% / 10% / 12% for every company**, with the profile's own band marked on the grid.
> - Margin levels: current, ten-year median, and one stress level.
>
> **Computed from filings, not chosen:**
> - RONIC, per the §3.3 formula, printed beside every implied-growth figure **together with its state**. Where the state is RONIC NOT MEANINGFUL the cell returns **NOT COMPUTABLE**; where it is LOW RONIC the cell is computed and carries the flag; where the cap applied the cell says so. Degenerate solver outputs return their own states per §3.3.
> - Base-year revenue: TTM, plus run-rate where §3.1 requires it.
>
> **Reported as:** years 1–5 growth **and** the equivalent ten-year CAGR **and** the year-10 revenue. The five-year figure alone reads as far more demanding than the same path actually is: on the v1.0.1 grid Microsoft's price requires **18.5% for five years at r = 8%, which is a 13.7% ten-year CAGR** — at the low end of its own 13.8–14.7% history, not above it.

The v0 claim that a fixed path shape made this number "comparable across companies" was false, because RONIC, terminal ROIC and the discount rate were all still set per company — Microsoft's implied growth was 17.2% at its own parameters and 13.0% at NVIDIA's, a 4.2-point gap with no company content. Under this version the honest claim is narrower and true:

> **Comparability claim:** the same rule generated every number. The numbers are not independent of the company's capital intensity, which is why RONIC is printed beside every one of them.

**3. Implied exit multiple.** What multiple must the company trade at in year 5 or 10 for the price to deliver your required return? Labelled by the metric it divides.

**[C] role:** translate these into a sentence and compare with base rates and history. That is information. It is not a recommendation.

For OKLO the equivalent is the "what has to be true" table: for a given exit year and multiple, required revenue → required MW deployed → required reactors → compare with announced timelines and manufacturing reality. **Preceded by the unit-economics breakeven test (§8.6), which decides whether any scale can justify the price before scale is solved for.**

---

## 7. How valuation differs by stage

| | Mature profitable (MSFT) | High-growth profitable (NVDA) | Pre-revenue (OKLO) |
|---|---|---|---|
| Central question | Is the growth durable and is capital spending earning its return? | Are current margins peak or plateau? | Will commercial revenue exist, when, and at what dilution? |
| Primary method | DCF + reverse DCF | Reverse DCF at several margin levels + scenarios on explicit paths | Implied probability of success + "what has to be true"; scenario distribution as display |
| What a point estimate means | Reasonable ±20–30% range | Wide range; report as range | Almost meaningless; report distribution and cash floor |
| Key deterministic diagnostics | FCF yield vs growth, PVGO share, terminal share, own-multiple history (suppressed under HISTORY INSUFFICIENT) | Normalised margin P/E, PVGO share on normalised NOPAT, margin sensitivity, run-rate vs TTM | Cash per share, burn, runway, unit-economics breakeven, implied future revenue, funding stack, implied probability |
| Biggest trap | Accepting current depressed FCF, or ignoring lease-funded capacity | Extrapolating peak margins; treating a spoken outlook as guidance | Pretending a DCF is possible; funding a fleet entirely from new equity |
| Where judgment concentrates | Capital-intensity normalisation timing | Margin durability | The prize, not the odds: exit multiple and fleet scale |

A practical implication before any software: for a pre-revenue holding, the valuation question is secondary to the sizing question. No methodology turns OKLO into a number you can trust; it can only make the bet explicit.

---

## 8. Cross-checking the primary method

Triangulation, not averaging.

1. **Implied multiples from the DCF vs today's and peers'.** Labelled by the metric they divide.
2. **FCF yield plus growth vs required return.** Expected return ≈ FCF yield + long-run FCF growth. **Precondition test [S]: (capex + lease additions) ÷ D&A between roughly 0.8× and 1.5×, and FCF conversion within its own ten-year normal range.** On failure the output is **PRECONDITION FAILED / NOT APPLICABLE**, never a number. This check failed on both companies where it was defined — Microsoft (**3.65×** capital additions to D&A on the lease-inclusive measure, producing a meaningless 0.5% + 14% against an 8.5% rate) and NVIDIA (2.1×, with $35B absorbed by receivables and inventory). Two failures out of two is why it is a conditional output rather than a standard one. It is the Gordon identity rearranged, so it checks internal consistency rather than offering an independent opinion.
3. **Own historical multiple range.** Deterministic. **PEAK-EARNINGS-warned or suppressed where §1 trigger B has fired; suppressed entirely under HISTORY INSUFFICIENT; window length printed beside it under SHORT HISTORY.**
4. **Market-implied vs your assumptions (§6).** Where you disagree with the market, name the assumption and the reason.
5. **Market cap vs the total profit pool.** What share of the industry's plausible future profits does the price require? Often the fastest way to catch absurdity, and the only multiple-like check that works for a pre-revenue company.
6. **Unit-economics breakeven (pre-revenue, mandatory step, not optional [S]).** For an owner-operator, a unit of capacity is worth building only if its exit value exceeds its cost. Solve for the output price at which exit value equals capex, across a grid of capex-per-unit and exit multiples, before solving for scale. If each unit destroys value, **no scale justifies the price and the "what has to be true" solver must return NOT ACHIEVABLE AT ANY SCALE** rather than a very large number. For OKLO this produced the finding that at ≥$8,000/kW and $110/MWh at a contracted-power multiple, every gigawatt destroys value.

**Reconcile, do not blend.** When methods disagree, find the assumption that explains the gap. That assumption is your thesis.

---

## 9. Mistakes that look rigorous but are weak

1. **False precision.** Value to the cent, WACC to two decimals. **Rounding policy [S]: scenario and success values to the nearest $5 (or 1% of price, whichever is larger); probabilities to the nearest 5%; growth and margin to 0.1pt.**
2. **Terminal dominance hidden by a long forecast.** Ten years of detail, >85% of value in year 11+.
3. **Growth without reinvestment.** High growth and high FCF conversion at the same time with no RONIC justification — including growth funded by leases that never appear in capex.
4. **Peak-cycle extrapolation.** Current margins held flat when they sit at the top of their own history.
5. **Double-counting risk** in both discount rate and cash flows — **or counting it in neither**, which is the error that actually occurred: a levered residual discounted at an unlevered rate.
6. **Consensus as truth.** Consensus is what is priced, not what is right. **And never derive a consensus figure from the price**: an EPS computed as price ÷ a quoted forward multiple carries no information, and a "cheapest of the megacaps" claim built on it is circular.
7. **Comparing multiples across different capital intensity, accounting or growth** and calling it "relative valuation."
8. **Silently adding back SBC** to FCF.
9. **Tuning scenario probabilities** until the expected value confirms the prior.
10. **Ignoring dilution.** Equity raises are part of the base case, not a bear case — **and so is the operating cash flow that reduces them.**
11. **EV/Revenue on a pre-revenue or low-margin business** as if it were a valuation.
12. **Treating the DCF output as a fact.** It is an inference from assumptions; label it that way.
13. **Sensitivity tables as evidence.** Wide enough ranges always include the price.
14. **Assuming multiple expansion** as a return driver without saying so.
15. **Cost basis as an input.** The price you paid has zero bearing on what a share is worth.
16. **A calibrated threshold from a single observation.** The ±1% rate band was recalibrated on Microsoft and NVIDIA immediately fell outside it. Thresholds carry the sample they were calibrated on, and are labelled PROVISIONAL until three independent observations support them.
17. **A spoken outlook presented as guidance.** A directional comment on an earnings call, captured by a third-party transcript, is not published guidance, and figures derived from it by analysts or the press are two steps removed. Both are SECONDARY, and every figure derived from them inherits that label at every point of use.
18. **Two definitions of the same quantity.** Enterprise value, share count and free cash flow each get exactly one definition, applied identically to every company.

---

## 10. The Calboard method

Five steps, one of which is judgment.

**Step 0 — Gates, then classify [S recommends, you confirm].** Run **Gate 0** (supported profile) and **Gate 1** (history sufficiency) first; either can stop the analysis before Step 2. Then recommend a profile from §1 with the facts that drove it, and evaluate triggers A and B separately. You confirm or override; every override, its reason, and the fact that nothing under an overridden gate has been validated are recorded.

**Step 1 — Facts [S].** Pull: price **with its timestamp**; shares outstanding from the latest filing plus treasury-method dilution; net debt including finance leases (operating leases per §2.1); other claims; ten years of revenue, margins, capex, lease additions, FCF, share count and ROIC on a consistent accounting basis; current consensus. Compute EV per the single §2.1 definition. **Every figure carries FACT / ASSUMPTION / INFERENCE, its source, and whether that source is PRIMARY (a filing or a company-published document) or SECONDARY (a call transcript, press coverage, or an aggregator). A figure derived from a SECONDARY source is SECONDARY wherever it appears.** Any figure that cannot be verified is marked **UNVERIFIED** and is never replaced by an estimate.

**Step 2 — Diagnostics, always computed regardless of profile [S].**
- Multiples where defined (P/E trailing and forward on NOPAT where non-operating gains exceed 5% of pre-tax income, EV/EBIT, FCF yield on market cap) with own ten-year percentile — **warned under trigger B, suppressed under HISTORY INSUFFICIENT, window-labelled under SHORT HISTORY**.
- Ten-year margin range, median and worst single-year change, beside the current margin.
- 52-week range. For every company, without exception.
- Steady-state EV on normalised NOPAT and PVGO share of EV.
- Diagnostic reverse DCF per §6.2: the 8/10/12% grid, three margin levels, years 1–5 growth and ten-year CAGR and year-10 revenue, with RONIC printed beside.
- **SHAPE MISMATCH flag** where guided or known near-term growth differs from the implied constant by more than ~15 points. On a mismatch the scenario-based answer leads and the fixed-shape number is shown as secondary.
- Run-rate beside TTM where sequential growth exceeds ~10%.
- Terminal share of value and ±1% rate sensitivity, reported together.
- Implied exit multiple vs today's, labelled by the metric it divides.
- Leverage precondition test result (§3.4 safeguard 4).
- FCF yield + growth, or PRECONDITION FAILED.
- For pre-revenue: cash per share on the latest share count adjusted for burn to today; quarterly burn; runway; unit-economics breakeven; the four-line funding stack under both ramps; dilution required; implied probability per success definition in one of the three defined states.

**Step 3 — Analyst inputs [you, assisted by C].** Three coherent scenarios with drivers set together, each with its anchor written down, each with its own share count where financing differs; explicit revenue paths where a constant growth rate does not describe the company. Probabilities for profitable companies. For pre-revenue, probabilities are optional; the implied probability from Step 2 is the primary lens. Discount band and terminal growth from policy, not per-company fiddling.

**Step 4 — Outputs [S].** Scenario values, probability-weighted distribution (display only), tornado and two two-way tables with suppression by §5, location of current price within the scenario range, **the discount rate at which the base case equals the price**, and a fair-value range.

Fair-value range rules:
- Always a range, never a point. Bounds = bear and bull scenario values; the probability-weighted value is shown inside it, not as the headline.
- Always labelled INFERENCE, with the three inputs that drive it named beside it.
- Always shown next to the price-implied diagnostics from Step 2. The range says what you assume; the diagnostics say what the market assumes. Neither is shown alone.
- **Where trigger A or B has fired, the range carries a warning: the bounds are scenario labels, not confidence bounds.** NVIDIA's 3.5×-wide range says less than it appears to.
- **Where any suppressing state is active** — UNSUPPORTED PROFILE, LEVERAGE UNSUPPORTED IN v1, or a NOT COMPUTABLE reverse DCF — there is no fair-value range. The state is the output.
- For pre-revenue companies the "range" is the distribution summary — failure / success-as-commonly-described / success-as-the-price-requires — plus the cash floor. Do not compress it to bear/bull bounds.
- The range is not a verdict.

**Step 5 — Interpretation [C].** Plausibility of each assumption against base rates and history. Internal consistency flags. Plain-English statement of what the price requires. **No verdict, no target, no recommendation.**

**What is deliberately excluded:** WACC calculators with betas, Monte Carlo, forecast horizons beyond ten years, peer-set construction, any single-number fair value. Add any of these only if a manual test shows the simple version failing.

**What this method has not been tested on, and now refuses [S]:** the asset-based row (banks, insurers, REITs, reserve-based resources) is caught by **Gate 0**; genuinely levered companies are caught by the **leverage precondition**; companies with fewer than five filed years are caught by **Gate 1**. All three test subjects pass the leverage precondition comfortably — Microsoft at 0.8% is net *debt* once finance leases are counted, but only just. Earlier versions stated the untested scope in prose and gave software no way to enforce it; the gates are that enforcement.

**The states that suppress output, in one place [S]:**

| State | Trigger | What is suppressed |
|---|---|---|
| **UNSUPPORTED PROFILE** | Gate 0 | all valuation outputs |
| **HISTORY INSUFFICIENT** | Gate 1, < 5 filed years | own-history percentile; history-based normalisation (policy stress levels substitute); any cyclicality label |
| **LEVERAGE UNSUPPORTED IN v1** | §3.4 safeguard 4 FAIL, or its inputs missing | every rate-dependent output |
| **RONIC NOT MEANINGFUL** | §3.3 ladder rows 1–2 | the diagnostic reverse DCF (NOT COMPUTABLE) |
| **NOT COMPUTABLE / NO SOLUTION IN RANGE / DEGENERATE** | §3.3 degenerate solver outputs | the affected reverse-DCF cell |
| **PRECONDITION FAILED** | §8.2 | FCF yield + growth |
| **NOT ACHIEVABLE AT ANY SCALE** | §8.6 | the "what has to be true" solve |
| **SUCCESS WORTH LESS THAN FAILURE / PRICE NOT JUSTIFIABLE** | §2.9 | the implied probability for that definition |

Flags that qualify rather than suppress: LOW RONIC — VALUE-DESTROYING GROWTH, RONIC CAPPED AT 200%, CAPITAL-LIGHT, SHORT HISTORY, MARGIN AT HISTORICAL HIGH, PEAK EARNINGS, SHAPE MISMATCH, SEASONAL risk (unhandled in v1 — see caveats).

---

## Appendix A — Version history

| Version | Date | Basis |
|---|---|---|
| v0.1 | pre-4 Sep 2026 | Original draft. Pre-revenue primary = probability-weighted scenarios. Terminal-value threshold 70–75%. |
| v0.2 | 4 Sep 2026 | Pre-revenue primary changed to implied probability. Terminal thresholds split to 75% caution / 85% multiple-in-disguise. Version the **Microsoft** test ran against. |
| v0.3 | 4 Sep 2026 | Adds the three Microsoft-derived presentation rules (three-point rate band, recalibrated ±1% thresholds, FCF-yield precondition). Version the **NVIDIA** test ran against. |
| v1.0 | 4 Sep 2026 | Merged v0.3 with the four NVIDIA-derived and ten OKLO-derived presentation rules, which had been agreed but never written to any file, and applied the seven methodology changes required by the 4 Sep 2026 audit (G1–G7). Issued as `calboard-valuation-methodology-v1.0.md`; superseded within the day and that file should be deleted. |
| **v1.0.1** | **4 Sep 2026** | **This file.** Two amendments requested before first use: the **RONIC NOT MEANINGFUL** guard (§3.3) and terminal ROIC = r + 3 marked PROVISIONAL. Three further amendments forced while executing the v1.0 reruns, each a consistency fix rather than a new rule: the G7 basis rule now says same date / share base / dilution treatment but **each value at the rate appropriate to its own risk** (forcing one rate would contradict §3.4); the EV bridge takes **finance leases only** unless operating lease cost is also removed from opex; and reinvestment and FCF use the **ROU-assets-obtained disclosure** rather than the change in lease liability. Filename de-versioned so the file is edited in place. |

**Which version each artefact ran against** (recorded here because it was not recorded anywhere at the time, and that is what allowed three drafts to circulate at once):

| Artefact | Version it ran against |
|---|---|
| Microsoft manual test, 4 Sep 2026 | v0.2 |
| NVIDIA manual test, 4 Sep 2026 | v0.3 |
| OKLO manual test, 4 Sep 2026 | v0.2/v0.3 in substance — it used the implied-probability primary method, which v0.1 did not have |
| Cowork audit, 4 Sep 2026 | supplied with **v0.1**, the oldest draft — older than either test's own copy |
| Blocking reruns, 4 Sep 2026 | v1.0.1 (this file) |

| **v1.0.2** | **5 Sep 2026** | **This file.** Four blocking guard-and-state fixes from the independent red-team review: the **RONIC state ladder** with an explicit 200% cap and defined degenerate-solver states (B1); **LEVERAGE UNSUPPORTED IN v1** as a fail-closed state replacing two remedies §10 excludes (B2); **Gate 1 — history sufficiency**, which suppresses history-dependent outputs without licensing a cyclicality claim (B3); and **Gate 0 — supported profile**, a deterministic, fail-closed gate for financials, real estate and reserve-based resources (B4). Reconciliations forced by those four: the overlay split into trigger A (margin at high, a description) and trigger B (cyclical, a claim needing evidence); the duplicate §3.2 trigger deleted; §4's revenue-decline bear made conditional on trigger B. **No computed figure changed.** |

The v0.1–v0.3 copies survive only inside the source archives of the three tests. They are superseded and must not be worked from; `calboard-valuation-methodology-v1.0.md` has been deleted. **This file is edited in place and its filename never changes.**

## Appendix B — What is provisional

These thresholds are in use but calibrated on fewer than three independent observations. They are labelled PROVISIONAL in the interface and revisited as companies are added.

| Threshold | Value | Calibrated on |
|---|---|---|
| Shape mismatch | >15 points | NVIDIA only |
| Run-rate vs TTM trigger | >10% sequential | NVIDIA only |
| FCF-yield precondition | capex/D&A 0.8–1.5× | MSFT (3.65×) and NVDA (2.1×) — both failed |
| Terminal share caution / disguise | 75% / 85% | MSFT (68–75% on the v1.0.1 rerun), NVDA (42–52%) |
| ±1% rate sensitivity normal band | 15–25% | **MSFT (+27/−18, above), NVDA (+14/−11, below). Both calibration companies now fall outside the band — see §3.4 safeguard 5.** |
| Cyclical-at-peak overlay triggers | 2pt / 15pt / 10pt | MSFT, NVDA |
| Leverage precondition | 10% net debt / EV | MSFT (0.8%), NVDA (−0.4%) |
| Sensitivity suppression | <10% value swing | NVDA RONIC and terminal ROIC |
| RONIC capital-light flag | >60% | NVDA (>200%) |
| **Terminal ROIC in the diagnostic reverse DCF** | **r + 3 points** | **MSFT, NVDA only. The level is a policy choice, not a measured one; comparability comes from applying it identically, not from the number being right. Revisit as companies are added.** |
| Construction lead (pre-revenue funding stack) | 2 years between cash spend and capacity in service | OKLO only. Worth $27/share on the 8 GW case, so this is a first-order provisional input, not a detail |
| Levered cost of equity cap | 30% | applied where exit D/E is very high; crude, revisit. **Capped cells are not yet labelled — recorded as a v1 caveat, not fixed in v1.0.2** |
| History-sufficiency threshold | < 5 years INSUFFICIENT, 5–9 SHORT | red-team judgment, no observations. The direction of error is suppression, so a wrong threshold shows less rather than something false |
| RONIC cap | 200% | NVDA (>200%). Now explicit and labelled |
| LOW RONIC boundary | the grid rate in the cell | definitional, not calibrated — growth below the cost of capital destroys value by arithmetic |
| Gate 0 interest-income test | >50% of revenue | no observations; the other three Gate 0 tests are classification lookups, not thresholds |
| Policy stress margins under HISTORY INSUFFICIENT | current, −25%, −50% relative | no observations; substitutes for a median that does not exist |
