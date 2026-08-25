# Document 0 — Critical Review (v1.2)

**Supersedes:** `00-CRITICAL-REVIEW-v1.1.md`. v1.0 and v1.1 remain available for comparison.
**Release vocabulary:** V0 / V1A / V1B / V1.5 are retired. Use **Product V1 → V2 → V3 → V4** with internal milestones M0–M4.

---

## 0.0 Verdict on the scope cut

**This is the right decision, and it is the first revision in this project that made the product smaller.** Both prior revisions added rigour; this one removes ambition. That is harder and more valuable.

The insight behind it is correct: *thesis management and monitoring are different products with different daily rhythms.* Monitoring is a three-minute habit performed every day. Thesis work is a forty-minute session performed a few times a quarter. Shipping them together meant the daily habit could not form until the quarterly workflow was built, which is backwards.

**But the cut creates three new risks that did not exist in v1.1, and one of them is serious.** They are §0.2, §0.3 and §0.4. Read those before the scope table.

---

## 0.1 Revised scope

| Feature | v1.1 tier | **v1.2 product** |
|---|---|---|
| Accounts, multi-account position grain | V0 | **V1 (M1)** |
| USD ledger, transactions, cost basis, cash | V0 | **V1 (M1)** |
| EOD prices, snapshots, reconciliation | V0 | **V1 (M1)** |
| Backup, restore, export, provenance, staleness | V0 | **V1 (M1)** |
| Lightweight watchlist | V0 (heavyweight) | **V1 (M2)** — requirements stripped |
| Dashboard, allocation, concentration | V0 | **V1 (M2)** |
| Approximate SGD display | V0 (full FX) | **V1 (M2)** — convenience only |
| Material moves | V1A | **V1 (M2/M3)** — thesis links removed |
| SEC filings *as documents* | V1A | **V1 (M3)** |
| News, entity linking, deterministic dedup, event inbox | V1A | **V1 (M3)** |
| AI triage, attributed summaries, guardrail, claim provenance | V1B | **V1 (M4)** |
| **SEC XBRL as a financial database** | V0 | **V2** |
| Fundamental facts, source policy, derived metrics | V0 | **V2** |
| Gate 0, theses, assumptions, reviews | V0 | **V2** |
| Event → assumption routing, thesis verdicts | V1A/V1B | **V2** |
| Decision journal, prediction-first gating, post-mortems | V0/V1B | **V2** |
| ETF look-through | V0 | **V2** |
| Valuation workbench, scenarios, IRR, hurdle | V1.5 | **V3** |
| Predictions, calibration, AI-vs-user | V1.5 | **V4** |
| Semantic dedup, embeddings | V1.5 | **V4** |
| Historical FX, execution FX, multi-currency accounting | V0 | **Deferred indefinitely** |

**Estimated time to a usable portfolio tracker: ~6 weeks. Complete V1: ~18–19 weeks.** Compare v1.1: ~10 and ~21 weeks, for a larger and slower-to-trust product.

---

## 0.2 The serious new risk: V1 is now shaped like the thing you were guarding against

This is the most important paragraph in this document.

V1 is: **portfolio value + daily price movement + news feed.** That is, structurally, the exact shape of the tools that produce FOMO, momentum-chasing and overtrading. In v1.0 and v1.1 the counterweight was the thesis layer — the discipline machinery that made price movement subordinate to a written argument. **That counterweight has been removed from the first product while the stimulus remains.**

I am not arguing against the cut. I am arguing that the behavioural protections in v1.1 were partly load-bearing on the thesis system, and the ones that are not now have to do all the work alone. They must therefore be hard requirements, not preferences:

1. **No real-time prices.** EOD only. The single largest protection, and it costs nothing to keep.
2. **No screen sorted by price movement.** Enforced at the API layer — no endpoint accepts `sort=pct_change` — because the easiest route to the forbidden interface is building the endpoint that enables it.
3. **No gainers/losers panel, no "% below 52-week high", no streaks, no engagement nudges.**
4. **Attention queue hard-capped, empty state designed.** If the queue is never empty you stop reading it; if it is never empty *and* full of price moves, you have built a trading app.
5. **Material moves report catalyst status, never causality, never an action.**
6. **Default position sort is portfolio weight, not daily move.** With no thesis status available, weight is the correct neutral default — it answers "what matters to me" rather than "what is exciting today".

