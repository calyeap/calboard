# TAG_MAPPING_VERSION review — `calboard-secmap-2026-09-1` → `-09-2`

**Status: the bump is made and this is the review §3.8.1 requires of it.** No
frozen artefact was touched. Eight contract hashes verified before any work.

Spec §3.8.1 line 294 rests the queue exemption on the fact that a mis-mapped
tag is "caught by §3.8.2 and by the mapping's own version review — not by an
analyst confirming one figure at a time." **The version bump is that review's
trigger.** A bump without a review removes the control the exemption depends
on, and the exemption is what keeps roughly fifteen facts per company out of
the spot-check queue. This document is the review, and the harness that
produced it is `scripts/analyzer/tag-mapping-review.ts`.

Reproduce:

```bash
npx tsx scripts/analyzer/tag-mapping-review.ts
```

Every figure below comes from that run, against live EDGAR on 9 September 2026,
across the ten companies of `CALIBRATION_SET`. The full output is written to
`.evidence/tag-mapping-review/review.txt`.

---

## 1. What the bump contains — two changes, one version, one review

Batched deliberately: each bump triggers a review of every previously acquired
fact, and two passes would mean two reviews for one outcome.

**Change 1 — the selection rule.** A candidate whose series the filer has
stopped reporting no longer wins over one that is current. Applied in all three
places that shared the defective rule: `selectTagged.resolveEntry` (the
current-period fact), `history.annualSeries` (the history the comparator reads),
and `history.quarterlySeries` (the run-rate module). Fixing fewer than three
would have left the headline fact and its own history reading different
elements, which is the mixed basis §3.7 refuses.

**Change 2 — one candidate added.** `total-debt` gains
`LongTermDebtNoncurrent + LongTermDebtCurrent (+ CommercialPaper, ShortTermBorrowings)`,
ranked last. Four of the five items on M8-c's list turned out **not** to be
missing candidates; §5 records what each turned out to be instead.

### The ruling this pass needed

**The selection rule is part of what `TAG_MAPPING_VERSION` identifies.** §3.8.1
requires a *fixed, versioned* mapping with the version recorded on the fact. If
the same version could resolve different tags depending on selection logic
living outside the mapping, the version would no longer identify how the fact
was obtained — it would name the table while something else picked the row.
Changing selection therefore bumps the version exactly as adding a candidate
does. That ruling is now written into `tagMap.ts` beside the version string and
into `selectTagged.ts`'s header, so the next person to touch selection meets it
before they touch it.

---

## 2. The rule, stated so it can be reviewed rather than inferred

> A candidate whose latest reported period is older than the filer's own latest
> reported annual fiscal year does not win over a candidate that is current.
> Where **no** candidate is current, the first still wins. Where the filer has
> filed no annual figure at all, the rule is inert.

**"Current" is `latestAnnualFiscalYear` — the filer's own latest reported annual
fiscal year, taken tag-blind.** That definition is not new here: it is the one
Defect D already ruled on for the comparator, and it is imported rather than
re-derived, because a second copy that drifted would let acquisition and the
comparator disagree about the same filing. It is not the clock — every filer is
months behind the calendar between its year end and its 10-K, and a clock-based
test would call all of them stale. It is not the chosen tag, because asking the
chosen tag how far it runs is the question that produced the defect: it can only
ever answer "as far as I go".

**The two bounds are load-bearing, not cautious.** Refusing to resolve where
every candidate is stale would move a fact off the §3.8.1 exempt path and into
the spot-check queue — changing *which* facts are exempt rather than only which
values they carry. That is a Command Center decision and explicitly outside this
pass. The rule therefore never withholds a figure; it only re-orders candidates.
Both bounds carry their own tests.

---

## 3. Every fact whose resolution changed

Eight, across five companies. Five come from the selection rule, three from the
added candidate.

