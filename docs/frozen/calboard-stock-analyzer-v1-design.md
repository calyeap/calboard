# CALBOARD STOCK ANALYZER v1 — INTERACTION AND SCREEN DESIGN

**Status:** DESIGN COMPLETE, COMPREHENSION REVISION APPLIED — returns to Command Center for approval. Nothing goes to BUILD until that approval exists.

**Date:** 5 September 2026. Comprehension and learning revision, same date.

**Revision note.** A bounded amendment followed, covering the workspace width model, Quick Read, dark-mode rendered inspection and a proposed closing recap — §17.15 to §17.17, and the CC-gated proposal in §18. It changed no methodology, no calculation, no state and no ruling. The closing recap is **not approved scope**.

A cross-site consistency pass followed, reconciling the Analyzer onto the shipped Calboard token set, adding dark mode and the shared top bar, fixing the disclosure affordance, and recording the navigation scaling rule — §17.11 to §17.14. It changed no methodology, no calculation, no report ordering, no state and no ruling.

A final UX pass followed the comprehension revision, covering cognitive load, scanability, orientation, re-entry and voice — §17.9 and §17.10. It changed visual scale, two ledes and several sentences. It changed no methodology, no calculation, no report ordering, no state and no ruling.

This document previously passed its own DONE WHEN while failing the reader. The analysis was correct and the interface required the reader to already know the vocabulary. §17 is the correction: a comprehension and learning layer that changes reading order and adds plain-English translation, and changes no methodology, no calculation, no report ordering and no state. R2 remains settled as previously ruled. R1 and R4 remain open for Command Center against these revised artefacts.

**Frozen contract verified before design started:**

| File | SHA-256 | Result |
|---|---|---|
| `calboard-stock-analyzer-v1-spec.md` | `1406eb1860d71f6604ed12e22d8ea7b9a2cc22bc6df5fbbf6248cf6a8b5e56b8` | MATCH |

This document adds no methodology, changes no calculation, moves no report section and removes no state. Where it appears to, that is a defect in this document and the spec wins.

Companion mocks, to be frozen with this document:

| File | Covers |
|---|---|
| `mock-human-steps.html` | Step 2 fact verification, §4.4 judgments, Step 6 profile confirm / override, scenario matrix |
| `mock-report-msft.html` | Report sections A–J, Microsoft four degenerate reverse-DCF cells |
| `mock-report-oklo.html` | Pre-revenue report, OKLO two worth-less-than-failure rows, funding stack, distribution-summary range |

---

## 0. THE DESIGN THESIS IN ONE PAGE

The spec's hardest interface problem is that a correct analysis routinely returns **states instead of numbers**, and there are twenty-two of them (ten suppressing, twelve qualifying) plus six provenance fields on every fact. Semantic colour is unavailable — Calboard reserves it for gain / loss / stale, and a new vocabulary cannot borrow reserved colours.

So the state vocabulary is built from **three decorations, no colour, no glyphs**:

| Decoration | Means | Count |
|---|---|---|
| **Tint fill + 2px left rule, replacing the value** | Suppression. There is no number here. | 10 states |
| **Underlined word token, right-aligned beneath the value** | Provenance qualification. The number is real; this is where it came from. | 3 flags |
| **Tick-ruled word, left-aligned beneath the value** | Analytic qualification. The number is real; this is what it means. | 9 flags |

Suppression **replaces**. Qualification **accompanies**. That is the whole distinction and it is visible at a glance without reading a word, because one changes the shape of the cell content and the other does not.

**The comprehension revision adds a fourth mechanism that is not a decoration:** every section opens with a **finding block** — plain-English finding, why it matters, what it means for this company, what to examine — and then presents the states, numbers, calculations and provenance unchanged beneath it. Canonical state names are preserved exactly and gain a plain-English line above them. Nothing is removed, softened or hidden to achieve this. See §17.

Three further consequences drive everything below:

1. **No abbreviations anywhere in the state vocabulary.** Every state and flag prints its own name. Twenty-two states do not need twenty-two icons; they need twenty-two names in three mechanisms.
2. **A layout that only works when every cell has a number is the wrong layout.** Every table in this design is specified at its degenerate extreme first — the Microsoft grid with four of nine cells gone, the OKLO table with two of six probabilities gone — and the healthy case is the easy one.
3. **Section A's state manifest is also the legend.** Every active state and flag is listed before any number, in the same three decorations it will use downstream. The reader learns the vocabulary before meeting it.

---

## 1. END-TO-END SCREEN FLOW — NINE STEPS, FOUR SCREENS

Nine spec steps map onto four screens and two processing states. Only two screens accept human input, which is the point.

```
Screen 1  ENTRY            Step 1   ticker entry + identity resolution
   │
   │  [processing]         fact acquisition
   ▼
Screen 2  FACTS      ★     Step 2   per-fact spot-check + §4.4 judgments
   │                                HUMAN. Blocks everything downstream.
   │  [software]           Step 3   Gate 0
   │                       Step 4   Gate 1
   │                       Step 5   profile recommendation + triggers A/B
   ▼
Screen 3  PROFILE    ★     Steps 3–5 results shown read-only at top
   │                       Step 6   confirm / override + three scenarios
   │                                HUMAN.
   │  [processing]         Step 7   deterministic modules M1–M16
   │                       Step 8   interpretation [C]
   │                       Step 8b  blind challenger (parallel, isolated payload)
   │                       Step 9   Analysis Result assembly
   ▼
Screen 4  REPORT           rendering of the Analysis Result, sections A–J
```

**Why Steps 3–5 have no screen.** They are software and instantaneous. Giving them a screen would add a click that decides nothing. They render as a read-only computed band at the top of Screen 3, which is where their only human consequence — an override — actually lives.

**The Gate 0 branch.** §2 says Gate 0 failure stops the analysis before Step 5; §6.1 permits a human override. Screen 3 therefore has two entry states:

- **Gates cleared** — full Step 6: profile recommendation, confirm/override, scenarios.
- **Gate 0 halted** — the gate result, its computed inputs, and exactly two controls: *Override Gate 0* or *Stop and view report*. No profile is recommended, no scenario editor is shown. Stopping produces a valid report in which valuation outputs are states (case V7).

**Enforcement of the Step 2 ordering rule.** §2 requires the software to enforce it, not recommend it. The design requirement is explicit: **the gate is server-side.** No calculation module may be reachable by any route, refresh, deep link or API call until every material fact carries a decision. A client-side route guard is a recommendation, not an enforcement, and does not satisfy §2. Screens 3 and 4 redirect to Screen 2 when the run is not spot-check-complete.

**No launch path from Holdings or Dashboard.** Entry is the ticker field on Screen 1 only. A per-holding "Analyze" button would (a) imply portfolio context entering the analyzer, which §1.4 forbids as a boundary rather than a preference, and (b) fail the anti-momentum test by turning the holdings list into a menu of reasons to open the app. *Ruling needed — item R8.*

**The run does not refresh.** A report is an artefact produced at a moment, carrying the price timestamp of that moment. There is no refresh control, no "price has moved since this analysis" indicator, and no re-run-with-same-facts shortcut. The cost of re-running is Step 2 again, and that cost is the anti-momentum mechanism. It must not be optimised away.

---

## 2. PAGE / SCREEN ARCHITECTURE

| Route | Screen | Steps | Human input |
|---|---|---|---|
| `/analyzer` | Entry | 1 | ticker |
| `/analyzer/[runId]/facts` | Facts | 2 | per-fact decisions, three judgments |
| `/analyzer/[runId]/profile` | Profile | 3–5 display, 6 input | confirm/override, scenarios |
| `/analyzer/[runId]/report` | Report | 7–9 output | none |

`[runId]` is in the URL so a refresh does not destroy Step 2 work. **There is no index of runs, no history list, no retrieval UI and no listing endpoint.** Lose the URL and the run is gone. This keeps Saved Analysis (§13.1) out of scope while not being hostile to a browser refresh. *Ruling needed — item R7.*

Nav: the analyzer is a peer route in the existing NavBar, not a sub-page of Holdings or Dashboard.

---

## 3. COMPONENT HIERARCHY

### 3.1 Primitives

