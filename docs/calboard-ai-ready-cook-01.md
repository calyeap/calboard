# Calboard AI-Ready Gate — Cook Test Audit Evidence

**OUTCOME-ID:** `CB-AI-READY-COOK-01`
**Originating issue:** [#73](https://github.com/calyeap/calboard/issues/73)
**Snapshot date:** 2026-09-12
**Status of this file:** dated audit evidence snapshot. Not a governing source, output/type contract, or new policy. Superseded by the next audit or by owner reconciliation, whichever comes first.

This file is the required deliverable for the Cook Test: an independent, fresh-context
reconstruction of Calboard's current authority graph, checked for currency, retrievability,
and sufficiency ahead of broader unattended execution. It does not rule on product, finance,
or design questions, and it creates no new authority.

## 1. Fetch log

All sources below were retrieved directly in this session on 2026-09-12 (UTC timestamps as
reported by each source), not inferred from chat memory or prior reports.

**GitHub** (repo `calyeap/calboard`):
- Repo `HEAD`/`master` at fetch time: `ee9afb18a51156a05472d3dc477ed7f655a49a85` (2026-09-12T23:53:37+08:00) — matches the dispatch-routing SHA issue #73 names; no rewind needed.
- Issues: [#73](https://github.com/calyeap/calboard/issues/73) (open, this outcome), [#71](https://github.com/calyeap/calboard/issues/71) (closed/completed, `CB-H3-AI-CASH-ALIASES-01`), [#69](https://github.com/calyeap/calboard/issues/69) (open, retained parent-recovery history — not touched).
- PR [#72](https://github.com/calyeap/calboard/pull/72) (merged, `CB-H3-AI-CASH-ALIASES-01`).
- Branches (`list_branches`) and open PRs (`list_pull_requests`, `search_pull_requests`) as of fetch time: no branch or PR named for or referencing `CB-AI-READY-COOK-01` existed before this run — no duplicate active run.
- Repo files: `CLAUDE.md`, `DESIGN.md`, `.github/ai-routines/BUILD.md`, `.github/ai-routines/CC.md`, `scripts/evidence/config.ts` (`FROZEN_HASHES`), `docs/frozen/*` (all 8 files, byte contents hashed directly).

**Notion** (`verification.state: "unverified"` on every page below — Notion's own field, not a claim of falseness; no `truncated`/`unknown_block_count` flags were present on any fetch, i.e. no source was cut short):
- [AI SYSTEM | WORKFLOW & OPTIMISATION](https://app.notion.com/p/3d00ca9a8fd0814d81decc5250bb5070) ("Workflow owner") — edited 2026-09-12T16:04:34Z.
- [Calboard Progress Board](https://app.notion.com/p/3d20ca9a8fd081368fa4df96283530b6) — edited 2026-09-12T16:03:16Z.
- [Product Roadmap](https://app.notion.com/p/3c60ca9a8fd08145bd86d5334a6b9b06) — edited 2026-09-12T15:23:20Z.
- [Product Decision Log](https://app.notion.com/p/3c60ca9a8fd081d09962fcb8fc34bb77) — edited 2026-09-12T09:11:50Z.
- [Technical Specs Index](https://app.notion.com/p/3c60ca9a8fd081328231ded31fbe1f54) — edited 2026-09-12T09:05:26Z.
- [CalFinance methodology v2 — Current](https://app.notion.com/p/3d20ca9a8fd08144ad14e66530f86e30) — edited 2026-09-12T07:10:44Z.
- [Source of Truth Map](https://app.notion.com/p/3d40ca9a8fd0811986a4e813dae53c2f) — edited 2026-09-12T08:08:26Z.
- [Trust & Safety Map](https://app.notion.com/p/3d40ca9a8fd081a8a2e3d1b59000dae4) — edited 2026-09-11T09:06:11Z.
- [reconstruct-project-state](https://app.notion.com/p/3d80ca9a8fd0818cabbbcf2ecf1560ec) — edited 2026-09-12T13:27:09Z.
- [execute-and-verify](https://app.notion.com/p/3d80ca9a8fd081609743e195ba34ad26) — edited 2026-09-12T10:41:17Z (retrieved and followed per BUILD.md's start gate).
- [review-work](https://app.notion.com/p/3d90ca9a8fd08127927ed6b32a010859) — edited 2026-09-12T13:10:00Z.
- [CAL Project & AI Workspace Standard V1](https://app.notion.com/p/3d70ca9a8fd08118afd8e9391d3ff29e) — edited 2026-09-12T15:26:02Z.

No Notion writes were made. No repo file other than this one was added or edited.

## 2. Lens 1 — Product purpose/logic: deterministic vs. authored/AI responsibilities

**READY.** The split is explicit and enforced in code, not just documented. Deterministic
figures are computed by `CatalogueBuilder` with provenance carried on the binding itself
(`lib/analyzer/ai/slots.ts`); the AI interpretation layer (`interpretation.ts`) only assembles
a prompt from that catalogue and may reference slots by name (`traceability.ts`'s
`renderText`), never author a number. An unknown or unavailable slot throws
`UntraceableFigureError` (the real "unknown slot" guard) rather than degrading to a
substitute value. PR #72 (merged) is a concrete recent instance of this contract being
exercised and defended: it fixed two AI-facing alias slots that were bypassing inherited
non-default provenance qualification, with negative regressions proving the failure mode
before the fix and its absence after. Source: repo code + PR #72 (GitHub, native fact).

## 3. Lens 2 — CalFinance authority vs. frozen implementation snapshots

**READY**, with explicitly parked items correctly left parked.

- The CalFinance methodology v2 Notion page self-declares current authority in-page ("CURRENT
  CALFINANCE METHODOLOGY AUTHORITY — Methodology v2 approved 8 Sep 2026 ... Calboard implements
  approved product-facing rules and does not become finance authority through code, constants
  or frozen artefacts").
- `docs/frozen/calfinance-methodology-v2.md` is the repo-side **implementation snapshot** of
  that authority (per Technical Specs Index: last amended via `CB-H3-CONTRACT-01`, PR #61), not
  a competing authority — consistent with CLAUDE.md's own framing.
- Settled since approval: no investment leverage/margin, required 5-part pre-BUY process,
  drawdown/average-down escalation, valuation-position semantics (CHEAP/FAIR/EXPENSIVE/
  INCONCLUSIVE), pre-revenue cash-floor basis (11 Sep 2026), success-weight date-consistency
  rule (12 Sep 2026).
- Explicitly unresolved/parked, correctly not implemented: CHEAP/FAIR/EXPENSIVE numeric
  cut-points (marked test/provisional, non-governing), portfolio risk envelope, performance
  hurdle, SBC/dilution single-count mechanics, exact pre-revenue financing method. Historical
  allocation percentages are explicitly superseded (5 Sep 2026) and correctly retained only as
  history.
- This matches the Progress Board's own record that the valuation-position chain is "parked,
  not delivered" for M8 — no drift between finance authority and product sequencing on this
  point.

## 4. Lens 3 — Feature-contract / design-frozen-spec hierarchy; next scope and re-freeze boundaries

**READY**, one minor naming-clarity observation (not a blocker).

- Technical Specs Index lists all 8 currently-approved frozen artefacts/revisions with their
  amending PRs; this is the correct semantic authority for *which* frozen revision governs
  (see Lens 5 for byte-level verification against `FROZEN_HASHES`).
- Roadmap's ruled sequence (11 Sep 2026): Verification & Logic Audit (done) → **Report copy &
  IA v1.1** (incl. bounded (r)/(s)) → **M9** → v1 acceptance → V1.5, with Design
  reconciliation/re-freeze as the explicit routing step between UX/information design and
  BUILD. This matches issue #73's own restatement of the sequence, and matches
  `DESIGN.md`'s self-description as a routing/index surface deferring to the frozen design
  contract for Stock Analyzer work.
- **Observation (source-clarity, not a defect):** issue #73 cites a "governing Workflow
  roadmap" for the AI-Ready Gate; this is the *Workflow owner* page's own roadmap table, a
  different document from the *Product Roadmap* page, which does not mention "Calboard
  AI-Ready Gate" at all. Both are correctly named in their own domains, but a fresh session
  skimming only the word "roadmap" could conflate them. Smallest disposition: no content
  change needed; the Workflow owner page could rename its internal roadmap table to avoid the
  homonym, at the Workflow owner's discretion.
- Technical Specs Index also documents a real historical failure mode worth carrying forward:
  a 9 Sep re-freeze recorded only one half of the required pair (Index vs. `FROZEN_HASHES`),
  causing a silent one-day gate failure. Both halves are currently consistent (Lens 5), so this
  is retained as history, not a current gap.

## 5. Lens 4 — Evidence/dashboard routing; semantic acceptance vs. merge/worker evidence

**READY.**

- Source of Truth Map's stated per-domain ownership (Calboard CC = semantic project state;
  GitHub = native PR/commit/CI/merge facts; Technical Specs page + repo bytes = frozen-artefact
  authority; CalFinance page = finance authority) matches this repo's `CLAUDE.md` routing
  exactly — no discrepancy found between the two independently-fetched sources.
- Progress Board correctly distinguishes semantic acceptance from worker/merge evidence: it
  records PR #72 as merged and issue #71 as closed, but frames the underlying H3 consumer
  acceptance as reconciling via explicit owner-approved follow-ups (`CB-H3-CONSUMER-RECOVERY-01`,
  `CB-H3-AI-CASH-ALIASES-01`) rather than treating "merged" as self-certifying acceptance —
  consistent with `execute-and-verify`'s own rule that "worker evidence is not semantic
  acceptance" and `review-work`'s "tests passing is evidence, not acceptance."
- Material-claim check, PR #72 vs. issue #71's acceptance criteria: PR #72's body documents the
  real seam exercised (slot catalogue → real interpretation prompt → real substitution path),
  negative regressions against the unmodified base reproducing the exact diagnosed symptom,
  targeted + full-suite + build verification, and independent re-hashing of all 8 frozen
  artefacts — matching issue #71's numbered acceptance criteria point for point. No
  unsubstantiated "logs available on request"-only claims found.
- This audit's own registration (issue #73 opened 2026-09-12T16:02:20Z) had not yet been
  reflected as `RUNNING` in the Progress Board fetched one minute later — an expected timing
  artifact of a fresh dispatch, not a routing defect.

## 6. Lens 5 — Autonomous execution permissions, duplicate guard, correction limits, guarded merge, Calvin boundary

**READY.**

- `.github/ai-routines/BUILD.md` in this repo is byte-identical in substance to the
  `CALBOARD-BUILD-AUTO` adapter this run followed, confirming the routine wake context matched
  the durable repo-side procedure rather than diverging from it.
- Duplicate guard exercised for real this run: `search_issues`, `list_pull_requests`, and
  `list_branches` were checked for any existing branch/PR tied to `CB-AI-READY-COOK-01` before
  any repo mutation — none existed, so no `DUPLICATE ACTIVE RUN` / `RECONCILIATION REQUIRED`
  was warranted.
- Trust & Safety Map's default ("BUILD must not merge protected branches without
  authorisation") is correctly superseded, not contradicted, by the later-recorded guarded
  auto-merge delegation in `review-work`'s pilot update and by the Workflow owner page's own
  "ROADMAP" table entry ("Guarded auto-merge is PROVEN LIVE on PR #64 and again on corrective
  PR #66"; "DONE — One real hands-off proof / Workflow freeze," 12 Sep 2026) — both explicitly
  frame this as an intentional, evidenced supersession of the stricter default, not a silent
  drift. `.github/ai-routines/CC.md`'s merge-gate checklist matches this delegated model.
- Correction-loop cap (two automatic cycles before `RECONCILIATION REQUIRED`) is stated
  consistently in `BUILD.md`, `CC.md`, and issue #73 itself; issue #69/#71's separate-approval
  framing for post-budget-exhaustion follow-ups is consistent with the Decision Log's
  `CB-H3-ARCH-01` entry and the Progress Board's own account of the correction history.
- The Workflow owner page's own "NEXT — Calboard AI-Ready Gate" table row is the actual,
  present authority issue #73 claims for this outcome (verified directly, not taken on the
  issue's word) — including the stated boundary that this gate's Calvin role is "only genuine
  unresolved product / finance / methodology / UX judgement and final acceptance," matching
  issue #73's own hard limits.

## 7. Frozen artefact integrity (bidirectional)

All 8 artefacts in `docs/frozen/` were independently re-hashed (SHA-256) this session and
compared against both `scripts/evidence/config.ts`'s `FROZEN_HASHES` and the Technical Specs
Index's currently-approved revision list. Byte-identical in both directions; no missing
artefact (which would have been a STOP, per the register's own comment).

| File | SHA-256 (computed) | Matches `FROZEN_HASHES` | Matches Technical Specs Index |
|---|---|---|---|
| `calboard-stock-analyzer-v1-spec.md` | `6a9cf282ce…` | yes | yes (amendment `CB-H3-CONTRACT-01`, PR #61) |
| `calboard-stock-analyzer-v1-design.md` | `49be40cafc…` | yes | yes (amendment `CB-IA-DISCLOSURE-02`, PR #52) |
| `mock-screen1-entry.html` | `700db080c6…` | yes | yes (re-frozen M8-2-D, PR #48) |
| `mock-human-steps.html` | `2f9e741bb7…` | yes | yes (M7-c, PR #30) |
| `mock-report-msft.html` | `4c7547cb23…` | yes | yes (re-frozen `CB-IA-DISCLOSURE-02`, PR #52) |
| `mock-report-oklo.html` | `fc6de075e6…` | yes | yes (re-frozen PR #27) |
| `calboard-valuation-methodology.md` | `a4a39e3371…` | yes | yes (v1.0.2, superseded as authority by v2, retained as history) |
| `calfinance-methodology-v2.md` | `0fd8e205fe…` | yes | yes (amendment `CB-H3-CONTRACT-01`, PR #61) |

## 8. Overall readiness verdict

**READY** for the already-authorised next outcome (Report copy & IA v1.1) to be dispatched
under existing authority, subject to the one non-blocking clarity observation in §4 above,
which is for the Workflow owner to action or decline at their discretion. No source conflict
was found that would require `RECONCILIATION REQUIRED`. No missing authority was found that
would require `BLOCKED`. This verdict covers **source readiness** only — it is not full
Analyzer v1 acceptance, not a design/UX ruling, and not permission to begin M9 or any IA
implementation; those remain gated on the roadmap's existing sequence and Calvin's final
acceptance as stated throughout the sources above.

## 9. Checks explicitly not run

- No application test suite, typecheck, or production build was run — out of scope for a
  Markdown-only evidence diff with no application/test/schema/dependency change (per issue
  #73 §"Evidence-only diff": "no gratuitous DB setup/full-suite/build requirement for a
  Markdown-only diff").
- No Notion page was fetched beyond the 12 pages listed in §1; deeper Notion databases (e.g.
  the linked "AI Workflow Roadmap" database) were not opened, as nothing in the five lenses
  required them.
- No attempt was made to independently verify Calvin's own approvals (e.g. the "APPROVED by
  Calvin, 12 Sep 2026" annotations on issues #69/#71 and Decision Log entries) beyond
  confirming they are consistently recorded across GitHub and Notion — verifying the approval
  itself happened is outside a source-only audit's remit.
