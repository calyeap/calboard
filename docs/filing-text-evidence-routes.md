# How filing-text evidence enters acquisition — three routes, scoped

**Scoping only. Nothing implemented, no route recommended.** Phase B stays
halted. No mapping change, no version bump, no construction, no frozen artefact
touched. Command Center rules the route; Calvin owns the scope call.

Contract gate: eight frozen artefacts verified by SHA-256, presence before
hashing, 8/8 OK.

---

## 0. Two corrections to Phase A, both from the new rules

### MSFT — conclusion survives, reasoning replaced

Lease > debt is discarded as evidence, as instructed. MSFT is non-nested on
**evidence type 1**, its own disclosure. FY2026 10-K Note 13, supplemental
balance-sheet table, accession `0001193125-26-323660`:

| Finance leases | 2026 |
|---|---:|
| Other current liabilities | $4,290M |
| Other long-term liabilities | $62,304M |
| **Total finance lease liabilities** | **$66,594M** |

4,290 + 62,304 = 66,594, exactly the `FinanceLeaseLiability` figure acquisition
resolves. The whole liability is disclosed as sitting in *other* current and
long-term liabilities, not in long-term debt. Non-nested, on approved evidence.

### LLY — Phase A had this wrong, and the new zero rule is why

Phase A recorded LLY as "no lease input / NOTHING TO NEST" from tag absence.
Its FY2024 10-K says otherwise:

> "Finance leases are included in property and equipment, short-term borrowings
> and current maturities of long-term debt, and **long-term debt** in our
> consolidated balance sheets."
>
> "Finance leases are not material to our consolidated financial statements."

So LLY is **NESTED** — its finance leases are inside the debt total
acquisition reads (`DebtLongtermAndShorttermCombinedAmount`, $42,503M) — and the
amount is **never quantified anywhere in the filing**. Not material is not an
amount. This is strictly worse than a missing input: the debt figure is
contaminated by a lease that cannot be removed because no issuer disclosure
states its size.

**INTC is the same family.** Its latest 10-K has no leases note at all. It
discloses finance lease payments ($133M undiscounted), finance leased assets
($453M in PP&E) and finance-lease principal payments ($105M), but never a
separate finance-lease liability, and never where one sits. UNKNOWN.

**KO** mentions finance leases nowhere in its lease note — 21 occurrences of
"operating lease", zero of "finance" or "capital". No statement addressing the
liability, so UNKNOWN, not REPORTED NIL.

**NVDA** says its obligations "primarily consist of operating leases", which is
named in the new rules as insufficient. UNKNOWN.

### The consequence that constrains every route

| Company | Truth from the filing | Limiting factor |
|---|---|---|
| MSFT | not nested (other liabilities) | reachable prose |
| OKLO | not nested (other liabilities) | reachable prose |
| COST | not nested (other long-term/current liabilities, footnote 3) | reachable prose |
| UNP | **nested, quantified $105M** | already structured |
| RIVN | not nested (disjoint balance-sheet lines) | already structured |
| NVDA | UNKNOWN — "primarily operating" | **issuer disclosure** |
| KO | UNKNOWN — liability never addressed | **issuer disclosure** |
| INTC | UNKNOWN — liability never stated separately | **issuer disclosure** |
| LLY | **nested, never quantified** | **issuer disclosure** |
| XOM | n/a — wrong registrant, total-debt NOT ACQUIRED | registrant identity |

**Four of ten (NVDA, KO, INTC, LLY) cannot be resolved by any of the three
routes.** The binding constraint there is what the issuer chose to disclose, not
Calboard's access to it. No fetch, no human, and no model can extract a
determination a filing does not contain. Any route's headline number should be
read against that ceiling: **six of ten is the maximum any route can reach**, and
XOM needs a separate registrant fix before it is even in scope.

---

## 1. Two facts established against real filings, because they decide Route 1

### Does the instance document carry the dimensional data companyfacts drops? **Yes.**

UNP's FY2025 10-K (`0000100885-26-000037`) publishes
`unp-20251231_htm.xml` (1.9MB instance), `_cal.xml`, `_def.xml`, `_lab.xml`,
`_pre.xml`. The instance carries **460 explicit dimensional members**. The one
that matters:

```
context c-256   instant 2025-12-31
  <xbrldi:explicitMember dimension="us-gaap:LongtermDebtTypeAxis">unp:FinanceLeaseMember</...>
  us-gaap:DebtInstrumentCarryingAmount = 105,000,000
```

