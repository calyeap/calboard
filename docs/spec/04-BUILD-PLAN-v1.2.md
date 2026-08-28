# Document 4 — Build Plan (v1.2)

**Supersedes:** `04-BUILD-PLAN-v1.1.md`.
**Principle:** *V1 is Portfolio + News Intelligence. Nothing in it may depend on thesis, fundamentals, valuation or multi-currency accounting.*

**Effort assumption:** solo work with heavy AI assistance, ~10–15 focused hours/week. Full-time, divide by roughly two and a half. Inconsistent weeks, add 50%.

---

## Timeline at a glance

| Milestone | Ships | Duration | Cumulative |
|---|---|---|---|
| **M0** | De-risking decisions | 1.5–2 wk | ~2 wk |
| **M1** | **Usable portfolio tracker** | 3.5–4.5 wk | **~6 wk** |
| **M2** | **Monitoring product** | 2.5–3.5 wk | **~9 wk** |
| **M3** | News, filings, events, catalysts | 4.5–5.5 wk | ~14 wk |
| **M4** | AI news intelligence — **V1 complete** | 3.5–4.5 wk | **~18–19 wk** |

**Compared with v1.1:** usable product at ~6 weeks instead of ~10; complete V1 at ~18–19 weeks instead of ~21 for a much larger product. The saving comes from removing the fundamentals subsystem, the historical FX subsystem, and the thesis and decision subsystems — not from working faster.

---

## M0 — V1 de-risking
**1.5–2 weeks · blocks everything · produces no product code**

Shorter than v1.1's M0 because the fundamentals-quality spike — its largest component — moves to the V2 de-risking stage.

### Hosting
Validate managed hosting, a background worker service, managed PostgreSQL, **Singapore region for the database specifically, not just compute**, deploy, **one live rollback**, backup retention and PITR window on the intended tier, and current pricing. Deploy a hello-world web + worker + Postgres and roll it back once.

### Market-data vendor
Validate: US EOD prices · historical price depth · **splits and dividends — coverage, timeliness relative to ex-date, historical depth, and whether adjusted and unadjusted series are both available** · crypto quoted in USD · ETF prices · asset profile metadata including sector · symbol mapping · API reliability · rate limits · **private-use licensing** · cost.

**The corporate-action check is a hard gate.** With no fundamentals layer to cross-check against, the vendor's split feed is V1's only defence against silent ledger corruption. If it is unreliable, M1 must include a manual corporate-action path and the split-guard detection rule becomes mandatory rather than a safety net.

**Also decide here:** whether vendor sector metadata is reliable across your actual holdings. If it is not, **cut sector allocation from V1** (PRD A5) rather than ship a chart you cannot trust.

### SGD convenience conversion
Validate **only**: latest USD/SGD rate availability · source reliability · timestamp presence · licensing.

**Do not evaluate historical FX depth.** It is explicitly not a V1 requirement. Prefer the market-data vendor's FX endpoint — zero additional integrations. Google Finance may remain a manual comparison reference; it is not the backend source.

### News
Validate: holdings and watchlist coverage · ticker tagging precision, measured as a number on a hand-labelled week · timestamps · source metadata · **article text availability** (critical — no body text means no sourced claims) · usage and licensing · rate limits.

### SEC documents
Validate: CIK mapping for your universe · filing discovery via the submissions API · accession handling · document retrieval · rate limits.

**Explicitly not validated in M0:** XBRL companyfacts, us-gaap tags, or any financial-statement endpoint. That is V2.

### AI
Estimate triage cost per document, summary cost per event, and expected monthly spend at your real volume.

### Acceptance
- Hosting verified end to end including one rollback, with a monthly figure.
- Vendor selected, with **corporate-action reliability stated explicitly** and a go/no-go on sector metadata.
- SGD rate source selected — the smallest decision in M0, deliberately.
- News ticker-tagging precision stated as a number.
- SEC filing discovery working for your universe in a throwaway script.
- A monthly cost you would pay for three years.

