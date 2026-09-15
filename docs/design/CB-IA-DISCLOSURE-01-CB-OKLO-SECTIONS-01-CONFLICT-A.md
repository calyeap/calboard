# IA v1.1 — sections I/I2, the OKLO mock, and CB-AUDIT-01 conflict A

DESIGN specification and amendment package. **Nothing in `docs/frozen/` is edited by
this document.** It proposes exact changes for Design reconciliation to apply at
re-freeze. Route: **UX design → Design reconciliation → re-freeze → BUILD.**

Produced against issue [#95](https://github.com/calyeap/calboard/issues/95),
covering three outcomes dispatched together because they land in the same
frozen artefacts:

- `CB-IA-DISCLOSURE-01` — Runway item 4
- `CB-OKLO-SECTIONS-01` — Runway item 5
- `CB-AUDIT-01` conflict A — Runway item 6, wording only

## 0. Contract verification

Fetched from `docs/frozen/` on this branch, hashed with `sha256sum`, checked against
`scripts/evidence/config.ts` `FROZEN_HASHES` — not read from any description.

| Artefact | Registered | Actual | Result |
|---|---|---|---|
| `calboard-stock-analyzer-v1-design.md` | `49be40ca…eed8150b` | `49be40ca…eed8150b` | match |
| `calboard-stock-analyzer-v1-spec.md` | `6a9cf282…0298caf61` | `6a9cf282…0298caf61` | match |
| `mock-report-oklo.html` | `fc6de075…4d9476f` | `fc6de075…4d9476f` | match — same bytes issue #51 verified |
| `mock-report-msft.html` | `4c7547cb…7118fb629` | `4c7547cb…7118fb629` | match |
| `calboard-valuation-methodology.md` | `a4a39e33…54a5ec7c` | `a4a39e33…54a5ec7c` | match |
| `calfinance-methodology-v2.md` | `0e07ec74…7470cb4388c07` | `0e07ec74…7470cb4388c07` | match |

## 1. CB-IA-DISCLOSURE-01 is largely already frozen — issue #95's premise is out of date

**Read this first: the artefact disagrees with the brief, and per issue #95's own
instruction ("where this brief and an artefact disagree, the artefact wins and you
say so") the artefact governs.**

Issue #95 describes this as a first-time specification and says it "carries design
changes D1–D5 and M1 from issue #51." That is only half true. Checking `design.md`
against issue #51's actual proposal:

| Issue #51 proposed | What is actually frozen | Same? |
|---|---|---|
| D1 — amend §17.3, give I/I2 a 5-part order (main takeaway; what supports it; what worries me; biggest uncertainty; challenger point) replacing §17.3's order for these two sections only | §17.6 (unchanged): **I and I2 still take no finding block at all** — "already prose authored for a human reader." §17.7 adds progressive disclosure instead: a visible primary summary, "a restructuring of their own existing prose... it follows none of §17.3's order" | **No — a different mechanism was ruled** |
| D2 — new §17.3.1, deterministic challenger-point selection | Frozen as **§17.7.1**, same substance (earliest-bound section, ties by return order, "selected by report order... not... the strongest") | Same rule, different section number |
| D3 — §17.4 constraint 7, no state may appear only in the I/I2 primary layer | Frozen as **§17.4 constraint 7**, verbatim match | Same |
| D4 — §10 ordering block, `I`/`I2` rows reworded | **Not applied.** `spec.md` §10.2 still reads "I — Interpretation [C]. Per §8.2." / "I2 — Challenger findings. Per §8.5..." with no §17.3-exception language, consistent with D1 not being the mechanism adopted | Not needed — D4 was downstream of D1, and D1 wasn't taken |
| M1 — replace the two `mock-report-msft.html` stub sections with the designed rendering | **Already done.** Lines 913–1014 of the current frozen `mock-report-msft.html` are a full `.sec-i` rendering (states-first `.bearing` block, four-item finding block — *What supports it / What worries me / Biggest uncertainty / Challenger point* — and a three-item disclosure rail), not stubs. A scoped `.sec-i` CSS block (lines 282–321) implements it, marked `ADDED BY CB-IA-DISCLOSURE-01`, "no existing rule is modified, no colour token is added" | Already applied |

**Conclusion:** CB-IA-DISCLOSURE-01's mechanism (§17.6/§17.7/§17.7.1/§17.4-c7) is
already frozen and already rendered for MSFT. This design pass does not need to
design it again. What it needs to do is (a) confirm that rendering still satisfies
the UX principles and the Design consistency gate — §5 below does that — and
(b) apply the *same, already-approved* pattern to OKLO, which never got it. That is
§2.

Nothing here reopens §17.3, §17.6, §17.7, §17.7.1 or §17.4 constraint 7. They are
correct as frozen and this pass does not amend them.

## 2. CB-OKLO-SECTIONS-01 — designing I and I2 for OKLO

### 2.1 What's actually in the file

`mock-report-oklo.html`'s rail (lines 279–291) advertises A, B, C, D, E, F, G, H, I,
I2, J, ★. The sections that actually render are only **A, C, D ×3 (the
success-definition table, unit economics, funding stack), H, J, At‑a‑glance** — no
`<h2>` for B, E, F, or G exists anywhere in the file, and I/I2 are the two issue #95
was opened for.

**This design pass designs only I and I2, per issue #95's named scope.** B, E, F
and G being absent too is new evidence, not something this pass has authority to
fix — see §4.

### 2.2 The design: reuse the frozen MSFT pattern, OKLO content

No new component, no new CSS rule, no new colour token. The same `.sec-i` block
already frozen in `mock-report-msft.html` (lines 282–321) is appended to
`mock-report-oklo.html`'s `<style>`, byte-identical:

```css
/* ================= ADDED BY CB-IA-DISCLOSURE-01 =================
   Scoped to sections I and I2 by the .sec-i class. No existing rule is
   modified, no colour token is added, and no other section is touched. */

/* The complaint was that body copy is small for the volume. In the primary
   layer of these two sections only, it goes to body size. Disclosure bodies
   stay at 12px, so depth still reads as depth. */
.sec-i .finding dd{font-size:15px;line-height:1.5}
.sec-i .finding dl{grid-template-columns:152px minmax(0,1fr);gap:15px 20px}
.sec-i .finding .lede{font-size:21px;margin-bottom:22px;max-width:60ch}
.sec-i .finding dd{max-width:62ch}

/* States that this section's reading depends on sit above the takeaway
   instead of inside its sentences. Nothing is hidden; §15 is untouched. */
.sec-i .bearing{margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid var(--hairline)}
.sec-i .bearing h3{margin:0 0 10px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-muted);font-weight:600}
.sec-i .bearing .state{margin-bottom:9px}
.sec-i .bearing .state .plain{display:block;font-size:13px;line-height:1.45;margin-bottom:6px;
  font-feature-settings:'tnum' 0}
.sec-i .bearing .qual{font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  display:flex;gap:6px;align-items:baseline}
.sec-i .bearing .qual::before{content:"";flex:0 0 8px;height:1px;background:var(--ink);
  transform:translateY(-3px)}
.sec-i .bearing .what{font-size:12px;color:var(--ink-muted);margin:4px 0 0 14px;max-width:66ch}

/* The depth rail. Each row is one interaction, expanding in place. Siblings,
   never nested — §15 rule 1 holds. */
.sec-i .more{margin-top:24px;border-top:1px solid var(--hairline)}
.sec-i .more .disclose{margin-top:0;border-bottom:1px solid var(--hairline)}
.sec-i .more .disclose:last-child{border-bottom:0}

.sec-i .selrule{display:block;font-size:12px;color:var(--ink-muted);margin:10px 0 0;max-width:66ch}
.sec-i .count{font-size:12px;color:var(--ink-muted);margin:0 0 18px}

@media (max-width:720px){
  .sec-i .finding dl{grid-template-columns:1fr;gap:3px 0}
  .sec-i .finding .lede{font-size:18px}
}
/* ================= END CB-IA-DISCLOSURE-01 ================= */
```

`mock-report-oklo.html` already defines `.finding`, `.disclose`, `.state .plain/.name/.cause`
and `.manifest` for its own existing sections (A, C, D), so only the `.sec-i`-scoped
additions above are new — exactly the same delta M1 made to the MSFT mock, applied
to the sibling file.

**Insertion point:** between `H — Fair-value range` and `J — Provisional and
unmodelled register`, matching the rail order (`…H · I · I2 · J…`).

**Content**, grounded only in figures already present elsewhere in this frozen mock
(no new figure is introduced — §17.4 rule 3):

```html
<!-- ============ I, I2 ============ -->
<section class="sec-i">
  <div class="sechead"><h2>I — Interpretation</h2><span class="k">Plain English · no verdict, target or recommendation</span></div>
  <hr class="rule">

  <div class="bearing">
    <h3>States this reading depends on</h3>
    <div class="state">
      <span class="plain">On two of the six ways this company could succeed, existing shareholders would end up
      with less than if it simply wound up and returned its cash today.</span>
      <span class="name">This success is worth less than failure</span>
      <span class="cause">2 of 6 success definitions · V_success below V_fail $3.10</span>
    </div>
    <div class="qual">Rate capped — value is an upper bound</div>
    <p class="what">The 30% levered cost-of-equity cap binds on 3 of 6 success cases, including the reference
    ramp below. The cap biases generous — the true value is more likely lower than shown, not higher.</p>
  </div>

  <div class="finding">
    <p class="lede">Today's price requires more capacity, or better economics, than the conservative 8‑gigawatt
    reference case delivers — and on two of the six ways this company could succeed, that success is worth less
    than the cash already on the balance sheet.</p>
    <dl>
      <dt>What supports it</dt>
      <dd>The conservative reference case — 8 GW, back-loaded ramp, utility multiple — already clears the cash
      floor by a wide margin: $31 a share against $3.10, and $48 on the steadier ramp. Value is created, not
      merely preserved, once the company reaches ordinary utility economics.</dd>

      <dt>What worries me</dt>
      <dd>Both reference values assume a fixed two-year construction lead with no slip. Solved year by year, a
      start-date shift currently only compresses the ramp rather than moving the exit — a real slip moves both,
      and this run does not yet model that. The gap that assumption is worth is $27 a share.</dd>

      <dt>Biggest uncertainty</dt>
      <dd>The cash floor and every dilution and runway figure in the funding stack rest on quarterly burn and a
      cash-per-share figure that are both Unverified. Nothing downstream of them carries independent confirmation.</dd>

      <dt>Challenger point</dt>
      <dd>The cash-per-share and burn figures the entire funding stack depends on are Unverified, so the support
      above leans hardest on the least-verified input in the report.
      <span class="selrule">Selected as the challenger finding bound to the earliest section of the report, not
      as the most damaging one. Calboard does not rank objections. The full set is in I2.</span></dd>
    </dl>

    <div class="more">
      <details class="disclose">
        <summary><span class="lbl">Full interpretation</span></summary>
        <div class="body">Each statement references the values it rests on. Base rates are cited only from
        supplied data; where none is available the interpretation says so and stops. The full reading covers
        every success definition in the table and every line of the funding stack, not only the points
        summarised above.</div>
      </details>
      <details class="disclose">
        <summary><span class="lbl">Show calculation</span></summary>
        <div class="body">The formulas behind the $3.10 cash floor, the $31 and $48 reference-ramp values, the
        four funding-stack lines for both ramps, and the discount rates used for each success definition, each
        with its inputs and the policy constants in force for this run.</div>
      </details>
      <details class="disclose">
        <summary><span class="lbl">Provenance for every figure above</span></summary>
        <div class="body">Source document string and link, retrieval timestamp, and the derivation path for the
        cash-per-share and quarterly-burn figures. Both Unverified tokens themselves remain visible at their
        figures in sections A and D.</div>
      </details>
    </div>
  </div>
</section>

<section class="sec-i">
  <div class="sechead"><h2>I2 — Challenger findings</h2><span class="k">A separate call that did not see the analysis</span></div>
  <hr class="rule">

  <div class="finding">
    <p class="lede">The cash-per-share and quarterly-burn figures underlying the entire funding stack and cash
    floor are Unverified, so the analysis leans hardest on its least-verified input.</p>
    <dl>
      <dt>What it bears on</dt>
      <dd>The $3.10 cash floor, every dilution and runway figure in the funding stack, and both reference-ramp
      values — $31 and $48 per share.</dd>

      <dt>Its evidence</dt>
      <dd>The cash-per-share and quarterly-burn figures both carry the Unverified provenance token in section D.
      No independently sourced or structured-feed figure stands behind either.</dd>

      <dt>What would make it matter</dt>
      <dd>The cash or burn figures being materially misstated. A lower true cash balance moves the floor down
      directly; a higher true burn shortens the runway and pulls the equity raise forward, which increases
      dilution at both ramps.</dd>
    </dl>
    <p class="selrule">Shown first because it is bound to the earliest section of the report, which is a fixed
    ordering rule and not a judgment about severity. Findings are placed alongside the analysis and never
    reconciled with it; neither side is rewritten in light of the other.</p>

    <div class="more">
      <details class="disclose">
        <summary><span class="lbl">The other challenger findings</span></summary>
        <div class="body">One call, one set of findings — no personas, no voting, no scoring. Each remaining
        finding shows the claim or fact it bears on, its evidence, and what would have to be true for it to
        matter, in the same fixed report order.</div>
      </details>
    </div>
  </div>
</section>
```

### 2.3 Why this content, not other content

- **States-first (§17.4 c7).** `THIS SUCCESS IS WORTH LESS THAN FAILURE` and the
  rate cap are OKLO's two states this reading depends on — the direct parallel to
  MSFT's `DEGENERATE` state and margin-at-high qualifier. Both already exist
  elsewhere in the frozen mock (section D); nothing new is asserted.
- **Challenger point = Unverified cash/burn, not the two-of-six finding itself.**
  The two-of-six finding is the *analysis's own* main finding (it is already the
  Quick Read headline); a challenger has to be an independent objection to the
  analysis, not a restatement of it. The MSFT precedent picks the least-verified
  input feeding the numbers being discussed (finance-lease additions); OKLO's
  parallel least-verified input is the cash/burn figure the entire I section
  leans on. That also satisfies §17.7.1: it is a deterministic, reach-based
  selection (earliest-bound input), not a severity judgment.
- **No new figure.** Every number used ($3.10, $31, $48, $27, 2 of 6, 3 of 6, "two
  years") is already rendered elsewhere in this exact frozen file.

## 3. CB-AUDIT-01 conflict A — the wording change list

**Ruled by Calvin, 14 Sep 2026: the spec and CalFinance govern.** §7.2 M16 already
names the correct term — **"conditional price-implied break-even success weight"**
— and never uses "probability." The short form used below, **"success weight,"**
is the plain-English form of that same term, used the same way CalFinance and the
spec already use it; the full CalFinance term is cited once, in the retained
disclosure, so the mapping is traceable.

**Checked against §7.2 M16 and CalFinance v2:** neither is changed. The
computation, the three-state table (`NOT COMPUTED/SUPPRESSED` ·
`PRICE NOT JUSTIFIABLE BY THIS OUTCOME` · `THIS SUCCESS IS WORTH LESS THAN
FAILURE` · the weight itself) and the "rounded to the nearest 5%" convention are
untouched. Words only.

### 3.1 `mock-report-oklo.html` — every occurrence

| Line | Current | Replacement |
|---|---|---|
| 390 | `Why six definitions instead of one probability` (disclosure label) | `Why six definitions instead of one number` |
| 391 | `A single "probability of success" figure requires a single definition of success` | `A single success weight requires a single definition of success` |
| 395 | `Calboard shows the value of each definition and only computes a probability where the definition is worth more than failure.` | `Calboard shows the value of each definition and only computes a weight where the definition is worth more than failure.` Append one sentence, since the deep disclosure is the right place for the full CalFinance mapping: `Calboard calls this a success weight — CalFinance Methodology v2's conditional price-implied break-even success weight — never a probability, because it carries no claim about how likely success actually is.` |
| 383–384 | `Calboard refuses to compute an implied probability for those two, because the arithmetic that converts price into a probability has no meaning when success is worth less than failure.` | `Calboard refuses to compute a success weight for those two, because the arithmetic that converts price into a weight has no meaning when success is worth less than failure.` |
| 407 | `2 of 6 success definitions · implied probability suppressed for those rows` | `2 of 6 success definitions · success weight suppressed for those rows` |
| 452 | `<h2>D — Implied probability of success</h2>` | `<h2>D — Price-implied success weight</h2>` (subtitle `Per definition · never one number` is unchanged and already correct) |
| 461 | `Implied probability works by comparing today's price against two outcomes...` | `The success weight works by comparing today's price against two outcomes...` (rest of the sentence unchanged — it already correctly describes the mechanism without claiming a likelihood) |
| 494 | `<th>...<th>r_fail</th><th>Implied probability</th>` | `<th>...<th>r_fail</th><th>Success weight</th>` |
| 506, 520, 535, 545, 554, 563 | `data-l="Implied probability"` (×6, one per table row, mirrors the `th` for the responsive layout) | `data-l="Success weight"` (×6) |
| 703 | `<span class="lbl">Implied probability, definition 3</span>` | `<span class="lbl">Success weight, definition 3</span>` |
| 704 | `<span class="lbl">Implied probability, definition 4</span>` | `<span class="lbl">Success weight, definition 4</span>` |
| 102 (CSS comment, not user-facing) | `/* the probability column is sized for the state name, not for "25%" */` | `/* the success-weight column is sized for the state name, not for "25%" */` — included for internal consistency; not itself a contract change |

No other file under `docs/frozen/` besides `mock-report-oklo.html` renders this
phrase as user-facing copy in a way this pass's scope covers — see §3.3 for the two
places that do and are deliberately **not** touched here.

### 3.2 `calboard-stock-analyzer-v1-design.md` — the OKLO worked example (§12)

| Line | Current | Replacement |
|---|---|---|
| 549 | `Single implied probability not tied to a definition` | `Single success weight not tied to a definition` |
| 632 | `Only the probability cell becomes a StateSlot.` | `Only the success-weight cell becomes a StateSlot.` |
| 635 | `success definition  V_success  V_fail  r_succ  r_fail  implied probability` (ASCII header) | `success definition  V_success  V_fail  r_succ  r_fail  success weight` |
| 654 | `The probability column is sized for the state name, not for 25%.` | `The success-weight column is sized for the state name, not for 25%.` |

`spec.md` needs **no change**: its existing text ("This is not a probability of
success," "never described as a probability of success," the caveat-register
entry listing "a single 'implied probability of success' figure" as the thing
**not** to build) already states the correct rule. Nothing there asserts the
banned framing as true.

`calfinance-methodology-v2.md` needs **no change** for the same reason — its
text already states the prohibition ("must not be presented as an identified
real-world probability of success").

### 3.3 Found but out of scope — named, not touched

Two more places carry the pre-CalFinance-v2 "probability" framing more
pervasively than the two named artefacts. Issue #95 scopes conflict A to **"app
copy, the frozen OKLO mock, and the design, re-frozen together"** — neither of the
following is one of those three, so this pass names them and stops rather than
silently widening scope:

1. **`docs/frozen/calboard-valuation-methodology.md`** (also `FROZEN_HASHES`-registered) —
   uses "implied probability of success" as a row/column label (§7 stage table, the
   profile table), and states in prose "the probability, rounded to the nearest 5%"
   and "Probability is reported per success definition, never as one number" —
   i.e. it still calls the weight a probability throughout, which is exactly what
   CalFinance v2 (a later, more specific document) now forbids. This looks like the
   older document that CalFinance v2 corrected, left unreconciled. **Flagged for a
   separate ruling — it is a real instance of the same defect, not a false
   positive, but fixing it is outside this outcome's named scope.**
2. **App code** (`app/components/AnalyzerReport.tsx:800`, its test at
   `AnalyzerReport.test.tsx:64,148`, and the comment at
   `AnalyzerReport.tsx:794`) — hardcodes the heading text `"D — Implied
   probability of success"`. `lib/analyzer/ai/interpretation.ts:75` already
   instructs the model correctly ("a conditional price-implied break-even
   success weight... never an implied probability of success"), so the
   narrative copy this pass is concerned with is already safe; only the
   **static heading string** needs the same §3.1 replacement. **This is
   product code. This pass does not write it or open a PR against it** — it is
   recorded here as the exact follow-up BUILD needs once §3.1/§3.2 are
   re-frozen, so the app heading and the re-frozen mock agree on day one.

## 4. Found but out of scope — B, E, F, G also absent from the OKLO mock

`mock-report-oklo.html`'s rail advertises **B — Fact set**, **E — Price-implied**,
**F — Scenarios** and **G — Scenario outputs** (lines 281–284) in addition to I and
I2. None of the four has a rendered `<h2>` anywhere in the file — confirmed by
listing every `.sechead h2` in the document (§0's verified bytes; only `A`, `C`,
`D` ×3, `H`, `J` and the closing synthesis render). **§10 forbids this exactly as
it forbids the I/I2 absence issue #95 was opened for:** a section is never
absent, and here four more are.

**This pass does not fix it.** Issue #95 names sections I and I2, specifically,
as the OKLO defect ("`mock-report-oklo.html` renders neither section I nor
section I2... §10 forbids it") and its `SCOPE BOUND` section is explicit that
this dispatch is not authority for anything beyond the (r)/(s) reframing plus the
three named outcomes. Designing four more sections' content was not authorised,
and doing it inline here would be exactly the scope-creep the dispatch warns
against.

**Returned, not fixed — for the same reason issue #51 returned the I/I2 defect
rather than patching it:** it is outside this outcome's authorised scope, and it
is not a copy problem, so it needs its own ruling and its own outcome ID before a
worker designs it.

## 5. Deviations from named UX principles

**None.** This pass applies the already-frozen §17.6/§17.7/§17.7.1/§17.4-c7
mechanism (§1) to OKLO without modification, and the conflict-A wording change is
words only. No exception to a named principle was needed, so there is nothing to
propose as a deviation.

## 6. Design consistency gate — the seven questions

1. **Which existing Calboard primitives does this reuse?** `.finding`, `.disclose`,
   `.state`, `.manifest` (already in `mock-report-oklo.html`'s own stylesheet) plus
   the already-frozen `.sec-i` block (§2.2), reused byte-for-byte from
   `mock-report-msft.html`.
2. **Does it introduce any justified new semantic token / component?** No. Zero
   new CSS custom properties, zero new colour values. The `.sec-i` block being
   proposed for OKLO is the identical block already frozen for MSFT — not a new
   component, the same one applied to a second file.
3. **How does it behave in light and dark?** Every rule in the reused block reads
   `var(--ink)`, `var(--ink-muted)`, `var(--hairline)` — the canonical tokens
   already defined with light and dark values at the top of `mock-report-oklo.html`
   (`:root` / `[data-theme="dark"]`, identical token set to MSFT's). No literal
   colour appears in the block, so both themes are handled by the existing token
   definitions with no further work.
4. **How does it behave at compact, standard and wide widths?** The block's own
   `@media (max-width:720px)` rule collapses the two-column finding grid to one
   column and steps the lede down to 18px, matching the mock's existing 720px
   breakpoint used throughout the file. Standard and wide inherit the 152px-label /
   fluid-body grid unchanged, consistent with §17.15's reading-width-vs-workspace-width
   split already governing the rest of the report.
5. **Does it preserve shared navigation / interaction language?** Yes — the
   disclosure affordance (`▸`/`▾`, hover, `:focus-visible`) is the one component
   defined once in the base stylesheet and reused, per §17.12; no second
   disclosure pattern is introduced.
6. **Can the main message be understood quickly?** Each section leads with a
   single-sentence lede at 21px, states rendered above it in full per §17.4-c7, four
   short labelled lines beneath — the same shape validated for MSFT.
7. **Can deeper evidence be inspected without losing rigor?** Yes — three
   one-interaction disclosures in I (`Full interpretation`, `Show calculation`,
   `Provenance for every figure above`) and one in I2 (`The other challenger
   findings`), each naming the specific question it answers, none reading "Learn
   more," "Details" or "More info."

## 7. `DONE WHEN` — issue #95's checklist, checked

1. Primary layer for I and I2 specified with reading order and disclosure
   structure stated — §2.2.
2. Every disclosure carries a specific label naming the question it answers — §6
   Q7; no generic label used.
3. OKLO's I and I2 bodies designed, rendering their state (`THIS SUCCESS IS WORTH
   LESS THAN FAILURE`, rate-capped qualifier) rather than being absent — §2.2,
   §2.3.
4. Conflict A wording replaced everywhere it appears within this pass's scope,
   stated and checked against §7.2 M16 and CalFinance v2 — §3.1, §3.2; two
   further, out-of-scope instances named rather than silently left — §3.3.
5. Deviations from named UX principles listed — §5 (none required).
6. Light/dark and compact/standard/wide addressed, Design consistency gate's
   seven questions answered — §6.
7. No genuinely new principle surfaced this pass; nothing to reconcile back into
   the canonical UX page.
8. This document is the amendment/re-freeze package — ready to hand to Design
   reconciliation.

## 8. What Design reconciliation needs to do at re-freeze

1. Apply §2.2's CSS and markup to `mock-report-oklo.html`.
2. Apply §3.1's wording changes to `mock-report-oklo.html`.
3. Apply §3.2's wording changes to `calboard-stock-analyzer-v1-design.md` §12.
4. Add an amendment record (parallel to `design.md` §20.6, referenced in §1's
   table) naming `CB-OKLO-SECTIONS-01` and the conflict-A wording change, and
   re-run the hash register in `scripts/evidence/config.ts` for both touched
   files.
5. Route `CB-AUDIT-01`'s app-code follow-up (§3.3 item 2) and the
   `calboard-valuation-methodology.md` finding (§3.3 item 1) to Calvin for
   scoping as their own outcomes — neither is re-frozen by this package.
6. Route the B/E/F/G absence (§4) to Calvin for its own outcome ID before any
   worker designs it.

Only after re-freeze does `CB-AUDIT-01`'s app-heading follow-up (§3.3 item 2)
become BUILD-ready work.