| Component | Responsibility |
|---|---|
| `Figure` | A value. Tabular figures, right-aligned. Optionally carries `ProvenanceTokens` and `FlagStack`. Never carries a glyph. |
| `StateSlot` | Replaces a `Figure` where a suppressing state is active. Renders the state name and its cause value. Never renders blank, zero or bare "n/a". |
| `ProvenanceTokens` | Up to three underlined word tokens, right-aligned beneath the value. Slots are fixed and independent: source class · extraction type · verification state. Never merged. |
| `FlagStack` | Zero or more tick-ruled analytic flag names, left-aligned beneath the value, one per line. |
| `Disclosure` | One-level, expands in place. Never a modal, never a drawer, never nested. |
| `SectionHead` | Existing Calboard rhythm: 47px row, 17px title-to-rule, `align-items: center`. Reused unchanged. |
| `InsetField` | Editable cell. Inset underline, never a box. Reused unchanged. |
| `StateManifest` | Section A. Two grouped lists — suppressed, qualified — in the same three decorations used downstream. Doubles as the legend. |

### 3.2 Compounds

| Component | Screen | Notes |
|---|---|---|
| `TickerResolve` | Entry | Uses existing `resolveInstrument`. No autocomplete, no catalogue, no force-add. |
| `FactCard` | Facts | One material fact, its six §3.2 fields, its citation, its decision control. |
| `JudgmentSelector` | Facts | §4.4. Presents options **with their resulting figures** side by side. |
| `SpotCheckProgress` | Facts | `n material facts · n confirmed · n undecided`. No bulk control. |
| `GateResult` | Profile | Gate 0 / Gate 1 / leverage, with computed inputs and both memo lines. |
| `ProfileEvidence` | Profile | The recommendation with the six classification inputs that drove it. Nothing pre-selected. |
| `OverrideBlock` | Profile | Reason field + non-dismissable acknowledgement. Its text is reproduced in report sections A and C. |
| `ScenarioMatrix` | Profile | Driver-major rows × bear/base/bull columns. Anchors and per-scenario share counts required. |
| `RevenuePathEditor` | Profile | Year-by-year path, opened where a constant rate does not describe the company. |
| `ReverseDcfGrid` | Report | 3 margin levels × 3 rates. Tall cells by necessity — M7 mandates four lines each. |
| `SuccessDefinitionTable` | Report | Per-definition probability with per-row states. |
| `FundingStack` | Report | Four lines, solved year by year, both ramps. |
| `FairValueFrame` | Report | Two-column: range beside the price-implied summary. Neither alone. |
| `ChallengerFinding` | Report | Claim reference · evidence · what would have to be true. |
| `ProvisionalRegister` | Report | Section J. Always fully expanded. |

---

## 4. STEP 2 — FACT VERIFICATION UX

The brief's test: *"A confirm button under a wall of figures satisfies the letter and defeats the point."* Six rules make that button impossible to build.

### 4.1 The six rules

**1 — There is no bulk control.** No "confirm all", no "confirm remaining", no select-all checkbox, no keyboard shortcut that advances without deciding. The step completes when the last individual fact has a decision, and by no other route. This is the primary enforcement and it is structural, not a nudge.

**2 — One fact at a time, full width, with its source beside it.** Not a table. A review queue. Table review is what produces click-through, because a table invites you to scan the shape rather than read the value.

**3 — No default decision.** The control is a two-way choice with neither side pre-selected: **Confirm** or **Cannot verify**. Advancing requires an act.

**4 — The queue is ordered by risk, not by statement order.** AI-EXTRACTED first, then SECONDARY, then UNVERIFIED, then structured PRIMARY. The four recorded errors were extraction errors; the facts most likely to be wrong get the freshest attention.

**5 — The period is a sentence, not a field.** Above each value: *"This is Microsoft's FY2026 figure, retrieved 4 September 2026."* Two of the four recorded errors were scope or period errors, and a date rendered as a table cell is read as furniture.

**6 — All six §3.2 fields are expanded by default here.** Screen 2 is the one place progressive disclosure does not apply. §3.8 requires per-fact confirmation *against provenance*; hiding provenance behind a click on the screen whose entire purpose is checking it would be a failed implementation.

### 4.2 There is no "Correct" control

**This is the design's most consequential reading and it needs a ruling.**

§3.2 defines exactly two extraction types: DETERMINISTIC/STRUCTURED and AI-EXTRACTED. A figure typed in by the analyst is neither. Calling it structured is false — its correctness is not reproducible without that human. Inventing a third value would amend the frozen contract, which this design may not do.

So the design offers **Confirm** and **Cannot verify** only.

A fact the analyst knows to be wrong is marked *Cannot verify*. Per §3.8 that leaves the analysis incomplete and its dependent outputs return INCOMPLETE per §5. Fixing it is a **re-acquisition**, not an edit: correct the source or the parse, run again. This is consistent with §3.1 (nothing enters from memory or from an unrecorded derivation) and with §5.1 (an unverifiable figure is never replaced by an estimate).

The general principle, which holds across both human steps: **the human selects; the human never types a figure.** §4.4's three judgments are selections among presented options. Step 6's scenarios are analyst-authored assumptions, not facts, and are explicitly typed — that is a different object and carries type ASSUMPTION.

Consequence Command Center should weigh: v1 is stricter than an analyst will expect. A single bad feed value stalls the run. *Ruling needed — item R2.*

### 4.3 The queue item

Each `FactCard` shows, in order:

1. **Fact name** and the outputs it is REQUIRED for — so the reader knows the blast radius before deciding.
2. **The period sentence.**
3. **The value**, large, tabular figures.
4. **The three provenance tokens**, always all three, always spelled out: `PRIMARY · AI-EXTRACTED · SPOT-CHECK PENDING`.
5. **Source and citation** — the document, identified precisely enough to re-fetch, as a link where one exists. Plus the retrieval timestamp.
6. **Restatement notice** where two records exist for the same quantity (§3.4). Both are shown; neither overwrites the other.
7. **The decision:** Confirm · Cannot verify. No default.

### 4.4 The three judgments

§4.4's three inputs are labelled FACT and are not. They appear as a distinct band **after** the confirmations, headed as judgments rather than checks, because they ask a different question.

Placement in Step 2 rather than Step 6 is a design decision — the spec does not pin it. The reasoning: all three are properties of the fact set, and two of them (accounting basis, non-operating classification) change figures the confirmations depend on. *Ruling needed — item R6.*

| Judgment | Presented as |
|---|---|
| Accounting-basis window | Both options **with their resulting figures**: restate-all vs shorten-window, showing the CAGR each produces. Microsoft renders as 14.6% mixed (not offered), 13.8% restated FY2016, 14.7% nine-year FY2017–FY2026. Selection recorded. |
| Which investments are non-operating | The candidate line items, each selectable, each carried at book with the direction of likely error stated beside it. |
| Median-margin NOPAT window | The window, selectable. **Labelled "median-margin NOPAT" throughout the interface, never "normalised" (I15).** |

Each records the selection and its reason.

### 4.5 Completion

`SpotCheckProgress` is persistent: `12 material facts · 9 confirmed · 0 cannot verify · 3 undecided`. The continue control is disabled and labelled with what is missing — never a bare disabled button.

Where any fact is *Cannot verify*, continuing is still permitted; the run proceeds with INCOMPLETE propagating to dependents. Blocking it entirely would hide the cascade, and the cascade is the information.

---

## 5. STEP 6 — PROFILE CONFIRMATION AND OVERRIDE UX

### 5.1 The gate band (Steps 3–5, read-only)

Three `GateResult` blocks at the top of Screen 3, before any control:

- **Gate 0** — result, and the four classification tests with their evaluated values. Where it failed, the §6.1 explanation copy is shown, because the reason is not obvious: for a bank, debt is funding rather than capital structure, so the EV bridge, EBITDA, FCF and PVGO are all computable and none of them means anything.
- **Gate 1** — the count of filed years, the state, and what it suppresses.
- **Leverage precondition** — the computed ratio, the operating-lease-inclusive memo beside it, and the result. Where it fails, the list of suppressed rate-dependent outputs is shown in full. **No remedy is named anywhere.** §13.5's two v2 remedies must not appear in copy, in a tooltip, in an empty state, or in an error message.

Then **Triggers A and B**, evaluated separately and displayed separately, each with the evidence that fired it. Where A fired without B, the interface states that A alone is not evidence of cyclicality — otherwise the reader supplies the inference themselves.

### 5.2 Profile recommendation

`ProfileEvidence` presents the recommendation **as evidence, not as a pre-checked option**:

- The recommended profile, named.
- The six classification inputs with their values: revenue scale, FCF character, revenue growth, capital intensity, cyclicality (ten-year margin range and worst single-year change), balance-sheet nature.
- **Balance-sheet nature is labelled ASSUMPTION**, not FACT — §6.3 is explicit that the asset-light / asset-heavy distinction inside the supported profiles is an analyst assumption, and it was wrongly marked FACT in earlier versions.

**Nothing is pre-selected.** The confirm control sits below the evidence as a separate act. A pre-checked radio would make confirmation the default and reduce Step 6 to the click-through Step 2 is designed to prevent.

Two controls, equally weighted: **Confirm recommended profile** · **Override**.

### 5.3 Override

Choosing Override opens, in place:

1. **A profile selector** — the other supported profiles. The asset-based row is present but not selectable through this control; reaching it requires the Gate 0 override, which is a different and louder thing.
2. **A required reason field.** Free text, `InsetField`, cannot be empty. Not a dropdown of canned reasons — a canned reason is not a reason.
3. **A non-dismissable acknowledgement block**, stating that nothing under the overridden gate has been validated. It has no close control and no checkbox. It is a statement, not a consent flow.

**The recording is the interaction, not a log.** The override, its reason, and the not-validated statement are reproduced verbatim in:

- report section A, in the state manifest, above every number
- report section C, beside the gate it overrode

Gate 0 override carries the strongest treatment: the header of section A carries **PROFILE OVERRIDDEN — NOTHING BELOW THIS HAS BEEN VALIDATED** as a persistent band, and the asset-based row's copy states that it has been validated on nothing.

### 5.4 Scenarios

Three scenarios, authored by the analyst. §10 Step 3 requires drivers set **together**, so the matrix is **driver-major**: one row per driver, three columns (bear · base · bull). Setting one scenario at a time invites incoherent paths, which is the same failure M14 names for two-way sensitivity tables.

| Row | Type | Required |
|---|---|---|
| Revenue growth (or explicit path) | ASSUMPTION | yes |
| Operating margin | ASSUMPTION | yes |
| Reinvestment / capital intensity | ASSUMPTION | yes |
| Share count for this scenario | ASSUMPTION | yes — post-financing where the scenario raises equity (§3.5) |
| Written anchor | ASSUMPTION | yes — free text, cannot be empty |

Fields are `InsetField`, inset underlines, never boxes.

**Explicit revenue paths.** Where a constant growth rate does not describe the company, `RevenuePathEditor` opens as a year-by-year grid. It is offered wherever the profile is high-growth, and wherever M13's SHAPE MISMATCH conditions are plausible. Each column remains a coherent path.

**Margin reversion in the bear case.** Where trigger A or B has fired, the bear row is annotated with what the diagnostic set requires: a margin that reverts, not merely growth that slows. Where **only** B has fired is the additional revenue-decline requirement stated. Under A alone the interface must not suggest a revenue decline — that would be the fabrication §6.4 names.

Where Gate 1 returned HISTORY INSUFFICIENT, the interface must not offer a CYCLICAL label, a PEAK EARNINGS warning, or a forced revenue-decline bear. It states that the window is short.

---

## 6. VISUAL SYSTEM — THE TEN SUPPRESSING STATES

**Mechanism: the state replaces the value.**

```
fill              --tint
border-left       2px solid --ink
padding-left      10px
state name        11px / uppercase / letter-spacing .08em / weight 500 / --ink
cause line        11px / --ink-muted / sentence case
alignment         LEFT — deliberately breaking the numeric column's right rhythm
figures           NOT tabular — the slot must not read as a number
min-height        matches a numeric cell so tables do not jump
```

Left alignment is doing real work. Right-aligning text inside a numeric column makes it read as a value. Breaking the rhythm is the signal that this cell is categorically different.

**Every suppressed cell carries its cause.** §9.5 forbids "n/a" without the reason, so the cause line is mandatory, not optional:

| State | Cell renders | Cause line |
|---|---|---|
| UNSUPPORTED PROFILE | state name | which Gate 0 test fired |
| HISTORY INSUFFICIENT | state name | `3 filed years` |
| LEVERAGE UNSUPPORTED IN v1 | state name | `net debt ratio 34.2%` — or `inputs missing` where fail-closed |
| RONIC NOT MEANINGFUL | state name | which ladder row fired |
| NOT COMPUTABLE | state name | `value function not monotone across bracket` |
| NO SOLUTION IN RANGE | state name | the bracket and the value at each end |
| DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE | state name | `terminal share 124%` |
| PRECONDITION FAILED | state name | the failed ratio |
| NOT ACHIEVABLE AT ANY SCALE | state name | `unit economics negative before scale solve` |
| SEASONAL — RUN-RATE SUPPRESSED | state name | the quarter and the prior-year growth figures that triggered it |
| INCOMPLETE | state name | the missing REQUIRED input, named |
| THIS SUCCESS IS WORTH LESS THAN FAILURE | state name | `V_success $1 · V_fail $3.10` |
| PRICE NOT JUSTIFIABLE BY THIS OUTCOME | state name | `price $X ≥ V_success $Y` |

(§9.3 groups some of these into single rows; they are enumerated here because each needs its own cause line.)

**Prohibited by construction.** There is no glyph in this system, so §10.5's "number with a warning glyph where a state is defined" is not reachable — there is no glyph component to reach for. Blank, zero and bare "n/a" are unreachable because `StateSlot` requires both a name and a cause.

---

## 7. VISUAL SYSTEM — THE TWELVE QUALIFYING FLAGS

**The twelve split into two behavioural families and get two mechanisms.** §9.4 lists them as one set; nothing in the spec requires one treatment. Giving twelve identical treatments to two different kinds of thing would be the actual design failure. *Ruling needed — item R3.*

### 7.1 Provenance qualifiers — underline

**SECONDARY · UNVERIFIED · AI-EXTRACTED.** These describe where the number came from. They are extremely common because §3.3 propagates them transitively into every downstream cell, so they must be cheap.

```
position       right-aligned, directly beneath the value
type           10px / uppercase / letter-spacing .06em / --ink-muted
decoration     border-bottom
               1px --rule    SECONDARY, UNVERIFIED
               2px --ink     AI-EXTRACTED
separator      middot between tokens
```

The heavier underline on AI-EXTRACTED is the within-family distinction §3.2.2 requires — the reader must be able to see, without opening anything, which numbers a model read rather than a feed supplied.

**Three independent slots, never merged.** §3.2.1 forbids collapsing source class and extraction type; the design forbids it structurally by giving them fixed separate slots in a fixed order:

```
[source class] · [extraction type] · [verification state]
```

An implementation with one combined token, one quality score or one confidence badge does not satisfy this section, and `ProvenanceTokens` must not accept a merged value as a prop.

**Full stamp vs non-default only:**

- **Section B (fact set) and Screen 2:** all three tokens, always, spelled out — `PRIMARY · AI-EXTRACTED · VERIFIED`. Absence is never how a reader learns something.
- **Derived cells everywhere else:** non-default tokens only. `PRIMARY`, `DETERMINISTIC/STRUCTURED` and `VERIFIED` print nothing; `SECONDARY`, `AI-EXTRACTED` and `UNVERIFIED` always print. A clean cell means clean provenance, and the fact set is one section away for anyone who wants the positive statement. *Ruling needed — item R4.*

**Attribution on demand.** A derived cell marked AI-EXTRACTED raises an obvious question — *which input?* One `Disclosure` answers it by naming the specific fact: *"Inherits AI-EXTRACTED from: finance-lease ROU additions, FY2026."* This is the provenance graph made useful, and it is what stops the label degrading into noise the reader learns to skip.

### 7.2 Analytic qualifiers — tick rule

**LOW RONIC — VALUE-DESTROYING GROWTH · INVERTED — HIGHER GROWTH LOWERS VALUE · RONIC CAPPED AT 200% · CAPITAL-LIGHT · SHORT HISTORY · MARGIN AT HISTORICAL HIGH · PEAK EARNINGS · SHAPE MISMATCH · RATE CAPPED — VALUE IS AN UPPER BOUND.**

These describe what the number means. They are rarer, heavier, and worth more vertical space.

```
position       left-aligned, beneath the provenance tokens
type           10px / uppercase / letter-spacing .08em / --ink
lead           8px × 1px --ink rule, then 6px gap
stacking       one per line, no wrapping onto a shared line
```

**Full names, never truncated.** Where a flag's full name will not fit, that is a layout failure, not a labelling problem. The reverse-DCF cell is tall by necessity — M7 mandates four lines in every cell — so `RATE CAPPED — VALUE IS AN UPPER BOUND` fits on two. **If BUILD finds a place where truncation appears unavoidable, that is a STOP condition to raise, not a judgement call to make.**