**No fundamentals data-quality spike. That work moves to V2 de-risking (§ below) and remains important — it simply must not delay V1.**

---

## M1 — Portfolio Core
**3.5–4.5 weeks · depends on M0**

> **M1 completion boundary — updated 2026-08-28 (snapshot/mirror UX).** V1's user-facing model is
> now snapshot/mirror (see the supersession note at the top of `docs/spec/01-PRD-v1.2.md` and the
> one in `docs/spec/03-TDD-v1.2.md`). The **current M1 Portfolio Core completion gate** is the
> implemented snapshot-focused vertical slice defined by
> `docs/superpowers/plans/2026-08-25-m1-portfolio-vertical-slice.md` and
> `docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` (Revision 3, final) — those two
> documents control M1 completion where this section's older wording conflicts.
>
> **In the current gate:** the full canonical `001_portfolio_core` schema and the ledger
> primitives (append-only `transactions`, `ADJUSTMENT`, derived positions at `(account_id,
> asset_id)`, the split-corruption guard, `audit_log`); a single hidden account; the snapshot
> setup wizard → Review → Save → populated Dashboard loop; the `/holdings` editor (add / remove /
> update holdings, atomic save); Dashboard portfolio value, current / stale / unavailable price
> handling with **manual** Retry, market value, aggregate and per-holding unrealised P&L, holdings
> freshness, missing-price exclusion disclosure, priced allocation with text legend; and the
> Tasks 28–32 responsive / accessibility UI pass.
>
> **Deferred, not removed — tracked under `## M1H — Portfolio Hardening` below:** passkey auth,
> managed deploy pipeline, reversal flow, inter-account transfer, account reconciliation against
> broker statements, `positions_daily` / `account_cash_daily` snapshot jobs, corporate actions
> *applied* to the ledger, `ProvenanceChip` / broader per-figure provenance, the data-health
> screen, export / re-import, and independent encrypted backup + verified restore. The
> Components / Tests / Acceptance lists below are retained unchanged as the original M1 design;
> the items among them that are not in the current gate belong to M1H.
>
> This boundary authorises completing the local snapshot-focused M1 and later Git integration. It
> does **not** authorise public deployment. Authentication, automated backup + verified restore,
> and appropriate security controls remain **required** (AC-SEC1; see M1H) before Calboard is
> exposed online with personal financial data.

**Goal: a usable portfolio tracker.** At the end of M1 you should stop using the spreadsheet.

**Components:** project skeleton (web + worker) · managed deploy pipeline · passkey auth · Postgres + migration `001_portfolio_core` · **`sources` created before `assets`** (FK on `sector_source_id`) · `assets` (+ identifiers, aliases, class attributes) · `accounts` · **single-table `transactions` with `link_id`** · append-only triggers · reversal flow · cash-effect computation and validation · position derivation at **`(account_id, asset_id)`** · `account_cash` · `positions_daily` and `account_cash_daily` at the account grain · `positions_aggregate` view · `prices_daily` · `corporate_actions` + splits applied to the ledger · **split-corruption guard** · account reconciliation · `job_runs` · `data_quality_flags` · `audit_log` · provider adapter interface + first adapter · `ProvenanceChip` · transaction and transfer forms · data-health screen · export · **independent encrypted backup and verified restore**

**Tests before proceeding:**
- **Golden-file fixture written first**, covering split, partial sale, dividend with withholding, same asset in two accounts, inter-account transfer, deposit, fee — passing per account and in aggregate
- All property tests: cash identity, per-account sum invariance, split invariance, transfer invariance, reversal invariance, linked-reversal atomicity, append-only enforcement
- Kill `prices_eod` → stale banner, no fabricated day-change
- A price series adjusting with no recorded corporate action raises `possible_unrecorded_split`
- A transaction with an empty note is accepted with **no flag, no warning, no visual difference** (AC-L8)
- **Average-cost only:** a fixture whose FIFO and average-cost answers differ realises P&L against the blended average. No `lots` table, no lot identifier, no lot-selection parameter exists
- **`001` applies to an empty database on its own**, with no reference to watchlist, material moves, documents, events or AI objects
- **Backup taken, restore executed into a clean database, verified**
- Export → re-import into an empty instance → identical accounts, transactions, positions
- **Absence test:** no migration creates a thesis, decision, fundamentals, valuation or FX-fixings table