| Company | Fact | Before | After | Why |
|---|---|---|---|---|
| **NVDA** | current-revenue | **$26.914bn** @ 2022-01-30 `RevenueFromContractWithCustomerExcludingAssessedTax` | **$215.938bn** @ 2026-01-25 `Revenues` | Defect D's headline. NVIDIA retired the ASC 606 element after its FY2022 10-K; `Revenues` is candidate #2 of the same entry and runs through FY2026. |
| **NVDA** | capex | **$138.7m** @ 2012-01-29 `PaymentsToAcquirePropertyPlantAndEquipment` | **$6.042bn** @ 2026-01-25 `PaymentsToAcquireProductiveAssets` | **Fourteen years stale, and nobody had found it.** The first tag has exactly three rows, FY2010–FY2012, and stops. |
| **INTC** | depreciation-and-amortisation | **$200.0m** @ 2019-12-28 `DepreciationAndAmortization` | **$11.706bn** @ 2025-12-27 `Depreciation + AmortizationOfIntangibleAssets` | The third candidate ran FY2015–FY2019 and stopped; the fourth runs to FY2025. See §6.1 — the old figure was also wrong in magnitude *at the time*. |
| **LLY** | total-debt | **$33.812bn** @ 2024-12-31 `LongTermDebt + CommercialPaper` | **$42.503bn** @ 2025-12-31 `DebtLongtermAndShorttermCombinedAmount` | `LongTermDebt` stops at FY2024; the combined element continues. |
| **UNP** | sbc | **$107.0m** @ 2023-12-31 `ShareBasedCompensation` | **$142.0m** @ 2025-12-31 `AllocatedShareBasedCompensationExpense` | `ShareBasedCompensation` stops after FY2023; the second candidate continues to FY2025. |
| **COST** | total-debt | **$6.618bn** @ 2022-05-08 `LongTermDebt` | **$5.670bn** @ 2026-05-10 `LongTermDebtNoncurrent + LongTermDebtCurrent` | Costco stopped tagging a debt total in 2022 while continuing to report both halves. Needed the new candidate: selection alone had nothing current to switch to. |
| **RIVN** | total-debt | **$5.526bn** @ 2024-06-30 `LongTermDebt` | **$4.444bn** @ 2026-06-30 `LongTermDebtNoncurrent` | Same shape as Costco, two years less stale. |
| **OKLO** | total-debt | **NOT ACQUIRED** | **$700,000** @ 2026-06-30 `LongTermDebtNoncurrent` | The recorded gap. Oklo tags no debt total at all. |

### Each change checked, not asserted

The dispatch's standing instruction is that any figure moving by this much was
wrong before or is wrong now, and the review is where that gets looked at rather
than assumed. Each was checked against the filings directly:

- **NVDA revenue.** `RevenueFromContractWithCustomerExcludingAssessedTax` has six
  annual years, FY2017–FY2022, and no row of any form ends later.
  `Revenues` has eighteen, FY2008–FY2026. The old figure was NVIDIA's FY2022
  revenue, correct for FY2022 and four years out of date.
- **NVDA capex.** `PaymentsToAcquirePropertyPlantAndEquipment`: FY2010 $77.6m,
  FY2011 $97.9m, FY2012 $138.7m, then nothing.
  `PaymentsToAcquireProductiveAssets`: FY2022 onward, FY2024 $1.069bn, FY2025
  $3.236bn, FY2026 $6.042bn. Two disjoint series; the old rule took the one that
  ended in 2012.
- **INTC D&A.** `Depreciation` FY2025 $10.757bn + `AmortizationOfIntangibleAssets`
  FY2025 $0.949bn = $11.706bn, which is Intel's reported D&A. The retired
  `DepreciationAndAmortization` carried its entire life in five rows — FY2015
  $265m, FY2016 $294m, FY2017 $177m, FY2018 $200m, FY2019 $200m — against a real
  D&A near $10bn in those years, so it was never the whole quantity.
- **LLY total debt.** The strongest evidence available: the two candidates
  **overlap**. At 2024-12-31 the old path gives $33.812bn and the combined
  element gives $33.644bn — 0.5% apart, the difference being classification of
  short-term borrowings. The switch is a like-for-like refresh to a fresher
  date, not a definitional jump.
- **UNP SBC.** The two candidates also overlap, and **agree exactly**: both
  report $107m at FY2023. `AllocatedShareBasedCompensationExpense` then continues
  to FY2024 $118m and FY2025 $142m.
- **COST / RIVN / OKLO total debt.** The new candidate is the two halves
  `us-gaap:LongTermDebt` is *defined* to foot to, which is why the §3.8.2 footing
  check runs against it unchanged — `componentsFor` foots a summed entry against
  its own contributing tags.

