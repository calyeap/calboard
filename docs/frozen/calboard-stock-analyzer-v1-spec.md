# Calboard Stock Analyzer v1 — Product Specification

**Status:** APPROVED FOR BUILD — Command Center, 5 September 2026. M1–M6 were built and shipped against it. Amendment M7 was approved on 7 September 2026 and is recorded below and in §14; M7-b and M7-c amended it further the same day. A disagreement between this document and the build is a defect to be raised, not drift for a later session to correct on its own judgment.

**Amendment M7 — APPROVED by Command Center, 7 September 2026.** This document carries the M7 amendment: eighteen changes across this spec, the interaction design and `mock-human-steps.html`, of which twelve land here. The amendment implements **Calvin's recorded override of 6 September 2026** on the no-verdict boundary, together with eleven further changes to Step 1, Step 2, the step numbering, the trust vocabulary and the page-one contract. **§14 is the amendment record.** It lists every change, every reading the amendment had to make, and the follow-ups it deliberately did not fix. **This amended text is the operative contract.** Command Center approved the amendment on 6 September 2026 and recorded it on the Product Decision Log, but the approval was not written into the artefacts until 7 September. For a day both documents declared themselves not in force while every dispatch assumed they were. Amendments M7-b and M7-c were applied during that window; both stand, and both are recorded in §14.

**Date:** 5 September 2026. Amendment M7 drafted 6 September 2026.

**Authority:** written against the frozen v1.0.2 contract. Both source files verified by SHA-256 before this document was started:

| File | SHA-256 | Result |
|---|---|---|
| `calboard-valuation-methodology_2.md` | `a4a39e33717993fe9558f263009cec3814555765ac69c69728d99354d4a5ec7c` | MATCH |
| `calboard-v1_0_2-changes-and-caveats.md` | `0b7d38f4099fa720528225a915e99f5855dca0525ed775eeb0f4b72e2d656a24` | MATCH |

This spec adds no methodology. Where it appears to, that is a defect in this document and the methodology wins. Section references throughout are to `calboard-valuation-methodology.md` v1.0.2 unless stated otherwise.

---

## SEASONALITY — RESOLVED

An earlier draft of this spec deferred I4 (seasonality) on the basis that the v1.0.2 methodology leaves it unenforced. **That resolution is superseded.**

The caveat register lists I4 under *"Product-spec requirements — these need software, not prose."* The methodology leaving it unenforced is precisely why it is assigned to the product spec; it is not a reason to defer it. **I4 is SPECIFIED — v1** and is implemented in §7.2 M12.

Consequently the red team's third recommended validation run (seasonal retailer) is **expected to pass** on the SEASONAL — RUN-RATE SUPPRESSED state, not to fail. §11.3 is written accordingly.

**Material convertibles or preferreds remains deferred**, because the register itself labels that item LATER rather than assigning it to the product spec. That is the only deferred row in §9.2.

---

## 1. v1 SCOPE

### 1.1 What the product is

A single-company equity analysis tool. The analyst supplies a ticker; the software acquires facts, runs gates, computes a fixed set of deterministic diagnostics, accepts three analyst-authored scenarios, and returns a structured report describing **what the current price already assumes** alongside **what the analyst assumes**.

The product issues **no price target and no portfolio action**. It does issue exactly one deterministic, entry-side valuation position — **CHEAP / FAIR / EXPENSIVE** — with the action clause defined in §10.6. Calvin remains the decision-maker on everything the position does not cover, which is everything except whether this is a price to start at.

**This supersedes the former absolute no-verdict boundary, which does not survive alongside it.** The frozen text read *"The product issues no verdict, no price target and no recommendation… This is the §10 Step 5 boundary and it is load-bearing."* Calvin's recorded override of 6 September 2026 reverses that boundary; §14 records the override and the counter-arguments he heard before making it. What remains of the §10 Step 5 boundary is narrower and still load-bearing:

1. **No price target.** The output is a range, never a point (§10.3, §13.2).
2. **No portfolio action.** Entry-side only — start / do not start / wait for a better price. Never trim, add or sell, because those need position size and cost basis the analyzer does not have and §1.4 forbids it from receiving.
3. **Nothing an AI authored.** The position is computed by **[S]** from fields the analyzer already holds (§10.6). The §8.3 limits on **[C]** are unchanged and still forbid [C] from issuing a position, a target or a recommendation of its own.

### 1.2 Validated scope

**v1 analyses listed operating companies only.** This is an instrument-class boundary and it is enforced at identity resolution, before any fact is acquired. A fund, an index, or a currency or crypto pair is **UNSUPPORTED INSTRUMENT** at Step 1 (§2, §9.3.1). It does not resolve, does not open a run, and never reaches Step 2 to fail there on a missing fact set.

The reason is that every method in this document takes a company apart — filings, margins, reinvestment, a capital structure, a share count. None of those objects exist for a fund or a pair, so a run against one cannot fail informatively; it can only fail late and confusingly.

**This narrows the analyzer's use of Calboard's invalid-symbol contract. It does not change that contract, and it does not change the portfolio side, where ETFs remain valid holdings.** The same ticker may be a legitimate holding on the portfolio side and an unsupported instrument here; that is the intended result, not an inconsistency to reconcile.

v1 has been validated on three companies in three profiles. Within the supported instrument class, the software supports exactly those three:

| Profile | Validated on | Primary method |
|---|---|---|
| Mature, profitable, stable FCF | Microsoft | DCF + reverse DCF |
| High-growth, profitable, uncertain durability | NVIDIA | Reverse DCF + scenario DCF with explicit revenue paths |
| Pre-revenue / unprofitable **owner-operator infrastructure** | OKLO | Conditional price-implied break-even success weight + "what has to be true" reverse calc |

The **asset-based row** (banks, insurers, brokers, balance-sheet asset managers, REITs, reserve-based resources) appears in the methodology's §1 table for completeness and **has been validated on nothing**. Gate 0 refuses it deterministically.

The pre-revenue profile's validated scope is narrower than "pre-revenue". Per I19 it is an **owner-operator infrastructure model**: funding stack, capacity ramp, construction lead and unit-economics breakeven all assume capex per unit of capacity. A pre-revenue biotech or software company has none of that structure and must be warned outside scope (§9).

### 1.3 What one analysis produces

One ticker in. One report out, containing: the fact set with provenance; gate results; the deterministic diagnostic set; analyst scenarios and their outputs; the price-implied diagnostics; and a plain-English interpretation layer. Nothing is persisted between analyses in v1 (see §13).

### 1.4 One company per analysis — a boundary, not a description

Stock Analyzer v1 is **one-company analysis only**. This is a scope boundary with four consequences an engineer must implement, not a statement about typical usage:

1. **No portfolio context enters the analyzer as input.** Not holdings, not weights, not cost basis, not existing exposure. Cost basis in particular has zero bearing on what a share is worth (§9 mistake 15) and must not be accepted even where available.
2. **No cross-company state persists between analyses.** Each run is independent. Nothing is carried forward, cached against a prior company, or compared to a previous run.
3. **No output field expresses position sizing, weight, portfolio fit or exposure.** The Analysis Result has no member for it and the renderer has no section for it.
4. **Cross-company comparison is limited to peer multiples as secondary cross-checks** (§13.3). Peer-set construction is excluded by the methodology.

Portfolio fit and Portfolio Review are out of scope for v1 (§13.1).

### 1.5 Single-user, local, not financial advice

Consistent with Calboard generally. No deployment, no multi-user state.

**On advice framing.** The frozen text read *"no advice framing anywhere in the output copy"*, and amendment M7 narrows it rather than leaving it to contradict §10.6. The product is a single-user tool Calvin runs for himself; it is not a service, not a publication, and not advice to anyone else. What the output copy may not do is **frame itself as advice to a reader**: no second person telling someone what to do with their money, no suitability language, no risk-profile language, no wording that would read as a recommendation issued to a third party. The §10.6.4 action clause is a statement about **this price against this company's own record** — the form the amendment authorises, and the only form it authorises.

---

## 2. USER FLOW

Ten steps. Steps 2, 6 and 7 are the only ones requiring the human; everything else is software.

**Step 1 — Ticker entry and identity confirmation.** Analyst supplies a ticker. Software resolves instrument identity before anything else, per Calboard's existing invalid-symbol contract. Identity resolution is separate from data availability; an unresolvable ticker is rejected, never force-added.

Two rules govern this step.

**1 — Instrument class is checked at resolution.** Only a **listed operating company** proceeds. A fund, an index, or a currency or crypto pair returns **UNSUPPORTED INSTRUMENT** here (§1.2, §9.3.1) — not at Step 2, and not as a downstream failure on a fact set that was never going to exist. The check narrows this analyzer's use of the invalid-symbol contract and changes neither that contract nor the portfolio side, where ETFs remain valid holdings.

**1a — A registrant with no annual filing history is refused at Step 1, and the reason is stated.** A ticker may resolve to a listed operating company that has filed nothing annual — a successor holdco after a reorganisation is the ordinary case, where the filing history sits under the predecessor's registrant. Every method in this document takes a company apart through its filings. A registrant with none has nothing to take apart, so the run can only fail late and confusingly on a fact set that was never going to exist. This is the same reasoning as the instrument-class check and it is enforced in the same place.

**This is NOT UNSUPPORTED INSTRUMENT.** That state is a class judgment — a fund, an index, a pair — and the registrant here is a listed operating company. Saying otherwise would state something false about what it is.

**Calboard does not follow corporate succession.** Selecting a predecessor registrant is a judgment that one entity's history is another's, which is an accounting judgment about continuity of the reporting entity and not one the software may make. Getting it wrong attributes one company's filings to another silently, and no state says "these figures came from a different registrant than you asked for". A heuristic is no better than a hardcoded mapping: "fall back where there are no annual filings" misfires on genuinely new filers, which is where being wrong is easiest and least visible.

**The analyst resolves it by entering the registrant they mean.** Identity stays decided at identity resolution.

**2 — Step 1 does not auto-advance.** Resolution displays the **resolved company name** and waits. The analyst confirms that this is the company they meant, and the run commits only on that confirmation. A ticker that silently resolves and advances puts the analyst three screens into a run against the wrong company before anything says so, and the cost of discovering it there is a repeated Step 2.

**No price renders on Step 1.** Price is acquired with the fact set and carries its timestamp (§3.4); showing it at entry would put an unsourced, untimestamped figure on screen before the fact contract applies, and would open the run with the number the analyst is trying not to anchor on.

**Step 2 — Fact acquisition and human spot-check.** Software acquires the fact set per §3, classifies every figure per §4, and presents the **queued material facts** for human confirmation before any calculation runs. This step is mandatory and cannot be skipped or defaulted. It exists because the realistic failure path for Calboard is deterministic arithmetic on wrong facts (§3.1).

**Not every material fact is queued.** A fact acquired through a **fixed, versioned tag mapping** is not spot-checked (§3.8.1). What remains in the queue is the AI-extracted set — the population in which all four recorded errors occurred. The exempted facts are covered instead by the deterministic input cross-checks of §3.8.2.

**Step 3 — Gate 0.** Supported profile. On failure the analysis stops before Step 5; facts, arithmetically defined multiples and history diagnostics may display, each carrying the state.

**Step 4 — Gate 1.** History sufficiency. Never stops the analysis; sets suppression and labelling state.

**Step 5 — Profile recommendation and trigger evaluation.** Software recommends a profile with the facts that drove it, and evaluates triggers A and B separately.

**Step 6 — Profile confirmation.** Analyst confirms the recommended profile, overrides it, or answers **Cannot judge**. Every override, its reason, and the fact that nothing under an overridden gate has been validated are recorded. *Cannot judge* uses the recommended profile provisionally, records the profile as **not human-confirmed**, and raises PROFILE NOT CONFIRMED (§6.3, §9.4).

**Step 7 — Analyst scenarios.** Analyst supplies three scenarios per §10 Step 3, with drivers set together, anchors written down, and a per-scenario share count where financing differs.

> **Why 6 and 7 are two steps.** They were one step and one number in the frozen text, and they are two different human jobs. Step 6 is a judgment about **what kind of company this is** — an act of classification, made against evidence the software has already assembled, whose failure mode is deferring to the recommendation. Step 7 is an act of **authorship**: the analyst writes assumptions that did not previously exist, and its failure mode is incoherent paths across the three columns. Collapsing them under one number let the second inherit the first's completed feeling. Splitting them is a numbering change only — no calculation, no gate and no state moves with it.

**Step 8 — Deterministic computation.** The full §7 module set runs. Suppression states from Steps 3–5 apply.

**Step 9 — Interpretation.** The [C] layer runs against the computed output only, under the §8 limits.

**Step 9b — Blind challenger.** A separate call receives the verified fact set and any thesis claims, and **not** the analysis (§8.5). It may run in parallel with Step 9; it may not read Step 9's output.

**Step 10 — Result assembly.** The machine-readable Analysis Result is assembled per §10.0, with the challenger findings merged only after that call has completed. The narrative report is rendered from the result object.

**Ordering rule:** no calculation module may execute before Step 2 has been completed by a human. The software must enforce this, not merely recommend it.

> **Reading note on two numbering systems.** This document uses "Step *n*" for two different things and they must not be confused. A bare **Step *n*** is a step of this ten-step user flow, and those are the numbers the M7 amendment renumbered. A **§10 Step *n*** is a step of the *methodology's* §10 and belongs to the frozen contract; those numbers are unchanged and must never be renumbered to match this flow. The load-bearing valuation boundary discussed in §1.1 and §8.3 is **§10 Step 5**, the methodology's, not this flow's Step 5.

---

# INPUT INTEGRITY — SECTIONS 3, 4 AND 5

> These three sections are the most detailed in this specification, and deliberately so. The caveat register's own conclusion outranks everything else in it:
>
> > "Both documents record that the AI-authored test reports were wrong first time on NRC status, the NVIDIA P/E range, the supply book and the OKLO share count. Deterministic arithmetic on wrong facts is the realistic failure path for Calboard."
>
> Four material factual errors across three reports, each caught only because an audit went looking. The methodology is well defended against bad maths and not at all against bad inputs. An engineer implementing this spec should expect to spend more effort on §3–§5 than on §7.

---

## 3. DATA CONTRACT AND SOURCE HIERARCHY

### 3.1 Acquisition principle

Every material fact comes from a **primary source or a trusted structured data feed**. No figure enters the system from model memory, from prose summarisation, or from a derived calculation whose own inputs are not themselves recorded.

**Hard prohibition:** the [C] layer may not supply facts. It reads the fact set; it does not populate it. Any figure appearing in an output that cannot be traced to an acquired, timestamped, source-classified record is a defect.

### 3.2 The per-fact record — six distinct fields

Every analyzer input fact carries all six of the following as **separate fields**. None may be collapsed into another.

| Field | Values | Purpose |
|---|---|---|
| **Type** | FACT / ASSUMPTION / INFERENCE | §10 Step 1 legend |
| **Source / provenance** | the specific document or feed, identified precisely enough to re-fetch | traceability |
| **Source class** | PRIMARY / SECONDARY | what kind of document the figure came from |
| **Extraction type** | DETERMINISTIC/STRUCTURED / AI-EXTRACTED | **how the figure was got out of that document** |
| **Verification state** | CONFIRMED / NOT CONFIRMED / SPOT-CHECK PENDING / SPOT-CHECK NOT REQUIRED | whether a human has confirmed it |
| **As-of / period date** | the date or fiscal period the figure describes | when the figure was true |
| **Retrieval timestamp** | when the figure was acquired, where applicable | staleness |

**Source class — PRIMARY** is a filing or a company-published document: SEC filings, company press releases, published guidance, investor-relations materials published by the company.

**Source class — SECONDARY** is a call transcript, press coverage, or an aggregator. Also: a directional comment on an earnings call captured by a third-party transcript, and any figure derived from such a comment by analysts or the press (§9 mistake 17). A spoken outlook is not published guidance.

**Extraction type — DETERMINISTIC/STRUCTURED** means the figure arrived through a structured feed field, a tagged filing element (XBRL or equivalent), or a deterministic parse whose output is reproducible without a model.