**Acceptance:** AC-L1 through AC-L9, AC-MD1, AC-MD2, AC-SEC1. Portfolio value reconciles to real broker statements **per account** for a full month.

**Start using it daily.** M2 and M3 are materially better designed if you have lived with M1 first.

---

## M1H — Portfolio Hardening
**Deferred from M1 · no fixed duration · security items required before public online exposure**

Established 2026-08-28 when the M1 completion gate narrowed to the snapshot-focused vertical slice
(see the "M1 completion boundary" note under `## M1 — Portfolio Core`). These are the broader
original M1 Portfolio Core requirements — **preserved and deferred, not deleted.** Nothing here is
authorised for implementation by the current M1 gate; each item keeps its original specification
and acceptance criteria (this section adds no new requirement).

**Security / operational — required before Calboard is served online with real financial data:**
- Passkey / WebAuthn authentication — **AC-SEC1** ("not publicly reachable without authentication").
- Managed deploy pipeline · Singapore-region managed Postgres · one live rollback (M0 hosting outputs feed this).
- **Independent encrypted backup and a verified restore** — **AC-SEC1**; Definition-of-done M1 #5.

**Ledger breadth — deferred from the original M1 requirements:**
- Reversal flow — **AC-L4**; property tests (reversal invariance, linked-reversal atomicity).
- Inter-account transfer behaviour — **AC-L1**, **AC-L6** (transfer conserves cost basis, no realised P&L); Definition-of-done M1 #2.
- Multi-account portfolio value reconciling to broker statements **per account** for a full month — **AC-L2**; Definition-of-done M1 #1.
- Account reconciliation wired to a UI (`lib/accountReconciliation.ts` exists, currently unused).
- `positions_daily` / `account_cash_daily` snapshot jobs; per-account cash matching its daily snapshot — **AC-L7**; Definition-of-done M1 #3.
- Corporate actions **applied** to the ledger (the split-corruption **guard** ships in current M1; applying a confirmed split/dividend to positions is deferred).

**Data quality / provenance / data management:**
- `ProvenanceChip` and broader "every figure exposes provenance and as-of" — Definition-of-done M1 #4 (current M1 surfaces price date, price-row `source_id`, and "Holdings last updated").
- Data-health screen (`job_runs` / `data_quality_flags` exist; no screen yet).
- Export → re-import into an empty instance reproducing identical data — **AC-L9**; Definition-of-done M1 #5.
- Golden-file ledger fixtures for split / partial sale / dividend-with-withholding / same asset in two accounts / inter-account transfer, passing per account and in aggregate — **AC-L1**.

**AC-MD1** (a killed price *job* producing a stale dashboard with no fabricated day-change) is
partially satisfied by current M1: staleness handling and the no-fabricated-day-change rule are
implemented; there is no scheduled price job to kill because V1 fetches EOD prices on demand.
M2 / M3 / M4 scope is unchanged.

---

## M2 — Watchlist + Monitoring UI
**2.5–3.5 weeks · depends on M1**

**Goal: competitive with the basic portfolio-monitoring experience you currently assemble from separate tools.**

**Components:** migration `002_monitoring` · lightweight `watchlist_items` (ticker only; note and tags optional; `materiality_threshold` defaults to `'important'`) · dashboard Zones 1 and 3 · account selector · position detail with price history · allocation by account, class and (conditionally) sector · basic concentration alerts with the **mandatory ETF look-through limitation notice** · **`fx_spot_latest` + `fx_spot_refresh` job + `ValueHeader` with approximate SGD** · **`material_moves` detection** — created **without `linked_event_id`**, `catalyst_status` defaulting to `'pending'` until M3 · attention queue skeleton · responsive mobile read experience