**No change is unexplained.** Every one is a filer changing which element it
tags, with the two series overlapping or abutting cleanly.

---

## 4. The §3.8.1 boundary — the question that decides whose call this was

The dispatch's stop condition: if fixing selection changed which facts are
**exempt** from spot-check, rather than only which values they carry, that moves
facts across the §3.8.1 boundary and is a Command Center decision.

**Measured, in two parts, because the two changes have to be judged separately.**

**The selection rule, measured on its own before any candidate was added:**

> Facts whose resolution changed: **5**. Facts that started or stopped being
> acquired: **0**.

Five values moved. Nothing crossed the line. That is the finding that kept this
inside an acquisition pass, and it is a property of the rule rather than luck:
the rule only re-orders candidates that already resolve, and never withholds.

**The added candidate** does move one fact — `OKLO total-debt`, from NOT
ACQUIRED to acquired and exempt. That is not a fact leaving the queue; it is a
fact that did not exist before. Measured on the OKLO capture:

| | before | after |
|---|---|---|
| facts acquired | 12 | 14 |
| **queued** | 1 — `cash-fcf` | 2 — `cash-fcf`, **`net-debt`** |
| **exempt** | 11 | 12 — plus **`total-debt`** |

Nothing left the queue. Two facts appeared: one exempt because it came through
the mapping, and one — the derived `net-debt`, newly computable — **queued**, on
the fail-closed side. No fact a human was previously looking at stopped being
looked at, which is the only direction that would matter.

---

## 5. What was NOT added, and why

M8-c's list, re-measured rather than assumed. **Four of five were not candidate
gaps at all** — the dispatch's warning that fixing selection might make listed
additions unnecessary was right in spirit and understated in degree.

### 5.1 XOM — not a mapping problem

`XOM` resolves through the SEC ticker directory to **CIK 0002115436,
"ExxonMobil Holdings Corp"** — a successor registrant carrying **100 tags, all
from 10-Q filings, and not one annual report**. `latestAnnualFiscalYear` is
null and `filedAnnualYears` is 0.

There is no revenue tag to add. `us-gaap:Revenues` exists with four rows, all
quarterly. XOM acquires four facts, and would acquire four under any candidate
list, because the entity has filed no 10-K.

**The history is intact one CIK away, and this was checked rather than assumed.**
CIK **0000034088**, "Exxon Mobil Corporation", carries **19 filed annual years**
and a seventeen-year `us-gaap:Revenues` series, FY2009–FY2025, ending at
**$332.238bn**. The current mapping would acquire from it without a single
change. The SEC ticker directory simply has one `XOM` row and it points at the
successor holdco.

**This is a ticker-to-CIK resolution question, not a tag-mapping one**, and it is
outside this pass. Adding a revenue candidate would have grown the mapping for
every company forever and fixed nothing — XOM's problem is the CIK it starts
from, and the fix is worth roughly twelve facts on this one company.

### 5.2 LLY operating income — no defensible tag exists

Eli Lilly does not tag `OperatingIncomeLoss`. Searching all 558 of its tags:
no `OperatingIncomeLoss`, no `GrossProfit`, no `CostsAndExpenses`, and
`OperatingExpenses` stops at FY2019. **Lilly does not present an operating-income
subtotal on its income statement**, which is ordinary for pharma.

The only near-candidate is
`IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest`
— **pre-tax income, which is a different quantity**: it includes interest
expense, interest income and other non-operating items. Mapping it to
`operating-income` would silently substitute pre-tax income for operating income
on *every* filer that lacks `OperatingIncomeLoss`, and would corrupt the
operating margin those filers' reverse DCF is built on.

**This is the dispatch's stop condition — a needed figure with no defensible tag
that would require approximating one — and the answer is to add nothing.** The
existing `NO TAG EXISTS` fallback record is already the correct behaviour: §5.1
refuses to replace an unverifiable figure with an estimate, and an absence
recorded is the honest output. Returned as a Command Center item, not fixed.

### 5.3 treasury-method-dilution — no tag exists on the six

Still missing on exactly six of ten (OKLO, NVDA, KO, UNP, XOM, RIVN) — the
selection fix did not change the count. None of the six tags
`IncrementalCommonSharesAttributableToShareBasedPaymentArrangements` or any
variant of it. **There is no candidate to add.**