**Extraction type — AI-EXTRACTED** means a model read a document and returned the figure. This includes reading a table out of a PDF, locating a line item in unstructured filing text, and any case where the figure's correctness depends on a model having read correctly.

**Verification state — the four values.** This field answers one question and one only: *has a human confirmed this figure against its source?*

| Value | Meaning |
|---|---|
| **CONFIRMED** | A human checked the figure against its source and it matched. Set by a Step 2 *Confirm* decision (§3.8.3) |
| **NOT CONFIRMED** | A human checked and could not confirm. Set by a Step 2 *Cannot verify* decision, and **always carries a reason code** (§3.8.4) |
| **SPOT-CHECK PENDING** | Queued for Step 2 and not yet decided. The Step 2 gate is not satisfied while any material fact sits here |
| **SPOT-CHECK NOT REQUIRED** | Exempt from the queue because the figure came through a fixed, versioned tag mapping (§3.8.1). Not a human confirmation and must never be displayed as one |

**These four names replaced VERIFIED / UNVERIFIED / SPOT-CHECK PENDING in amendment M7, because UNVERIFIED was doing two unrelated jobs.** It named both a verification state here and a propagation state in §5.1, and those are different claims about a figure: *no human has confirmed it* versus *it exists but could not be checked against a source*. **UNVERIFIED now means only the §5.1 propagation state.** See §14 for why the rename fell on this field rather than on §5.

### 3.2.1 Source class and extraction type are orthogonal — do not collapse them

**A PRIMARY-source fact can still be AI-EXTRACTED.** A revenue figure a model read out of a 10-K is PRIMARY *and* AI-EXTRACTED. Both facts about it matter and they answer different questions: source class asks *how authoritative is the document*, extraction type asks *how did the number get from that document into this system*.

Collapsing them hides the exact failure the register identifies. The four recorded errors were not errors of authority — the documents were fine. They were errors of extraction.

An implementation with a single "quality" or "confidence" field on each fact does not satisfy this section.

### 3.2.2 Visible distinction in output

**Material AI-extracted facts must be visibly distinguishable in the user-facing output**, not only in the underlying record. The reader must be able to see, without opening anything, which numbers a model read rather than a feed supplied.

The materiality boundary is the §3.8 material-facts list. Every fact on that list carries a visible extraction-type marker wherever it is displayed.

**Extraction type propagates like source class.** A derived figure whose inputs include an AI-extracted fact is itself AI-EXTRACTED at its point of display, under the same transitive rules as §3.3.

### 3.3 The propagation rule

> **A figure derived from a SECONDARY source is SECONDARY wherever it appears.** (§10 Step 1)

This is transitive and unconditional. It has three implementation consequences the engineer must handle explicitly:

1. **Every derived value inherits the weakest class of its inputs.** A multiple computed from a PRIMARY price and a SECONDARY earnings figure is SECONDARY.
2. **The class travels with the figure into every downstream output.** A SECONDARY revenue figure that feeds a growth rate, which feeds a reverse DCF cell, makes that cell SECONDARY. The label appears on the cell, not only at the point of entry.
3. **Class is never upgraded by aggregation.** Combining several SECONDARY figures does not produce a PRIMARY one.

**Extraction type propagates by the same three rules.** A derived value inherits AI-EXTRACTED if any input was AI-EXTRACTED; the marker travels to the point of display; aggregation never upgrades it to DETERMINISTIC/STRUCTURED.

Implementation note: this is a provenance graph, not a per-field flag. Model it as such from the start. Retro-fitting propagation onto flat fields is where this requirement will fail silently. The graph carries source class and extraction type as **two independent labels on each edge**, not one combined quality score.

### 3.4 Timestamping

Price carries its timestamp always (§10 Step 1). **There is no "approximate" state for price.** The caveat register records this as a specific correction: a rerun labelled NVIDIA's price "approximate" and it was corrected to UNVERIFIED. Step 1 has no approximate state, and the software must not create one.

Financial statement figures carry both the **period they describe** and the **retrieval timestamp**. Restatements are handled by retaining both records, never by overwriting.

### 3.5 The single-definition rule

Per §9 mistake 18, three quantities get exactly one definition each, applied identically to every company. The software implements one function per quantity. No per-company variation, no alternate path.

**Enterprise value (§2.1):**

> EV = market capitalisation + total debt + **finance** lease liabilities − cash and marketable debt securities − non-operating equity investments.

- **Operating leases** are excluded from the bridge and their cost stays in opex. Including the liability while leaving rent in opex double-counts. The operating-lease-inclusive net-debt ratio is shown as a memo in the §3.4 leverage test only.
- **Market capitalisation** = most recent **shares outstanding** from the filing cover page or balance sheet, **plus** treasury-method dilution from options, RSUs and warrants per the equity note. **Not** the weighted-average diluted share count.
- **The equity bridge reverses this exactly:** equity value = operating EV + cash + investments − debt − finance leases.
- **Non-operating investments** are carried at **book value** in both directions, with the carrying value and the direction of the likely error stated beside them.

**Share count:** as above. For any company expected to raise equity, the share count used in a scenario is the **post-financing** count in that scenario, not today's (§2.1). Scenario values are then expressed per **current** share (§2.9).

**Free cash flow (§2.6) — three definitions, all three displayed:**

> Cash FCF = operating cash flow − cash capex.
>
> FCF after lease-funded capacity = cash FCF − **finance-lease right-of-use assets obtained in the period**.
>
> Unlevered FCF = NOPAT + D&A − cash capex − finance-lease ROU additions − ΔNWC.

SBC and working-capital swings are shown separately in all three.

**Pairing rule:** OCF − capex is after interest, so it is an equity-holder cash flow and pairs with market cap. For a yield on EV, use unlevered FCF. The software must not mix them.

**Per I6:** FCF yield displays cash FCF **and** cash FCF − SBC. The latter is the figure compared to the required return.

### 3.6 The lease input

The input is the **ROU-assets-obtained disclosure**, not the year-over-year change in the lease liability. The change nets off principal repayments and understates the period's investment. Microsoft FY26: ROU additions $24.6B against a $20.4B liability change.

**The lease term is not optional.** Capacity acquired under lease is capacity acquired. Per I14, finance-lease ROU additions are the live example of a REQUIRED input often absent from structured feeds — see §4.

### 3.7 Accounting-basis consistency

Ten-year history is computed **on a consistent accounting basis** (§3.1). Where an accounting standard changed within the window, either use restated figures for every year or shorten the window — and **record which was done**, because the two give different answers.

Microsoft illustrates the size of the effect: 14.6% CAGR on the mixed basis originally used, 13.8% on a restated FY2016, 14.7% on the nine-year FY2017–FY2026 window needing no restatement. All three are defensible once labelled. The mixed-basis one is not.

Per I15 this choice is a **judgment presented as a fact**. Software flags it; the human confirms. See §4.4.

### 3.8 Human spot-check

Mandatory, before any calculation. This is the register's own first recommendation for the product spec.

**Material facts requiring confirmation:**

- price and its timestamp
- shares outstanding and the treasury-method dilution added to it
- total debt, finance lease liabilities, cash and marketable debt securities
- current-period revenue and operating margin
- finance-lease ROU assets obtained in the period
- capex
- any figure classified SECONDARY
- any figure classified AI-EXTRACTED
- any figure classified UNVERIFIED
- for pre-revenue: share count, cash balance, quarterly burn

**Presentation requirement:** each fact is shown with its value and all six fields from §3.2 — type, source, source class, extraction type, verification state, as-of date and retrieval timestamp — and with a direct link or citation sufficient to check it against the source document. The spot-check is not a checkbox on a summary; it is a per-fact confirmation against provenance.

**Behaviour on non-confirmation:** a material fact that is NOT CONFIRMED leaves the analysis in an incomplete state. Dependent outputs return INCOMPLETE per §5. The software does not proceed on non-confirmed material facts.

**Why the list above is what it is:** three of the four recorded factual errors (the NVIDIA P/E range, the supply book, the OKLO share count) were in figures of exactly these kinds. The fourth (NRC status) was a qualitative claim, which is why §8 forbids the [C] layer from asserting facts at all.

### 3.8.1 Tagged acquisition, and the one exemption from the queue

**Tagged acquisition is required wherever a tag exists.** Where a figure is available as a tagged filing element under a **fixed, versioned tag mapping** — XBRL or equivalent, with the mapping version recorded on the fact — the software acquires it that way. AI extraction is a **documented fallback**, permitted only where no tag exists for that figure, where the tag is present but unmapped in the version in force, or where the tagged value fails the §3.8.2 cross-checks.

Falling back is not free. **Every fallback is recorded on the fact** with which of those three reasons applied, and **milestone M8 must report which facts fell back and why** — as a list of facts, not a count. A fallback rate that climbs quietly is the failure this record exists to make visible, and a bare number cannot be acted on.

**The exemption.** A fact acquired through a fixed, versioned tag mapping is **not queued** for spot-check. Its verification state is **SPOT-CHECK NOT REQUIRED** (§3.2). What remains in the queue is the AI-extracted set — which is where all four recorded errors occurred, and the reason §3 exists.

**What the exemption rests on, stated plainly so it can be reviewed:** a versioned tag mapping is reproducible without a model, and its failures are systematic rather than per-fact. A mis-mapped tag is wrong for every company at once, and is caught by §3.8.2 and by the mapping's own version review — not by an analyst confirming one figure at a time. Per-fact human attention spent on tagged data buys little, and costs the attention the AI-extracted queue needs. **This is a judgment about where human attention is worth spending. It is not a claim that tagged data is correct.**

**Two guards on the exemption:**

1. **It is granted by acquisition path, never by extraction-type label alone.** A fact marked DETERMINISTIC/STRUCTURED that did **not** come through a fixed, versioned tag mapping — a structured feed field with no tag mapping, or a deterministic parse — is **queued**. Absence of a recorded mapping version is not evidence of one, on the §5.3 fail-closed rule.
2. **The exemption changes what is queued, not what is carried.** An exempt fact still carries all six §3.2 fields, still displays them, still propagates its labels under §3.3, and still appears in report section B. It is not spot-checked; it is not hidden.

**Consequence for the Step 2 gate:** *spot-check complete* means every **queued** material fact carries a decision. The §2 ordering rule and criterion A1 are otherwise unchanged — no calculation module runs before that.

### 3.8.2 Deterministic input cross-checks — a milestone M8 requirement

The §3.8.1 exemption removes human attention from tagged facts, so the compensating control is deterministic and runs on **every** input, exempt or queued. **[S]**, never [C]. Three families, all reproducible, each producing a state rather than a correction:

| Cross-check | What it tests |
|---|---|
| **Footing** | That components sum to their stated total, and that a quantity agrees with itself where it appears more than once in one document — a statement, its note, and the cover page |
| **Reconciliation against related facts** | That a figure is consistent with the facts it must agree with: the equity bridge reversing exactly (§3.5), cash FCF against its components, the leverage ratio against the debt and cash lines it is built from, and period-over-period continuity where a balance carries forward |
| **Range sanity** | That a figure lies within the range its own history and its units admit — a margin outside 0–100%, a share count moving by an order of magnitude between periods, a scale error of 10³ or 10⁶ against the prior period |

**A failed cross-check never corrects the figure.** It sets a state on the fact, forces that fact into the Step 2 queue whatever its acquisition path, and — where the fact is REQUIRED — returns INCOMPLETE for its dependents until it is resolved by **re-acquisition**, per §3.1 and §5.1. Nothing here writes a value.

**Milestone M8 reports the cross-check outcome for every input**, pass or fail, alongside the §3.8.1 fallback list. A cross-check suite whose results are not reported is not a control.

### 3.8.3 The two decisions, and the vocabulary they map onto

Step 2 offers exactly **two** decisions and no default. The interface labels are **Confirm** and **Cannot verify**; those literal labels appear in the design and in `mock-human-steps.html`, and this table is the only place they are bound to this document's vocabulary.

| Interface label (design layer) | This document calls it | Verification state set | Gate effect |
|---|---|---|---|
| **Confirm** | **confirmation** | CONFIRMED | Counts toward spot-check completion |
| **Cannot verify** | **non-confirmation** | NOT CONFIRMED, with a §3.8.4 reason code | Counts toward completion; dependents return INCOMPLETE per §5 |

Neither side is pre-selected and there is no third decision. There is deliberately **no control that edits a figure**: a typed value would carry no source, no source class and no extraction type, which is the failure §3.1 exists to prevent. A wrong figure is fixed by **re-acquisition**, never by correction.

### 3.8.4 Reason code on non-confirmation

**A non-confirmation is not complete without a reason code.** The control is a **fixed two-option select** — no free text, no third option, no *other*:

| Reason code | Means |
|---|---|
| **CONTRADICTED BY SOURCE** | The analyst found the figure in the source and it does not match |
| **NOT LOCATED** | The analyst could not find the figure in the source at all |

**Both return INCOMPLETE. The gate does not change.** The two codes do not branch behaviour, do not produce different states, and do not licence proceeding in either case. Step 2 still has exactly two decisions; the code is a required field **of** the *Cannot verify* decision, not a decision of its own.

**Why the codes exist, given that they change nothing downstream:** they separate a **pipeline defect** from an **acquisition gap**, and those need opposite fixes. *Contradicted by source* says the pipeline delivered a wrong figure from a document that holds the right one — a parse, mapping or extraction defect. *Not located* says the pipeline delivered a figure the analyst cannot find at all — a provenance or citation defect. Aggregated across runs the two split into two work queues; recorded as one undifferentiated *cannot verify*, they split into none.

**Why the select is fixed and free text is refused:** a free-text reason is unaggregatable, and an unaggregatable reason cannot drive the fix. This is deliberately the opposite of the §6.3 profile-override reason, which **is** free text precisely because an override is a one-off judgment nobody will ever count. These are counted, so they are coded.

**The code is recorded on the fact** and carried in `facts` (§10.0.1). Milestone M8 reports it alongside the §3.8.1 fallback list.

---

## 4. REQUIRED VS OPTIONAL FIELDS

Per I14: **every FACT input is marked REQUIRED or OPTIONAL. A missing REQUIRED input returns INCOMPLETE for every dependent output.**

### 4.1 The classification is per-output, not global

A field is REQUIRED *for a given output*. Share count is REQUIRED for value per share and OPTIONAL for the operating-margin history. The software holds a dependency map from each output to its required inputs, and evaluates completeness per output.

Implementing this as a single global "required fields" list will produce either false INCOMPLETEs or false completeness. It must be a map.

### 4.2 REQUIRED inputs by output group

| Output group | REQUIRED inputs |
|---|---|
| Enterprise value and every EV-based multiple | shares outstanding; treasury-method dilution; price + timestamp; total debt; finance lease liabilities; cash and marketable debt securities; non-operating equity investments at book |
| Leverage precondition test | total debt; finance lease liabilities; cash and marketable debt securities; EV |
| Gate 0 | sector classification; interest income; revenue; primary statement line items; industry classification |
| Gate 1 | count of filed annual years |
| Trigger A / B | operating margin for every year in the available window |
| RONIC | five-year change in NOPAT; five-year change in invested capital **including lease-funded assets** |
| Reinvestment | capex; acquisitions; finance-lease ROU assets obtained; D&A; ΔNWC |
| All three FCF definitions | operating cash flow; cash capex; finance-lease ROU additions; NOPAT; D&A; ΔNWC; SBC |
| P/E | price; EPS; pre-tax income; non-operating items |
| Steady-state EV and PVGO | median-margin NOPAT (see §4.4); discount rate; EV |
| Diagnostic reverse DCF | base-year revenue; RONIC + state; margin levels; policy constants |
| Own-history percentile | ten years of the relevant multiple on a consistent accounting basis |
| Pre-revenue module | share count; cash balance; quarterly burn; capex per unit of capacity; capacity ramp; construction lead; project debt share and cost |
| §10.6 valuation position and action clause | price + timestamp; the scenario range; M7 implied growth; **the achieved-history comparator fact, on the same series and horizon as the implied-growth figure** (§10.6.2). Absent the comparator the gap is INCOMPLETE and the position does not render |