**Tests:**
- **AC-SGD1:** disable the FX source → dashboard renders complete, correct USD figures with "SGD conversion unavailable"; **no job fails, no flag is raised, no endpoint returns non-200**
- **AC-SGD2:** schema grep confirms no column anywhere stores an SGD monetary value
- **AC-SGD3:** SGD is visually secondary and labelled approximate; rate, source and timestamp reachable in one interaction
- **AC-U1:** default position sort is portfolio weight; **no endpoint accepts a percentage-change sort parameter**
- **AC-U2:** attention queue respects its cap; the empty state renders as designed
- **AC-U3:** with an ETF held, the concentration panel shows the limitation notice
- **AC-U4:** adding a watchlist item requires only a ticker; omitting note and tags produces no warning
- **AC-MM3:** material moves function with no thesis or assumption table present
- Failed `prices_eod` → zero material moves recorded
- **AC-U5:** morning check on a normal day, timed on real data, under 5 minutes
- **`002` applies on top of `001` alone.** `material_moves` has no `linked_event_id` column at this point, and inserts succeed using the `'pending'` default
- Every table with both a `DEFAULT` and a `CHECK` accepts a defaults-only insert

**Acceptance:** you check this on your phone in the morning instead of Yahoo Finance.

---

## M3 — News / Filings / Events
**4.5–5.5 weeks · depends on M1, M2**

**Goal: the right documents reach you, deduplicated deterministically and linked to the right assets — with no model deciding significance yet.**

**Components:** migration `003_documents_events` · `documents` (with `body_text` retained, `external_id NOT NULL`) · `events` (**`event_key NOT NULL UNIQUE`**, four-tier deterministic derivation) · `event_documents` · `event_asset_links` · `document_filters` created **without `ai_run_id`** · **`ALTER material_moves ADD linked_event_id`** · **SEC filing ingestion by CIK** (submissions API, accession keys, 8-K item typing, document retrieval) · issuer RSS where practical · commercial news adapter · alias dictionary · **rule-based entity linking** · **natural-key dedup** · **near-duplicate suppression** (canonical URL, title hash, SimHash) · manual "same event" action · event inbox · **filtered tray** · coverage disclosure · ingestion health · **material-move catalyst join** (`pending` → `known`/`possible`/`none_found`)

**Explicitly NOT in M3:** embeddings, semantic clustering, LLM adjudication, dedup evaluation sets, XBRL, thesis routing.

**Tests:**
- **AC-N1:** zero orphan documents across a full week of live data
- **AC-N2:** entity-linking precision ≥0.95, recall ≥0.85 on ≥200 hand-labelled documents
- **AC-N3:** zero events merged across periods — a correctness assertion, not a threshold
- **AC-N4:** a wire story under ≥3 mastheads produces one event
- **AC-N5:** coverage disclosure present; "nothing to report" and "ingestion failed" visually distinct
- **AC-N6:** filing ingestion works with **no XBRL integration present** — asserted by the absence of any companyfacts call
- **AC-MM1:** −7% move with a same-day 8-K → known related event, linked
- **AC-MM2:** −3% move, no company event, comparable benchmark move → "no identified company-specific catalyst" with benchmark context, and **no rendered string asserts causation**
- **`event_key` is never null**; re-ingestion is idempotent; Q2 and Q3 earnings for one asset yield different keys; same-titled articles on different dates yield different keys
- **`003` applies on top of `001`+`002` alone.** Deterministic filtering is fully functional with **no `ai_runs` table present** and `document_filters` has no `ai_run_id` column

**Acceptance:** for a full week, review the filtered tray daily and note your agreement rate. This is the beginning of AC-F1; the threshold is enforced at the end of M4, once AI triage is in the loop.

---

## M4 — AI News Intelligence
**3.5–4.5 weeks · depends on M3**

**Goal: AI that filters and summarises with cited claims, cannot emit an unsourced figure, and makes no investment judgement.**