**Each flag carries its number where it has one.** `RONIC CAPPED AT 200%` prints the uncapped value beside it. `SHORT HISTORY` prints the window length. `SHAPE MISMATCH` prints the gap in points. A flag without its number is a mood.

### 7.3 Why the two families cannot be confused

| | Provenance | Analytic |
|---|---|---|
| Alignment | right | left |
| Decoration | underline | leading tick rule |
| Question answered | where did it come from | what does it mean |
| Frequency | high, propagated | low, computed |

Different axis, different decoration, no colour. The distinction survives greyscale, low vision and a screen reader.

---

## 8. SUPPRESSION vs QUALIFICATION — THE READ AT A GLANCE

| | Suppression | Qualification |
|---|---|---|
| Is there a number? | No | Yes |
| Cell content | State name + cause | The value, unchanged in position and weight |
| Alignment | Left, breaking the column | Right, holding the column |
| Fill | `--tint` | none |
| Left rule | 2px `--ink` | none |
| Effect on layout | Visible break in the numeric rhythm | None |

A reader scanning a column sees the suppressions as gaps in the rhythm before reading a single word. A reader scanning for qualifications sees additional lines beneath intact numbers. **The two are never encoded in the same channel**, which is why a page can carry both without either being lost.

Section A's manifest reinforces this by grouping them separately — *suppressed* and *qualified* — under separate heads, before any number appears.

---

## 9. PROVENANCE DISPLAY WITHOUT DROWNING THE FIGURES

Six fields per fact, propagated transitively, is a lot of metadata. Three levels resolve it.

### 9.1 The three levels

| Level | Contains | Where |
|---|---|---|
| **0 — never hidden** | source class · extraction type · verification state | every cell, non-default only in derived tables |
| **1 — always visible in the fact set** | all three tokens spelled out, plus as-of / period date | section B, Screen 2 |
| **2 — one interaction, in place** | source document string and link · retrieval timestamp · the derivation path for an inherited label | `Disclosure` |

### 9.2 The hiding rule

**You may hide what a reader needs in order to go and check. You may never hide what changes how a reader reads the number.**

Class, extraction type and verification state change how the number reads. The source string and the timestamps are what you need to verify it. That is the line, and it is why Screen 2 — the screen whose entire purpose is verification — expands everything by default while the report does not.

### 9.3 Why "type" is not a token

§3.2's first field, **type** (FACT / ASSUMPTION / INFERENCE), is not in the provenance token set because it is carried structurally instead:

- Facts live in section B.
- Assumptions live in the scenario matrix and are labelled there.
- The fair-value range is labelled INFERENCE per §10.3.
- The funding stack labels each of its four lines individually (FACT / ASSUMPTION / INFERENCE) because they genuinely mix.

Where a table mixes types in one column, the type prints as a fourth token in the same underlined family. It is not omitted; it is placed where it distinguishes rather than repeated where it does not.

---

## 10. FIXED REPORT ORDERING

Sections A–J render in the §10.2 order, always, with none reordered and none dropped. Where a section has nothing to show, it renders its state — a section is never absent.

```
A   Header and states          company · ticker · price + timestamp · profile
                               (recommended / confirmed / overridden + reason)
                               · every active state and flag, before any number
B   Fact set with provenance   all six §3.2 fields · AI-extracted visibly marked
C   Gate results               Gate 0 · Gate 1 · leverage ratio + both memo lines
D   Deterministic diagnostics  M1–M14, states at the point of display
E   Price-implied diagnostics  steady-state EV · PVGO share · reverse-DCF grid
                               with RONIC + state beside every cell · implied exit
                               multiple labelled by the metric it divides
F   Analyst scenarios          drivers · anchors · per-scenario share counts
G   Scenario outputs           values · weighted distribution (display only)
                               · price location · rate where base equals price
                               · sensitivity per M14
H   Fair-value range           see 10.2 below
I   Interpretation [C]
I2  Challenger findings        alongside, never reconciled
J   Provisional and unmodelled register
```

### 10.1 Scroll, not tabs

One continuous document with a persistent section rail. **Tabs are prohibited by §10.1's ordering principle.** The principle is that what the market assumes and what the analyst assumes are never shown alone — and a tabbed report structurally permits opening H without E. Scroll cannot be skipped in a way that violates the principle; tabs can.

The rail marks position; it does not summarise, and it carries no counts, badges or completion indicators.

### 10.2 Section H — resolving "next to"

§10.3 requires the fair-value range to be **always shown next to the price-implied diagnostics**. §10.2 fixes the order with F and G between E and H. Read literally these cannot both hold.

**Resolution without amending either:** section H is a two-column frame.

```
┌───────────────────────────────┬───────────────────────────────┐
│  FAIR-VALUE RANGE             │  WHAT THE PRICE ASSUMES       │
│  what you assume              │  restated from section E      │
│                               │                               │
│  bear ──────●────── bull      │  steady-state EV              │
│  weighted value inside        │  PVGO share of EV             │
│  INFERENCE                    │  implied 5yr / 10yr CAGR      │
│  three driving inputs named   │  RONIC + state                │
└───────────────────────────────┴───────────────────────────────┘
```

Both derive from the Analysis Result, so §10.0.2 rule 3 is satisfied — the renderer restates, it does not add. Neither is ever shown alone, in reading order or on screen. *Ruling needed — item R1.*

Below 720px the two columns stack **price-implied first**, so the market's assumption is read before the analyst's on every device.

### 10.3 Section H under a suppressing state

Where UNSUPPORTED PROFILE, LEVERAGE UNSUPPORTED IN v1 or a NOT COMPUTABLE reverse DCF is active, §10.3 gives no range — the state is the output. Section H still renders, in the same two-column frame, with `StateSlot` on both sides. It is never collapsed, never hidden, and never replaced with an empty state illustration.

### 10.4 Section H for pre-revenue

The range is the distribution summary — failure / success-as-commonly-described / success-as-the-price-requires — plus the cash floor. **It is not compressed to bear/bull bounds**, and the bear/bull slider component is not used. This is a different component, not a variant, so the compression cannot happen by accident.

### 10.5 Required caveat text

I7, I8, I9 and I11 have fixed wording and appear at their modules, not in section J. I16's label states that it **assumes a permanent 3-point return premium for every company**, printed beside every terminal-ROIC-dependent figure.

### 10.6 Section J is never collapsed

The provisional register renders fully expanded, always. Every PROVISIONAL threshold with what it was calibrated on; the four undefined policy constants with their configured values; the named unmodelled risks including debt availability. Collapsing it would be exactly the footnote failure §5.5 describes, applied to the report's honesty section.

### 10.7 Prohibited patterns, structurally

| §10.5 prohibition | Why it cannot be built |
|---|---|
| Number with a warning glyph | No glyph component exists |
| Sensitivity range spanning price as fair-value evidence | M14 output is not permitted in section H |
| Single implied probability not tied to a definition | `SuccessDefinitionTable` renders per row; there is no aggregate cell |
| Weighted mean as headline | Rendered inside the range, at body size, never as the section's largest figure |
| Multiple without own-history context | `Figure` in the multiples table requires the percentile or its suppressing state |
| EV/Revenue standalone | Rendered only paired with the implied margin needed to reach a normal profit multiple |
| Consensus derived from price | Consensus is an OPTIONAL fact with a source; a derived one has no source record |
| Verdict, target or recommendation | No component renders one; no copy string contains one |
| Counter-case from the interpretation layer | Section I2 renders only `challenger`; it cannot read `interpretation` |
| AI-extracted fact without a marker | `Figure` refuses to render a material fact without `ProvenanceTokens` |
| Figure not in the Analysis Result | The renderer takes no literals |

---

## 11. THE MICROSOFT CASE — FOUR DEGENERATE CELLS RENDERED

Rendered in full in `mock-report-msft.html`. The layout must be right when four of nine cells have no number.

### 11.1 The grid is nine tall cards, not a numeric matrix

M7 mandates three figures in every cell — five-year growth **and** the equivalent ten-year CAGR **and** year-10 revenue — plus RONIC with its state beside every one of them, plus the I13 lag-bias direction. That is four to six lines per cell before any flag. **The grid is tall by necessity**, which is what makes the long flag names fit and what makes a suppressed cell sit comfortably rather than collapse.

### 11.2 What renders

