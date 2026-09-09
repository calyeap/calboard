# M8-c — valuation-position threshold calibration: STOP AND REPORT

**Status: stopped. No threshold set is recommended, because none is defensible.**

Thresholds remain PROVISIONAL and unwritten. No policy constant was added. The
position renderer is still disabled. No frozen artefact was touched.

Run it yourself:

```bash
npx tsx scripts/analyzer/calibrate-position.ts
```

Every figure below comes from that run, against live EDGAR on 2026-09-09, tag
mapping `calboard-secmap-2026-09-1`. The full per-company output is written to
`.evidence/m8c-calibration/calibration-report.txt`.

---

## 1. The headline

**Zero of ten calibration companies produced a usable observation.** Not a
material share — all of them.

| | Companies |
|---|---|
| Set size | 10 |
| Acquired successfully | 10 |
| **Input A** — price location within the scenario range | **0** |
| **Input B** — required-versus-achieved gap | **0** |
| **Usable (both inputs, as §10.6.2 requires)** | **0** |

§10.6.2 rule 2 requires positive agreement from *both* inputs, so one input
alone supports no position and contributes no observation. Nothing in the set
reached even one.

This triggers three of the dispatch's stop conditions at once: a material share
of the set yields no usable inputs (it is the whole set); computing an input
requires a methodology judgment that is not settled; and the evidence supports
no defensible recommended set.

**Recommending a threshold set on this evidence would be the Appendix B failure
performed deliberately.** Appendix B set cut-points by judgment with no
observations behind them, and they were later read as measured. There are zero
observations here. Any set proposed now would be exactly that artefact, with a
calibration document attached to make it look otherwise.

## 2. The calibration set

Chosen to span shapes, not to optimise around MSFT and NVDA.

| Ticker | Shape |
|---|---|
| MSFT | Megacap software — high margin, long history, net cash |
| OKLO | Pre-revenue — described-success distribution, not a range |
| NVDA | Hypergrowth — achieved growth far above plausible required growth |
| KO | Consumer staple — low single-digit growth, stable margin, levered |
| UNP | Capital-intensive rail — heavy debt, steady returns |
| COST | Retail — very high revenue, very thin margin |
| XOM | Cyclical commodity — margin and revenue swing with price |
| INTC | Declining incumbent — falling margin, loss-making years |
| LLY | Pharma — high multiple on accelerating revenue |
| RIVN | Loss-making, capital-intensive, early revenue |

The set is data, in `lib/analyzer/calibration/set.ts`, so a later session cannot
quietly drop the shapes that came back awkward.

**The case the dispatch specifically required — price at or above the top of the
described-success range — was not reached, and could not be.** It needs a
described-success range, which is Step 7 analyst output (§5.4, §7.1). The
arithmetic for it is built and tested (`priceLocationWithinRange` returns values
above 1 rather than clamping, so "at the top" and "well above the top" stay
distinguishable), but no company in the set has a range to place a price in.
The M9 gap this was meant to close jointly remains open.

## 3. Why each input failed

### Input A — price location within the scenario range: 0 / 10

Two independent blockers, and every company hits at least one:

**A1. The range is suppressed on all ten.** `LEVERAGE UNSUPPORTED IN v1`. The
leverage precondition (§6.5) needs enterprise value, enterprise value is
`INCOMPLETE` on every acquired run, so the ratio cannot be computed and the gate
fails closed — which is correct behaviour, not a bug. §10.6.3 is explicit: no
range, no position. The harness therefore refuses to compute the fraction even
where the raw scenario numbers would allow it; carrying that arithmetic past a
suppressed range would calibrate a threshold on a figure the run itself refused
to publish.

**A2. Eight of ten have no scenarios at all.** Step 7's three scenario values are
analyst input and were never acquired. `analystInputsFor` returns null for
anything but MSFT and OKLO, and `buildAcquiredRun` raises
`AnalystInputsUnavailableError` rather than proceeding. **A third company cannot
be run end-to-end today.** So even with A1 fixed, the maximum achievable
calibration set is the two companies the dispatch says not to optimise around —
and both of those are blocked by A1 anyway.

### Input B — the required-versus-achieved gap: 0 / 10

The achieved side partly works. The required side does not, and there are three
blockers stacked behind it, not one.

**B1. `targetEnterpriseValue` is missing on all ten** — the same INCOMPLETE
enterprise value as A1, whose root cause is §4.4's non-operating-investments
judgment. That is a classification, not a reported line; no tag answers it, and
null is the correct state on a run no analyst has classified.