Two things are worth recording rather than left implicit:

- **For OKLO and RIVN the absence is correct and must not be "fixed".** Both are
  loss-making, their awards are antidilutive, and diluted equals basic exactly.
  The mapping's own basis note already says so: absence there is a fact, not a
  gap.
- **For NVDA, KO and UNP the quantity is exactly recoverable** as diluted
  weighted-average minus basic weighted-average — both tagged, both already
  acquired as §3.8.2 reconciliation companions, and that identity is what the
  tag *means* under ASC 260. But that is a **derivation, not a tag**, and
  §3.8.1 guard 1 puts a deterministic calculation on the queued side of the
  line. Building it would add a queued §3.8 material fact for six companies —
  a spot-check-queue decision, which this pass is told not to touch.

This is now the **single largest blocker on enterprise value: 6 of 10.**

### 5.4 RONIC's two five-year deltas — no definition to map against

The binding constraint on Input B, and the one item where the honest answer is
that the work cannot start yet.

`fiveYearDeltaNopat` is derivable in principle — operating income is acquired,
and NOPAT is operating income × (1 − τ) — but τ is `nopatTaxRate`, one of the
four `UNDEFINED_POLICY_CONSTANTS` Command Center has not defined.

`fiveYearDeltaInvestedCapital` is the blocker. **Invested capital is not a
tagged element and is not defined as a formula in any frozen artefact.** All
four say the same eleven words and no more:

> RONIC = trailing five-year change in NOPAT ÷ trailing five-year change in
> invested capital, invested capital including lease-funded assets

(spec §4.2 and M5; valuation methodology §3.3.) "Including lease-funded assets"
constrains one term of a definition that is otherwise absent. There is no
`us-gaap:InvestedCapital`; the construct is some assembly of debt, equity, cash,
working capital, net PP&E, ROU assets and goodwill, and **which** assembly is a
methodology decision. The MSFT fixture carries a placeholder `100`.

**Constructing one here would be inventing methodology and writing it into a
mapping whose whole claim is that it is a table.** A wrong definition would be
wrong for every company at once — precisely the failure the version review
exists to catch. **Stopped and returned:** RONIC needs a ruling on how invested
capital is measured, and a defined `nopatTaxRate`, before any acquisition work
on it is possible.

### 5.5 One gap found that the dispatch did not list — reported, not added

**LLY capex.** Lilly tags neither mapped candidate. It reports capex as
`PaymentsToAcquireOtherPropertyPlantAndEquipment` (76 rows, current to
2026-06-30), which is its cash-flow-statement "net purchases of property and
equipment" line.

That looks like a defensible third candidate, and it is deliberately **not
added**: it is not on the dispatch's list, and the dispatch is explicit that
every addition carries §3.8.1 review burden forever. Recorded here so the next
pass can authorise it in one line rather than rediscover it.

---

## 6. What this pass exposed and did not fix

### 6.1 `us-gaap:DepreciationAndAmortization` is not always the whole quantity

Intel's retired `DepreciationAndAmortization` carried $177m–$200m in FY2015–FY2019
against a real D&A near $10bn. It was a **component**, not the total, for the
whole time it was tagged. The recency rule routes around it here for the right
reason, but by luck of it also being retired: on a filer that still tags it as a
component, candidate #3 would win and be wrong. Not addressed in this pass —
it is a candidate-scoping question, not a staleness one.

### 6.2 The comparator's window is selected by index, not by fiscal year

Newly visible because NVDA's series is now current and therefore actually read.

NVIDIA tagged FY2019 revenue only under the ASC 606 element, so `us-gaap:Revenues`
— correctly chosen now, eighteen years long — **has no FY2019 row at all**.
`achievedRevenueCagr` takes its far endpoint by index
(`observations[length - 1 - horizonYears]`), which equals selection by year only
on a contiguous series. NVDA's ten-year comparator therefore reports
**FY2015→FY2026 — eleven fiscal years — under a `horizonYears: 10` label**, and
compounds eleven years of growth over ten.

The record still carries the window and the horizon separately, so the
inconsistency is visible rather than hidden, and a test now asserts it so the
next reader meets it as a known defect with a measurement. **Not fixed here:**
it is comparator work, outside an acquisition pass, and the fix is to select the
endpoint by fiscal year and refuse where that year is absent.