```
                    r = 8%              r = 10%             r = 12%

margin 46.8%        18.5%  5yr          computed            ▌DEGENERATE —
current             13.7%  10yr CAGR                         TERMINAL EXCEEDS
                    $XXXb  yr-10 rev                         TOTAL VALUE
                    RONIC 20.9%                              terminal share 115%
                    ─ lag bias: conservative

margin 41.8%        computed            computed            ▌DEGENERATE —
median                                                       TERMINAL EXCEEDS
                                                             TOTAL VALUE
                                                             terminal share 120%

margin 38.0%        computed            ▌DEGENERATE —       ▌DEGENERATE —
stress                                   TERMINAL EXCEEDS    TERMINAL EXCEEDS
                                         TOTAL VALUE         TOTAL VALUE
                                         terminal share 101% terminal share 124%
```

Four states, five numbers, one grid that does not look broken.

### 11.3 Why the layout holds

- The suppressed cells keep the card's height, so no row collapses and no column jumps.
- The tint fill and left rule make the four read as a **pattern** — degeneracy concentrated at high rates and low margins — which is genuine information the reader gets for free from the visual arrangement.
- No cell is dropped, greyed to invisibility, or rendered as an empty box.
- Every degenerate cell names its terminal share. A reader can see that 101% is a near miss and 124% is not.

### 11.4 The rest of the Microsoft report

| Element | Renders as |
|---|---|
| Section A manifest | `MARGIN AT HISTORICAL HIGH` (qualifying) · `DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE ×4` (suppressing) |
| Trigger A only | A stated; the interface states A alone is not evidence of cyclicality |
| Leverage | PASS 0.8% · operating-lease memo 1.37% also PASS · the sign flip once $66.6B of finance leases are counted, stated |
| Reinvestment | 86% of NOPAT lease-inclusive, with 66% cash-capex-only shown beside it and labelled as the incomplete measure |
| RONIC | 20.9%, with 27.2% shown as the cash-capex-only figure · I13 lag-bias direction printed beside |
| Implied growth | 18.5% five-year **and** 13.7% ten-year CAGR **and** year-10 revenue — all three, always |
| Bear case | margin reversion, no revenue decline. This is correct under A alone and must not raise a rule violation |
| Section H | range beside the price-implied restatement, carrying *the bounds are scenario labels, not confidence bounds* |

### 11.5 The V8 variant

Removing finance-lease ROU additions cascades to INCOMPLETE on reinvestment, RONIC, unlevered FCF, FCF after lease-funded capacity, capital intensity and the leverage ratio — and the leverage precondition returns LEVERAGE UNSUPPORTED IN v1 rather than PASS. Section D becomes majority-`StateSlot` and section H becomes a state on both sides.

**This is the design's stress case.** A layout that survives four degenerate cells but not a full cascade has not solved the problem. Each INCOMPLETE names the missing input, so a reader diagnoses the cause from one cell rather than from six.

---

## 12. THE OKLO CASE — WORTH-LESS-THAN-FAILURE ROWS RENDERED

Rendered in full in `mock-report-oklo.html`.

### 12.1 The success-definition table

Six definitions. Two return THIS SUCCESS IS WORTH LESS THAN FAILURE — $0 and $1 against a $3.10 failure value. §7.2 calls these the most informative output the model produced.

The row is **partially suppressed**: V_success, V_fail and both discount rates still render as numbers. Only the probability cell becomes a `StateSlot`.

```
success definition        V_success   V_fail   r_succ   r_fail   implied probability
─────────────────────────────────────────────────────────────────────────────────────
[definition]                 $0        $3.10    30.0%    X.X%    ▌THIS SUCCESS IS
                                       ▲ RATE CAPPED —                WORTH LESS
                                         VALUE IS AN UPPER BOUND      THAN FAILURE
                                                                      V_success $0
                                                                      V_fail $3.10
[definition]                 $1        $3.10    28.4%    X.X%    ▌THIS SUCCESS IS
                                                                      WORTH LESS
                                                                      THAN FAILURE
[definition]                $31        $3.10    ...              25%
[definition]                $48        $3.10    ...              15%
...
```

### 12.2 Two design moves that stop the rows being buried

**1 — Rows sort by V_success ascending.** A deterministic, neutral rule that happens to place the two states at the top rather than at the bottom where a reader stops looking. The spec is silent on row order. *Ruling needed — item R5.*

**2 — The state cell is the widest column.** The probability column is sized for the state name, not for `25%`. The table's proportions are set by its degenerate case, which is the general principle of this whole design applied to one table.

### 12.3 The rest of the OKLO report

| Element | Renders as |
|---|---|
| Probability | Per success definition, six rows. **There is no aggregate cell.** The component cannot produce one |
| Leverage | Passes today; fails in every success case. The levered-residual exception is stated as the reason the module is not refused — **not as a remedy** |
| Rates | D/E at exit 0.20–3.95; levered cost of equity 12.0% up to the 30% cap; capped cells carry `RATE CAPPED — VALUE IS AN UPPER BOUND` (I12) |
| Basis rule | Same date, same share base, same dilution treatment, **different discount rates**, both displayed. Stated at the table head so the differing rates are not read as an error |
| Funding stack | Four lines in order, line 3 (retained operating cash flow from assets in service) present and labelled INFERENCE. Solved **year by year** — the year grid is the component, not a total |
| Both ramps | Back-loaded and steady always shown; the spread labelled as the honest uncertainty; back-loaded marked as the reference |
| 8 GW utility-multiple case | $31 back-loaded, $48 steady |
| Unit economics | Rendered **above** the scale solve, because it runs before it. Where each unit destroys value the solve renders `NOT ACHIEVABLE AT ANY SCALE`, never a very large number |
| Caveats | I7, I8, I9, I11 at their modules, verbatim |
| Section H | Distribution summary + cash floor. **Not** bear/bull bounds |

---

## 13. DESKTOP-FIRST BEHAVIOUR

Design target is a desktop reading width. The analyzer is a document, not a monitoring surface, and the report is meant to be read once, carefully, and probably printed.

| Screen | Desktop layout |
|---|---|
| Entry | Single centred column, ~560px. One field. |
| Facts | Two columns: the fact card left (~60%), its source and citation right (~40%). Source visible without scrolling. |
| Profile | Full-width gate band, then evidence at reading width, then the scenario matrix at full width — three columns need it. |
| Report | Fixed section rail left (~180px), content at a reading measure (~720–860px), with the reverse-DCF grid and scenario matrix permitted to break out to full width. |

**Print stylesheet is in scope.** Sections A–J print in order, all disclosures expanded, no rail, no controls. A report that cannot leave the app creates a reason to return to the app, which fails the anti-momentum test.

---

## 14. RESPONSIVE BEHAVIOUR AT 720px

Single breakpoint, matching Calboard. One hard rule governs everything below it:

> **Nothing about a state, a flag or a provenance token is ever hidden, truncated, collapsed or moved off-screen at any width.**

| Element | ≥ 720px | < 720px |
|---|---|---|
| Reverse-DCF grid | 3 × 3 | Three stacked rate groups, each listing three margin cells. **Rate major, margin minor**, matching the per-cell RONIC ladder reasoning |
| Scenario matrix | 3 columns | Driver-major: one driver per row, three inset-underline fields beneath it. The "set together" property is what must survive |
| Fact card | 2 columns | Stacked, source below the value, still expanded |
| Section H | 2 columns | Stacked, **price-implied first** |
| Success-definition table | Table | One record per definition, state at the record head |
| Provenance tokens | Right-aligned beneath the value | Wrap beneath the value, still all present |
| Section rail | Fixed left | Section select at the top of the document |

**No horizontal scroll on any state-bearing table.** Horizontal scroll moves states off-screen, which is §5.5's failure in a different costume. Tables reflow to stacked records instead.

---

## 15. PROGRESSIVE DISCLOSURE RULES

**Never hidden, at any width, in any state, on any screen:**

- any suppressing state and its cause
- any qualifying flag and its number
- the three provenance tokens where non-default
- the price and its timestamp
- gate results
- the override acknowledgement and its reason
- section J in full

**Hidden behind exactly one interaction, expanding in place:**

- source document string and link
- retrieval timestamp
- the derivation path for an inherited provenance label
- the operating-lease-inclusive memo detail
- PROVISIONAL calibration notes (the *label* stays visible; the note expands)

**Rules:**