### 4.3 OPTIONAL inputs

Optional inputs improve an output but do not block it. Their absence is displayed, not silent.

Examples: consensus figures (a reference for what is priced, never truth, and **never derived from the price** — §9 mistake 6); operating lease liabilities (memo line only); peer multiples (secondary cross-check only — see §13); acquisitions where genuinely nil.

**Rule:** an OPTIONAL input that is absent is shown as absent beside the output that would have used it. Absence is never rendered as zero.

### 4.4 The three FACT-labelled inputs that are judgments

Per I15, three inputs are labelled FACT in the methodology and are not. Software flags each; the human confirms; the confirmation is recorded with its reason.

| Input | Why it is a judgment | Software behaviour |
|---|---|---|
| Accounting-basis window | Restate-all vs shorten-window give different answers (§3.7) | Present both options with the resulting figures; human selects; selection recorded |
| Which investments are non-operating | Classification, not a reported line | Present the candidate line items; human confirms; carried at book with the direction of likely error stated |
| "Normalised" NOPAT | A choice of normalisation basis | **Renamed to median-margin NOPAT throughout the interface**, per I15. Human confirms the window used |

**Naming note for the engineer:** the methodology text says "normalised NOPAT" (§6.1, §10 Step 2). I15 requires the interface term to be **median-margin NOPAT**. This is a rename, not a change of computation, and not a divergence from the frozen contract — it is one of the seven product-spec requirements the register records. Where this spec says median-margin NOPAT it means the methodology's normalised NOPAT.

---

## 5. UNVERIFIED AND INCOMPLETE PROPAGATION

### 5.1 The two states

**UNVERIFIED** — the figure exists but could not be verified against a source. Per §10 Step 1: **an unverifiable figure is never replaced by an estimate.** Not by a model's recollection, not by a peer average, not by a prior period carried forward, not by an interpolation.

**INCOMPLETE** — a REQUIRED input for this output is missing. The output returns the state and no number.

> **UNVERIFIED means this and nothing else.** Before amendment M7 the same word also named a value of the §3.2 verification-state field, where it meant *no human has confirmed this figure*. That is a different claim — about whether anyone looked — and it is now called **NOT CONFIRMED** (§3.2). UNVERIFIED is a **propagation state**: a property of the figure and its source, which travels downstream under §5.2. NOT CONFIRMED is a **verification state**: a property of the human review, which gates Step 2 and returns INCOMPLETE for dependents under §3.8. A figure can be UNVERIFIED and CONFIRMED at once — the analyst looked, agreed the figure is what the pipeline says, and agreed it cannot be checked against a source. That combination was unstatable while one word carried both jobs, and it is exactly the combination §3.4 records for the NVIDIA price correction.

### 5.2 Propagation rules

Per I14: **UNVERIFIED propagates like SECONDARY.** That means the §3.3 rules apply unchanged — transitive, travelling to the point of display, never upgraded by aggregation.

| Input condition | Output state | Number returned |
|---|---|---|
| All REQUIRED inputs present and PRIMARY | normal | yes |
| Any REQUIRED input SECONDARY | computed, labelled SECONDARY | yes |
| Any REQUIRED input UNVERIFIED | computed, labelled UNVERIFIED | yes |
| Any REQUIRED input AI-EXTRACTED | computed, labelled AI-EXTRACTED | yes |
| Any REQUIRED input NOT CONFIRMED (§3.8.4) | **INCOMPLETE** | **no** |
| Any REQUIRED input still SPOT-CHECK PENDING | the run has not passed the Step 2 gate; no module has run | **no** |
| Any REQUIRED input missing | **INCOMPLETE** | **no** |
| An OPTIONAL input missing | normal, with the absence displayed | yes |

The distinction that matters: SECONDARY and UNVERIFIED **qualify** an output; missing REQUIRED **suppresses** it. A qualified number is still a number and still carries its qualification everywhere it appears.

### 5.3 Fail-closed behaviour

Wherever a missing input could plausibly be read as a pass, it is read as a failure. Three places the methodology makes this explicit, and the software implements all three:

1. **Gate 0 fails closed.** An unclassifiable company is UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE, **never mature-profitable by default** (§1).
2. **The leverage precondition fails closed.** Where the inputs needed to compute the ratio are missing, the state is **LEVERAGE UNSUPPORTED IN v1**, not PASS (§3.4 safeguard 4).
3. **Missing REQUIRED inputs return INCOMPLETE**, not a computed value on partial data (I14).

**General rule for the engineer:** any new state added later inherits this default. Absence of a disqualifying fact is not evidence of qualification. This is the same reasoning as Gate 1's "absence of evidence is not evidence of absence" (§1) applied to inputs rather than to history.

### 5.4 The live example

Finance-lease ROU additions are the worked case in I14: **often absent from structured feeds, and the lease term is not optional.**

Consequence when absent: reinvestment, RONIC, unlevered FCF, FCF after lease-funded capacity, capital intensity and the leverage ratio all lose a REQUIRED input and return INCOMPLETE. That cascade is correct and must not be softened. Microsoft FY26 shows why the number matters — reinvestment is 66% of NOPAT on cash capex alone and **86%** once the $24.6B of ROU additions are included, moving the implied return on new capital from 27.2% to **20.9%**.

An engineer who sees that cascade and is tempted to default the field to zero should read this paragraph again.

### 5.5 Display

Every state is visible at the point of use. A report in which the states are collected in a footnote and the cells look clean is a failed implementation of this section.

---

## 6. COMPANY CLASSIFICATION AND GATES

Gates run in order. Either can stop the analysis before Step 2 of the method (§10 Step 0).

### 6.1 Gate 0 — supported profile [S]

Deterministic. No judgment. Evaluated before everything.

**Return UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1 when any of:**

- sector classification is Financials or Real Estate; or
- interest income exceeds 50% of revenue; or
- insurance premium or policy-reserve line items appear in the primary financial statements; or
- industry classification is reserve-based extraction (oil and gas exploration and production, mining).

**Return UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE** when the sector classification is missing and those tests cannot be evaluated.

**The gate fails closed:** an unclassifiable company is unsupported, never mature-profitable by default.

**Under either state:** all valuation outputs are suppressed. Facts, multiples where arithmetically defined, and history diagnostics may still display, **each carrying the state**.

**Human override** is permitted. The override, its reason, and the fact that nothing under it has been validated are recorded with the analysis.

**Why the gate exists** (carry this into the interface copy, because it is not obvious): for a bank or an insurer, debt is funding rather than capital structure, so the EV bridge, EBITDA, free cash flow and PVGO are all arithmetically computable and none of them means anything. A property-casualty insurer with low reported debt and stable operating cash flow passes every other test in the methodology into the mature-profitable row and produces a full page of correct, meaningless numbers.

**Provisional threshold:** the >50% interest-income test has no observations behind it (Appendix B). The other three tests are classification lookups, not thresholds.

### 6.2 Gate 1 — history sufficiency [S]

Count the fiscal years of filed annual data available.

| Years available | State | Effect |
|---|---|---|
| **< 5** | **HISTORY INSUFFICIENT** | Own-history multiple percentile **suppressed**. Every range, median and worst-change statistic labelled with the window actually used and **never described as ten-year**. Margin and stress diagnostics **still run**, with stress margin levels set by policy — the current margin, and that margin reduced by one quarter and by one half in relative terms |
| **5–9** | **SHORT HISTORY** | Compute normally; print the window length beside every history statistic; evaluate the overlay triggers on the available window |
| **≥ 10** | — | As written throughout |

**Gate 1 never refuses.** It suppresses and labels. The margin diagnostics run regardless, because a company with four filed years and a record margin is exactly where the peak-earnings question matters most and exactly where history cannot answer it.

**HISTORY INSUFFICIENT does not license a cyclicality claim.** Trigger B requires an *observed* margin decline. A short window in which none was observed is absence of evidence, not evidence of absence. The software must not:

- label such a company CYCLICAL
- attach a PEAK EARNINGS warning on that basis
- force a revenue-decline bear case on it

It runs the margin diagnostics and says the window is short. That is the whole of what the data supports.

**Provisional thresholds:** <5 / 5–9 are red-team judgment with no observations (Appendix B). The direction of error is suppression, so a wrong threshold shows less rather than something false. The policy stress margins (current, −25%, −50% relative) likewise have no observations and substitute for a median that does not exist.

### 6.3 Profile recommendation [S recommends, human confirms, overrides or declines]

Software recommends a profile **with the facts that drove it**. The human has three outcomes: **confirm**, **override**, or **Cannot judge**. None is pre-selected and there is no default. Overrides are recorded with their free-text reason. *Cannot judge* records no reason — requiring an explanation from an analyst who has just said they cannot assess the question produces text nobody can act on, and §3.8.4 already sets the rule that a reason is coded where it will be counted and free where it will not.

**Cannot judge — what it does.** The recommended profile is used **provisionally** so the run continues. The profile is recorded as **not human-confirmed**, the qualifying flag **PROFILE NOT CONFIRMED** (§9.4) is raised on the valuation path, and the §10.6 valuation position and its action clause do not render (§10.6.3). Every other output runs normally. *Cannot judge* never counts as confirmation.

**Why the position is suppressed rather than only qualified.** The profile selects the primary valuation method, so an unconfirmed profile leaves the loudest sentence in the report resting on a judgment nobody made. Trust status falls to PARTIAL on the §9.4 flag and the fair-value range still renders. The position does not, and its slot shows the state per §9.5.

Hard auto-assignment is explicitly rejected by the methodology: a cyclical in a peak year looks like a growth company, and a mature company in a capex spike looks unstable. The table is a recommendation rule, not the final word.

**Classification inputs (FACT and [S] except where marked):**

- Revenue: zero / small / large
- Free cash flow: negative / positive but volatile / positive and stable (3+ years)
- Revenue growth: >30%, 10–30%, <10%
- **Capital intensity:** (capex + acquisitions + finance-lease ROU assets obtained in the period) as % of revenue. Operating leases excluded on the §2.1 consistency rule
- **Cyclicality:** the ten-year operating-margin range and the worst single-year margin change. A primary input, not a tiebreaker
- **Balance-sheet nature:** the financial and asset-based case is decided by Gate 0. The asset-light / asset-heavy distinction remaining inside the supported profiles is an **ASSUMPTION the analyst confirms**, informed by capital intensity and the CAPITAL-LIGHT flag. It was marked FACT [S] in earlier versions and is not one

**Profile table:**

| Profile | Primary | Secondary cross-checks | Do not use |
|---|---|---|---|
| Mature, profitable, stable FCF | DCF + reverse DCF | FCF yield, P/E vs own history, EV/EBIT vs peers | EV/Revenue, P/B |
| High-growth, profitable, uncertain durability | Reverse DCF + scenario DCF with explicit revenue paths | Median-margin P/E, EV/EBIT, market-cap vs addressable-profit-pool | Trailing P/E at peak margins, EV/Revenue standalone |
| Pre-revenue / unprofitable | Conditional price-implied break-even success weight + "what has to be true" reverse calc | Cash-per-share floor, runway and dilution path, unit-economics breakeven, implied future revenue at exit multiple | DCF as a point estimate, any current multiple |
| Asset-based | *Not validated. Caught by Gate 0.* | — | — |

### 6.4 Triggers A and B — evaluated separately [S]

Independently of which profile row is chosen. Two different claims needing different evidence.

**Trigger A — MARGIN AT HISTORICAL HIGH.** *A description.* The current operating margin is at or within **2 points** of the maximum of the available window **and** that window's margin range exceeds **15 points**.

**Trigger B — CYCLICAL.** *A claim about the business.* The company has recorded a single-year operating-margin decline of more than **10 points** within the available window.

**Mandatory whenever A or B fires — the diagnostic set:**

- PVGO computed on median-margin NOPAT as well as current NOPAT, with the gap reported
- P/E computed at three margin levels: current, the window median, and one stress level between them (policy stress levels where Gate 1 returned HISTORY INSUFFICIENT)
- The reverse DCF run at **all three** margin levels, not one
- A bear scenario in which the **margin reverts** — not merely growth slowing

**Additional, and only when B fires — the cyclicality set:**

- The **PEAK EARNINGS** label on the own-history multiple percentile, or its suppression
- A bear scenario containing an actual revenue **decline**

**A alone is not evidence of cyclicality.** A software company whose operating margin rose twenty points over a decade of scaling fires A and is not cyclical; asserting a revenue decline in its bear case on that evidence would be a fabrication.

Reference behaviour: Microsoft fires **A only**. NVIDIA fires **both** — its margin is a ten-year maximum and it has cut its operating margin 21 points in a single year within the window.

**Single definition:** the triggers are defined once, here and in §1 of the methodology. The earlier §3.2 "top decile of own history" wording was a second, different trigger for the same test and is deleted. The software must not reintroduce it.

### 6.5 The leverage precondition [S]

§3.4 safeguard 4. Computed, not asserted.

> **net debt ratio = (total debt + finance lease liabilities − cash and marketable debt securities) ÷ enterprise value**, consistent with §2.1. The operating-lease-inclusive ratio is shown beside it as a memo.

**< 10% → PASS.** The band may be applied to firm cash flows as an approximate cost of equity.

**≥ 10% → FAIL → LEVERAGE UNSUPPORTED IN v1.**

Every rate-dependent output returns that state and **no number**:

- scenario DCF and its value per share
- diagnostic reverse DCF
- steady-state EV and PVGO
- implied exit multiple
- ±1% rate sensitivity
- the rate at which the base case equals the price
- the fair-value range

**Still displayed:** the ratio itself, all facts, every multiple that is arithmetically defined, the history and margin diagnostics, the three FCF definitions, the run-rate comparison, the 52-week range.

**Fail closed:** where the inputs needed to compute the ratio are missing, the state is LEVERAGE UNSUPPORTED IN v1, not PASS.

**No remedies are offered.** The two remedies earlier versions named — build a WACC, or switch to equity cash flows at a levered cost of equity — are **both excluded by §10** and are v2 scope. Naming a remedy that does not exist is how a safety test comes to be ignored. The interface must not suggest either.

**The levered-residual exception.** A cash flow that is a **residual after debt** is a separate case and is **not refused**, because it has a working remedy. It is levered by construction regardless of the company-level ratio, and this includes every pre-revenue success case in which project debt or customer prepayments fund the asset. For those:

> r_equity = r_unlevered + (r_unlevered − r_debt) × D/E, with D and E measured at the exit year.

Without this exception the refusal would swallow the entire pre-revenue module. The engineer must implement it as an explicit branch, not as a special case discovered at runtime.

**Per I12:** where the 30% levered cost-of-equity cap binds, the cell is labelled **RATE CAPPED — VALUE IS AN UPPER BOUND**. The cap biases generous and was previously unlabelled.

**Reference behaviour:** Microsoft passes at 0.8% (net *debt* of $30.0B once $66.6B of finance leases are counted, against a $3.78T EV — the sign of its net cash position flips once leases are included). Operating-lease-inclusive memo 1.37%, also PASS. NVIDIA passes at −0.4%. OKLO passes today and **fails in every success case**: at 60% project debt, D/E at exit runs 0.20–3.95 across the six success definitions, giving levered costs of equity from 12.0% up to the 30% cap.

---

## 7. DETERMINISTIC CALCULATION MODULES [S]

Everything in this section is software. No model judgment enters any of it.

### 7.1 Policy constants — identical for every company