**B2. `nopatTaxRate` is unset on all ten.** It is one of the four
`UNDEFINED_POLICY_CONSTANTS` Command Center has not defined. Every one of the
nine reverse-DCF cells returns INCOMPLETE without it. Choosing a value is a
methodology judgment that is not settled — the 0.20 in the MSFT fixture is what
a recovered reference grid is *consistent with*, not a configured constant, and
generalising it to nine other companies would be inventing policy.

**B3. RONIC is not acquired, so the grid could not solve even if B1 and B2 were
fixed.** `companyInputs.ts` holds `fiveYearDeltaNopat` and
`fiveYearDeltaInvestedCapital` at null for every company, so the ladder has no
cells and M7 cascades to NOT COMPUTABLE.

B3 is the finding most likely to be missed, so the harness measures it directly.
A labelled **counterfactual** pass resolves §4.4 and sets the NOPAT tax rate to
0.20, then re-runs the grid. It produces no observation and is reported in its
own section. Result: MSFT and COST get an enterprise value — **and still solve
0 of 9 cells.** Fixing the §4.4 judgment alone would not produce a single
required-growth figure.

### The achieved side, which did partly work

This is real evidence and worth keeping. Single-tag revenue series, §3.7-clean:

| Ticker | 10-year CAGR | 5-year CAGR | Tag |
|---|---|---|---|
| MSFT | **13.79%** (FY2016→FY2026) | 14.57% | RevenueFromContractWithCustomerExcludingAssessedTax |
| LLY | **12.56%** (FY2015→FY2025) | 21.58% | Revenues |
| NVDA | — | 31.25% (FY2017→**FY2022**) | RevenueFromContractWithCustomerExcludingAssessedTax |
| KO | — | 7.75% | Revenues |
| COST | — | 10.54% | RevenueFromContractWithCustomerExcludingAssessedTax |
| UNP | — | 4.64% | RevenueFromContractWithCustomerExcludingAssessedTax |
| INTC | — | **−7.46%** | RevenueFromContractWithCustomerExcludingAssessedTax |
| OKLO, XOM | — | — | no single-tag annual series |
| RIVN | — | — | revenue is zero at the FY2020 endpoint |

**Only 2 of 10 can produce the ten-year comparator §10.6.2 actually requires.**
That is a structural finding about the comparator rule, not about these ten
companies: EDGAR `companyfacts` carries roughly a decade per element, and the
ASC 606 transition split most filers' revenue across `Revenues` and
`RevenueFromContractWithCustomerExcludingAssessedTax` mid-window. §3.7 refuses
to join them, correctly. So the strict "same series, same horizon" comparator is
unavailable for most large filers at a ten-year horizon, and will stay that way.
Whether the position should therefore read against a five-year horizon is a
methodology question for Command Center — it is not settled, and this milestone
did not settle it.

## 4. Two defects found on the way — reported, not fixed

Both are tag-mapping issues. Adding a candidate bumps `TAG_MAPPING_VERSION` for
every company and puts every previously acquired fact under §3.8.1 review, which
Command Center rules. Neither was touched.

**D1 — NVDA's achieved comparator is silently four years stale, and this is the
serious one.** `annualSeries` takes the first candidate tag that resolves. For
NVDA, `RevenueFromContractWithCustomerExcludingAssessedTax` resolves — but only
for FY2017–FY2022. NVDA's continuous series is `Revenues`, which runs 18 annual
years through FY2026. So the harness returns a 5-year achieved CAGR of 31.25%
measured **FY2017→FY2022**, excluding the entire period NVDA is known for, and
nothing in the output says the window is stale.

The precedence rule is deliberate and documented — it keeps the headline revenue
fact and its history on the same element. But §10.6.2's comparator has a
requirement the rule was not written for: it must be *recent*, not merely
consistent. A threshold calibrated on this figure would be calibrated on a
window that ended four years before the price it is read against. **Any
calibration run before this is resolved will carry the same defect.**

> **Amendment, 9 September 2026 — D1's comparator half is fixed; its
> acquisition half is not.** The 31.25% figure above is no longer produced:
> the comparator now refuses it as INCOMPLETE, naming the window, the filer's
> real latest period, and the live candidate that was skipped. See
> `docs/defect-d-stale-comparator.md`. **The figure in §3's table below is
> retained as the record of what the 9 September run returned, and is not a
> current output.**
>
> D1 was reported here as a tag-mapping issue. It is not one. `Revenues` is
> already candidate #2 of the `current-revenue` entry — the mapping reaches
> it; the first-resolving-candidate rule never asks whether the series it
> built is still alive. No candidate was added, removed or reordered and
> `TAG_MAPPING_VERSION` is unchanged.
>
> **What remains open is larger than the comparator.** The same rule governs
> `resolveEntry`, so NVDA's acquired *current-period revenue fact* is
> $26.9bn as of 2022-01-30 against a real FY2026 figure of $215.9bn. Fixing
> that re-resolves previously acquired facts and is §3.8.1 business for the
> acquisition pass.

