# Document 1 — Product Requirements Document (v1.2)

**Supersedes:** `01-PRD-v1.1.md`.
**Prerequisite:** `00-CRITICAL-REVIEW-v1.2.md`.
**Product:** V1 — Portfolio + News Intelligence.
**Milestones:** M0 de-risking · M1 Portfolio Core · M2 Monitoring UI · M3 News/Events · M4 AI News Intelligence.

Every requirement below is **V1** unless explicitly marked V2/V3/V4. There are no sub-tiers.

> **Supersession note (2026-08-27) — snapshot/mirror UX.** V1's user-facing model is now snapshot/mirror: the user records the **current** quantity and average cost of each holding and updates those figures when their real holdings change. Users do **not** enter Buy / Sell / Deposit / Withdrawal transactions, and V1 has no brokerage-cash, multi-account, or per-broker UX. Any remaining transaction/ledger wording in this document refers to internal backend primitives (the append-only `transactions` table, `ADJUSTMENT` rows, derived positions) unless a requirement explicitly concerns user-entered transactions. Where older transaction-entry wording conflicts with user-facing behaviour, **Revision 3 of the Portfolio Setup UX design** (`docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md`) governs. Accounting model, schema, and ledger rules are unchanged.

---

## 1. Product vision

A private, single-user web application that tells you **what you own, what it is worth, what moved, and what happened.**

V1 answers exactly six questions:

> What do I own? · What is it worth? · What moved materially? · What happened? · What important news, filings or announcements affect my holdings and watchlist? · Is there an identifiable catalyst for an unusual move?

**V1 does not answer** — and must not appear to answer — whether something strengthens a thesis, whether a company is fundamentally attractive, whether to buy or sell, what fair value is, what return to expect, or what the bear/base/bull case is. Those are V2 and V3.

**V1 replaces:** portfolio spreadsheet checking · Yahoo/Google Finance checking · manually checking holdings for news · repeatedly Googling companies for recent developments · opening large numbers of irrelevant market articles.

**Test for every feature:** *does this help me see what I own, or notice something that happened?* If neither, it is not V1.

---

## 2. Goals

**G1** One accurate, provenance-stamped, multi-account view of holdings and cash in USD.
**G2** Reduce document volume without reducing coverage: 150–400 documents/day in, ≤10 items/day surfaced, with an inspectable record of what was filtered and why.
**G3** Surface unusual price moves and, where evidence exists, link them to a real event — without inventing causality.
**G4** Never display an unsourced figure, and never let an AI-authored claim assert a source it cannot support.
**G5** Make the daily check fast enough to become a habit: 3–5 minutes.
**G6** Leave clean attachment points for V2–V4 without building them.

**Explicit non-goals for V1:** investment judgement of any kind · thesis management · fundamental analysis · valuation · decision discipline machinery · multi-currency accounting · replacing general search or general LLM research.

---

## 3. Currency model

**USD is the sole accounting and reporting currency in V1.** It governs: ledger accounting, transaction values, cash, cost basis, realised and unrealised P&L, portfolio value, performance, reconciliation and account totals.

**CUR1** Every monetary figure that is computed, persisted, reconciled or exported is USD.
**CUR2** `assets.native_currency` is retained on the schema for future extensibility and is not used in any V1 calculation.
**CUR3** V1 assumes actively held assets are USD-denominated or USD-quoted. Adding a non-USD-quoted holding is a V2 concern, and V1 should warn rather than silently mis-value if one is created.

### SGD is an approximate convenience display only

**SGD1** The portfolio header may render:
```
US$XXX,XXX
≈ S$XXX,XXX     (approximate)
```
**SGD2** The SGD figure is **visually secondary** — smaller, lower contrast, positioned beneath or beside the USD figure, never given equal weight.
**SGD3** It is **clearly marked approximate.** The word appears in the UI, not only in a tooltip.
**SGD4** Rate, source and as-of timestamp are exposed on hover/tap.
**SGD5** It uses the **latest available USD/SGD rate**. One rate. No historical series.
**SGD6** It **must not** feed ledger calculations, cost basis, P&L, reconciliation, snapshots or export-as-truth, and **must not be persisted as portfolio truth.**
**SGD7** If the rate is unavailable, display USD normally with the text **"SGD conversion unavailable."** No error state, no data-quality escalation, no blocked render.
**SGD8** **The portfolio must never fail because SGD conversion failed.** This is an acceptance criterion (AC-SGD1), not a preference.