That is the isolated finance-lease component of the debt schedule, at the
reporting instant, machine-readable. The calculation linkbase then supplies the
relationship:

```
LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities
    ← DebtInstrumentCarryingAmount                                    (w=+1)
    ← DebtInstrumentUnamortizedDiscountPremiumAndDebtIssuanceCostsNet (w=−1)
```

companyfacts, by contrast, has fact rows whose only keys are
`end, val, accn, fy, fp, form, filed, frame` — no axis, no member, ever.

**Evidence type 2 is obtainable from the instance and is not obtainable from
companyfacts.** So is evidence type 3 in its strong form.

### Is note TEXT reachable that way, or only structured facts? **Reachable — but as prose.**

The instance carries `TextBlock` facts holding whole notes as escaped HTML. I
extracted UNP's leases note prose from its instance directly.

This is the partial answer that must be stated as one. Route 1 delivers Costco's
footnote 3 **as a string**. It does not deliver the determination. Something
still has to read "Included in other long-term liabilities in the consolidated
balance sheets" and conclude non-nesting — a human (Route 2) or a model
(Route 3). Route 1 makes types 1 and 2 *reachable*; it makes only type 2 and
strong type 3 *determinable without reading prose*.

And the structured form is rarer than the pattern it needs to cover. MSFT tags
its entire leases note as a single custom TextBlock
(`msft_LesseeOperatingAndFinanceLeasesTextBlock`) — the 4,290 / 62,304 / 66,594
rows are not separate facts at all. OKLO's balance-sheet calculation tree
(`Liabilities ← LiabilitiesCurrent + OperatingLeaseLiabilityNoncurrent +
OtherLiabilitiesNoncurrent + RightOfFirstRefusalLiability +
DeferredIncomeTaxLiabilitiesNet + LongTermDebtNoncurrent`) does not include
`FinanceLeaseLiability` as a summand anywhere, so nothing structural says where
its lease sits. Both need the prose.

RIVN is the counter-case and it is structural: its balance-sheet calculation
linkbase makes `LongTermDebtNoncurrent` and `OperatingLeaseLiabilityNoncurrent`
disjoint sibling summands of `Liabilities`, which proves the lease line is not
inside the debt line without reading anything.

---

## 2. ROUTE 1 — fetch the instance document and calculation linkbase

**Does it satisfy CalFinance?** Partly, and the split is sharp.

- Evidence type 2: **yes**, where the filer detail-tags with dimensions.
- Evidence type 1: **text reachable, determination not**. Prose arrives as a
  `TextBlock` string.
- REPORTED NIL vs tag absence: **no.** Distinguishing them requires reading a
  scoped statement about the liability. Route 1 hands over the sentence; it
  cannot tell you the sentence is complete and scoped. On the ruling's own
  standard — a route that cannot make this distinction is not a solution to this
  problem — Route 1 alone does not solve it.

**Cost.** No new external dependency: same EDGAR host, same `SecClient`, same
rate limiter, same `SEC_USER_AGENT`. New surface is substantial: a per-filing
fetch (1.9MB for UNP against ~3.6MB for its whole companyfacts, but *per filing*
rather than per company), an XBRL instance parser with contexts, segments,
explicit members and unit refs, plus a linkbase parser resolving `xlink:from` /
`xlink:to` locator ids. New failure modes: filings that block-tag rather than
detail-tag (MSFT); custom extension members whose meaning is filer-specific
(`unp:FinanceLeaseMember`); inline-XBRL-only filings where the `_htm.xml`
extraction is absent; and the discovery step of mapping accession to artefact
filenames, which is by convention rather than guaranteed.

**Which of the ten does it actually resolve?** **Two: UNP and RIVN.** UNP via
dimensional member plus calculation arcs; RIVN via disjoint sibling summands.
MSFT, OKLO and COST get their prose delivered but not determined. NVDA, KO,
INTC and LLY are unreachable in principle. XOM is a registrant problem.

**Where does the determination live, and is it reviewable?** In the filing
itself, addressed by accession, context id and element — the most reviewable of
the three, because a reviewer can re-fetch and recompute. It is a fact about a
filing with a source, not a mapping constant, so it does not belong in `TAG_MAP`;
it belongs on the fact as provenance. §3.8.1's exemption rests on the *mapping*
being reviewable, and this leaves the mapping unchanged while adding a second
reviewable artefact beside it.

**Bounded fix or milestone?** **Milestone.** A new document type, two new
parsers, a new failure taxonomy — and it resolves two of ten.