| Constant | Value | Status |
|---|---|---|
| Path shape | constant growth years 1–5, linear fade to terminal by year 10, terminal thereafter | fixed |
| Terminal growth | **3.0%** | fixed; never above nominal GDP; >3–3.5% is a red flag |
| Terminal ROIC (diagnostic reverse DCF only) | **r + 3 percentage points** | **PROVISIONAL** — must carry the label "assumes a permanent 3-point return premium for every company" (I16) |
| Rate grid | **8% / 10% / 12%** for every company, with the profile's own band marked | fixed |
| Margin levels | current, window median, one stress level | fixed |
| Discount bands | ~8–9% large stable low-leverage; ~10–12% high-growth or cyclical profitable | fixed by policy |
| Rate minus terminal growth | must be ≥ ~4–5 points | hard constraint |
| Pre-revenue construction lead | **2 years** | **PROVISIONAL** — first-order, worth $27/share on OKLO's 8 GW case |
| Levered cost-of-equity cap | **30%** | **PROVISIONAL** — capped cells labelled RATE CAPPED (I12) |

Four policy constants remain **undefined** and are recorded as LATER in the register: NOPAT tax rate, the stress margin level, the pre-revenue unlevered rate, and project-debt cost. The spec cannot define them without changing the methodology. **They must be surfaced as explicit configuration with their values recorded in every report**, not buried as literals in code.

### 7.2 Module list

Each module states its inputs, its suppression conditions and its output states.

**M1 — Enterprise value and equity bridge.** §2.1 single definition. Suppressed by: nothing. INCOMPLETE if any REQUIRED input missing.

**M2 — Multiples.** P/E (trailing and forward), EV/EBIT, EV/EBITDA, FCF yield on market cap, P/B, EV/Revenue. Each with its own-ten-year percentile.

- **P/E basis rule (I5):** trigger on **|non-operating items| > 5% of pre-tax income** — note this is symmetric, correcting the methodology's gains-only asymmetry. Compute on **GAAP EPS with the item removed after tax**, or show **EV/NOPAT** — price is an equity number and NOPAT is a firm number. The GAAP version is shown only with the item quantified beside it.
- **EV/Revenue rule:** never surfaced on its own. Always with the implied margin needed to reach a normal profit multiple.
- **Percentile:** PEAK-EARNINGS-warned or suppressed where trigger B has fired; **suppressed entirely under HISTORY INSUFFICIENT**; window length printed beside it under SHORT HISTORY.

**M3 — Margin and history diagnostics.** Ten-year (or window) operating-margin range, median, and worst single-year change, displayed beside the current margin as standard. 52-week range, **for every company, without exception**.

**M4 — The three FCF definitions.** §2.6. All three displayed, SBC and working-capital swings shown separately in each. FCF yield shows cash FCF **and** cash FCF − SBC (I6).

**M5 — Reinvestment and RONIC.**

> Reinvestment = capex + acquisitions + finance-lease ROU assets obtained − D&A + ΔNWC
>
> RONIC = trailing five-year change in NOPAT ÷ trailing five-year change in invested capital, invested capital including lease-funded assets

**RONIC state ladder — evaluated in order, per grid cell:**

| Condition | State | Effect |
|---|---|---|
| Δ invested capital ≤ 0 | **RONIC NOT MEANINGFUL** | diagnostic reverse DCF → **NOT COMPUTABLE** |
| Δ NOPAT ≤ 0, or computed RONIC ≤ 0 | **RONIC NOT MEANINGFUL** | diagnostic reverse DCF → **NOT COMPUTABLE** |
| 0 < RONIC < the rate in that cell | **LOW RONIC — VALUE-DESTROYING GROWTH** | **computed and returned with the flag**, plus the direction of the value–growth relationship; where value falls as growth rises, additionally labelled **INVERTED — HIGHER GROWTH LOWERS VALUE** and read as a ceiling |
| RONIC > 200% | computed at 200%, **RONIC CAPPED AT 200%** | display guard, not a valuation |
| otherwise | computed | — |

**Evaluated per grid cell** because "the rate in that cell" differs across 8/10/12%. A company with a computed RONIC of 9% is clean at 8% and LOW RONIC at 10% and 12%. The engineer must not evaluate the ladder once per company.

**CAPITAL-LIGHT flag:** where computed RONIC exceeds 60%, flag CAPITAL-LIGHT and additionally express reinvestment as **working-capital intensity (ΔNWC ÷ Δrevenue)**. Independent of the ladder; can fire alongside the cap.

**Per I13:** print the **direction of the five-year lag bias** beside RONIC, derived from whether capital intensity rose or fell over the window. The bias is conservative during a capex acceleration and generous after a capex pause.

**When RONIC is NOT MEANINGFUL, everything not built on it still runs:** PVGO, every multiple, the history and margin diagnostics, and any terminal share produced by another route.

**M6 — Steady-state EV and PVGO.** Steady-state EV = median-margin NOPAT ÷ discount rate. PVGO = current EV − steady-state EV. PVGO ÷ EV is the fraction of value that is a bet on future growth. **The comparison must be EV to EV.** Where trigger A or B has fired, both current and median-margin are shown with the gap called out. Suppressed where there is no NOPAT to normalise, and where LEVERAGE UNSUPPORTED IN v1 is active.

**M7 — Diagnostic reverse DCF.** The 8/10/12% grid × three margin levels. Every input is a filed fact or a policy rule; nothing is chosen.

Reported as: **years 1–5 growth AND the equivalent ten-year CAGR AND the year-10 revenue.** All three, always. The five-year figure alone reads as far more demanding than the same path actually is — Microsoft's price requires 18.5% for five years at r = 8%, which is a **13.7% ten-year CAGR**, at the low end of its own 13.8–14.7% history rather than above it.

RONIC printed beside every implied-growth figure **together with its state**.

**Degenerate solver outputs** — a state, never a number:

| Condition | State |
|---|---|
| Search bracket contains no root | **NO SOLUTION IN RANGE** — reported with the bracket and the value at each end |
| Value function not monotone in growth across the bracket | **NOT COMPUTABLE** |
| Terminal share of value exceeds 100% | **DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE** |

**Comparability claim — the only one permitted in the interface:** *the same rule generated every number. The numbers are not independent of the company's capital intensity, which is why RONIC is printed beside every one of them.* The v0 claim that a fixed path shape made this number comparable across companies was false and must not reappear.

**M8 — Terminal diagnostics.** Terminal share of value, reported **every time**. 60–75% normal for a healthy mature company on a ten-year explicit period; >75% caution; >85% the model is a multiple in disguise. A **low** terminal share is also information.

Terminal cash flow consistency: **terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC)**. Do not take final-year FCF × (1+g). Worth 4.5% of value on the Microsoft base case.

**M9 — Implied exit multiple.** Labelled by **the metric it actually divides**. In the manual test a row headed "terminal value / FY36 revenue" was in fact terminal value ÷ FY36 EBIT, and the required cross-check was never performed. The label is not cosmetic.

**M10 — Rate sensitivity.** ±1% always shown. Reported **beside the terminal share, with the statement that it is close to a deterministic function of terminal share, not an independent signal about the company.** Not used as a standalone red flag.

**M11 — FCF yield + growth.** Precondition test: **(capex + lease additions) ÷ D&A between roughly 0.8× and 1.5×, and FCF conversion within its own ten-year normal range.** On failure the output is **PRECONDITION FAILED / NOT APPLICABLE**, never a number. Failed on both companies where it was defined; a conditional output, not a standard one.

**M12 — Run-rate comparison, with the seasonality test [S].**

The base-year rule (§3.1) fires where sequential revenue growth exceeds ~10%. **Per I4, the seasonality test gates it.**

> **Seasonality test.** Before the run-rate is computed, examine **the same fiscal quarter in each of the prior two years**. Where that quarter's sequential growth was below 10% in **both** prior years, the current sequential growth is not a seasonal artefact and the run-rate rule triggers normally.
>
> Otherwise — where the same quarter showed sequential growth of 10% or more in **either** prior year — return **SEASONAL — RUN-RATE SUPPRESSED**.

**REQUIRED inputs:** quarterly revenue for the current quarter, its immediate predecessor, and the same fiscal quarter plus its immediate predecessor in each of the prior two years. Missing any of these returns **INCOMPLETE** for the test — which, per the fail-closed rule in §5.3, means the run-rate is **not** computed. Absence of the history that would prove non-seasonality is not evidence of non-seasonality.

**On SEASONAL — RUN-RATE SUPPRESSED:** the annualised run-rate is not computed or displayed for revenue, NOPAT, any multiple or the steady-state value. TTM stands alone. The state is displayed wherever a run-rate figure would have appeared, with the quarter and the prior-year growth figures that triggered it.

**Where the test passes:** the run-rate is shown **alongside** TTM, never instead of it, for revenue, NOPAT, every multiple and the steady-state value.

**Reference behaviour:** NVIDIA's TTM understated its run-rate by 27% and the test should pass there — the growth is not a seasonal pattern repeating in the same quarter. A retailer's Q4 should return SEASONAL — RUN-RATE SUPPRESSED.

**Provisional:** the >10% sequential trigger is calibrated on NVIDIA only (Appendix B). The seasonality test's own 10% prior-year threshold comes from I4 and has no observations behind it. Both carry the PROVISIONAL label.

**M13 — SHAPE MISMATCH flag.** Where guided or known near-term growth differs from the implied constant by more than ~15 points. On a mismatch the scenario-based answer leads and the fixed-shape number is shown as secondary.

**M14 — Sensitivity.** One-at-a-time tornado; two two-way tables (growth × margin, discount rate × terminal growth). **Each row and column of a two-way table must be a coherent path, not a spliced one.** Suppress by profile: an input whose full plausible range moves value by less than ~10% is not displayed.

**Per I10:** **debt share is removed from the sensitivity table.** It is value-neutral by construction (MM without taxes or distress) and was misreported as a tested sensitivity. Debt availability is added to the named unmodelled risks instead.

**M15 — Scenario outputs.** Scenario values; probability-weighted distribution **as display only, never a headline**; location of current price within the scenario range; the discount rate at which the base case equals the price; the fair-value range per §10.

**M16 — Pre-revenue module.** Cash per share on the latest share count adjusted for burn to today; quarterly burn; runway; unit-economics breakeven; the four-line funding stack under **both ramps**; dilution required; the conditional price-implied break-even success weight per success definition.

Funding stack order, all four lines displayed:

> 1. Project debt (ASSUMPTION: share of capex, and cost)
> 2. Customer prepayments and non-dilutive funding (FACT where contracted, ASSUMPTION otherwise)
> 3. **Retained operating cash flow from assets already in service** (INFERENCE from the capacity ramp)
> 4. New equity — the residual, not the first resort

**Line 3 is mandatory.** It was missing from the OKLO manual test.

**Timing rule — the stack is solved year by year, not in aggregate.** Construction cash spend **leads capacity in service** by the construction lead. New equity is raised **only in the years the cash balance would otherwise go negative**, and only in the amount needed. Solving in aggregate lets cash flow from the last reactors pay for the first ones — worth $27 per share on OKLO's 8 GW case.

**Two ramps always shown** — back-loaded and steady. The spread between them is the honest uncertainty; the back-loaded case is the conservative one and is the reference.

Retained cash flow is computed after cash operating costs, corporate overhead, interest on drawn project debt, and tax.

**Unit-economics breakeven runs BEFORE solving for scale.** If each unit destroys value, the "what has to be true" solver returns **NOT ACHIEVABLE AT ANY SCALE** rather than a very large number.

**Conditional price-implied break-even success weight, three defined states:**

| Condition | State returned |
|---|---|
| V_fail < Price < V_success | the weight, rounded to the nearest 5% |
| Price ≥ V_success > V_fail | **PRICE NOT JUSTIFIABLE BY THIS OUTCOME** |
| V_success ≤ V_fail | **THIS SUCCESS IS WORTH LESS THAN FAILURE** |

**Basis rule:** V_fail and V_success must be on the same basis — both a present value as of today, both per **current** share, both after the same dilution treatment. Each is discounted at **the rate appropriate to its own risk**, and both rates are displayed. Same basis means same date, same share base, same dilution treatment — **not** the same discount rate.

**This is not a probability of success.** It is the weight at which the two modelled outcomes break even at today's price — a statement about what the price implies, conditional on those two outcomes being the only ones and on their values being right. It carries no claim about how likely success actually is. Reporting it as a probability would attribute to the model a view it does not hold (CalFinance Methodology v2).

**The third state is a finding, not an error.** In the OKLO rerun two of six success definitions returned it. Rows in that state are the most informative output the model produced and **must be displayed, not dropped**.

**The weight is reported per success definition, never as one number, and never described as a probability of success.**

**Per I7:** where the pre-revenue reference issue price is an assumption, the caveat text is displayed: *"Success values use an assumed future issue price. The grid is the output; the reference row is not a forecast."*

**Per I8:** *"The model raises equity only when cash would go negative. Real companies raise ahead of need, usually on worse terms."*

**Per I9:** *"Build lead is fixed at 2 years and is worth $27/share on the reference case. Treat every pre-revenue success value as conditional on it."*

**Per I11:** *"A start-date shift currently compresses the ramp rather than moving the exit. A real slip moves both."*

### 7.3 Rounding policy [S]

- Scenario and success values: nearest **$5**, or 1% of price, whichever is larger
- Probabilities: nearest **5%**
- Growth and margin: **0.1pt**

**Recorded as LATER (not fixed in v1):** rounding is tested on unrounded values and displayed rounded. The engineer should be aware the two can disagree at a boundary.

---

## 8. AI INTERPRETATION [C] — RESPONSIBILITIES AND HARD LIMITS

### 8.1 The boundary

Deterministic code handles calculations, gates, states and rules. AI interprets, explains, challenges and summarises. **AI does not choose valuation assumptions and does not issue buy/sell decisions.** Calvin is the final decision-maker.

**Amendment M7 did not move this line, and the valuation position does not cross it.** The CHEAP / FAIR / EXPENSIVE position and its action clause (§10.6) are computed by **[S]** from fields the analyzer already holds. They are deterministic, reproducible and auditable — the same inputs always produce the same position. Nothing in §8 is relaxed to make room for them, and an AI-authored headline verdict remains prohibited exactly as before, for the reason recorded in §14: it would be unreproducible and unauditable.

### 8.2 What [C] does

| Where | Responsibility |
|---|---|
| §3.1 | Check the analyst's chosen growth path against base rates and history; say in plain English what would have to be true. **Not choose it** |
| §5 | Identify hypersensitivity as a signal the model is fragile, usually because the terminal dominates or growth and discount rate are close |
| §6 | Translate the price-implied diagnostics into a sentence and compare with base rates and history |
| §10 Step 3 | Assist the analyst in constructing scenarios. The analyst authors them |
| §10 Step 5 | Plausibility of each assumption against base rates and history; internal consistency flags; plain-English statement of what the price requires |

### 8.3 Hard limits

1. **[C] issues no verdict, no target and no recommendation.** (§10 Step 5.) Not softened, not implied, not phrased as a question that carries one. The CHEAP / FAIR / EXPENSIVE position and its action clause are **[S]** output computed under §10.6: [C] may **restate** the position in prose under §10.7, and may not author one, vary one, soften one, qualify one, or reason toward one of its own. Where the position is suppressed, [C] reports the state and says nothing in its place — limit 5 applies to the position exactly as it applies to any other suppressed output.
2. **[C] may cite base rates only from supplied data, never from memory. Otherwise it must say none is available.** (I18.) This is the single most important limit in this section — it is the direct control on the failure path §3 exists to prevent.
3. **[C] does not supply facts.** It reads the fact set. Any figure in [C] output that is not traceable to the acquired fact set is a defect.
4. **[C] does not choose assumptions.** Discount band and terminal growth come from policy. Scenarios come from the analyst.
5. **[C] does not override a state.** Where a module returned INCOMPLETE, NOT COMPUTABLE, UNSUPPORTED PROFILE or any other suppressing state, [C] reports the state. It does not reason around it, estimate past it, or describe what the number would probably have been.
6. **[C] does not aggregate or vote.** No multi-persona structure, no confidence tallies, no synthesis of several generated opinions into a score. (§13.)

### 8.4 Required [C] behaviour on missing base rates

Where the supplied data contains no base rate for a comparison the interpretation would naturally make, [C] states that none is available and stops. It does not substitute a remembered figure, a plausible range, or an unattributed general claim.

### 8.5 The blind challenger — a separate call