1. **One level only.** No disclosure inside a disclosure.
2. **In place, never modal.** States are contextual; a modal makes the surrounding context unreadable, which defeats them.
3. **State never expands.** If it is a state or a flag, it is already visible. Disclosure carries evidence, not meaning.
4. **Screen 2 exempt.** Everything is expanded by default there.
5. **Print expands everything.**

**§17.7 adds two disclosure targets to this list** — *Show calculation* and *What is this?* — under these same five rules, and adds the plain-English finding line and state translation to the never-hidden list. Nothing in §15 is relaxed by that addition.

---

## 16. ACCESSIBILITY

The colour constraint turns out to be an accessibility asset — **no state, flag or provenance label is encoded in colour**, so the entire vocabulary survives greyscale, colour-blindness and high-contrast mode by construction.

| Concern | Design |
|---|---|
| Colour independence | Structural only. Contrast checked against the seven-value palette at both themes |
| Screen readers | Every state is **real text in the cell**. No `aria-label` substitute, no `title`-attribute-only, no visually-hidden-only state. A past Calboard defect was a false donut aria-label; the rule here is that the accessible name is the visible text |
| Abbreviations | None. Full names throughout, so visible text and accessible name are identical |
| Tables | Real `<table>` with `<th scope>` on both axes. The reverse-DCF grid announces *"margin 38.0%, rate 12%, DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE, terminal share 124%"* |
| Step 2 decision | Radio group, no default, `<fieldset>` labelled with the fact name |
| Continue control | Disabled state carries the reason in its accessible name — never a bare disabled button |
| Focus order | Follows the review queue order, which is risk order |
| Disclosure | `<button aria-expanded>` + adjacent region. Expanded content is in DOM order |
| Motion | None anywhere. There is no reason for any |
| Zoom | 200% without horizontal scroll on the reading column; state-bearing tables reflow rather than scroll |
| Figures | Tabular figures throughout, per the existing design system |

---

---

## 17. COMPREHENSION AND LEARNING LAYER

Added in the comprehension revision. **This section adds no methodology, changes no calculation, moves no report section and removes no state.** It governs the order in which existing content is read, and the plain-English text that accompanies it. Where it appears to do more, that is a defect in this document and the spec wins.

### 17.0 The problem this solves

The first version of this design was correct and unreadable. Every state, flag, provenance token and diagnostic was present, in the right order, with the right treatment — and the entry point to each was a finance term. `DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE` is an accurate canonical state name and a hostile opening line. `PVGO = 42%` is a correct label for a number whose meaning the reader has to already know.

The rigor was never the problem. The problem was that the canonical name was doing double duty as the user-facing sentence, and it cannot do both jobs.

### 17.1 North-star principle

**Calboard should not replace the analyst's judgment. It should train it.**

Repeated use should make the reader better at understanding investments, taught through the normal analysis workflow — not through a separate course, tutorial, quiz, gamified mode or "Beginner Mode". There is one report. It becomes more technical as the reader chooses to go deeper.

### 17.2 Dual-audience target — both tests must pass

| Test | Question | Fails if |
|---|---|---|
| **Comprehension test** | Can an intelligent investor with limited technical financial literacy understand what the analysis says, why it matters, and what to investigate — without leaving Calboard to look up a term? | The first thing the reader meets in any section is a finance term, an acronym, or a canonical state name |
| **Analyst test** | Can an experienced investor expand the detail and inspect enough assumptions, calculations, states, methodology and provenance to challenge the analysis? | Any figure, state, flag, provenance token or calculation available in the pre-revision design is harder to reach, or absent |

**Simplicity is never achieved by removing rigor.** It is achieved by hierarchy, plain-English explanation, progressive disclosure, labelling, and company-specific interpretation. If a change makes the first layer clearer by making the deeper layer poorer, it is rejected.

### 17.3 The finding block — the required order

Every report section opens with a **finding block** and then presents its existing content unchanged.

```
PLAIN-ENGLISH FINDING      what the section found, in a sentence, no jargon
        ↓
WHY IT MATTERS             the economic significance of that kind of finding
        ↓
FOR THIS COMPANY           the same point applied to the company in front of you
        ↓
WHAT TO EXAMINE            the assumption, evidence or risk worth looking at next
        ↓
[ existing section content — metrics, states, calculations, provenance ]
```

Not:

```
FINANCE TERM → NUMBER → reader must already know what it means
```

**Worked example, section E.** Instead of leading with `PVGO = 42%`:

> **A large part of today's price depends on growth that has not happened yet.**
>
> *Why it matters* — when much of a company's value sits in future earnings rather than current ones, the valuation becomes more sensitive to whether growth and returns on new investment hold up.
>
> *For Microsoft* — [the company-specific reading, from values already in the Analysis Result]
>
> *What to examine* — revenue growth, the operating-margin path, and returns on reinvested capital.
>
> PVGO 42% of EV · Show calculation

The exact wording is a design decision per company and per run. The **order** is not.

### 17.4 Constraints on finding-block copy

These are hard limits, not style preferences.

1. **No verdicts.** No BUY/SELL, no price target, no "attractive"/"expensive", no portfolio-fit judgment, no recommendation. §10.5 and D1 apply to this copy exactly as to every other string.
2. **"What to examine" names a subject, never an action to take on the security.** *"Whether the margin holds at this level"* is permitted. *"Consider waiting for a better entry"* is not.
3. **No figure appears in a finding block that is not in the Analysis Result** (§10.0.2 rule 3). The finding block is rendering, not content.
4. **The finding block never replaces a state, flag, number or provenance token.** It precedes them. Everything present before this revision is still present after it.
5. **[C] authors the company-specific line under the same §8.3 hard limits** — no facts it was not given, no base rates absent from supplied data, no reasoning around a suppressing state.
6. **A finding block for a suppressed section describes the refusal**, not a substitute estimate. "Calboard will not put a number here, and here is why" is the finding.

### 17.5 Translating states without weakening them

**The canonical state name is preserved exactly, everywhere it appeared before.** The revision adds a plain-English line *above* it inside the same block.

Reading order inside a suppression block:

```
This scenario cannot produce a meaningful valuation.          ← plain English, added
Too much of the calculated value sits in the distant
terminal period for the result to mean anything.

DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE                     ← canonical, unchanged
terminal share 115% · RONIC 20.9%, above the rate in this cell ← cause, unchanged
```

The plain line is real text in the cell, so §16's rule holds: the accessible name is the visible text, and the screen reader announces the translation *and* the canonical name. No `aria-label` substitute, no `title`-only text.

**This does not change what the state means, when it fires, or what it suppresses.** §9.3, §9.4 and §9.5 are untouched. A suppressed output still appears as its state and never as a number, a blank, a zero or a glyph.

### 17.6 Where finding blocks go, and where they do not

| Location | Finding block | Reason |
|---|---|---|
| Report orientation, top of section A | **Yes — prose only, no figures** | Preserves §10.2's "every active state and flag, before any number" as strictly as the pre-revision design, which already placed the price above the manifest |
| Sections C, D, E, G, H | Yes | These are where the finance vocabulary concentrates |
| Section B — fact set | No | It is a provenance ledger. A finding block would editorialise the fact set |
| Sections F, I, I2 | No | Already prose authored for a human reader |
| Section J | No, and never collapsed | It is a disclosure register; summarising it is the failure it exists to prevent |
| Step 2 fact cards | Per card, one line | Explains why *this* fact matters, so verification is not clicking through opaque figures |

### 17.7 Progressive disclosure — additions to §15

§15 is unchanged and still governs. The comprehension layer adds:

**Never hidden, at any width, in any state:**

- the plain-English finding line of any section
- the plain-English translation above any suppressing state

**Hidden behind exactly one interaction, expanding in place:**

- *Show calculation* — the formula, its inputs, and the policy constants in force for that figure
- *What is this?* — the concept explanation, where a term is unavoidable

The §15 rules carry over without exception. One level only; in place, never modal; **a state never expands**, because a state is already visible and disclosure carries evidence, not meaning; Screen 2 exempt; print expands everything.

**The default layer stays calm.** The finding block is four short lines, not a textbook. Depth is available, never imposed.

### 17.8 What this layer must not become

Explicitly excluded, and no stub, flag or placeholder for any of them: Beginner Mode · Pro Mode · Learning Mode · quizzes · courses · gamification · streaks · educational notifications · a glossary as a separate destination · additional AI opinions · any second interpretation voice beyond §8.2 [C] and the §8.5 blind challenger.

One excellent report, with progressive disclosure.


### 17.9 Cognitive load, orientation and re-entry