**Monitored failure signal, checked at 8 weeks of real use:** if your trading frequency has increased since launch, V1 has failed at its actual purpose regardless of how accurate the ledger is. **Write down your trailing-12-month trade count before M1 ships**, so the comparison is possible.

---

## 0.3 The differentiation risk: without thesis, filtering quality *is* the product

In v1.1, V1 could be mediocre at news filtering and still be valuable, because the thesis system carried independent value. In v1.2 that fallback is gone. Stripped down, V1 is:

- a portfolio tracker (several free tools do this adequately), plus
- a news feed for your holdings (several free tools do this adequately)

**The only thing that makes V1 worth building is that the filtering is genuinely better than a ticker-tagged feed.** If M3 and M4 ship and you still open a news app to check whether you missed something, V1 has no reason to exist.

Three concrete implications:

**(a) The filtered tray is the quality instrument, not a nice-to-have.** Auditing it daily for the first two weeks is how you find out whether filtering works. The ≥80% agreement threshold is a shipping gate.

**(b) Filtering in V1 is asset-level, not thesis-level, and will be less precise than v1.1 implied.** Without assumptions the system cannot know you care about gross margin and not about a product launch. It can only know *this document is about NVDA and is materially unusual.* Expect a higher false-positive rate than a thesis-aware system, and set the materiality bar slightly higher to compensate.

**(c) A cheap, optional relevance signal is worth having.** Optional free-form **tags** on holdings and watchlist items (`semis`, `pricing-power`, `regulatory-risk`) can be passed to the triage prompt as soft context. This is **not** a thesis and must not become one — no mandatory reason, no falsifier, no review date. It costs one array column and may materially improve precision. Leave it empty and nothing breaks.

---

## 0.4 The cost of deferring the decision journal, and a free mitigation

v1.1 argued the journal should come first because its value compounds — every month without it is history you cannot reconstruct. That argument was correct and remains correct. Deferring to V2 means the gap is however long V1 lasts.

**I accept the deferral** — the journal only earns its friction inside a discipline product, and V1 is not one. But there is a mitigation that costs nothing:

**Keep a free-text `note` on every transaction.** One optional field, no validation, no requirement, no warning when empty. When you buy something and happen to have a sentence about why, it lands somewhere durable and dated. When V2 builds real decision records, those notes are raw material for backfill — and even if they are not, you will be glad in three years that "sold half, position got too big" exists somewhere.

**What this is not:** a decision record. No rationale requirement, no falsifier, no hurdle, no review date, and — critically — **transactions are never flagged, warned or treated as incomplete for having an empty note.** v1.1 flagged transactions lacking a linked decision. That flag is removed entirely.

---

## 0.5 The ledger simplification: recommendation and reasoning

**You asked for this decision to be explicit. Recommendation: simplify. Drop `transaction_groups` + `transaction_legs`; use a single `transactions` table with a nullable `link_id`.**

**Why the group/leg model existed.** Its load-bearing justification was the balance invariant — `Σ(principal legs × price × fx) − external_flow = 0` — which made a malformed *multi-currency* event impossible to persist. A USD→SGD conversion has two cash legs in two currencies that must reconcile, and one row cannot express that.

**Why it no longer earns its complexity.** With USD-only accounting, cash effect is derivable *from the row itself*: a buy of 50 shares at $200 with a $2 fee has exactly one possible cash effect. The invariant collapses into an arithmetic check on a single row. The two-table structure, parent/child integrity rules, trigger set and multi-leg entry form would all remain while the problem they solved has been deleted.

**What still needs more than one row, and how the simpler model handles it:**

| Event | Handling |
|---|---|
| Buy, sell, fee, interest, deposit, withdrawal | **One row.** `cash_effect_usd` derived and validated |
| Dividend with withholding | **One row** carrying `gross_amount_usd`, `tax_usd` and net `cash_effect_usd`. v1.1 used two legs; one row with two amount columns is clearer and cannot desynchronise |
| Split | **One row**, quantity delta, zero cash effect, cost basis invariant |
| **Inter-account transfer** | **Two rows** sharing a `link_id`: `TRANSFER_OUT` and `TRANSFER_IN`. Cost basis carries; no realised P&L |
| **Spin-off** | **Two rows** sharing a `link_id`: cost-basis reduction on the parent, position creation in the child |
| Correction | Reversal of all rows sharing the `link_id`, with a required reason |