The counter-case is produced by an **independent call that has not seen the analysis**. It is not produced by the §8.2 interpretation layer.

**Why separate.** A counter-case generated from the same reasoning context as the base case is not disconfirming evidence; it is the same conclusion wearing an opposing label. It will find the objections the base case already anticipated and miss the ones it did not. Blinding is the whole mechanism — remove it and the feature returns nothing the interpretation layer did not already contain.

#### 8.5.1 What the challenger receives

- The **verified fact set** (§3), with all six per-fact fields intact
- Any **thesis or company claims** available to v1 — the analyst's stated reasons for interest in the company, where present
- Gate results and active states, so it does not challenge a suppressed output

#### 8.5.2 What the challenger must not receive

Enforced by the call boundary, not by instruction:

- analyst base-case reasoning
- the fair-value or scenario range
- any valuation output
- the implied-growth conclusion
- the analyst's conclusion
- any output of the §8.2 interpretation layer

**Implementation requirement:** the challenger's input is assembled from the fact set and thesis claims **by construction** — a filtered payload built for this call — not by passing the full analysis context with an instruction to ignore parts of it. An instruction to disregard is not a boundary.

#### 8.5.3 What the challenger returns

Structured disconfirming evidence. Each finding carries:

- the **claim or fact** it bears on, referenced by its record
- the **evidence**, traceable to the supplied fact set
- **what would have to be true** for the finding to matter

The challenger returns findings, not a verdict. §8.3 limits apply to it in full: no verdict, no target, no recommendation, no base rates absent from supplied data, no facts it was not given.

#### 8.5.4 Merge ordering

The challenger's output is merged into the final report **only after the independent call has completed**. The merge is assembly, not synthesis — findings are placed alongside the analysis, not reconciled with it, and neither side is rewritten in light of the other.

**No personas, no voting, no scoring.** One challenger call, one set of findings. Any structure that samples several opinions and tallies them is prohibited by §13.1 and by §8.3 limit 6.

---

## 9. REFUSAL, SUPPRESSION AND WARNING STATES

### 9.1 The refusal register — reproduced verbatim

This table is the source of truth. It is reproduced from the caveat register **without paraphrase, without splitting rows, and without omission**. Five of eleven rows are enforced in v1.0.2.

| Company type | Enforced in v1.0.2 by |
|---|---|
| Banks, insurers, brokers, balance-sheet asset managers; REITs; E&P, mining and reserve-based resources | **Gate 0** |
| Any company failing the leverage test | **LEVERAGE UNSUPPORTED IN v1** |
| Fewer than five filed years in a profitable profile | **Gate 1 — HISTORY INSUFFICIENT** (suppression, not refusal: the margin diagnostics still run) |
| Unclassifiable companies | **Gate 0, fail-closed** |
| Bankruptcy or restructuring; SPACs; holding companies | **NOT ENFORCED** — product-spec requirement |
| Non-USD reporters (warn) | **NOT ENFORCED** — I20 |
| Seasonal businesses (warn) | **NOT ENFORCED** — I4 |
| Material convertibles or preferreds (warn) | **NOT ENFORCED** — LATER |
| Pre-revenue non-owner-operators, e.g. biotech (warn) | **NOT ENFORCED** — I19 |
| RONIC NOT MEANINGFUL (warn) | **Enforced** — B1 |
| Incomplete required inputs (warn) | **NOT ENFORCED** — I14 |

### 9.2 The six unenforced rows as product-spec requirements

Every unenforced row is carried forward here with an explicit **v1 status**.

Five of the six are implemented in v1. Only R4 is deferred, and only because the register itself labels that item LATER rather than assigning it to the product spec.

| # | Row | Requirement | v1 status |
|---|---|---|---|
| R1 | Bankruptcy or restructuring; SPACs; holding companies | Detect and **warn**. Bankruptcy/restructuring: going-concern qualification or Chapter filing present. SPAC: pre-combination shell structure. Holding company: value is primarily stakes in other entities, for which no validated method exists in v1 | **SPECIFIED — v1** |
| R2 | Non-USD reporters | Bands are **nominal USD** for nominal USD cash flows (§3.4 safeguard 3). Warn on a non-USD reporter until a currency rule exists (I20) | **SPECIFIED — v1** |
| R3 | Seasonal businesses | Seasonality test on the run-rate rule: trigger only where the same quarter's sequential growth in the prior two years was below 10%, otherwise **SEASONAL — RUN-RATE SUPPRESSED** (I4) | **SPECIFIED — v1** |
| R4 | Material convertibles or preferreds | Warn where convertibles or preferreds are material. Related open item: preferred/minorities/pensions are named in §2.1 but missing from the bridge formula | **SPECIFIED — DEFERRED** (register: LATER) |
| R5 | Pre-revenue non-owner-operators | Label the pre-revenue profile's validated scope as **owner-operator infrastructure** and warn outside it. A pre-revenue biotech or software company has no capex-per-unit-of-capacity structure and the module does not describe it (I19) | **SPECIFIED — v1** |
| R6 | Incomplete required inputs | Full §4 and §5 implementation: REQUIRED/OPTIONAL marking, INCOMPLETE propagation, UNVERIFIED propagating like SECONDARY (I14) | **SPECIFIED — v1** |

**R2 note on an ambiguity in the source:** I20 says "Warn or refuse on non-USD reporters until a rule exists"; the refusal register row says "(warn)". This spec implements **warn**, following the register row as the more specific statement. Flagged rather than assumed.

### 9.3 States that suppress output — one place [S]

| State | Trigger | What is suppressed |
|---|---|---|
| **UNSUPPORTED PROFILE** | Gate 0 | all valuation outputs |
| **HISTORY INSUFFICIENT** | Gate 1, < 5 filed years | own-history percentile; history-based normalisation (policy stress levels substitute); any cyclicality label |
| **LEVERAGE UNSUPPORTED IN v1** | §3.4 safeguard 4 FAIL, or its inputs missing | every rate-dependent output |
| **RONIC NOT MEANINGFUL** | §3.3 ladder rows 1–2 | the diagnostic reverse DCF (NOT COMPUTABLE) |
| **NOT COMPUTABLE / NO SOLUTION IN RANGE / DEGENERATE** | §3.3 degenerate solver outputs | the affected reverse-DCF cell |
| **PRECONDITION FAILED** | §8.2 | FCF yield + growth |
| **NOT ACHIEVABLE AT ANY SCALE** | §8.6 | the "what has to be true" solve |
| **SUCCESS WORTH LESS THAN FAILURE / PRICE NOT JUSTIFIABLE** | §2.9 | the conditional price-implied break-even success weight for that definition |
| **SEASONAL — RUN-RATE SUPPRESSED** | §7.2 M12 seasonality test (I4) | the annualised run-rate for revenue, NOPAT, every multiple and the steady-state value |
| **INCOMPLETE** | missing REQUIRED input (I14) | every dependent output |

### 9.3.1 UNSUPPORTED INSTRUMENT — a rejection, not a suppression

**UNSUPPORTED INSTRUMENT** is deliberately **not** in the §9.3 table, and the distinction is not pedantic.

| | The ten §9.3 states | UNSUPPORTED INSTRUMENT |
|---|---|---|
| When | During a run | At Step 1, before a run exists |
| What it does | Removes an output from a report that still renders | Prevents the run; there is no report |
| Where it displays | At the point of use, inside the report | On the entry screen, as the reason the ticker was refused |

Trigger: Step 1 identity resolution returns an instrument that is not a **listed operating company** — a fund, an index, or a currency or crypto pair (§1.2, §2).

Consequently the §9.3 table still holds **ten** states. The §9.4 list held **twelve** flags and the design's state vocabulary twenty-two items when this paragraph was written; amendment M7-b added PROFILE NOT CONFIRMED, taking them to **thirteen** and **twenty-three**. Neither count is changed by the UNSUPPORTED INSTRUMENT reasoning above. Criterion B8 is unaffected. UNSUPPORTED INSTRUMENT needs an entry-screen treatment, not a report-cell treatment, and §14 records that as a design follow-up rather than resolving it here.

### 9.4 Flags that qualify rather than suppress

LOW RONIC — VALUE-DESTROYING GROWTH · INVERTED — HIGHER GROWTH LOWERS VALUE · RONIC CAPPED AT 200% · CAPITAL-LIGHT · SHORT HISTORY · MARGIN AT HISTORICAL HIGH · PEAK EARNINGS · SHAPE MISMATCH · RATE CAPPED — VALUE IS AN UPPER BOUND · SECONDARY · UNVERIFIED · AI-EXTRACTED · PROFILE NOT CONFIRMED.

PROFILE NOT CONFIRMED (§6.3) belongs in this list. It qualifies the analysis — the fair-value range and every module still render — and removes exactly one output, the §10.6 position and its action clause. That single removal is named in §10.6.3 rather than here. It is not a §9.3 state: §9.3 states remove the range, and this one does not, which is also why trust status resolves to PARTIAL rather than UNUSABLE.

SEASONAL — RUN-RATE SUPPRESSED is **not** in this list. It suppresses rather than qualifies, and appears in §9.3.

### 9.5 The suppression principle

**Where any suppressing state is active there is no fair-value range. The state is the output.**

A suppressed output is displayed as its state. It is never displayed as blank, as zero, as "n/a" without the reason, or as a number with a warning glyph. The last of these is specifically prohibited: four Microsoft reverse-DCF cells were printed as numbers with a warning glyph in v1.0.1 and B1 corrected them to states.

---

### 9.6 Trust status — how much of this analysis can be used

One status per run, computed by **[S]**, displayed on page one. Three values, all introduced by amendment M7:

| Status | Meaning |
|---|---|
| **CLEAN** | Every output this run produces can be used as it stands |
| **PARTIAL** | The analysis stands, and named parts of it do not. The status names which |
| **UNUSABLE** | Not enough of the analysis survived its own states to be used at all |

**Derivation — evaluated in this order, first match wins.** Every input is a state this document already computes; nothing new is measured.

1. **UNUSABLE** — a §9.3 suppressing state removes the fair-value range under §10.3, **or** a REQUIRED input of the range is INCOMPLETE. The range does not render, and neither does the §10.6 position.
2. **PARTIAL** — the range renders, and any of: a §9.4 qualifying flag is active on the valuation path; a material fact is NOT CONFIRMED; a §3.8.2 cross-check failed; a REQUIRED input of any other output is INCOMPLETE.
3. **CLEAN** — the range renders and none of the above holds.

**UNUSABLE is a statement about the analysis, not about the investment.** It says this run cannot tell you what the company is worth. It does not say the company is bad, and no copy may let it be read that way.

**The instruction is delivered by behaviour, not by wording.** The third status is named UNUSABLE rather than DO NOT RELY because CLEAN and PARTIAL both answer *how much of this analysis can I use*, and an instruction to the reader would change dimension halfway through a three-item set. Under UNUSABLE the page **refuses to render the range** — which is the instruction, enforced rather than requested.

**Trust status is not gated on the §1.1 override and is v1 regardless of it.** It describes the analysis and asserts nothing about price. Its report-level home is the `trust` member of the Analysis Result (§10.0.1).

---

## 10. OUTPUT STRUCTURE

### 10.0 The analysis result is the output; the report is a rendering of it

**v1 returns a defined machine-readable Analysis Result.** The narrative report in §10.2 is rendered *from* that object. The object is the product's output; the prose is a view.

**Why this is a v1 requirement and not a later refactor.** A future Thesis Record must be able to ingest analyzer output **without parsing generated prose**. A system that emits only a narrative forces its own successor to re-extract facts from text — which is the AI-EXTRACTED path in §3.2, applied to the system's own output, and the exact failure mode §3 exists to prevent. Retro-fitting a schema after the renderer exists means reconstructing provenance that was never carried.

**Thesis Record is not built in v1** (§13.1). This requirement is only that the analyzer's output be ingestable by it.

**One contract, not several.** The Analysis Result is the analyzer's single output contract. Where a downstream need arises that this object already covers, it is met by consuming this object — not by defining a second schema, an export format, or a parallel record. A second contract is only warranted if a need appears that this one genuinely cannot express, and that is a decision for Command Center, not an implementation choice.

#### 10.0.1 Required top-level members

| Member | Contents |
|---|---|
| `facts` | Every acquired fact with all six §3.2 fields: type, source, source class, extraction type, verification state, as-of/period date, retrieval timestamp |
| `provenance` | The derivation graph: which facts fed which computed values, carrying source class and extraction type as **two independent labels per edge** |
| `gates` | Gate 0, Gate 1 and the leverage precondition, each with its computed inputs, result and any override with its recorded reason |
| `states` | Every active suppressing state (§9.3) and qualifying flag (§9.4), each bound to the output it applies to |
| `diagnostics` | Modules M1–M14, each value carrying its own states, flags and inherited labels |
| `scenarios` | The three analyst scenarios with drivers, written anchors, per-scenario share counts and explicit revenue paths where used |
| `price_implied` | Steady-state EV and PVGO, the reverse-DCF grid with RONIC and its per-cell state, implied exit multiple with the metric it divides |
| `challenger` | The §8.5 findings, each with its claim reference, evidence reference and what-would-have-to-be-true |
| `interpretation` | The §8.2 output, with each statement referencing the values it rests on |
| `policy` | Every policy constant in force for this run, including the four undefined ones (§7.1), and every PROVISIONAL threshold with what it was calibrated on |
| `trust` | The §9.6 trust status — CLEAN / PARTIAL / UNUSABLE — with the states and facts that determined it |
| `position` | The §10.6 valuation position and its action clause, with the price, range location and required-versus-achieved gap they were computed from — or the state that replaced them |

**Twelve members.** `trust` and `position` were added by amendment M7; criterion G1 counts twelve accordingly.

#### 10.0.2 Contract rules

1. **Every number in the result carries its states and labels in the same object.** A value and its qualifications are never separated such that one could be read without the other.
2. **A suppressed output appears as its state**, not as null, absent or zero. The state is a value.
3. **No figure appears in the rendered report that is not in the result object.** The renderer adds formatting and prose; it adds no content.
4. **`challenger` is populated only after the independent call completes** (§8.5.4) and is never merged into `interpretation`.
5. **Schema versioned** and recorded in every result, so a later consumer can tell what it is reading.

### 10.1 Ordering principle

The report is ordered so that **what the market assumes** and **what the analyst assumes** are never shown alone. Per §10 Step 4: *the range says what you assume; the diagnostics say what the market assumes. Neither is shown alone.*

### 10.2 Report sections, in order

**A — Header and states.** Company, ticker, price with timestamp, profile (recommended / confirmed / overridden, with the override reason where applicable), and **every active state and flag**, before any number.

**B — Fact set with provenance.** Every material fact with its value and all six §3.2 fields: type, source, source class, extraction type, verification state, as-of date, retrieval timestamp. Material AI-extracted facts are **visibly marked** here and at every other point of display.

**C — Gate results.** Gate 0, Gate 1, leverage precondition, with the computed ratio and both memo lines.

**D — Deterministic diagnostics.** Modules M1–M14, each carrying its states and flags at the point of display.

**E — Price-implied diagnostics.** Steady-state EV and PVGO share; the diagnostic reverse-DCF grid with RONIC and its state beside every cell; implied exit multiple labelled by the metric it divides.

**F — Analyst scenarios.** Three scenarios, each with its drivers set together, its anchors written down, and its own share count where financing differs. Explicit year-by-year revenue paths where a constant growth rate does not describe the company.

**G — Scenario outputs.** Values; probability-weighted distribution as display only; price location within the range; the discount rate at which base equals price; sensitivity per M14.

**H — Fair-value range.** Rules below.

**I — Interpretation [C].** Per §8.2.

**I2 — Challenger findings.** Per §8.5, presented as findings alongside the analysis, not reconciled with it. Each finding shows the claim or fact it bears on, its evidence, and what would have to be true for it to matter.

**J — Provisional and unmodelled register.** Every PROVISIONAL threshold in use with what it was calibrated on; the four undefined policy constants with their configured values; the named unmodelled risks including debt availability (I10).