**Explicitly not in V1:** SGD cost basis · SGD transaction accounting · historical SGD performance · FX attribution · trade-date FX · historical USD/SGD reconstruction · multiple FX providers · SGD hurdle rates · execution FX · multi-currency cash · FX conversion transaction type · FX staleness refusal logic · any FX job capable of breaking the portfolio.

---

## 4. User journeys

### J1 — Morning check — target 3–5 min
Open → Zone 1 portfolio state (USD value, approximate SGD, period movement, cash, allocation, data health) → Zone 2 attention queue, capped → resolve or acknowledge each item → Zone 3 scan positions if wanted → done. **An empty attention queue is normal and frequent, and is a designed state.**

### J2 — Investigating a material move — target <60 sec
Move flagged → catalyst status (known / possible / none identified) → linked event and summary if any → benchmark comparison if no catalyst found → acknowledge. **"No company-specific event identified; broader technology benchmark moved similarly" is a complete and satisfying answer.**

### J3 — Reading an event — target <60 sec
Event in inbox → what happened, source, publisher, timestamp, event type → concise summary with per-claim sources → why it was surfaced → related material move if any → open the source if wanted → mark read.

### J4 — Adding something to watch — target <30 sec
Enter ticker → optional note → optional tags → save. That is the entire flow.

### J5 — Entering a transaction — target 1–2 min
Select account and type → quantity, price, date, fees → optional free-text note → save. Cash effect computed and shown before commit.

### J6 — Reconciling an account — periodic
Enter broker-reported total (or per-holding quantities) for an account and date → system computes deltas → discrepancy above tolerance raises a flag on that account.

### J7 — Auditing the filter — daily for the first two weeks, then weekly
Open the filtered tray → see what was excluded and why → disagree with anything → adjust rules. **This is the instrument that tells you whether the product works.**

---

## 5. Screens

| Screen | Milestone | Purpose |
|---|---|---|
| Dashboard (3 zones) | M2 | State, attention, positions |
| Position / Asset detail | M2 | Price history, holdings by account, events (M3) |
| Transactions / Ledger | M1 | Entry, history, reversal |
| Accounts | M1 | Account list, cash, reconciliation |
| Watchlist | M2 | Lightweight monitored list |
| Event inbox | M3 | Events, filtered tray, coverage |
| Material moves | M2 detection / M3 catalyst | Integrated into attention queue; detail view |
| Data health | M1 | Job status, staleness, flags |
| Daily brief | M4 | Concise summary of the day |
| Settings | M1 | Thresholds, sources, display, spend cap |

**Not in V1:** thesis editor · thesis history · decision journal · journal timeline · valuation workbench · calibration.

---

## 6. Ledger requirements *(M1)*

**L1** The ledger is **transaction-sourced**. Positions, cost basis and cash are derived and never directly edited.

**L2 — Single-table transaction model.** One row per economic event, with a nullable `link_id` for the two events that genuinely need two rows (inter-account transfer, spin-off). *Rationale in Critical Review v1.2 §0.5.*