---

## 3. ROUTE 2 — a §4.4 recorded judgment

**Does it satisfy CalFinance?**

- Evidence types 1 and 2: **yes.** A human reads the note and both are within
  reach; this is how OKLO, RIVN, COST, MSFT and LLY were actually settled in
  this and the previous pass.
- REPORTED NIL vs tag absence: **yes** — and it is the only route that can
  make the distinction reliably today, because the distinction is a judgment
  about whether a disclosure is complete and scoped. That is what a human
  reviewer is for.

**Cost.** No new dependency and no new fetch. The cost is recurring human work:
one determination per company **per reporting period**, since nesting can change
when a filer re-presents its balance sheet, and a determination recorded against
a 10-K does not carry to the next 10-Q. The structural cost is a **fourth §4.4
judgment**. §4.4 is titled "The three FACT-labelled inputs that are judgments"
and enumerates exactly three; `decisions.ts` keys them. Adding a fourth is a
spec change to a frozen artefact — which is a listed STOP condition, so this
route cannot be taken without amending the contract or finding that nesting
rides inside an existing judgment.

**Which of the ten does it resolve?** **Six: MSFT, OKLO, COST, UNP, RIVN and
LLY** — LLY resolving to "nested, amount unknown", which is a determination that
the bridge is INCOMPLETE rather than one that unblocks it. NVDA, KO and INTC
stay UNKNOWN because their filings do not say. XOM needs the registrant fix.

**Where does the determination live, and is it reviewable?** In the run's
recorded judgments, with the analyst's stated reason — the existing §4.4
mechanism, which `nonOperatingJudgment.ts` already models: acquisition presents
candidates, the human selects, the selection and its reason are recorded and
printed in report section J. Reviewable, and reviewable in the place reviewers
already look. It correctly does **not** enter the mapping.

**Bounded fix or milestone?** **Bounded in code, unbounded in operations, and
blocked on a spec amendment.** The mechanism exists; the fourth judgment does
not, and the ongoing per-company-per-period reading is a standing cost rather
than a one-time one.

---

## 4. ROUTE 3 — the §3.8.1 documented AI-extraction fallback

### The permission question, quoted rather than paraphrased

§3.8.1, spec line 294:

> "**Tagged acquisition is required wherever a tag exists.** Where a figure is
> available as a tagged filing element under a **fixed, versioned tag mapping** —
> XBRL or equivalent, with the mapping version recorded on the fact — the
> software acquires it that way. AI extraction is a **documented fallback**,
> permitted only where no tag exists for that figure, where the tag is present
> but unmapped in the version in force, or where the tagged value fails the
> §3.8.2 cross-checks."

The permission is scoped to **"that figure"** — three cases, all about acquiring
a *figure* that the mapping could not supply. This splits the question in two,
and the two answers differ:

- **REPORTED NIL is inside case 1.** The figure is `finance-lease-liabilities`;
  no tag exists for it at NVDA, KO, INTC or LLY. "Permitted only where no tag
  exists for that figure" applies squarely. Reading the lease note to establish a
  REPORTED NIL is an existing permission, not a new one.
- **A nesting determination is not a figure.** It is a classification about
  where a figure sits relative to another figure. None of the three cases
  describes it: a tag does exist for `total-debt`, it is mapped in the version in
  force, and it passes its cross-checks. Establishing that the figure it returns
  *contains something else* falls outside all three. On the §5.3 fail-closed
  rule and the M7-a precedent — where the exemption was read narrowly because
  "the fail-closed direction is to queue more, not fewer" — **this reads as a new
  permission.**

There is a second-order route: the *consequence* of nesting is a figure —
"interest-bearing debt excluding leases" — for which no tag exists at a nested
filer. Framed that way, case 1 covers it. Whether that framing is legitimate or
is the carve-out being manufactured to fit is a Command Center call, and I flag
it as the question rather than answering it.

**Does it satisfy CalFinance?** Types 1 and 2: yes in capability — a model
reading the note reaches everything a human reaches. REPORTED NIL vs tag
absence: yes in capability, and it is the case the spec most clearly permits.

**Cost.** `fallback.ts` records `valueAcquired: false` "FALSE THROUGHOUT
MILESTONE M8-a, and deliberately… M8-a's scope excludes the [C] layer". Route 3
turns that flag true, which puts a model in the acquisition path for a REQUIRED
EV input for the first time. New dependency: the Anthropic SDK is already a
project dependency and `lib/analyzer/ai/` exists, so the plumbing is present.
New failure mode is the material one: a wrong determination here is silent and
systematic-looking — it arrives wearing acquisition's provenance — and §3
exists because all four recorded errors were in the AI-extracted population.