**Investment case — at a glance.** The closing restatement approved as CC-1A and CC-1B, renders after J. It restates only members already in the Analysis Result — `scenarios`, `price_implied`, `states`, `challenger`, `facts` — and, per amendment M7, `trust` and `position`. **The §10.6 valuation position and its action clause render here and on page one, and nowhere else.** No new calculation, no new [C] call, no new state and no new figure. Pre-revenue reports omit the bear/base/bull strip and keep the §10.3 distribution summary.

### 10.3 Fair-value range rules

- **Always a range, never a point.** Bounds = bear and bull scenario values; the probability-weighted value is shown **inside** it, not as the headline
- **Always labelled INFERENCE**, with the three inputs that drive it named beside it
- **Always shown next to the price-implied diagnostics from §10 Step 2** — the methodology's step, not this document's user flow
- **Where trigger A or B has fired**, the range carries the warning: *the bounds are scenario labels, not confidence bounds*
- **Where any suppressing state is active** — UNSUPPORTED PROFILE, LEVERAGE UNSUPPORTED IN v1, or a NOT COMPUTABLE reverse DCF — **there is no fair-value range. The state is the output**
- **For pre-revenue companies** the range is the distribution summary — failure / success-as-commonly-described / success-as-the-price-requires — plus the cash floor. **Do not compress it to bear/bull bounds**
- **The range is not itself a verdict and does not become one.** The §10.6 position is computed *from* the range and the required-versus-achieved gap. It is not a property of the range, never replaces it, and never compresses it: the full range renders, with the position beside it. Where the range does not render, neither does the position

### 10.4 Required caveat text

The eight v1 caveats from the register carry display text. Those with fixed wording (I7, I8, I9, I11) are reproduced in §7.2. I10, I12, I13 and I16 are behavioural and are implemented in their modules. I16's label must state that it **assumes a permanent 3-point return premium for every company**.

### 10.5 Prohibited output patterns

- A number with a warning glyph where a state is defined (§9.5)
- A sensitivity table whose range spans the current price, presented as evidence of fair value
- A single "implied probability of success" figure not tied to a named success definition
- A probability-weighted mean as a headline value
- Any multiple presented without its own-history context where that context exists
- EV/Revenue standalone
- Any consensus figure derived from the price
- Any **price target**, and any single-number fair value
- Any **portfolio action** — trim, add, sell, hold, or any wording implying position size, cost basis or existing exposure
- A **[C]-authored position**, or [C] prose that varies, softens, hedges or reasons toward one (§8.3 limit 1)
- The §10.6 **position or its action clause rendered under suppression** — under any §9.3 state, under UNUSABLE trust, or where the range failed
- A **number originating from the model** anywhere on page one or in the closing section (§10.7)
- A counter-case produced by the interpretation layer rather than the blind challenger
- A material AI-extracted fact displayed without a visible extraction-type marker
- Any figure in the rendered report that is not present in the Analysis Result object

---

### 10.6 The valuation position and its action clause

Authorised by Calvin's recorded override of 6 September 2026 (§1.1, §14). One position per run, computed by **[S]**.

#### 10.6.1 Vocabulary

The four values are **CHEAP · FAIR · EXPENSIVE · INCONCLUSIVE**, per CalFinance Methodology v2. Each is a positive claim about what the evidence supports — CHEAP undervaluation, FAIR roughly fair valuation, EXPENSIVE overvaluation, and INCONCLUSIVE that material valuation evidence conflicts or is insufficient. **INCONCLUSIVE is not FAIR**, and the distinction is the point: FAIR asserts the company is roughly fairly valued, which is a finding, while INCONCLUSIVE reports that no finding is supported. This vocabulary lives here and deliberately not in §9: §9 catalogues what the analysis could not do, and a position — INCONCLUSIVE included — is the analysis succeeding and reporting a finding, not a limitation; a CLEAN run with complete data can return INCONCLUSIVE, and that is the machinery working as designed, not a trust or suppression event (ruled, amendment M8). Not bull / bear / hold, for two reasons that are not stylistic:

- **HOLD collides with a portfolio-layer state.** The Investment Methodology's HOLD is an output about a position, requiring position size, cost basis and portfolio context — which §1.4 forbids this analyzer from receiving. Reusing the word would make a one-company statement look like a portfolio one.
- **Bull and bear are sentiment words for what is arithmetic.** The position is a comparison of price against a computed range and a computed gap. CHEAP / FAIR / EXPENSIVE is price-scoped, one-company, and free of any implied action on its own.

#### 10.6.2 Derivation — deterministic, never a [C] call

Both inputs are fields the analyzer already computes. Nothing new is measured and no model is called.

| Input | Source |
|---|---|
| **Price location within the scenario range** | §10.2 section G, already computed and already displayed |
| **The required-versus-achieved gap** | M7's implied growth — the five-year figure, the ten-year CAGR and year-10 revenue — read against the company's own achieved history on a consistent accounting basis (§3.7) |

**The comparator fact is REQUIRED.** The achieved figure must be a section B fact **on the same series and the same horizon** as the implied-growth figure it is read against. A ten-year implied CAGR is compared to a ten-year achieved CAGR of the same series, on the same accounting basis, or it is not compared at all. Where no such fact exists, the gap is **INCOMPLETE**, and the position and its action clause do not render.

**Two horizons are valid, and the horizon travels with the result** (CalFinance Methodology v2, ruled 8 September 2026). Ten years is preferred. **A five-year comparator is permitted where a valid ten-year one cannot be constructed** — which is the common case rather than the exception: ASC 606 split most filers' revenue across two tagged elements partway through the decade, and §3.7 refuses to join two series into one comparator, so only a minority of companies can produce a ten-year figure at all.

**Five-year and ten-year comparators are related but not semantically identical**, so the horizon is carried with the figure and is never implied. **Both sides must be the same horizon**: a five-year achieved comparator is read against a five-year required-growth figure. Mixing the two sides is not a fallback, it is a different comparison.

**No cross-series stitching.** §3.7's refusal stands, and a five-year window that spans a tag change is not a valid five-year comparator.

**Where neither horizon can be constructed, the growth input is UNAVAILABLE and the position is INCONCLUSIVE.** It does not degrade to a weaker reading, and it does not fall back to FAIR — FAIR is a positive claim, not the absence of one.

**For calibration:** observations from the two horizons are not pooled without evidence that common thresholds hold across them. Whether they do is a testable question and must be answered from observations rather than assumed. Where they do not, thresholds are calibrated per horizon.

**Bands and the disagreement rule are policy constants**, recorded in `policy` (§10.0.1) and marked **PROVISIONAL** with what they were calibrated on. Two rules are fixed here and are not configuration:

1. **The same inputs always produce the same position.** No per-company adjustment, no override, no model in the path.
2. **Every position requires positive agreement from both inputs.** CHEAP requires both to read cheap, FAIR requires both to read fair, EXPENSIVE requires both to read expensive. **Anything else is INCONCLUSIVE** — whether the two point in opposite directions or one is simply not enough to support a finding.

   This corrects an earlier rule that sent disagreement to FAIR. FAIR is a claim that a company is roughly fairly valued; making it the fallback meant asserting that claim on the strength of two inputs that agreed about nothing — a finding produced by silence. Under CalFinance Methodology v2, INCONCLUSIVE carries that case and says what is true: the evidence does not support a position.

   It still fails toward saying less. It now does so without saying something else instead.

**Why deterministic and not an AI call, recorded because it will be asked again:** an AI-authored headline verdict would be unreproducible and unauditable. Two runs on identical inputs could differ, and neither could be traced. That is the failure §3 exists to prevent, applied to the loudest sentence in the report.

#### 10.6.3 It never renders under suppression

The position renders only where **all three** hold:

- a valuation range exists (§10.3), **and**
- trust status is **CLEAN** or **PARTIAL** (§9.6), **and**
- **PROFILE NOT CONFIRMED** is not active (§6.3, §9.4).

Under **UNUSABLE**, under **PROFILE NOT CONFIRMED**, under any §9.3 suppressing state, or where the range failed, the slot shows **the state** — not a position, not a hedge, not a softened verdict, not an empty frame. OKLO with nine of nine reverse-DCF cells failed must say the model has nothing to say, and must say it in that slot rather than leaving the reader to infer it from an absence.

#### 10.6.4 The action clause

**The label alone is not the deliverable.** Beneath the position, page one states the required figure against the achieved figure and what follows from the gap, in plain sentences:

> The price requires 14% a year. The company has delivered 13.8% over ten years. Not a price to start a position at.

**Form rules:**

- Plain sentences. **Never a second all-caps token** beneath the first — the position carries the only label in the block.
- The required figure and the achieved figure are both **named and shown**, never summarised as "above" or "below".
- Both numbers come from the Analysis Result by substitution (§10.7). Neither is written by a model.

**ENTRY-SIDE ONLY IN v1.** The clause may say **start**, **do not start**, or **wait for a better price**. It may never say trim, add, sell or hold — those are statements about a position, and they need the position size and cost basis §1.4 forbids the analyzer from holding. This is a hard boundary, not a default.

**The action clause never renders under suppression**, on the same rule as the position in §10.6.3. It is not rendered separately, and it does not survive a suppressed position.

#### 10.6.5 Decided now, built with milestone M8

The comparator of §10.6.2 requires a section B fact on the same series and horizon as the implied-growth figure, and **that fact may not exist in the current fact set**. Acquiring it is milestone M8 work, alongside §3.8.1 and §3.8.2.

**This is sequencing, not deferral.** The ruling is made, this section is the contract, and M8 builds against it. A later session may not reopen the decision on the grounds that the comparator was not ready.

### 10.7 Page one — how its sentences are produced

Page one carries the position, the action clause and the Quick Read. It is the most-read surface in the product and the one where a fabricated number would do the most damage, so its composition is specified rather than left to the renderer.

**Three rules.**

**1 — Fixed-shape sentences are deterministic templates.** Any sentence whose shape does not vary between companies is a **template with substitution slots**, filled from the Analysis Result. The action clause of §10.6.4 is the worked case: its shape is fixed, and only its figures and its verb change. Templates are [S]. No model is called to produce them, and no model may rewrite one after it is filled.

**2 — Variable prose is a constrained [C] call.** Where the sentence genuinely varies — the main finding, what supports the case, what worries Calboard, the biggest uncertainty — it comes from a **[C]** call under the full §8.3 limits. It restates values already in the result object; it introduces nothing.

**3 — Numbers never originate from the model.** Every figure on page one is **substituted from the Analysis Result**, in both mechanisms. A [C] call may reference a number by its result-object slot; it may not emit a numeral, and a numeral emitted by [C] is a defect rather than a value to be checked. This closes the failure path §10.0.2 rule 3 names, at the surface where it would be least likely to be caught: page one is read first, quoted most, and checked least.

**Consequence for the renderer.** A page-one sentence has exactly two legitimate provenances — a filled template, or a constrained [C] call carrying slot references. There is no third path, and prose assembled by any other route does not render.

---

## 11. VALIDATION CASES

Eight cases. The first three are the red team's recommended software validation runs; the next three are the calibration companies; the last two exercise the fail-closed paths.

### 11.1 V1 — Levered non-financial

**Expect:** leverage precondition FAIL → **LEVERAGE UNSUPPORTED IN v1**, cleanly.

**Confirm suppressed:** scenario DCF and value per share, diagnostic reverse DCF, steady-state EV and PVGO, implied exit multiple, ±1% sensitivity, rate at which base equals price, fair-value range.

**Confirm still displayed:** the ratio itself, all facts, arithmetically defined multiples, history and margin diagnostics, the three FCF definitions, run-rate comparison, 52-week range.

**Confirm absent:** any suggestion of a remedy.

### 11.2 V2 — Short-history profitable IPO

**Expect:** Gate 1 → **HISTORY INSUFFICIENT**, cleanly.

**Confirm suppressed:** own-history multiple percentile.

**Confirm running:** margin and stress diagnostics, with policy stress levels (current, −25%, −50% relative) substituting for the absent median.

**Confirm absent:** any CYCLICAL label, any PEAK EARNINGS warning, any forced revenue-decline bear. Confirm no statistic is described as ten-year.

### 11.3 V3 — Seasonal retailer

**Expect:** the seasonality test detects that the same fiscal quarter showed sequential growth of 10% or more in a prior year, and returns **SEASONAL — RUN-RATE SUPPRESSED**, cleanly.

**Confirm suppressed:** the annualised run-rate for revenue, NOPAT, every multiple and the steady-state value. Confirm **no flattering run-rate is computed anywhere**, including internally as an input to another module.

**Confirm displayed:** TTM standing alone; the state shown wherever a run-rate figure would have appeared; the quarter and the prior-year growth figures that triggered it.

**Confirm the fail-closed path:** run the same retailer with one of the required prior-year quarters removed from the fact set. The test returns **INCOMPLETE** and the run-rate is still not computed. Absence of the history that would prove non-seasonality is not evidence of non-seasonality.

**Note on the register.** An earlier draft recorded this case as expected-to-fail on the basis that v1.0.2 leaves I4 unenforced. That was wrong: the register assigns I4 to the product spec precisely because the methodology does not handle it. All three of the red team's recommended validation runs are expected to return cleanly against this spec.

### 11.4 V4 — Microsoft (mature profitable)

**Expect:** trigger **A only**. Leverage PASS at 0.8%, operating-lease-inclusive memo 1.37% also PASS — and the sign of the net cash position flips once finance leases are counted.

**Confirm:** four reverse-DCF cells return **DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE** (46.8%/12%, 41.8%/12%, 38.0%/10%, 38.0%/12%, at terminal shares of 115%, 120%, 101%, 124%) as **states, not numbers with glyphs**.

**Confirm:** the bear case contains **margin reversion and no revenue decline**, and this does not trigger a rule violation.

**Confirm:** reinvestment 86% of NOPAT on the lease-inclusive measure, not 66%; implied return on new capital 20.9%, not 27.2%.

**Confirm:** implied growth reported as 18.5% five-year **and** 13.7% ten-year CAGR **and** year-10 revenue, at r = 8%.

### 11.5 V5 — NVIDIA (high-growth profitable)

**Expect:** triggers **A and B both**. Leverage PASS at −0.4%.

**Confirm:** RONIC returns **RONIC CAPPED AT 200%** and **CAPITAL-LIGHT** fires alongside it, with reinvestment additionally expressed as working-capital intensity.

**Confirm:** the cyclicality set runs — PEAK EARNINGS label or percentile suppression, and a bear containing an actual revenue decline.

**Confirm:** P/E computed on NOPAT with the ~$24B of equity-investment gains quantified beside the GAAP version.

**Confirm:** run-rate shown beside TTM (TTM understated run-rate by 27%).

**Confirm:** RONIC and terminal-ROIC sensitivities are **suppressed** by the <10% rule.

### 11.6 V6 — OKLO (pre-revenue owner-operator)

**Expect:** pre-revenue module. Leverage passes today and **fails in every success case**; the levered-residual exception applies and the module is **not refused**.

**Confirm:** two of six success definitions return **THIS SUCCESS IS WORTH LESS THAN FAILURE** ($0 and $1 against a $3.10 failure value) and those rows are **displayed, not dropped**.

**Confirm:** the conditional price-implied break-even success weight is reported per success definition, never as one number, and never described as a probability of success.

**Confirm:** funding stack shows all four lines including retained operating cash flow from assets in service; solved year by year; both ramps shown; 8 GW utility-multiple case at $31 back-loaded and $48 steady.

**Confirm:** unit-economics breakeven runs before the scale solve.

**Confirm:** levered costs of equity from 12.0% to the 30% cap, with capped cells labelled **RATE CAPPED — VALUE IS AN UPPER BOUND**.

### 11.7 V7 — A bank

**Expect:** Gate 0 → **UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1**.

**Confirm:** all valuation outputs suppressed; facts, arithmetically defined multiples and history diagnostics still display, **each carrying the state**.

**Confirm:** the company does **not** reach the mature-profitable row despite low reported debt and stable operating cash flow.