**Components:** AI task registry (task · prompt version · model · schemas · validator) · numeric context bundle builder with **field allow-list** · **unsourced numeric-output guardrail** · **claim provenance with substring validation** · migration `004_ai` · `ai_runs` · `ai_claims` · **`ALTER document_filters ADD ai_run_id`** · caching on `input_hash` · batched triage · **monitoring-oriented significance rubric** (important / notable / routine / duplicate / unrelated, defaulting to routine) · filing and news summarisation · ambiguous entity disambiguation · `AIBlock`, `ClaimList`, `RefusalCard` · cost cap and degradation ladder · **concise daily brief**

**Tests:**
- **AC-AI1:** ≥200 adversarial prompts → **zero unsourced numerals reach the UI**
- **AC-AI2:** every `ai_runs` row has non-null `model_id` and `prompt_version`
- **AC-AI3:** injected fabricated, paraphrased and truncated excerpts rejected **100%** of the time; headline-only documents produce no sourced claims
- **AC-AI4:** inference claims render distinctly from sourced claims
- **AC-AI5:** **a summary is viewable with no rationale, no decision and no gate of any kind** — asserted at the API layer
- **AC-AI6:** cost cap triggers the degradation ladder in order, with a visible notice; **triage degrades last**
- **AC-AI7:** cache hit on a repeated document produces zero incremental cost
- **AC-AI8:** triage precision on a ≥200-document labelled set meets the agreed threshold
- **Absence test:** no prompt template contains the strings "thesis", "assumption" or "fundamental impact"
- **AI never mutates `event_type` or `event_key`** — only `significance`. A proposed type correction surfaces as a reviewable flag
- **`004` applies on top of `001`+`002`+`003`.** Filter rows written during M3 correctly retain `ai_run_id IS NULL`

**Acceptance — the product-defining gate:**
- **AC-F1:** over a full week of live use, auditing the filtered tray daily, **you agree with ≥80% of filter decisions.** If not, tune before declaring V1 complete.
- Attention queue averages ≤5 items and is frequently empty.
- Two weeks of daily use without needing another tool to check whether you missed something.

> **At the end of M4, V1 is complete.**

---

## Future product versions *(design only — do not build during V1)*

### V2 — Thesis + Fundamental Intelligence
*Does what happened actually matter to why I own this?*

Structured fundamentals · SEC XBRL financial facts · metric provenance · field-level source policies · derived metrics · business-quality and survivability analysis · Gate 0 / knowability · formal theses with versions · falsifiable assumptions with review dates · **event → assumption routing** · **user thesis-impact verdict (supports / neutral / questions / breaks)** · thesis-change history · investment decision journal with pre-decision rationale · post-mortems · portfolio-fit analysis · simple sourced valuation context · ETF look-through.

AI may suggest which assumptions an event could affect. **The user retains the final thesis-impact judgement.**

**V2 de-risking stage — the fundamentals-quality work removed from V1.** Before implementing structured financial analysis, do the spike properly: SEC XBRL tag mapping · diluted shares · debt · cash · net debt · lease treatment · SBC treatment · TTM revenue · EBIT · FCF · restatement handling · ADR treatment · vendor-versus-filing comparison on ten hand-checked names · and the resulting field-level authoritative-source policy. **This remains important; it simply must not delay V1.**

### V3 — Valuation + Risk/Reward Intelligence
*Is this attractive at today's price?*

Valuation-input confirmation · market-implied expectations · reverse DCF · historical valuation context · peer context where defensible · bear/base/bull scenarios · forward IRRs · hurdle-rate comparison · margin of safety · risk/reward analysis · advanced portfolio fit · advanced decision support.

**User-invoked per asset. No fake precision.**

### V4 — Learning + Advanced Automation
Structured predictions · calibration · AI-vs-user evaluation · **semantic event clustering if proven useful** · broker synchronisation · opportunity scanning · automated earnings analysis · advanced alerts · additional exchanges · additional asset classes · curated additional sources.