**L3 — Transaction types:** `BUY`, `SELL`, `DIVIDEND`, `INTEREST`, `FEE`, `DEPOSIT`, `WITHDRAWAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `SPLIT_ADJUSTMENT`, `SPINOFF_ADJUSTMENT`, `ADJUSTMENT`. Dividend withholding is carried on the dividend row as `tax_usd`, not as a separate transaction.

**L4 — Append-only.** `UPDATE` and `DELETE` raise. Corrections are reversing rows referencing the original, with a **required reason**. Reversing a linked pair reverses both rows.

**L5 — Multi-account grain.** Current positions are keyed **`(account_id, asset_id)`**; snapshots **`(snapshot_date, account_id, asset_id)`**. **Portfolio totals are an aggregation across accounts, never the storage grain.** Same asset at two brokers = two rows and one aggregate.

**L6 — Cash is derived** per account as the running sum of `cash_effect_usd`, snapshotted daily. Cash is not modelled as an asset. *Rationale in Critical Review v1.2 §0.6.*

**L7 — Cash effect is computed and validated**, not free-entered. For `BUY`: `−(quantity × price) − fees`. For `SELL`: `+(quantity × price) − fees`. For `DIVIDEND`: `gross − tax`. Shown to the user before commit.

**L8 — Cost basis: average cost only in V1**, computed **per account**. No FIFO, no lot selection, no configuration switch.

FIFO is excluded rather than offered because it is not a toggle — it requires lot-level accounting, which propagates into partial sales, lot selection, transfers carrying lot identity, spin-off basis allocation, corporate-action adjustment of every open lot, and per-lot reconciliation. That complexity is not justified for a personal portfolio tracker, and a partial implementation would produce authoritative-looking numbers that are wrong exactly when they matter.

**The UI states plainly that this is a portfolio-tracking record, not tax-lot accounting.** Singapore does not tax capital gains, so nothing in V1 depends on lot identity. If true tax-lot accounting is ever required it should be designed deliberately, reconstructing lots from the append-only transaction history.

**L9 — Corporate actions.** Splits apply correctly to historical quantity and average cost, leaving total cost basis invariant. Spin-offs and mergers have a manual path with an audit note. **Ticker changes must not orphan history** — identity is `asset_id`, never the symbol.

**L10 — Inter-account transfers** carry cost basis and produce no realised P&L.

**L11 — Optional transaction note.** Free text, no validation, no requirement. **Transactions are never flagged, warned or treated as incomplete for lacking a note or any other record.** *(This explicitly removes the v1.1 unlinked-transaction flag.)*

**L12 — Account reconciliation.** Enter a broker-reported total or per-holding quantities for an account and date; system computes deltas and flags above tolerance.

**L13 — Full export** (JSON + CSV) of accounts, transactions, positions, watchlist, documents, events — available at any time without support intervention.

---

## 7. Market data requirements *(M1)*

**MD1** EOD close prices for all held and watched assets. **No real-time data**, deliberately.
**MD2** Historical price series sufficient for charts and for material-move detection.
**MD3** Crypto prices quoted in USD. ETF prices treated identically to equities.
**MD4** Splits and dividends ingested from the vendor; **applied to the ledger only with a recorded corporate action**, never inferred from a price jump.
**MD5** A **"price series adjusted but position quantity unchanged"** detection rule raises a data-quality flag. This is the guard against silent split corruption, which is the classic way a personal ledger corrupts itself.
**MD6** Every price carries source, as-of and retrieval timestamp.
**MD7** Staleness SLA per data type; violations render visibly degraded, never as fresh data.

---

## 8. Watchlist requirements *(M2)*

Watchlist means exactly one thing in V1: **assets I want monitored even though I do not own them.**

**W1** Add an asset. Ticker resolution and save. Nothing else is required.
**W2** Optional free-text note. Optional tags.
**W3** Date added, recorded automatically.
**W4** **Archive, never delete.** Archived items retain history and can be restored; re-adding a previously archived asset is permitted.
**W5** Watched assets receive prices, material moves, news and filings — at a slightly higher materiality threshold than holdings, since you have less at stake.
**W6** No ranking by price movement, % from high, or any composite score.
**W7 — Explicitly not required in V1:** mandatory written reason · Gate 0 · thesis · falsifier · mandatory review date · investment-candidate workflow. **V2 may allow converting a watchlist item into a formal investment candidate; V1 must not anticipate it with unused fields.**
**W8 — Effort budget:** adding an item completes in **under 30 seconds**.

---

## 9. Dashboard requirements *(M2)*

### Zone 1 — Portfolio State
Total portfolio value in USD · approximate SGD equivalent, visually secondary and marked approximate · daily and period movement · USD cash · basic allocation · account selector · data-health indicator. **Nothing else. No thesis information of any kind.**

### Zone 2 — Attention
Hard-capped and prioritised. Eligible items:
- material price move
- important company filing
- important news/event
- ingestion failure
- stale or missing price
- account reconciliation issue
- basic concentration warning

**Explicitly not eligible:** overdue thesis reviews · broken assumptions · thesis-impact verdicts · decision-review reminders. None of these exist in V1.

**An empty queue is the normal, expected, well-designed state.**

### Zone 3 — Positions
Compact table: ticker/asset name · quantity · account (or "all") · value · portfolio weight · price · daily move · latest relevant news/event indicator.

**Ranking constraints:**
- **Default sort is portfolio weight.**
- Daily move is displayed as a column and is never the default sort, never the visual anchor.
- **No API endpoint accepts sorting by percentage change.** Enforced and tested, because the easiest route to a forbidden interface is building the endpoint that enables it.
- No thesis-status column. No gainers/losers panel. No "% below 52-week high". No streaks or engagement mechanics.

---

## 10. Material move requirements *(detection M2, catalyst join M3)*

**MM1 — Deterministic detection.** A daily price change exceeding a configurable threshold. Defaults: equity 5%, ETF 3%, crypto 8%. Optionally weight-adjusted so a small move in a large position can qualify and a large move in a trivial position need not. **No statistical anomaly detection in V1.**

**MM2 — Suppressed on bad data.** If the price job failed or the price is stale, **no moves are detected** for that day. A stale price produces a phantom move.

**MM3 — Catalyst join, not causal inference.** On detection, search ingested events for that asset in a T−2 to T+1 day window:
- **Known relevant event** — a significant event with the asset as subject
- **Possible relevant event** — a lower-significance or mentioned-role event
- **No identified company-specific catalyst** — nothing found; if a comparable benchmark moved similarly, state that deterministically

**MM4 — The system never invents causality.** Copy is correlational only: "Related company event found: earnings release", never "fell because of earnings". The `ai_inference` claim class may not be used to explain a price move at all.

**MM5 — No investment recommendation, ever.**

**MM6 — No thesis dependency.** Material moves reference events and benchmarks only. There is no assumption linkage in V1.

**MM7 — Queue behaviour.** Material moves enter the attention queue as ordinary capped items and do not dominate it.

**Example outputs:**
> **NVDA — significant move, −7.2%** · Related company event found: Q3 earnings release (8-K, 2026-08-23) · Summary: […] · Sources: […]

> **MSFT — significant move, −3.1%** · No company-specific event identified · Broader technology benchmark (QQQ) moved similarly, −2.8%

---

## 11. News and filings requirements *(M3)* — the core product pillar

### 11.1 Sources
Start with three, and add more **only if real usage demonstrates a coverage gap**:
1. **SEC filings** — 10-K, 10-Q, 8-K, S-1, and Form 4 / 13D-G where useful. Free, structured, natural event keys, 8-K item codes.
2. **Issuer communications** where practical — direct IR feeds.
3. **One commercial financial-news provider.**

**Critical distinction, stated once and enforced throughout:** V1 ingests **SEC filings as documents** — discovery, retrieval, linking, filtering, summarisation. V1 does **not** build **SEC XBRL as a financial database** — companyfacts, us-gaap tags, restatement chains, derived metrics. That is V2. The two share only the CIK.

### 11.2 Ingestion
Every document stores: source · publisher · title · timestamp · URL or source identifier · asset links · event type where known · retrieval status · document text.

### 11.3 Entity linking
**Rule-first over the bounded portfolio + watchlist universe.** Ticker with word boundaries and a disambiguating signal · alias dictionary · CIK for filings. Model assistance only where rules are ambiguous, and only among universe candidates. Confidence and linker type recorded. Low-confidence links land in a separate "possibly relevant" tray.

### 11.4 Duplicate suppression — deterministic only
- **Natural keys:** SEC accession number; `{asset}|{event_type}|{period}` for scheduled events. **The period component is mandatory — merging across periods is a zero-tolerance correctness defect.**
- **Near-duplicate suppression:** canonical URL, normalised title hash, SimHash over the lede, within a bounded window.
- A minimal manual "same event" action is available.
- **No embeddings, no semantic clustering, no LLM adjudication in V1.** Deferred to V4, and only if real usage proves the need.

### 11.5 Filtering
The question is: **"Is this worth surfacing to someone monitoring this asset?"** — *not* "does this change an investment thesis."

Inputs: asset relevance · source quality · event type · novelty · significance · duplicate status.

**The user must be able to inspect filtered items at all times.** "N items filtered" is always expandable with per-item reasons.

### 11.6 Coverage disclosure
Every inbox view and daily brief states sources polled, window, stage counts and job failures. **"Nothing to report" must be visually distinct from "ingestion failed."**

### 11.7 Presentation
A surfaced event shows: what happened · asset(s) · source and publisher · timestamp · event type · concise summary · **why it was surfaced** · related material move where applicable.

**No thesis mapping. No assumption references. No verdict controls.**

---

## 12. AI requirements *(M4)* — news assistant, not investment analyst

### 12.1 Permitted tasks
Relevance triage · filing summarisation · news summarisation · event classification · ambiguous entity disambiguation · identifying potentially significant developments · concise explanation of what happened · source-linked claim extraction · grouping obviously related information where reliable.

### 12.2 Prohibited tasks
Thesis strengthening or weakening · assumption mapping · BUY/HOLD/SELL · valuation · fair value · expected IRR · bear/base/bull cases · investment recommendations · decision evaluation · personalised investment action · **asserting causality for a price move** · **asserting completeness of coverage**.

### 12.3 Significance rubric — monitoring-oriented
The V1 classification is about *monitoring salience*, not investment impact:

| Class | Meaning |
|---|---|
| **important** | A development someone monitoring this asset should see today |
| **notable** | Potentially relevant; worth a glance but not attention-queue material |
| **routine** | Scheduled, procedural or minor — filed, not surfaced |
| **duplicate** | Same underlying event already surfaced |
| **unrelated** | Not actually about this asset despite the tag |

**The default class is `routine`.** Most market output is noise, and the rubric must say so explicitly.

**The phrase "no fundamental impact" is removed from V1 entirely** — it belongs to a thesis-aware system and implies a judgement V1 is not permitted to make.

### 12.4 Unsourced numeric-output guardrail
Figures are passed to the model as tokens from a pre-computed numeric context bundle; the model may not write numerals. Post-generation validation rejects any output containing an unsourced digit sequence. Rejections are suppressed, logged and counted.

**The guarantee, stated narrowly:** unsupported raw numeric figures do not reach the user. **It does not guarantee prose is correct** — "revenue nearly doubled" and "one of the largest customers" pass a digit scan cleanly and can be false.

### 12.5 Claim-level provenance
Summaries return a **structured claim list**, not prose. Each claim carries `claim_class ∈ {structured_data, company_statement, third_party_reporting, ai_inference}`, and for the first three a `document_id` and a **verbatim excerpt**.

**Validation:** the excerpt must be a **literal substring of the cited document**. Deterministic, model-free, microseconds. A fabricated citation cannot survive it. Failed claims are dropped; if all sourced claims fail, the summary is suppressed.

Inference claims render with distinct visual treatment and require no citation.

### 12.6 Operational requirements
Swappable model adapter · `model_id`, `prompt_version`, `input_hash` on every run · caching keyed on input hash so a document is never triaged twice at cost · cost tracking · **hard monthly spend cap** with an ordered degradation ladder (summaries degrade before triage) · never silently stop working.

### 12.7 Explicitly removed from V1
`GatedAIPanel` · any requirement to write a rationale before viewing a summary · decision-linked AI gating · assumption-scope proposals · thesis-impact verdicts. **AI news summaries are viewable normally, with no gate of any kind.**

### 12.8 Refusal is a success state
"Insufficient data", "no identified catalyst", "routine — not surfaced" and "coverage reduced today" are first-class, well-designed outputs, not error styling.

### 12.9 Asset-class scope
**AI analysis is stock-only.** Crypto holdings — and any future crypto watchlist entries — must be deterministically excluded (by `asset_class`) before any AI-analysis stage. This is a filter on the input universe, not a model instruction.

---

## 13. Portfolio analytics requirements *(M2)* — deliberately basic

**A1** Total portfolio value; per-position value.
**A2** Position weights.
**A3** Allocation by account.
**A4** Allocation by asset class.
**A5 — Sector allocation, conditional.** Ships **only if** M0 finds vendor sector metadata reliable across your actual holdings. Carries source and as-of like any figure, and **sector is user-overridable per asset**. If unreliable, cut it rather than ship a chart you cannot trust.
**A6** USD cash weight.
**A7 — Basic concentration alerts** against a configurable maximum position weight.

**A8 — Mandatory limitation notice.** Whenever the portfolio contains any ETF, the concentration panel displays a persistent, visible note: **"Excludes exposure held inside ETFs. True concentration in individual names may be higher."** A concentration warning that silently understates risk is worse than none.

**Deferred to V2 unless trivially cheap:** ETF look-through · correlation · performance attribution · benchmark-relative performance · expected-return optimisation · sophisticated risk metrics. **Analytics must not delay portfolio or news functionality.**

---

## 14. Provenance, error states and UX

**D1** Every displayed figure exposes source, as-of and (where derived) formula version.
**D2** Staleness is visible: greyed value plus age badge, never rendered as fresh.
**D3** Data-health strip: last successful run per job, open flags, unreconciled account deltas, AI validation rejections.

**D4 — Error states:**

| State | Behaviour |
|---|---|
| Price job failed | Value shown with staleness banner and timestamp; no day-change computed; **no material moves detected** |
| Price missing for an asset | Position shown at last known price with age badge; excluded from day-change; flagged |
| **SGD rate unavailable** | **USD renders normally; "SGD conversion unavailable." No error, no flag escalation, no blocked page** |
| Split detected in prices but not in ledger | Data-quality flag raised; position value marked suspect until a corporate action is recorded |
| Account reconciliation delta | Flag on that account; portfolio total still shown and flagged |
| Ingestion job failed | Brief states reduced coverage explicitly; **visually distinct from "nothing to report"** |
| Entity link ambiguous | Low-priority "possibly relevant" tray |
| AI numeric validation rejection | Output suppressed entirely; source documents still linked; incident logged and counted |
| Claim excerpt fails substring check | Claim dropped; if all sourced claims fail, summary suppressed |
| AI spend cap approached | Degradation ladder engages with a visible notice; triage degrades last |
| Empty attention queue | Designed, positive, quiet state |

**D5 — Mobile.** Mobile-first for read paths: dashboard, event inbox, material move detail, position detail, daily brief. Transaction entry may be desktop-optimised.

**D6 — No self-directed dark patterns.** No streaks, no engagement nudges, no "you haven't checked in today". The correct usage pattern is short and infrequent.

---

## 15. Effort budgets

| Workflow | Target |
|---|---|
| Morning check, normal day | **3–5 min** |
| Morning check, busy news day | ≤10 min |
| Material move triage | **<60 sec** |
| Reading an event | **<60 sec** |
| Add watchlist item | **<30 sec** |
| Enter a transaction | **1–2 min** |
| Account reconciliation | 5 min, periodic |

**Cross-cutting obligations:** pre-fill everything known · compute cash effect rather than asking for it · never ask twice · no mandatory free-text anywhere in V1 except a reversal reason.

---

## 16. Acceptance criteria

### Ledger and portfolio (M1)

> **M1 completion gate (2026-08-28).** Consistent with the snapshot/mirror supersession note at
> the top of this document, the **current** M1 Portfolio Core gate covers the snapshot-focused
> vertical slice. In the current gate today: **AC-L5** (append-only `UPDATE`/`DELETE` raise),
> **AC-L8** (optional note), **AC-MD2** (split-corruption guard), and the "no thesis /
> fundamentals / valuation / FX-fixings table" + "average-cost only, no lot state" absence tests.
> **AC-L1–AC-L4, AC-L6, AC-L7, AC-L9, AC-MD1** (a killed price *job*) and **AC-SEC1** require
> multi-account reconciliation, inter-account transfer / reversal flows, daily-snapshot jobs,
> export / re-import, authentication, and verified backup / restore — these are **deferred to
> M1H — Portfolio Hardening** (`docs/spec/04-BUILD-PLAN-v1.2.md`); they are preserved, not
> removed. `docs/superpowers/plans/2026-08-25-m1-portfolio-vertical-slice.md` and
> `docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` (Revision 3) control the
> current gate where older wording conflicts. This does **not** authorise public deployment —
> authentication and verified backup / restore (AC-SEC1) remain required before online exposure
> with real financial data.

- **AC-L1** Fixture ledger (4-for-1 split, partial sale, dividend with withholding, **same asset in two accounts**, **inter-account transfer**, deposit, fee) produces expected per-account quantity, cost basis, cash and realised P&L to the cent, and correct aggregates.
- **AC-L2** Portfolio value reconciles to real broker statements **per account** for a full month.
- **AC-L3** Same asset in two accounts appears as two position rows and one aggregate row; aggregate equals the sum.
- **AC-L4** A reversal restores prior positions and cash exactly; the original row remains visible.
- **AC-L5** `UPDATE`/`DELETE` on transactions raise.
- **AC-L6** Split leaves total cost basis invariant; transfer conserves cost basis across accounts and produces no realised P&L.
- **AC-L7** Cash per account equals the sum of cash effects, and equals the daily snapshot.
- **AC-L8** A transaction with an empty note is accepted with **no flag, no warning and no visual difference**.
- **AC-L9** Export → re-import into an empty instance reproduces identical accounts, transactions and positions.
- **AC-MD1** Killing the price job produces a visibly stale dashboard with no fabricated day-change and **zero material moves**.
- **AC-MD2** A price series that adjusts for a split with no matching corporate action raises a data-quality flag.
- **AC-SEC1** Not publicly reachable without authentication; **a restore from automated backup executed and verified before launch**.

### SGD (M2)
- **AC-SGD1** With the FX source disabled, the dashboard renders complete and correct USD figures and shows "SGD conversion unavailable". **No job fails, no flag escalates, no page is blocked.**
- **AC-SGD2** No persisted row anywhere in the database contains an SGD monetary value.
- **AC-SGD3** The SGD figure is visually secondary and labelled approximate; rate, source and timestamp are reachable in one interaction.

### Monitoring UI (M2)
- **AC-U1** Default position sort is portfolio weight. **No endpoint accepts a percentage-change sort parameter** — asserted in tests.
- **AC-U2** The attention queue respects its cap regardless of input volume, and the empty state renders as designed.
- **AC-U3** With an ETF held, the concentration panel displays the look-through limitation notice.
- **AC-U4** Adding a watchlist item requires only a ticker; note and tags are optional and omitting them produces no warning.
- **AC-U5** Morning check on a normal day completes in under 5 minutes, timed on real data.

### News and events (M3)
- **AC-N1** Every ingested document has either an event link or a recorded filter reason. **Zero orphans across a full week of live data.**
- **AC-N2** Entity-linking precision ≥0.95, recall ≥0.85 on a hand-labelled set of ≥200 documents.
- **AC-N3** **Zero events merged across periods.** A correctness assertion, not a threshold.
- **AC-N4** A wire story appearing under ≥3 mastheads produces one event.
- **AC-N5** Coverage disclosure present; "nothing to report" and "ingestion failed" visually distinct.
- **AC-N6** SEC filing ingestion functions with **no XBRL integration present** — asserted by the absence of any companyfacts call in the codebase.
- **AC-MM1** A −7% move with a same-day 8-K reports a known related event and links it.
- **AC-MM2** A −3% move with no company event and a comparable benchmark move reports "no identified company-specific catalyst" plus benchmark context, and **no rendered string asserts causation**.
- **AC-MM3** Material moves function with no thesis or assumption table present in the schema.

### AI (M4)
- **AC-AI1** Adversarial set of ≥200 prompts designed to elicit fabricated figures → **zero unsourced numerals reach the UI**.
- **AC-AI2** Every AI run row has non-null `model_id` and `prompt_version`.
- **AC-AI3** Injected fabricated, paraphrased and truncated excerpts are rejected **100%** of the time.
- **AC-AI4** Inference claims render distinctly from sourced claims.
- **AC-AI5** **An AI summary is viewable with no rationale, no decision and no gating of any kind** — asserted at the API layer.
- **AC-AI6** Cost cap triggers the degradation ladder in order with a visible notice; triage degrades last.
- **AC-AI7** Cache hit on a repeated document produces zero incremental cost.
- **AC-AI8** Triage precision on a ≥200-document labelled set meets the agreed threshold.

### Filtering quality (M3/M4) — the product-defining gate
- **AC-F1** Over a full week of live data, auditing the filtered tray daily, **you agree with ≥80% of filter decisions.** If not, tune before declaring V1 complete.

---

## 17. Success criteria

### Portfolio accuracy
Holdings reconcile per account · USD cash reconciles · cost basis is correct · splits and transfers do not corrupt holdings · portfolio totals are correct.

### Monitoring usefulness
Material moves are surfaced · relevant company events are surfaced · important filings are surfaced · news noise is significantly reduced · catalysts are linked where evidence exists · **no causal relationship is invented**.

### Information reduction
A large incoming document volume becomes a small useful attention set · you rarely need to manually search your holdings for routine daily updates.

### Trust
Every portfolio figure has provenance and as-of information · stale data is visibly stale · ingestion failures are visible · AI sourced claims have valid supporting sources · **unsourced numeric figures do not reach the UI**.

### Simplicity
Morning check is fast · transactions are easy to enter · watchlist entry is easy · **SGD conversion is a convenience, not a failure dependency** · V1 does not create unnecessary manual investment-process work.

### Failure signals — treat as defects
- Daily time in app exceeds ~15 minutes.
- The attention queue is never empty, or you have started ignoring it.
- You still open a news app to check whether you missed something.
- You open the app to look at price movement rather than to check what happened.
- **Trading frequency has increased since launch.** Record your trailing-12-month trade count before M1 ships so this is measurable.

---

## 18. Roadmap beyond V1

**V2 — Thesis + Fundamental Intelligence.** *Does what happened actually matter to why I own this?* Structured fundamentals · SEC XBRL facts · metric provenance · field-level source policy · derived metrics · business quality and survivability · Gate 0 · formal theses with versions and falsifiable assumptions · review dates · event→assumption routing · user thesis-impact verdict (supports / neutral / questions / breaks) · thesis-change history · decision journal with pre-decision rationale · post-mortems · portfolio-fit analysis · simple sourced valuation context · ETF look-through. **AI may suggest which assumptions an event could affect; the user retains the final judgement.**

**V3 — Valuation + Risk/Reward Intelligence.** *Is this attractive at today's price?* Valuation-input confirmation · market-implied expectations · reverse DCF · historical and peer valuation context · bear/base/bull scenarios · forward IRRs · hurdle comparison · margin of safety · advanced portfolio fit and decision support. **User-invoked per asset. No fake precision.**

**V4 — Learning + Advanced Automation.** Structured predictions · calibration · AI-vs-user evaluation · semantic event clustering if proven useful · broker synchronisation · opportunity scanning · automated earnings analysis · advanced alerts · additional exchanges and asset classes · curated additional sources.