Added in the final UX pass. Nothing here is a mode, a setting or a user-selectable preference. The report has one form, and this section governs how it is entered, scanned and resumed.

**One dominant entry point per section.** The finding lede is the largest running text on the page at `19px / 500`. Company name and price sit *below* it in scale at `21px` — they are two or three words each and read as orientation, not as the message. Before this pass the company name was `30px` against a `17px` finding, which sent the eye to the one element carrying no information the reader did not already have.

**Scale order, and the reason for it:**

| Element | Size | Role |
|---|---|---|
| Company name, price | `21px / 600` | Identity. Short, so it does not dominate by mass |
| Finding lede | `19px / 500` | The message. Multi-line, so it dominates by mass |
| Body, table values | `15px / 400` | Content |
| Explanations, causes, notes | `12–13px` | Support |
| Section heads, state names, tokens | `10–11px` uppercase | Structure and labels |

**Re-entry.** The section rail is the orientation mechanism and must reflect scroll position, not a hardcoded value. **Requirement for BUILD:** the rail's current-section marker updates as the reader scrolls, and the section anchor is in the URL so a return to the tab restores position. Nothing else about the report changes on scroll — no progress bar, no completion count, no "you have read 6 of 11 sections". The rail answers *where am I*, and nothing more.

**Chunking.** Explanatory copy runs at most three sentences per `<dd>`. Where a point needs more, it belongs in a disclosure, not in the default layer.

**Competing callouts.** Section A's manifest is the only place where suppressions and qualifications appear together, and it is ordered suppressed-first, because a suppression means a number is missing and a qualification means a number is merely conditional. Downstream, a state and its qualifications never sit at the same visual weight in the same cell.

### 17.10 Voice

The target is a good buy-side analyst explaining a point clearly to an intelligent friend. Two failure modes, both rejected:

**Too dumbed down.** Patronising, obvious, motivational or cutesy copy; explaining ordinary reality rather than unfamiliar finance. A sentence like *"Microsoft is the kind of company this tool is built to analyse"* states something the reader can see and costs the product credibility. It was written in the comprehension revision and removed in this pass.

**Too technically dry.** Leading with an acronym, a formula, a canonical state name or an unexplained label where a plain-English reading can lead. The equity-research-appendix voice.

**Rules:**

1. Assume the reader is intelligent. Explain unfamiliar finance, never obvious reality.
2. Short, precise sentences. No filler, no consultant-speak, no generic observation.
3. Hedge only where the uncertainty is real and material.
4. No dramatic language and no fake confidence.
5. Proper finance terminology stays, underneath the plain-English line, so repeated use builds literacy. Removing the term would defeat the learning principle; leading with it would defeat comprehension.

**The test for any sentence:** would a very good analyst say this to a smart friend, in these words? If it is technically correct but patronising, generic or needlessly technical, it is rewritten — without changing the meaning or the analytical contract.


### 17.11 Cross-site consistency — one Calboard, not three

Added in the cross-site pass. The Analyzer had drifted into a second visual system. Three defects, all fixed.

**1. A parallel colour palette.** The Analyzer defined `--paper #FBFAF7`, `--surface #FFFFFF`, `--tint`, `--rule`, `--ink-muted` — different names *and* different values from the Calboard tokens shipped on Dashboard and Holdings. `--surface` was pure white, which Calboard uses nowhere. Reconciled: the Analyzer now declares the canonical token set at its exact values and maps its local names onto it as aliases, so no rule had to be rewritten and no second palette survives.

| Analyzer alias | Resolves to | Value |
|---|---|---|
| `--paper` | `--ground` | `#F2EEE5` light · `#16181A` dark |
| `--surface` | `--field` | `#F8F5EE` light · `#1E2124` dark |
| `--rule` | `--line-strong` | `#CBC2AE` light · `#3C4045` dark |
| `--ink-muted` | `--muted` | `#5F5A50` light · `#979CA1` dark |
| `--tint` | *(Analyzer-only)* | `#E8E1D2` light · `#24272A` dark |

`--tint` is the one token with no canonical equivalent, and that is justified rather than convenient: suppression states do not exist on Dashboard or Holdings, so no shipped token does this job. It is derived from `--ground`, not invented independently of it.

**2. No dark theme.** Dashboard and Holdings both ship light and dark with a toggle. The Analyzer had neither, so switching routes in dark mode would have gone from `#16181A` to a white page. Dark is now defined at the canonical values on all three Analyzer screens.

**3. No Calboard chrome.** The Analyzer screens had no wordmark, no navigation and no utility controls — nothing identified them as Calboard. They now carry the same top bar component as the other two routes: wordmark at `18px / 500 / -0.01em`, nav at `20px` gap, `30px` bare icon buttons for privacy and theme, `--muted` resting and `--ink` on hover.

**What stays different, deliberately.** The section rail, the narrower reading column and the nine-cell grid are Analyzer-only because the job is different. Same product language, different layout — the rule is not identical grids.

### 17.12 Disclosure affordance

A real usability defect: the expandable rows read as static subheadings and were not recognised as clickable. They were `11px` uppercase in `--muted` with a hairline underline — the same treatment as non-interactive labels.

**The disclosure component, used everywhere this interaction appears:**

- Visible chevron, `▸` closed and `▾` open
- `13px`, sentence case, full `--ink` — not the small-caps label treatment
- Entire row is the click target, `min-height: 38px`
- Hover lifts the chevron and the underline to `--ink`
- `:focus-visible` outline at `2px solid var(--ink)`, offset `3px`

**Label taxonomy.** The mechanism is one component; the label states what kind of depth is behind it, so the reader chooses how deep to go:

```
QUICK READ          the finding block, always visible
  ▸ What is X?      explanation — learning
  ▸ See calculation formula, inputs, policy constants
  ▸ Sources         provenance and audit trail
```

### 17.13 Typography — uppercase discipline

Canonical state, flag and provenance names keep their required casing; the functional contract owns those strings. **Ordinary interface language does not inherit that casing.** Disclosure labels, finding copy and explanatory text follow normal Calboard typography in sentence case. The Analyzer must not read as a wall of tiny capitals because some of its vocabulary is canonical.

### 17.14 Navigation scaling rule — canonical

**The wordmark is Home.** On every route and every width, the Calboard wordmark links to the Home route and carries the accessible name `Calboard home`. No separate "Home" nav item is added while the wordmark does that job.

**Three levels are permitted and must not be collapsed into one bar:**

| Level | Question | Example |
|---|---|---|
| Global | Which investment area am I in? | Portfolio · Research · Review |
| Area | Which capability am I using? | Stock Analyzer · Research Memory · What Changed |
| Page | Where am I in this report? | The section rail, A–J |

**Migration trigger — recorded so it is not missed.** The current flat arrangement (Dashboard · Holdings · Stock Analyzer) may stand for this milestone. **Stock Analyzer is the last capability that may be added by appending another global nav item.** Before Research Memory, Sector Intelligence, What Changed or Portfolio Review is introduced, navigation migrates to grouped global areas with local area navigation beneath. Utilities — privacy, theme, settings — stay right-aligned and outside the grouping at every stage.

**Mobile.** Wordmark left, menu right, grouped navigation revealed in the menu. Horizontally scrolling nav labels are not the long-term answer and must not become one.


### 17.15 Workspace width — three modes, driven by window not device

The report is laid out against available window width, not a notional "desktop" canvas. A half-ultrawide window is a substantial workspace and must not be treated as a laptop.

**Reading width and analytical width are separate constraints.** Prose is capped at `72ch` — measured at 687px in every mode from 1024px upward, so the measure never stretches. Analytical content is not capped and uses the column: fact tables, provenance tables, the reverse-DCF grid, scenario tables and the fair-value frame.

| Mode | Window | Composition | Main column | Prose |
|---|---|---|---|---|
| Compact | ≤1024px | Quick Read → rail → report, single column. Grid areas `"quick" "rail" "main"` | 320–976px | fills |
| Standard | 1024–1600px | rail │ report, Quick Read in flow above | 976–1164px | 687px |
| Wide | ≥1600px | rail │ report │ Quick Read | 1008–1148px | 687px |

The main column narrows slightly from 1164px at 1440 to 1008px at 1760 because the third column takes 360px. That is the deliberate trade — parallel context is worth more than the width it costs, and the prose measure does not move either way.

**Chrome shares the content grid.** The top bar's max-width and padding track the layout at every mode, so the wordmark aligns with the section rail. They were on different grids until this pass.