### 11.8 V8 — Missing REQUIRED input

Run V4 (Microsoft) with the finance-lease ROU additions removed from the fact set.

**Expect:** **INCOMPLETE** on reinvestment, RONIC, unlevered FCF, FCF after lease-funded capacity, capital intensity and the leverage ratio.

**Confirm:** the leverage precondition returns **LEVERAGE UNSUPPORTED IN v1**, not PASS.

**Confirm:** the field is **never defaulted to zero**, and no dependent output returns a number.

This case exists because §5.4 identifies this exact field as the one most likely to be absent from a structured feed.

---

## 12. ACCEPTANCE CRITERIA

Observable conditions. Each is PASS / FAIL, not a judgment.

### 12.1 Input integrity — the primary criteria

| # | Criterion |
|---|---|
| A1 | No calculation module executes before the human spot-check (§3.8) is complete |
| A2 | Every figure in every output is traceable to an acquired record carrying source, source class and timestamp |
| A3 | A figure derived from a SECONDARY input is labelled SECONDARY **at its point of display**, not only at entry |
| A4 | A figure derived from an UNVERIFIED input is labelled UNVERIFIED at its point of display |
| A5 | No unverifiable figure is anywhere replaced by an estimate, a carried-forward prior value, an interpolation, or a peer average |
| A6 | Price carries a timestamp and there is no "approximate" price state anywhere in the system |
| A7 | Every FACT input is marked REQUIRED or OPTIONAL **per dependent output**, not globally |
| A8 | A missing REQUIRED input returns INCOMPLETE for every dependent output and no number |
| A9 | A missing OPTIONAL input is displayed as absent and never rendered as zero |
| A10 | V8 passes: removing finance-lease ROU additions cascades correctly and the leverage test fails closed |
| A11 | Every fact carries all six §3.2 fields as **separate** fields; no implementation collapses source class and extraction type into one |
| A12 | A PRIMARY-source fact that was AI-extracted is recorded as PRIMARY **and** AI-EXTRACTED, and is not recorded as either alone |
| A13 | Every material AI-extracted fact is **visibly distinguishable** in the user-facing output, not only in the underlying record |
| A14 | Extraction type propagates transitively to the point of display, under the same rules as source class |
| A15 | A figure available as a tagged filing element is acquired through the fixed, versioned tag mapping, with the mapping version recorded on the fact. AI extraction occurs only on one of the three §3.8.1 fallback conditions |
| A16 | Milestone M8 reports **which facts** fell back to AI extraction and why, as a list of facts rather than a count |
| A17 | A tag-mapped fact carries SPOT-CHECK NOT REQUIRED and is not queued; it still carries and displays all six §3.2 fields and still appears in section B |
| A18 | A DETERMINISTIC/STRUCTURED fact with **no** recorded mapping version is queued, not exempted (fail-closed, §5.3) |
| A19 | Footing, reconciliation and range-sanity cross-checks run on every input, exempt or queued, and report an outcome for each |
| A20 | A failed cross-check never rewrites a figure. It sets a state, forces the fact into the queue, and returns INCOMPLETE for REQUIRED dependents until re-acquisition |
| A21 | Step 2 offers exactly two decisions, neither pre-selected, and no control anywhere edits a figure |
| A22 | Every *Cannot verify* carries a reason code from a fixed two-option select — CONTRADICTED BY SOURCE or NOT LOCATED. No free text, no third option |
| A23 | Both reason codes return INCOMPLETE for dependents and neither branches behaviour; the code is recorded on the fact and reported by milestone M8 |
| A24 | The verification-state field carries CONFIRMED / NOT CONFIRMED / SPOT-CHECK PENDING / SPOT-CHECK NOT REQUIRED. **UNVERIFIED appears nowhere as a verification state**, and only as the §5.1 propagation state |
| A25 | Step 1 refuses a fund, an index, or a currency or crypto pair with UNSUPPORTED INSTRUMENT at identity resolution, before any fact is acquired. No run is opened |
| A26 | Step 1 displays the resolved company name and does not auto-advance; the run commits only on the analyst's confirmation |
| A27 | No price renders on Screen 1 |
| A28 | Step 1 refuses a registrant with no annual filing history, stating that reason, before any fact is acquired. No run is opened, and the software does not select a predecessor registrant |

### 12.2 Gates and states

| # | Criterion |
|---|---|
| B1 | Gate 0 fails closed on missing classification (V7 and a classification-stripped variant) |
| B2 | Gate 1 suppresses without refusing, and licenses no cyclicality claim (V2) |
| B3 | The leverage precondition fails closed on missing inputs and offers no remedy (V1, V8) |
| B4 | The levered-residual exception applies to pre-revenue success cases and does not refuse them (V6) |
| B5 | The RONIC ladder is evaluated **per grid cell**, verifiable by a company whose RONIC falls between two grid rates |
| B6 | Every degenerate solver output returns a state; no cell anywhere returns a number with a warning glyph (V4) |
| B7 | Triggers A and B are evaluated separately, and A alone produces no cyclicality claim (V4) |
| B8 | Every suppressing state in §9.3 is reachable and displays as its state |
| B9 | Step 6 offers three outcomes with none pre-selected. *Cannot judge* leaves the profile not human-confirmed, raises PROFILE NOT CONFIRMED, sets trust status to PARTIAL, renders the fair-value range, and renders the state rather than a position in the §10.6 slot. A run in this state never displays CHEAP, FAIR or EXPENSIVE and never displays an action clause |

### 12.3 Register inheritance

| # | Criterion |
|---|---|
| C1 | The §9.1 register is present with **eleven rows**, matching the caveat register exactly |
| C2 | The bankruptcy/SPAC/holding-company row is **one row**, not three |
| C3 | I19 (pre-revenue non-owner-operators) is present |
| C4 | All six unenforced rows appear in §9.2 with a v1 status |
| C5 | R1, R2, R3, R5, R6 are implemented in v1 |
| C6 | R4 (material convertibles or preferreds) is the only deferred row, documented as such, and its absence is not reported as a defect |

### 12.4 Architecture boundary

| # | Criterion |
|---|---|
| D1 | No output contains a **price target**, a single-number fair value, or a **portfolio action** (trim / add / sell / hold). The §10.6 position and its entry-side action clause are permitted and are the only exception |
| D1a | The §10.6 position is computed by [S] and is reproducible: identical inputs produce an identical position, with no model in the derivation path |
| D1b | The position and its action clause do **not** render under any §9.3 state, under UNUSABLE trust, or where the range failed — the slot shows the state |
| D1c | The action clause is entry-side only. No copy string anywhere can produce trim, add, sell or hold |
| D2 | [C] cites no base rate absent from the supplied data, and says none is available where that is the case (I18) |
| D3 | [C] supplies no facts; every figure in [C] output traces to the fact set |
| D4 | [C] reports suppressing states without reasoning around them or estimating past them |
| D5 | No multi-persona, voting, tallying or confidence-scoring structure exists anywhere |
| D6 | Discount band and terminal growth come from policy configuration, never from [C] or from per-company adjustment |
| D7 | The counter-case comes from the §8.5 blind challenger, never from the interpretation layer reasoning against its own output |

### 12.5 Seasonality

| # | Criterion |
|---|---|
| E1 | V3 passes: a seasonal retailer returns SEASONAL — RUN-RATE SUPPRESSED and no annualised run-rate is computed anywhere, including as an internal input |
| E2 | The seasonality test fails closed: missing prior-year quarters return INCOMPLETE and the run-rate is still not computed |
| E3 | All three of the red team's recommended validation runs (V1, V2, V3) return cleanly |

### 12.6 Structured output contract

| # | Criterion |
|---|---|
| G1 | v1 returns a versioned machine-readable Analysis Result containing all **twelve** §10.0.1 members, `trust` and `position` included |
| G2 | The narrative report is rendered from the result object; no figure appears in the report that is absent from the object |
| G3 | Every value in the object carries its states and labels in the same object; a value cannot be read without its qualifications |
| G4 | Suppressed outputs appear as their state, never as null, absent or zero |
| G5 | The provenance graph carries source class and extraction type as two independent labels per edge |
| G6 | A consumer can read facts, gates, states, diagnostics, scenarios, price-implied outputs, challenger findings and interpretation **without parsing prose** |

### 12.7 Blind challenger

| # | Criterion |
|---|---|
| H1 | The challenger runs as a **separate call**, not as a branch of the interpretation layer |
| H2 | Its input payload is assembled by construction from the fact set, thesis claims, gate results and states — verifiable by inspecting the payload, not by reading an instruction |
| H3 | The payload contains none of: analyst base-case reasoning, fair-value or scenario range, valuation outputs, implied-growth conclusion, analyst conclusion, interpretation-layer output |
| H4 | Challenger findings are merged only after the independent call completes, and are never merged into `interpretation` |
| H5 | Findings are structured, each referencing the claim or fact it bears on, its evidence, and what would have to be true |
| H6 | No persona, voting, tallying or scoring structure exists in the challenger path |
| H7 | The challenger asserts no fact absent from its supplied payload and cites no base rate absent from it |

### 12.8 Scope boundaries

| # | Criterion |
|---|---|
| J1 | No portfolio context — holdings, weights, cost basis, existing exposure — can be supplied as input; the analyzer has no field to receive it |
| J2 | No state persists between analyses; two consecutive runs of different companies share nothing |
| J3 | No output field, in the Analysis Result or the rendered report, expresses position sizing, weight, portfolio fit or exposure |
| J4 | Exactly one output contract exists (§10.0). No second schema, export format or parallel record |
| J5 | The interpretation and challenger calls exist as specified, with no reusable-layer abstraction built around them |
| J6 | No crypto or BTC handling, no Systematic Research, no Portfolio Review, and no stub or flag anticipating them |

### 12.9 Reference reproduction

| # | Criterion |
|---|---|
| F1 | V4, V5 and V6 reproduce the states and flags recorded in §11.4–11.6 |
| F2 | No computed figure differs from the v1.0.1 reruns. v1.0.2 changed no values — only states and gates |

---

### 12.10 Trust status, page one and the step split

| # | Criterion |
|---|---|
| K1 | Every run carries exactly one trust status — CLEAN, PARTIAL or UNUSABLE — derived by the §9.6 order, first match wins |
| K2 | Under UNUSABLE the page **refuses to render the range**. The refusal is behaviour, not a sentence asking the reader to be careful |
| K3 | No copy anywhere lets UNUSABLE be read as a statement about the company rather than about the analysis |
| K4 | DO NOT RELY appears nowhere. The third status is UNUSABLE |
| K5 | Every fixed-shape page-one sentence is a filled template, [S], with no model in its path |
| K6 | Every variable page-one sentence comes from a constrained [C] call under the full §8.3 limits |
| K7 | **No number on page one originates from the model.** Every figure is substituted from the Analysis Result; a numeral emitted by [C] is a defect, not a value to be checked |
| K8 | A page-one sentence has exactly two provenances — filled template or constrained [C] call with slot references. Prose from any other route does not render |
| K9 | The user flow has **ten** steps. Profile confirmation (6) and analyst scenarios (7) are separately numbered and separately named |
| K10 | No reference to a methodology **§10 Step *n*** was renumbered by the step split; §10 Step 5 still names the methodology's step |

---

## 13. OUT OF SCOPE FOR v1

### 13.1 Excluded by the brief — do not design

- Thesis Tracker and Thesis Record — **not built in v1.** §10.0 requires only that the analyzer's output be ingestable by a future Thesis Record; it does not authorise building one
- What Changed? / monitoring
- Portfolio Review and Portfolio Intelligence
- Sector Intelligence
- Research Memory
- Opportunity Discovery
- Saved Analysis
- Fear/greed or contrarian layers
- Multi-investor or persona voting — including in the §8.5 challenger path, which is one call returning findings, not a panel returning a tally
- Autonomous trading, and any recommendation beyond the entry-side action clause of §10.6.4

### 13.1.1 Additionally excluded — settled boundaries

- **Portfolio fit and Portfolio Review**, in any form, including a single "does this fit the portfolio" line. See §1.4
- **A generic Intelligence Layer.** The §8.2 interpretation and §8.5 challenger are specified **for this analyzer**. They are not to be built as a reusable service, a shared abstraction, or a layer other Calboard modules are expected to call. Build the two calls this spec describes and no framework around them
- **Crypto and Bitcoin.** No crypto assets, no BTC exposure rules, no crypto-specific gates or valuation paths
- **Systematic Research**
- Any anticipatory hook, interface stub, feature flag or placeholder for the above

### 13.2 Excluded by the methodology itself (§10)

- WACC calculators with betas
- Monte Carlo
- Forecast horizons beyond ten years
- **Peer-set construction**
- Any single-number fair value

> Add any of these only if a manual test shows the simple version failing.

### 13.3 The peer-multiple boundary

Peer-set construction being excluded resolves the sector-multiple question. **v1.0.2 does not use a sector or peer multiple as a core valuation input.** Peer multiples are **secondary cross-checks only**. Where an exit multiple is needed — chiefly in pre-revenue scenario work — it is an **explicit analyst assumption with its anchor recorded**, not a constructed peer set.

### 13.4 Deferred from the register

- **Material convertibles or preferreds warning** (register: LATER) — the only deferred register row
- Rounding tested on unrounded values and displayed rounded
- Retire the ±1% band from Appendix B
- OKLO's gross-vs-treasury award count
- Preferred / minorities / pensions named in §2.1 but missing from the bridge formula
- Boundary hysteresis
- The four undefined policy constants — NOPAT tax rate, stress margin level, pre-revenue unlevered rate, project-debt cost — remain configuration rather than methodology
- Exit-year EBITDA basis for pre-revenue

### 13.5 v2 scope, named explicitly because v1 refuses rather than approximates

- Building a WACC
- Switching to equity cash flows at a levered cost of equity

Both are the remedies the leverage precondition previously named and no longer offers. They are v2. **The v1 interface must not suggest either.**

---

## 14. AMENDMENT RECORD — M7

**Status: APPROVED by Command Center, 7 September 2026.** Drafted 6 September 2026 against the frozen artefacts, whose SHA-256 hashes were verified byte-exact before any edit:

| File | SHA-256 verified before edit |
|---|---|
| `calboard-stock-analyzer-v1-spec.md` | `1406eb1860d71f6604ed12e22d8ea7b9a2cc22bc6df5fbbf6248cf6a8b5e56b8` |
| `calboard-stock-analyzer-v1-design.md` | `31690bde59ac2035f391566ede9ecc2e5871b211805a6c2c03f6083c4f251b56` |
| `mock-human-steps.html` | `cb2e540e549f159e096aa319b6cd4e13fbc582eff0039ea34a0b45ee3ac67ca1` |

Eighteen changes: **twelve here**, four in the interaction design, two in `mock-human-steps.html`. The design carries its own §20 record.

### 14.1 The 6 September ruling — the authority for changes 10 and 11

Recorded as **Calvin's informed override**. It reverses the no-verdict boundary in this spec and in four Notion pages.

**He heard the counter-arguments and decided to proceed.** The two put to him were that the engine holds no view on whether a company can deliver what its price assumes, and that a real OKLO purchase at roughly $140 is the specific failure the boundary was written to correct. **This is recorded so it is not re-argued.** A later session that rediscovers either objection has not found something new; it has found the reason the override was made deliberately rather than casually.

The ruling's own terms, as implemented:

| Ruling | Where it lands |
|---|---|
| Vocabulary is CHEAP / FAIR / EXPENSIVE, not bull / bear / hold — HOLD collides with the Investment Methodology's portfolio-layer state, and bull/bear are sentiment words for arithmetic | §10.6.1 |
| Derivation is deterministic, from already-computed fields. Not an AI call — an AI-authored verdict would be unreproducible and unauditable | §10.6.2, §8.1, §8.3 limit 1 |
| It never renders under suppression. Under UNUSABLE, a fired gate or a failed range, the slot shows the state | §10.6.3, §10.5 |
| Decided now, built with milestone M8, because the comparator fact may not exist yet. Sequencing, not deferral | §10.6.5 |
| The Quick Read read sentence and the UNUSABLE trust status are **not** verdicts and do not depend on the override. Both are v1 | §9.6, §10.7 |
| The position carries an action clause. Entry-side only: start / do not start / wait for a better price. Never trim, add or sell | §10.6.4 |
| Trust vocabulary is CLEAN / PARTIAL / UNUSABLE, all three new. UNUSABLE rather than DO NOT RELY, because an instruction changes dimension halfway through a three-item set | §9.6 |

