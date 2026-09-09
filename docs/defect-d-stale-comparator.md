# Defect D — the achieved-growth comparator could be silently stale

**Status: CLOSED, both halves.** The comparator half was fixed on 9 September
2026 under `calboard-secmap-2026-09-1`; the acquisition half was fixed later the
same day under `calboard-secmap-2026-09-2`. See
[`tag-mapping-version-review.md`](tag-mapping-version-review.md).

> **Amendment, 9 September 2026 — the acquisition half is now fixed.** §6 below
> reported it open, and it was: `resolveEntry` still chose the retired tag, so
> NVDA's acquired current-period revenue fact was $26.9bn as of 2022-01-30. The
> acquisition pass applied the same recency rule to `resolveEntry`,
> `annualSeries` and `quarterlySeries`, bumped `TAG_MAPPING_VERSION` to
> `calboard-secmap-2026-09-2`, and produced the §3.8.1 review that bump
> triggers.
>
> **The rule found four more stale facts than this document knew about**, none
> of them revenue: NVDA capex at a **fourteen-year-stale** $138.7m against
> $6.042bn, INTC D&A at $200m against $11.706bn, LLY total debt a year behind,
> UNP share-based compensation two years behind. Defect D was named for the
> comparator; the same rule was mis-selecting across the whole mapping.
>
> **Consequence for §5's table below: NVDA is no longer INCOMPLETE.** With
> acquisition choosing the live series, the comparator has nothing stale to
> refuse — NVDA returns 66.90% over FY2021→FY2026 (five-year) and 45.70% over
> FY2016→FY2026 (ten-year). The guard is unchanged and still fires on the
> synthetic cases;
> it simply has no real-company instance left in this set.

No frozen artefact was touched by either half.

Reproduce:

```bash
npx tsx scripts/analyzer/calibrate-position.ts
```

---

## 1. What was wrong

M8-c returned NVDA at a **31.25% five-year revenue CAGR measured
FY2017→FY2022** — a window ending four years before the price it would have
been read against — and nothing in the output said so. Not INCOMPLETE, not
suppressed, not flagged: a plausible number answering a different question than
the one asked. §3 exists for that failure, and the growth comparator is one of
the two inputs §10.6.2's valuation position depends on.

## 2. Why it happened

Three explanations were possible: the candidate order is wrong, the continuous
series sits under a tag the mapping cannot reach, or the truncated tag genuinely
has no later filings. Measured against live EDGAR (CIK 0001045810):

| tag | annual-eligible rows | fiscal years | latest period end, all rows |
|---|---|---|---|
| `RevenueFromContractWithCustomerExcludingAssessedTax` | 12 | FY2017–FY2022 | **2022-01-30** |
| `Revenues` | 42 | FY2008–FY2026 | 2026-07-26 |
| `RevenueFromContractWithCustomerIncludingAssessedTax` | — | absent | — |

**The third is true, with a twist that changes the fix.** NVIDIA retired the
ASC 606 element after its FY2022 10-K; no row of any form ends later. But the
continuous series is not outside the mapping — `Revenues` is **candidate #2 of
the same `current-revenue` entry**. The mapping reaches it. What never reaches
it is the *selection rule*: `annualSeries` takes the first candidate that yields
anything at all and never asks whether the series it just built is still alive.

So the candidate order is not wrong — ASC-606-specific-first is correct for the
other nine companies in the calibration set — and no tag is missing. The defect
is that first-resolving-candidate has no recency condition.

## 3. The rule that replaced it

A comparator cannot be computed without saying what period the company has
actually reported. `achievedRevenueCagr` takes a **required** `WindowRecency`,
so the question can no longer go unasked.

Where the window does not reach the current period, the comparator never returns
a bare figure. Which of two outcomes applies depends on what the mapping already
holds:

| situation | outcome |
|---|---|
| window reaches the filer's latest reported annual year | returns normally, nothing disclosed |
| window is short and **no** other mapped candidate reaches further | the figure travels **with its window** — a shortened window under §3.7, recorded because "the two give different answers" |
| window is short and another mapped candidate **does** reach further | **INCOMPLETE**, naming the skipped tag. The figure is wrong, not stale, and a label would dress it as a judgment call |

`staleWindowDisclosure` is non-null exactly when `window.yearsStale > 0`, so a
surface printing the figure without the window is visibly wrong rather than
quietly wrong.

**"Current period" is the filer's own latest reported annual fiscal year**
(`latestAnnualFiscalYear`), taken tag-blind across the whole document — not the
clock, because every filer is months behind the calendar between its year end
and its 10-K and a clock-based test would call all of them stale; and not the
chosen tag, because asking the chosen tag how far it runs is the question that
produced the defect. It can only ever answer "as far as I go".

**This is a rule about window recency, not a check for NVDA.** Every case in the
test suite but two is synthetic; NVDA is one instance of the rule.

## 4. The horizon ruling

CalFinance ruled on 8 September that a five-year same-series comparator is
permitted where a ten-year one cannot be constructed, that five- and ten-year
comparators are related but **not** semantically identical, and that the horizon
must travel with the result.

**No five-year fallback is implemented here** — §10.6.2 still says one horizon
and the amendment has not run.

But the mechanism built for carrying a window **is** the mechanism that will
carry a horizon, and it is built so the amendment extends it rather than
replacing it. `ComparatorWindow` is one travelling record naming the tag, the
horizon, the window's endpoints, the filer's current period and the staleness.
`horizonYears` already sits there beside the window. When the one-horizon rule
is amended, the amendment adds a horizon *choice* to a record that already
carries and reports the horizon — it does not need a second travelling record
beside this one.

## 5. What this run shows

Across the ten-company calibration set, the guard fires on exactly one company
and changes no other figure:

| | comparator window | outcome |
|---|---|---|
| MSFT | FY2016→FY2026 | 13.79% / 14.57%, unchanged |
| KO | FY2020→FY2025 | 7.75%, unchanged |
| UNP | FY2020→FY2025 | 4.64%, unchanged |
| COST | FY2020→FY2025 | 10.54%, unchanged |
| INTC | FY2020→FY2025 | −7.46%, unchanged |
| LLY | FY2015→FY2025 | 12.56% / 21.58%, unchanged |
| **NVDA** | **FY2017→FY2022** | **INCOMPLETE** — was 31.25% |
| OKLO, XOM, RIVN | — | already blocked upstream, unchanged |

The middle row of §3's table — a short window that travels labelled — has **no
real-company instance in this set**. Every stale window found was rescuable.
That branch is covered by synthetic tests only, and the distinction is recorded
here so a later reader does not mistake absence of evidence for a dead path.

## 6. What was still open, and where it went

**CLOSED 9 September 2026 by the acquisition and mapping pass — see the
amendment at the top of this document. The section is kept as written because it
is the record of what was deferred and why, and the deferral was the point.**


**The same rule governs `resolveEntry`, so the defect is not only in the
comparator.** NVDA's acquired **current-period revenue fact** is
$26,914,000,000 as of 2022-01-30. The real FY2026 figure is $215.9bn. The
comparator now refuses to read a stale series; acquisition still *chooses* one.

That fix belongs to the acquisition pass, deliberately and not by preference:
changing which candidate resolves re-resolves every previously acquired fact and
puts them under §3.8.1 review, which Command Center rules. The comparator
therefore **refuses rather than re-chooses** — a test pins that it still reads
its window off the retired tag — so this fix cannot quietly become the
acquisition change it is meant to defer.

Note also that `current-revenue` is a §3.8 material fact requiring human
spot-check. A stale headline revenue figure is the kind of error the spot-check
exists to catch, which is a second reason not to route around it here.