### 6.3 Staleness the rule cannot reach, now measurable

`preferCurrent` can only move a retired candidate aside when another candidate is
current. Where an entry has one candidate, the figure is still stale and still
acquired — deliberately, since withholding it would cross the §3.8.1 boundary.
The staleness does not disappear; it becomes **measured**, and the harness prints
it, because a review that reported only the half the fix happened to solve would
be the wrong kind of reassuring.

| Company | Fact | Carried value | Behind |
|---|---|---|---|
| LLY | treasury-method-dilution | 6,855,000 @ 2011-12-31 | **14 years** |
| INTC | operating-lease-liabilities | $1.455bn @ 2021-12-25 | 4 years |
| UNP | finance-lease-rou-additions | 0 @ 2023-12-31 | 2 years |
| KO | total-debt | $42.218bn @ 2024-03-29 | 1 year |
| LLY | operating-lease-liabilities | $1.147bn @ 2024-12-31 | 1 year |

LLY's fourteen-year-stale dilution figure is the one worth acting on, and §5.3 is
why it was not acted on here.

### 6.4 Enterprise value blocks on a genuine nil

Not a mapping finding, but it falls out of the same measurement and it is the
cheapest remaining unblock. `finance-lease-liabilities` is absent on 5 of 10, and
for LLY the absence is verifiable and genuine: Lilly tags **no** `FinanceLease*`
element of any kind, only operating-lease ones. It has no material finance
leases, so the correct value is **zero**, and `computeEnterpriseValue` is
returning INCOMPLETE for a missing REQUIRED input where §4.3's "genuinely nil is
different from unknown" says nil is the answer. Reported for the next pass.

---

## 7. How much closer calibration is — measured, not promised

Ten companies, re-run end to end. **This is not a claim that calibration will
run.** It will not: zero of ten produce a usable observation, unchanged.

| §10.6.2 input | before | after |
|---|---|---|
| **Input A** — price location within the scenario range | 0 / 10 | **0 / 10** |
| **Input B** — required growth (M7's nine cells) | 0 / 10 | **0 / 10** |
| **Usable** (both, as §10.6.2 requires) | 0 / 10 | **0 / 10** |
| achieved comparator, ten-year | 2 / 10 | **3 / 10** |
| achieved comparator, five-year | 6 / 10 | **7 / 10** |
| counterfactual EV computes (§4.4 resolved) | 2 / 10 | **2 / 10** |
| mapping gaps reported across the set | 17 | **16** |

The movement is NVDA joining the comparator set on both horizons, and OKLO's
total-debt gap closing. Both inputs §10.6.2 actually needs are unmoved, because
their blockers are the ones this pass could not touch: §4.4's judgment,
`nopatTaxRate`, RONIC, and Step 7 scenarios.

**What did change is the quality of what is acquired, which is what the pass was
for.** Before this bump, a report on NVIDIA would have carried a $26.9bn revenue
headline and a $138.7m capex figure — both §3.8 material facts, both exempt from
spot-check, both years out of date and neither flagged.

**The EV blocker table, which is where the next pass should start:**

| Missing REQUIRED input | before | after |
|---|---|---|
| treasuryMethodDilution | 6 | **6** — now the largest, and §5.3 says it needs a queue ruling |
| financeLeaseLiabilities | 5 | **5** — and §6.4 suggests most are genuine nils |
| totalDebt | 2 | **1** — XOM only, and §5.1 says that is a CIK question |

---

## 8. Verification

- Eight frozen-artefact SHA-256 hashes verified against the contract before any
  work. All matched. No frozen artefact was read for a fix or modified.
- Full suite: **1357 passed, 116 files.** Typecheck clean. Build clean.
- Negative tests, each watched failing before its fix:
  - a retired-but-first candidate losing to a current one — failed, then passed;
  - the same for an instant entry;
  - the same for `annualSeries`;
  - the added candidate on OKLO — failed with the candidate removed, passed with
    it, while the MSFT "unchanged" test passed in both states.
- Three Defect D pins that deliberately recorded the *deferral* of this work were
  updated to record the transition, each with the reason written at the
  assertion. They were the mechanism that made this change conscious rather than
  accidental, and they did their job.