> **Amendment, 9 September 2026 — D1 and D2 both resolved, and neither was
> what this section called it.** The acquisition and mapping pass fixed the
> selection rule and bumped TAG_MAPPING_VERSION to calboard-secmap-2026-09-2;
> see docs/tag-mapping-version-review.md.
>
> **D1 was not a tag-mapping issue** — us-gaap:Revenues was already candidate #2
> — and fixing selection also caught four stale facts this section never
> identified, including a FOURTEEN-YEAR-stale NVDA capex figure of $138.7m
> against a real $6.042bn.
>
> **D2 was not a tag-mapping issue either.** XOM resolves through the SEC ticker
> directory to CIK 0002115436, "ExxonMobil Holdings Corp", a successor
> registrant with 100 tags, all from 10-Qs, and no annual report at all. The
> history is intact under CIK 0000034088 — 19 filed annual years, revenue
> through FY2025 at $332.238bn — and the current mapping would acquire it
> unchanged. XOM is a ticker-to-CIK resolution defect, not a missing candidate.
>
> **LLY does not tag OperatingIncomeLoss and no defensible substitute exists:**
> Lilly presents no operating-income subtotal, and the nearest tag is PRE-TAX
> income, which is a different quantity. Nothing was added. Returned as a
> Command Center item.
>
> Of the gaps listed below, exactly ONE was a missing candidate: OKLO total-debt.
> It was added. The five-of-ten and six-of-ten counts in this section are
> otherwise unchanged.

**D2 — XOM acquires almost nothing.** Four facts, no annual revenue under any
mapped candidate (`Revenues` has zero annual rows in its companyfacts), and no
operating income. XOM contributes nothing to any calibration. Separately, LLY
does not tag `OperatingIncomeLoss` at all, so no operating margin can be derived
for it.

Per-company mapping gaps observed: OKLO (total-debt — the recorded gap, plus
treasury-method-dilution and current-revenue), NVDA/KO (finance-lease-liabilities,
treasury-method-dilution), UNP/RIVN (treasury-method-dilution), INTC/LLY
(finance-lease-liabilities), LLY (operating-income), XOM (five of seven).

`treasury-method-dilution` is missing on six of ten and blocks enterprise value
independently of §4.4 — worth noting, because fixing §4.4 alone leaves those six
still INCOMPLETE.

## 5. What would unblock a real calibration

In dependency order. Nothing below is done in this milestone.

1. **A way to record §4.4's non-operating-investments judgment per company.**
   Until then enterprise value is INCOMPLETE, which kills both inputs at once.
   The selection mechanism exists (`selectionToNonOperatingInvestments`, with a
   "None of these" option); what is missing is a recorded answer per company.
2. **Acquire RONIC's two five-year deltas.** Without them M7 solves nothing even
   with a valid enterprise value — measured, not assumed, in the counterfactual.
3. **Command Center to define `nopatTaxRate`.** One policy-wide constant; nine
   cells per company depend on it.
4. **Resolve D1** — the comparator must not silently read a stale window.
5. **Step 7 scenarios for more than two companies.** This is the binding
   constraint on Input A and the reason a set larger than two cannot exist. It
   needs either the Step 7 interface or recorded analyst bundles.
6. **Rule the horizon question** in §3 above, and rule which of M7's nine cells
   supplies the position's required figure — §10.6.2 names "M7's implied growth"
   without choosing among the nine, and the harness deliberately returns all
   nine rather than making that ruling silently.

With 1–4 done, Input B becomes computable on roughly seven companies and real
calibration of the gap threshold is possible. Input A needs 5 as well.

## 6. What was built

- `lib/analyzer/calibration/set.ts` — the calibration set, as data.
- `lib/analyzer/calibration/inputs.ts` — both §10.6.2 inputs as raw values, with
  a recorded reason wherever there is none. No band, no cut-point, no
  classifier; a test asserts the module exports none.
- `lib/analyzer/calibration/inputs.test.ts` — 19 tests, including the
  above-the-top-of-range case the set could not supply from a real company.
- `scripts/analyzer/calibrate-position.ts` — the run, live EDGAR or `--offline`.

Re-runnable. When the blockers in §5 clear, this produces the evidence a
threshold ruling can actually rest on.