---

## Critical path and risk

**Critical path:** M0 → M1 → M2 → M3 → M4. Strictly sequential; nothing parallelises usefully for a solo builder.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Filtering quality is mediocre** | Medium | **Severe** | Without a thesis layer, filtering quality *is* the product. AC-F1 is a shipping gate; the filtered tray is audited daily |
| Corporate-action feed unreliable | Medium | **Severe** | M0 hard gate; split-corruption guard; manual entry path |
| News body text unavailable (paywalls) | **High** | Medium | Headline-only documents produce no sourced claims by design; measured in M0 |
| Entity linking noisy | High | Medium | Rule-first over a bounded universe; measured in M0, gated in M3 |
| **V1 becomes a checking habit** | **Medium** | **Severe** | No real-time prices, no move sorting, capped queue, weight-default sort. **Record your trailing-12-month trade count before M1 ships** |
| Vendor sector metadata unreliable | Medium | Low | M0 go/no-go; cut sector allocation rather than ship an untrustworthy chart |
| Scope creep back toward thesis/valuation | **Medium** | High | Absence tests in CI: no thesis table, no XBRL call, no thesis vocabulary in prompts |
| AI cost overrun | Low | Low | Caching, batching, cheap triage tier, hard cap, ladder |
| Vendor API or pricing change | Medium | Medium | Adapter interface; SEC EDGAR free fallback |

---

## Definition of done

### M1 (~week 6)

> **Scope note (2026-08-28):** the current M1 completion gate is the snapshot-focused vertical
> slice (see the "M1 completion boundary" note under `## M1 — Portfolio Core`). Of the items
> below, **#6 and #6a are in the current gate** and both hold today (no thesis / decision /
> fundamentals / valuation / FX-fixings table; average-cost only, no lot-level state anywhere).
> **#1–#5 are deferred to `## M1H — Portfolio Hardening`** — multi-account per-account
> reconciliation, transfers / reversals, per-account daily-snapshot cash, `ProvenanceChip` /
> full per-figure provenance, and backup restore + export. They remain required for their
> milestone; they are not deleted.

1. Multi-account portfolio value in USD reconciles to broker statements **per account** for a full month. *(M1H)*
2. Splits, transfers and reversals leave the ledger correct; property tests pass. *(splits: current M1 · transfers/reversals: M1H)*
3. Cash per account is correct and matches its daily snapshot. *(M1H — no user-facing cash in the snapshot model)*
4. Every figure exposes provenance and as-of. *(price date + source + "Holdings last updated" in current M1 · `ProvenanceChip` / full coverage: M1H)*
5. Backup restore verified. Export verified. *(M1H)*
6. **No thesis, decision, fundamentals, valuation or FX-fixings table exists.**
6a. Cost basis is average-cost only; no lot-level state exists anywhere.

### M2 (~week 9)
7. Dashboard renders three zones with weight-default position sorting.
8. **Portfolio functions completely with SGD conversion unavailable.**
9. No SGD value is persisted anywhere.
10. Material moves detect correctly and are suppressed on stale prices.
11. Concentration panel discloses the ETF look-through limitation.
12. Morning check completes in under 5 minutes.

### M3 (~week 14)
13. Zero orphan documents across a week.
14. Zero cross-period event merges.
15. Filing ingestion works with no XBRL integration present.
16. Catalyst status reported without asserting causality.
17. "Nothing to report" and "ingestion failed" are visually distinct.

### M4 (~week 18–19) — **V1 complete**
18. Zero unsourced numerals reached the UI.
19. Every sourced claim carries a verbatim excerpt verified as a literal substring.
20. Summaries viewable with no gate of any kind.
21. Attention queue averages ≤5 items and is frequently empty.
22. **≥80% agreement with filter decisions over a full audited week.**

### And the standing check across all milestones
23. **Trading frequency has not increased since launch.** If it has, V1 has failed at its actual purpose regardless of how accurate the ledger is.