Two genuine multi-row cases, both handled by a nullable grouping column rather than a mandatory parent table.

**Net change:** two tables → one table plus one nullable column and one nullable enum. Fewer joins on every ledger query, a simpler entry form, materially less code to get right.

**Explicitly preserved:** append-only storage, correction by reversal rather than edit, per-account cost basis, transfer and split invariants, the audit log, multi-row auditability.

**Explicitly not adopted:** double-entry accounting. No chart of accounts, no debits and credits, no trial balance.

**Migration path if multi-currency ever arrives.** Add `currency` and `fx_rate_to_usd` to `transactions`, backfill as `'USD'` and `1.0`, then either extend the single-row model or promote `link_id` into a real group table at that point. Because every existing row is unambiguously USD, the backfill is lossless and mechanical. **This is a genuinely reversible simplification, which is what makes it safe.**

---

## 0.6 Cash: derived, not modelled as an asset

v1.1 modelled cash as an asset (`CASH.USD`) so account cash fell out of the `(account_id, asset_id)` grain. With USD-only accounting and a single-row transaction model, **deriving cash as `SUM(cash_effect_usd)` per account is simpler**: no phantom asset rows, no `price = 1.0` special case, no exclusion filters in every sector and asset-class allocation query, and no possibility of a cash asset drifting from the cash effects that imply it.

Cost: one small `account_cash_daily` snapshot table so historical portfolio value includes cash. A fair trade for removing a special case from every allocation query in the system.

---

## 0.7 Two limitations that must be visible in the UI, not just in a document

Both are consequences of correct deferrals, and both are dangerous if silent.

**(a) Concentration warnings will understate true concentration.** ETF look-through moves to V2. If you hold QQQ alongside NVDA and MSFT directly, V1 reports your NVDA weight as the direct holding only — wrong in the direction that matters. A concentration warning that quietly understates risk is worse than none, because you will trust it.

**Requirement:** whenever the portfolio contains any ETF, the concentration panel displays a persistent note — *"Excludes exposure held inside ETFs. True concentration in individual names may be higher."* Not a footnote, not a tooltip. Visible on the panel.

**(b) Sector allocation depends on vendor metadata of unknown quality.** With XBRL deferred, sector and industry come from the market-data vendor's profile endpoint. Vendor sector classification is coarse, occasionally wrong, and inconsistent for conglomerates and recent reclassifications.

**Requirement:** sector allocation carries source and as-of date like any other figure, and sector is user-overridable per asset. If M0 finds vendor sector data unreliable across your actual holdings, **cut sector allocation from V1 entirely** rather than ship a chart you cannot trust. The PRD marks it conditional for this reason.

---

## 0.8 A gap in the proposed M0

Your M0 validates prices, symbol mapping, reliability, rate limits and licensing for the market-data vendor. It does not mention **splits and dividends**.

Silent corporate-action failure is the classic way a personal ledger corrupts itself: a 4-for-1 split arrives, the price series adjusts, your quantity does not, and your position value is wrong by 4× until you notice. Because V1 has no fundamentals layer to cross-check against, the vendor's corporate-action feed is your *only* source.

**Added to M0:** validate the vendor's split and dividend endpoints — coverage, timeliness relative to ex-date, historical depth, and whether adjusted and unadjusted price series are both available. If the feed is unreliable, V1 needs a manual corporate-action entry path plus a "price series adjusted but quantity unchanged" detection rule that raises a data-quality flag.

---

## 0.9 Confirming there are no hidden dependencies

Checked explicitly:

- **Portfolio functions with SGD conversion unavailable** — yes. SGD is computed at render time from a cached spot rate, never persisted, never an input to any ledger figure. Unavailable → header shows USD plus "SGD conversion unavailable". No job failure, no flag escalation, no blocked page.
- **News summaries viewable without any rationale** — yes. `GatedAIPanel` is removed from V1 entirely, along with the API-layer 403 that backed it.
- **Material moves work without a thesis** — yes. `material_moves.assumption_ids` is deleted. The catalyst join is move → event only.
- **SEC filing ingestion works without XBRL analytics** — yes, and this is the distinction to hold onto: **filings-as-documents** (submissions API, accession numbers, 8-K item codes, document text) is a completely separate integration from **XBRL-as-financial-database** (companyfacts, us-gaap tags, restatement chains). V1 builds the first. V2 builds the second. They share only the CIK.
- **V2 tables attach without rewriting V1** — yes, provided the discipline in §0.10 holds.
- **No thesis, assumption, decision, valuation, calibration or fundamentals table appears in a V1 migration.** Confirmed in TDD v1.2 §1.

---

## 0.10 Attachment-point discipline

*"Design the attachment points now. Build the future features later."* Concretely, five rules, all cheap:

1. **Stable surrogate keys everywhere.** `assets.id`, `accounts.id`, `transactions.id`, `documents.id`, `events.id`, `sources.id` are `BIGSERIAL`, never reused, never recycled, never derived from natural keys that can change. A ticker change must not orphan a future thesis.
2. **Archive, never delete.** Watchlist items, assets and accounts are soft-archived. A V2 thesis pointing at an asset you stopped following must still resolve.
3. **Retain `documents.body_text`.** V1 needs it for claim-excerpt validation; V2 needs it for assumption routing. Discarding it after summarisation would be irreversible.
4. **Keep `assets.native_currency`** even though V1 assumes USD. One column now prevents a painful backfill later.
5. **Do not create empty V2 tables.** No `theses`, no `fundamental_facts`, no `decisions` stubs. An unused table is a maintenance burden, a migration hazard and an invitation to half-build the feature. The attachment points are the *IDs*, not the tables.

---

## 0.11 What carries forward unchanged from v1.1

- **Multi-account position grain `(account_id, asset_id)`**, snapshots at `(snapshot_date, account_id, asset_id)`. Portfolio totals are an aggregation, never the storage grain. Account-level reconciliation depends on this.
- **Append-only ledger with correction by reversal.**
- **Deterministic dedup only** — natural keys (SEC accession; `{asset}|{event_type}|{period}`) plus near-duplicate suppression. Zero cross-period merges is a correctness assertion, not a tunable threshold.
- **Rule-first entity linking** over a bounded universe; model assistance only for ambiguity.
- **Coverage disclosure** — "nothing to report" must be visually distinct from "ingestion failed".
- **Filtered tray always inspectable.**
- **Material moves never assert causality.**
- **Unsourced numeric-output guardrail**, guarantee stated narrowly: unsupported raw numeric figures do not reach the user. It does not make prose correct.
- **Claim-level provenance** with verbatim-excerpt substring validation — deterministic, model-free, and a fabricated citation cannot survive it.
- **`model_id` + `prompt_version` + `input_hash`** on every AI run; caching; hard spend cap with an ordered degradation ladder.
- **Managed hosting, managed Postgres, modular monolith (web + worker), database-backed jobs, provider adapters, portability.**
- **Provenance on every figure, visible staleness, data-health screen, backup with tested restore, export.**

---

## 0.12 Assumptions for v1.2

1. Your active holdings are USD-denominated or USD-quoted. **If you hold a meaningful SGX or HKEX position today, say so now** — it invalidates the USD-only simplification, and the ledger would need currency columns from day one rather than as a later backfill.
2. Implementation is primarily AI-assisted; managed hosting; you do not want to run servers.
3. Single user, 2–6 accounts, 10–40 positions, 20–100 watchlist names.
4. Budget ~USD 75–175/month — lower than v1.1, since there is no fundamentals feed in V1.
5. Morning check target 3–5 minutes. With the thesis layer gone this should now be comfortably achievable, so the target tightens rather than relaxes.
6. TypeScript / Next.js / Postgres / managed hosting retained. Not reopened.
7. **V2 will actually happen.** If that assumption is false, this is a portfolio tracker with a good news filter — still worth building, but be honest with yourself about which product you are committing to.