**Which of the ten does it resolve?** **Six: MSFT, OKLO, COST, UNP, RIVN,
LLY** — the same six as Route 2, for the same reason: both read the same prose.
NVDA, KO and INTC remain UNKNOWN; a model reading "primarily consist of
operating leases" must return UNKNOWN, and if it returns nil the rule has been
violated by the extractor rather than satisfied by it.

**Where does the determination live, and is it reviewable?** On the fact, with a
recorded fallback reason, and **queued** — §3.8.1 guard 1 puts anything not
acquired through the versioned mapping into the spot-check queue, and guard 2
keeps it carrying all six §3.2 fields. So it is reviewable, and reviewed by a
human per fact, which is the opposite of the exemption's economics: the whole
point of §3.8.1 was to spend human attention on the AI-extracted set. This route
enlarges that set with a determination for every company with a finance lease.
It cannot earn the derived-fact exemption either: that needs a §3.8.2
cross-check that covered the fact and passed, and there is no cross-check for
"where does this liability sit".

**Bounded fix or milestone?** **Milestone.** It opens the [C] layer inside
acquisition, which the current milestone excluded by design, and it carries a
permission question that is not settled by the text.

---

## 5. Can a bridge reach a non-latest value?

**The series is discarded at the fixture boundary, not at acquisition — and
that changes the shape of the fix.**

Three layers, three different answers:

| Layer | Has the rows? |
|---|---|
| `resolveEntry` / `acquire.ts` output (`FactRecord[]`) | **No** — one resolved value per entry, latest eligible row |
| `buildCompanyInputs(companyFacts, …)` | **Yes** — receives the whole companyfacts document |
| `assembleAnalysisResult(fixture)` and every module | **No** — single `SourcedValue`s only |

So a bridge as currently sited **cannot** reach a non-latest instant: the
modules that do the arithmetic see one value per input. But
`buildCompanyInputs` — the function that constructs the fixture those modules
consume — already holds every row of the document. A bridge-level same-date rule
is therefore implementable **there**, with no new fetch, no new dependency, and
without touching acquisition's selection rule or the mapping version.

Two constraints on that, both worth stating:

- **There is no instant series API.** `annualSeries` and `quarterlySeries`
  filter on duration bands (300–400 days, 60–120 days) and `ANNUAL_FORMS` — they
  handle flows. `resolvePriorPeriod` steps back exactly one period, for range
  sanity. Nothing enumerates the instants a balance-sheet stock is available at,
  which is what choosing a coherent anchor date requires.
- **It is the fixture that would carry two dates.** The ruling requires the
  market date and the statement date both preserved in provenance. Provenance is
  attached at fixture construction, so that is the same place — which is
  consistent, but it means `SourcedValue` and the bridge result types change,
  and those are read by assembly and the report.

This is the answer to "is that the real constraint": the constraint is not that
acquisition discards the series. It is that the series survives exactly one
layer further than the bridges do, and the bridges were built where it is
already gone.

---

## 6. Summary, without a recommendation

| | Route 1 instance+linkbase | Route 2 §4.4 judgment | Route 3 AI fallback |
|---|---|---|---|
| Evidence type 1 | text yes, determination no | yes | yes |
| Evidence type 2 | **yes** | yes | yes |
| REPORTED NIL vs absence | **no** | yes | yes |
| Resolves (of ten) | 2 — UNP, RIVN | 6 | 6 |
| New dependency | none | none | none (SDK present) |
| Determination lives | in the filing, re-fetchable | in recorded judgments | on the fact, queued |
| Blocked on | nothing | a 4th §4.4 judgment = spec change | a permission question |
| Bounded or milestone | milestone | bounded code, standing ops cost | milestone |

Two things hold across all three:

1. **Six of ten is the ceiling.** NVDA, KO, INTC and LLY are limited by their
   own disclosure. LLY is the sharpest case — nested, and never quantified — and
   its bridge cannot be made coherent by any means available to Calboard.
2. **Route 1 and Routes 2/3 are not substitutes.** Route 1 is the only one that
   makes type 2 machine-checkable and re-verifiable; Routes 2 and 3 are the only
   ones that can distinguish REPORTED NIL from tag absence. The ruling requires
   both capabilities.