### 14.2 The twelve spec changes

| # | Change | Sections touched |
|---|---|---|
| 1 | Step 2 queue holds the AI-extracted set only; tag-mapped facts are exempt; the four-tier risk ordering loses its structured-primary tier | §2, §3.8.1, §12.1 A17–A18 |
| 2 | Tagged acquisition required where a tag exists; AI extraction a documented fallback; milestone M8 reports which facts fell back and why | §3.8.1, §12.1 A15–A16 |
| 3 | Deterministic input cross-checks as a milestone M8 requirement — footing, reconciliation, range sanity | §3.8.2, §12.1 A19–A20 |
| 4 | Required reason code on non-confirmation, fixed two-option select | §3.8.4, §12.1 A22–A23 |
| 5 | UNVERIFIED disambiguated — see §14.3 | §3.2, §5.1, §5.2, §12.1 A24 |
| 6 | Confirm / Cannot verify mapped onto confirmation / non-confirmation | §3.8.3 |
| 7 | Step 6 split into Step 6 profile confirmation and Step 7 analyst scenarios — see §14.4 | §2, and every reference listed in §14.4 |
| 8 | Step 1 accepts listed operating companies only; UNSUPPORTED INSTRUMENT at identity resolution | §1.2, §2, §9.3.1, §12.1 A25 |
| 9 | Step 1 does not auto-advance; resolved name confirmed; no price on Screen 1 | §2, §12.1 A26–A27 |
| 10 | The valuation position and its action clause; the no-verdict boundary resolved | §1.1, §1.5, §8.1, §8.3, §10.2, §10.3, §10.5, §10.6, §13.1, §12.4 D1–D1c |
| 11 | Trust vocabulary CLEAN / PARTIAL / UNUSABLE | §9.6, §10.0.1, §12.10 K1–K4 |
| 12 | Page-one template specification | §10.7, §12.10 K5–K8 |

### 14.3 Change 5 — which sense of UNVERIFIED was renamed, and why

**The two senses.** In the frozen text, UNVERIFIED named two unrelated things:

| Where | Sense | What it claimed |
|---|---|---|
| §3.2, verification-state field | **Verification state** | No human has confirmed this figure |
| §5.1, propagation state | **Propagation state** | The figure exists but could not be checked against a source |

These are different claims. The first is about whether anyone looked; the second is about whether the figure can be checked at all. One name for both made the combination *a human looked, agreed the pipeline's figure, and agreed it is uncheckable* literally unstatable — which is the state §3.4 records for the corrected NVIDIA price.

**The verification-state sense was renamed. UNVERIFIED now means only the §5.1 propagation state.** Three reasons, in order of weight:

1. **The propagation sense is inherited; the verification sense is ours.** *UNVERIFIED propagates like SECONDARY* is caveat-register item **I14**, and the word travels with the frozen contract into §5.2, §9.4's qualifying-flag vocabulary, criterion A4 and the design's three provenance tokens. Renaming it would edit a term this spec inherits rather than owns. The verification-state field is this document's own construction — its third value, SPOT-CHECK PENDING, appears in no upstream document.
2. **The blast radius is smaller and entirely inside this document's control.** The propagation sense is rendered in every derived cell in the report; the verification sense is rendered on fact cards and in section B.
3. **The new names fall out of the interface that already exists.** Step 2's two decisions are *Confirm* and *Cannot verify* (§3.8.3), so CONFIRMED and NOT CONFIRMED name exactly what the human did. VERIFIED was renamed to CONFIRMED with it, because leaving VERIFIED beside NOT CONFIRMED would have kept the field internally mismatched.

**A fourth value was added, and it is a consequence of change 1 rather than of change 5:** tag-exempt facts are never queued, so they can be neither CONFIRMED nor SPOT-CHECK PENDING. They carry **SPOT-CHECK NOT REQUIRED**. Recorded here because a reader comparing the field against the frozen text will see four values where the ruling implied three.

### 14.4 Change 7 — every affected reference

Step 6 became two steps. Steps 1–5 are unchanged. The map:

| Frozen | Amended |
|---|---|
| Step 6 — Analyst confirmation and inputs | **Step 6 — Profile confirmation** *and* **Step 7 — Analyst scenarios** |
| Step 7 — Deterministic computation | Step 8 |
| Step 8 — Interpretation | Step 9 |
| Step 8b — Blind challenger | Step 9b |
| Step 9 — Result assembly | Step 10 |

**Every reference changed, by file:**

| File | Reference |
|---|---|
| spec | §2 — "Nine steps… Steps 2 and 6" → "Ten steps… Steps 2, 6 and 7" |
| spec | §2 — the six step definitions above, renamed and renumbered |
| spec | §12.10 — K9 and K10 added |
| design | §1 heading — "NINE STEPS, FOUR SCREENS" → "TEN STEPS, FOUR SCREENS" |
| design | §1 — the screen-flow diagram, Screen 3 and the processing block |
| design | §2 — route table, `/profile` row and `/report` row |
| design | header — the `mock-human-steps.html` companion row |
| design | §4.2 — "Step 6's scenarios" → "Step 7's scenarios" |
| design | §5 heading — "STEP 6 — PROFILE CONFIRMATION AND OVERRIDE UX" → "STEPS 6 AND 7" |
| design | §5.4 — retitled to Step 7 |
| design | §19 — evidence row 5 |
| `mock-human-steps.html` | the Screen 3 section head "Step 6 — Analyst scenarios" → "Step 7" |
| `mock-human-steps.html` | the CSS section comment |

**Deliberately not renumbered — the methodology's own steps.** A **§10 Step *n*** belongs to `calboard-valuation-methodology.md` and is part of the frozen contract.

The frozen artefacts carried **thirteen** such references — twelve in the spec (§1.1, §2, §3.2, §3.3, §3.4, §4.4, §5.1, §6, §8.2 twice, §8.3, §10.1) and one in the design (§5.4) — and **not one was renumbered**. Two of the lines carrying them were rewritten by change 10, at §1.1 and §8.3 limit 1; the references inside them are identical to the frozen text. Amendment M7 adds four more, at §1.1, §2, §10.3 and §12.10 K10.

Criterion K10 asserts the rule. The reading note in §2 exists so the next editor does not undo it: the load-bearing boundary of §1.1 is **§10 Step 5**, the methodology's, and it bears no relationship to this flow's Step 5, which is profile recommendation and trigger evaluation.

### 14.5 Readings this amendment had to make

Recorded rather than assumed, in the §18 tradition of the design document. Each is a place the instruction did not fully determine the text.

| # | Reading | Alternative, and why it was not taken |
|---|---|---|
| **M7-a** | **The exemption is granted by acquisition path, not by extraction-type label.** The ruling exempts facts acquired through a fixed, versioned tag mapping and says the queue holds AI-extracted facts. §3.2's DETERMINISTIC/STRUCTURED is broader than tag mapping — it also covers structured feed fields and deterministic parses, which have no mapping version. Those are **queued** (§3.8.1 guard 1) | Exempting everything labelled DETERMINISTIC/STRUCTURED would have matched the second sentence more literally and widened the exemption beyond what the first sentence justifies. The fail-closed direction is to queue more, not fewer (§5.3) |
| **M7-b** | **UNSUPPORTED INSTRUMENT is recorded in §9.3.1, not in the §9.3 table.** It rejects before a run exists rather than suppressing an output inside a report | Adding an eleventh row to §9.3 would have made the design's ten-suppressing-state vocabulary stale and put a state with no report cell into a table of report cells |
| **M7-c** | **`trust` and `position` are new top-level Analysis Result members**, taking §10.0.1 from ten to twelve; G1 was updated to match | Nesting them inside `states` would have hidden a report-level roll-up among per-output states and left page one with no contract to read from |
| **M7-d** | **The position's band thresholds and its disagreement rule are PROVISIONAL policy constants** (§10.6.2), recorded in `policy` and calibrated at milestone M8. The mechanism is fixed here; the numbers are not | The ruling fixes the inputs and the determinism, not the cut-points. Inventing thresholds would have frozen numbers with no observations behind them — the failure Appendix B already records for the <5 / 5–9 history thresholds |
| **M7-e** | **Where the two derivation inputs disagree, the position is FAIR** (§10.6.2 rule 2) | Preferring either input would be an unstated valuation judgment. FAIR fails toward saying less, consistent with §5.3 |
| **M7-f** | **"M8" in changes 2 and 3 is read as the build milestone, not the §7.2 module.** §7.2's M8 is terminal diagnostics and has nothing to do with acquisition. Every occurrence is written as "milestone M8" so the two cannot be confused | Reading it as module M8 would have put fallback reporting inside terminal-share diagnostics, which is incoherent |
| **M7-g** | **§1.5's "no advice framing" was narrowed rather than deleted** (§1.5) | Deleting it would have removed a real constraint the override did not touch. Leaving it whole would have left a sentence contradicting §10.6.4, which the instruction forbids |

### 14.6 Found and deliberately not fixed

Out of scope for this amendment. Each is a real defect, recorded so it is not lost and not silently absorbed.

| # | Finding | Why not fixed here |
|---|---|---|
| **F1** | **`mock-report-msft.html` contains a stale `Step 6` reference** after change 7's renumber | Explicitly excluded from this amendment's scope. The report mocks are not to be edited |
| **F2** | **§3.2 says "six distinct fields" and its table lists seven** — type, source, source class, extraction type, verification state, as-of date, retrieval timestamp. §3.8 and §10.0.1 repeat "all six" while listing the same seven. Criterion A11 inherits the error | Pre-existing and untouched by these eighteen changes. It is a counting error rather than a contract error, but A11 is an acceptance criterion and should be corrected deliberately |
| **F3** | **The module range is inconsistent.** §10.0.1 and §10.2 section D say "M1–M14"; §6.5 and §10.4 cite M16, and the design's flow diagram says "M1–M16" | Pre-existing. Resolving it means confirming how many modules §7.2 defines, which is a spec question this amendment has no authority over |
| **F4** | **UNSUPPORTED INSTRUMENT has no entry-screen visual treatment.** §9.3.1 defines the state; the design's §6 vocabulary covers report cells, and this state never reaches a report | A new design treatment is beyond changes 13–16. Command Center should rule on it with the rest of Screen 1 |
| **F5** | **The design's §7.1 provenance tokens and §9 disclosure levels name the verification-state values.** After change 5 they read against a renamed field | The design changes authorised here are 13–16. This is a mechanical follow-through, but it is not in scope and should not be done silently |
| **F6** | **`mock-human-steps.html` prints `Spot-check pending` on fact-card stamps**, which survives change 5, but the mock shows no tag-exempt fact and so never renders SPOT-CHECK NOT REQUIRED | The mock changes authorised here are 17 and 18. Worth a card in a later pass, since the exempt path is now the common one |

### 14.7 Amendment M8-2 — two rulings, 8 September 2026

**Documents only. Four changes, one file.** Drafted 9 September 2026 against the frozen artefacts, whose SHA-256 hashes were verified byte-exact before any edit:

| File | SHA-256 verified before edit |
|---|---|
| `calboard-stock-analyzer-v1-spec.md` | `9801dfef269c435d8be955db2099f097aba54f0fac1da3f6cf30c4430d01e3bc` |

The other seven frozen artefacts (`calfinance-methodology-v2.md`, `calboard-valuation-methodology.md`, `calboard-stock-analyzer-v1-design.md`, `mock-screen1-entry.html`, `mock-human-steps.html`, `mock-report-msft.html`, `mock-report-oklo.html`) were verified against the same manifest and are untouched by this amendment.

Two rulings, unrelated to each other, landed in one amendment because both close a v1 build-blocking gap and neither required design or app-code changes to record:

| Ruling | Authority | Where it lands |
|---|---|---|
| Two horizons — five-year and ten-year — are valid growth comparators, and the horizon travels with the result rather than being implied | CalFinance Methodology v2, ruled 8 September 2026 | §10.6.2 |
| A registrant with no annual filing history is refused at Step 1, stating the reason, rather than following corporate succession to a predecessor registrant | Calboard Command Center, 8 September 2026 | §2 (new rule 1a), §12.1 A28 |

**The four changes:**

| # | Change | Sections touched |
|---|---|---|
| S1 | The comparator paragraph gains the five-year fallback, the no-mixing rule, the no-cross-series-stitching rule, the UNAVAILABLE/INCONCLUSIVE floor, and the per-horizon calibration note | §10.6.2 |
| S2 | New Step 1 rule 1a: a registrant with no annual filing history is refused, is not UNSUPPORTED INSTRUMENT, and is not resolved by following succession to a predecessor registrant | §2 |
| S3 | New acceptance criterion for rule 1a | §12.1 A28 |
| S4 | This record | §14.7 |

**Reading M8-2-a — the new criterion is A28, not A26.** The instruction read "append after A25, following the existing numbering," written against a state of §12.1 that ended at A25. M7 had already extended the table to A27 (§12.1 A26, A27) by the time this amendment was drafted. Renumbering A26 and A27 to open a literal slot after A25 would cascade into every existing reference to them — §14.2 change 9 cites "A26–A27" by number — for no product benefit; the criterion itself does not depend on where in the table it sits. **Following the existing numbering**, read against what the table actually contains rather than against the instruction's stale mental model of it, means appending at the table's true end. The criterion is A28.

**The Step 1 registrant-refusal outcome has no entry-screen visual treatment yet, on the same F4 precedent above.** UNSUPPORTED INSTRUMENT was specified in §9.3.1 with no entry-screen treatment, and that gap was recorded as a design follow-up rather than resolved in the spec (F4). The same applies here: Screen 1 now needs a fifth outcome rendered, alongside UNSUPPORTED INSTRUMENT's still-outstanding one, and both are DESIGN's to take up, not this amendment's.

**Not in this amendment.** No §9.3 or §9.4 vocabulary count changes — neither ruling adds a suppressing state or a qualifying flag, and the state vocabulary stays at twenty-four. No thresholds, cut-points or position-renderer changes. No design-document or mock changes. No application code.

---
## APPENDIX — TRACEABILITY

Every requirement in this spec traces to the frozen contract. Where a requirement originates in the caveat register rather than the methodology, the item number is cited inline.

**The seven product-spec requirements from Part 3 of the register, and where each lands:**

| # | Requirement | Where in this spec |
|---|---|---|
| I4 | Seasonality test on the run-rate rule | §7.2 M12, §9.2 R3, §9.3, §11.3 — SPECIFIED, v1 |
| I5 | P/E basis: symmetric trigger on \|non-operating items\| > 5% of pre-tax income | §7.2 M2 |
| I6 | SBC consistency: cash FCF and cash FCF − SBC | §3.5, §7.2 M4 |
| I14 | Input completeness: REQUIRED/OPTIONAL, INCOMPLETE, UNVERIFIED propagates like SECONDARY | §4, §5 — the core of the input integrity block |
| I15 | Three FACT-labelled inputs are judgments; rename to median-margin | §4.4 |
| I18 | [C] cites base rates only from supplied data | §8.3 limit 2, §8.4 |
| I20 | Currency and country rule; warn on non-USD reporters | §9.2 R2 |

**The eight v1 caveats and where their display text lands:** I7, I8, I9, I11 — §7.2 M16. I10 — §7.2 M14. I12 — §6.5, §7.2 M16. I13 — §7.2 M5. I16 — §7.1, §10.4.

**The two scope labels:** I17 — record hygiene, no software requirement. I19 — §1.2, §9.2 R5.

---

**END OF SPECIFICATION**

Returns to Command Center for approval. Nothing goes to BUILD until that approval exists.