**Empty space is allowed.** Extra width is not permission to fill. Where nothing useful can be shown in parallel, the space stays empty.


**Compact ordering is normative.** Quick Read comes first, then the section rail, then the report — `grid-template-areas: "quick" "rail" "main"`. The delivered mocks briefly shipped `"rail" "quick" "main"`, which put navigation above the summary and inverted the stated hierarchy for the primary reading mode. Corrected in both report mocks; the document and the implementation now agree.

**Human Steps is not the report layout.** It keeps its single-column composition — a different job — but takes a defined width from the same system: `1100px`, rising to `1240px` at ≥1600, with the top bar tracking the same container so chrome and content share one edge. It previously referenced an undeclared `--measure`, so the declaration was invalid and dropped, leaving the screen unconstrained on wide windows.

### 17.16 Quick Read

**One component, two compositions.** Identical content in both; only placement changes.

```
WIDE (≥1600)                     STANDARD / COMPACT
rail │ report │ Quick Read        Quick Read
             (sticky)            ↓ report
```

The product must not make important information conditional on owning an ultrawide monitor.

**Contents — eight items, capped:**

| Item | Content |
|---|---|
| Main finding | The single most important conclusion, in one sentence |
| Price vs scenarios | Where the price sits relative to meaningful scenario context |
| What today's price requires | The assumptions the current price makes necessary |
| What supports the case | Two or three points maximum |
| What worries Calboard | Two or three points maximum |
| Biggest uncertainty | The variable creating the most spread |
| Strongest challenger point | From §8.5, unreconciled |
| Data and model quality | Material suppression, qualification and provenance issues — not the whole register |

**Hard limits.** No scores, no ratings, no verdict, no `Quality: 8/10`, no `Risk: Medium`. Concise causal language that explains *why*, never a label that replaces the reasoning. No figure that is not already in the Analysis Result. Quick Read restates; it never computes.

Items link to their source section, so it is a route into the report rather than a replacement for it.

### 17.17 Consumption model

```
QUICK READ            30–60 seconds, the normal path
   ↓
DETAILS WHEN NEEDED   the finding blocks, in place
   ↓
FULL REPORT           sections A–J, unchanged and undiminished
   ↓
FINAL RECAP           what to walk away remembering
```

The surface got easier to consume. **No analytical depth was removed to achieve that**, and none may be.

## 18. UX CONFLICTS AND RULINGS NEEDED

**No STOP condition fired.** Nothing here requires a spec change to be coherent. Eight items are readings the design has had to make, recorded rather than assumed.

| # | Item | The design's reading | Consequence if rejected |
|---|---|---|---|
| **CC-1** | **CC-GATED NARROW AMENDMENT — proposed, not approved.** A closing section *Investment case — at a glance* after §10.2 section J | Renders only from members already in the Analysis Result: `scenarios`, `price_implied`, `states`, `challenger`, `facts`. No new calculation, no new [C] call, no new state, no new figure. Pre-revenue reports omit the bear/base/bull strip and keep the §10.3 distribution summary | **Requires an explicit §10.2 ordering amendment.** §10.2 fixes the section list and order; adding a section changes that contract. Also affects Quick Read, which places restated content above section A in compact and standard modes. Command Center must rule on both. Rendered in the mocks behind a visible CC-gated marker so it can be judged, and must not be read as approved |
| **R1** | §10.3 "next to the price-implied diagnostics" vs §10.2 order E…F…G…H | Section H is a two-column frame restating the price-implied summary beside the range | Only alternative is reordering §10.2, which the brief forbids. This is the resolution or the spec has a genuine internal conflict |
| **R2** | No extraction type exists for a human-entered figure | Step 2 offers **Confirm / Cannot verify** only. No manual correction. The human selects, never types a figure | Rejecting this requires a third extraction type — a spec change. v1 is stricter than an analyst will expect: one bad feed value stalls the run |
| **R3** | §9.4's twelve flags as one list | Split into provenance (3, underline) and analytic (9, tick rule) with different mechanisms | Twelve identical treatments make the propagated provenance labels as loud as the computed analytic ones, and the page becomes unreadable |
| **R4** | Default provenance unprinted in derived cells | Full three-token stamp always in section B and Screen 2; non-default tokens only in derived tables | Printing `PRIMARY · DETERMINISTIC/STRUCTURED · VERIFIED` on every cell would be the drowning the brief warns about. Confirm this satisfies A13 and A14 |
| **R5** | OKLO success-definition row order | Sort by V_success ascending, so worth-less-than-failure rows are not last | Spec is silent. Alternative is definition order, which buries them |
| **R6** | Where §4.4's three judgments sit | Step 2, after the confirmations, as a distinct band | Spec is silent. Two of the three change figures the confirmations depend on, which is the argument for Step 2 |
| **R7** | Run persistence | `runId` in the URL so refresh does not destroy Step 2 work. **No index, no history, no listing endpoint** | Borderline against §13.1 Saved Analysis. Zero persistence means a refresh destroys the spot-check, which will produce click-through behaviour on the retry |
| **R8** | Entry point | Ticker field only. No launch path from Holdings or Dashboard | A per-holding button implies portfolio context (§1.4) and turns the holdings list into a menu of reasons to open the app |

**Confirmed absent from the design, deliberately:** any thesis, monitoring, portfolio-fit, saved-analysis, sector, persona, discovery or fear/greed element; any stub, feature flag, placeholder or anticipatory hook for one; any mention of building a WACC or switching to equity cash flows (§13.5); any verdict, target, recommendation or advice framing in any copy string; any crypto path.

---

## 19. DESIGN → COMMAND CENTER HANDOFF

**RESULT** — Stock Analyzer v1 interaction and screen design complete. Four screens, three-decoration state system, all 22 states and flags given distinct treatment without semantic colour, provenance layered across three disclosure levels, report ordering fixed with §10.3 resolved by restatement, Microsoft and OKLO degenerate cases rendered.

**VERDICT** — PASS against the brief's DONE WHEN, all 18 items.

**EVIDENCE**

| # | Item | Where |
|---|---|---|
| 1 | End-to-end screen flow, nine steps | §1 |
| 2 | Page/screen architecture | §2 |
| 3 | Component hierarchy | §3 |
| 4 | Step 2 fact-verification UX | §4 + `mock-human-steps.html` |
| 5 | Step 6 profile confirmation/override UX | §5 + `mock-human-steps.html` |
| 6 | Ten suppressing states | §6 |
| 7 | Twelve qualifying flags | §7 |
| 8 | Suppression vs qualification distinction | §8 |
| 9 | Six provenance fields without drowning figures | §9 |
| 10 | Fixed report ordering | §10 |
| 11 | Microsoft degenerate states rendered | §11 + `mock-report-msft.html` |
| 12 | OKLO worth-less-than-failure rows rendered | §12 + `mock-report-oklo.html` |
| 13 | Desktop-first behaviour | §13 |
| 14 | Responsive at 720px | §14 |
| 15 | Progressive disclosure rules | §15 |
| 16 | Accessibility | §16 |
| 17 | Comprehension and learning layer | §17 + all three mocks |
| 18 | UX conflicts with the functional spec | §18 — eight rulings, no STOP |
| 19 | This handoff | §19 |

**NEEDS ME** — YES. Eight rulings in §18. **R1, R2 and R4 are blocking** — BUILD cannot start without them, because R1 determines a report section's structure, R2 determines what Step 2 can do, and R4 determines what every cell in the report prints. R3, R5, R6, R7 and R8 have working defaults and can be confirmed or reversed after BUILD starts.

**STOP CONDITIONS** — none fired. No hash mismatch. No design requires a spec change to be coherent. Every state has a visual treatment that does not change what it means. Nothing required guessing; the eight ambiguities are recorded as rulings rather than resolved silently.

**WHAT MUST NOT BE TOUCHED BY BUILD**

- Methodology, calculations, gates, scope, the §10.0 output contract, any suppression/qualification/refusal state, the set of things the analyzer refuses to do.
- The §10.2 section order.
- The no-glyph rule. There is no glyph component and one must not be added.
- The no-bulk-confirm rule in Step 2.
- The server-side Step 2 gate. A client-side guard does not satisfy §2.
- Truncation of any state or flag name. If a layout appears to require it, STOP.

**BUILD RECEIVES** — the frozen functional spec (`1406eb18…`) and this approved design, and not before. Both hashes attach to every new BUILD session and hash verification is BUILD's first action, per existing Calboard gate process.

---

**END OF DESIGN**

Returns to Command Center for approval.
