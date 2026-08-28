# Portfolio Setup UX — Design

**Status:** Approved for planning. Revision 3 (final) — narrowed per a product-scope correction and an independent Opus review (see §12). Calboard V1 is a monitoring **mirror** of the equity and selected-crypto holdings the user owns elsewhere — not a transaction ledger the user keeps by hand.
**Scope:** Presentation-layer redesign of the Phase B UI (`app/page.tsx`, `app/actions.ts`) plus a small set of narrowly-scoped, behaviour-preserving backend additions needed for an atomic first-time write and honest data display. No change to the M1 accounting model, ledger rules, or schema.
**Out of scope for V1 user-facing:** brokerage cash, multiple accounts, per-broker / per-exchange "source" breakdown, Buy/Sell/Deposit/Withdrawal entry, money-weighted / time-weighted / contribution-aware returns, an investment-return time series, watchlist / news / events / AI (M2+), visual branding polish, mixed cost-basis-mode-per-holding.

---

## 1. Problem

The M1 portfolio core, historical backfill guardrails, and spot-only opening-import workflow are built and tested, but the real portfolio database is still empty. Before entering real financial data, the current single-page UI (`app/page.tsx`) reads as an engineering/debug screen:

- Dashboard, account creation, ongoing transactions, and one-time opening import all compete on one page.
- Forms rely on placeholder text instead of persistent labels.
- Implementation vocabulary ("Phase B", "cutover", "OPENING IMPORT:") is user-visible.
- There is no setup progression and no pre-commit review.

This document defines the minimum UX restructuring needed before real data entry. It does not reopen the accounting model, ledger design, or schema (see §10).

**Product model (the frame for every decision below).** Calboard V1 mirrors the equity and selected-crypto positions the user owns elsewhere, as **one combined portfolio**. It focuses on holdings, quantities, current value, current unrealized gain/loss versus cost basis, allocation, and (later, M2+) market/news/event monitoring and AI decision support. **Calboard does not execute trades**, and the user's separate trading app is the system of record for every buy and sell. Calboard's job is to reflect the user's *current* position, kept current by the user updating quantities and average cost when their real holdings change — not by re-keying a transaction stream. There is no cash, no multi-account, and no per-broker view in V1: if the same asset is held at more than one real-world broker or exchange, the user enters the combined quantity and combined average cost. The existing append-only ledger, `accounts`/`sources` tables, and accounting primitives remain, used under the hood (a single hidden account; each user update recorded as an `ADJUSTMENT`); none of that is surfaced.

---

## 2. Information architecture

### 2.1 Persistent primary navigation

```
Calboard   ·   Dashboard | Holdings
```

The Dashboard is the product. **Holdings** is the single secondary destination — the pre-filled editor where the user keeps the mirror current (§5). There is no Transactions screen, no Accounts screen, no cash screen.

The setup wizard (§4) suppresses this nav while active, to keep the flow focused. Its own "Cancel setup" is the only exit path during the draft steps.

### 2.2 Screens

| Route | Purpose |
|---|---|
| `/` Dashboard | Read-oriented, and the primary experience: one combined portfolio — Portfolio Value, holdings table, allocation, "Holdings last updated: [when]". No entry forms. |
| `/holdings` Holdings | **The pre-filled editor itself** — every current holding as an editable row, plus add/remove. Save brings Calboard into line with the user's real holdings today. Zero-holdings state launches the setup wizard. There is no separate read-only recap table before the editor. |
| *(wizard, not a route users navigate to directly)* | First-time guided portfolio setup. Reachable from the Dashboard empty state and from `/holdings`. |

The wizard currently lives at the route `/accounts/new` for implementation-history reasons; that path is legacy and not worth renaming in this pass. Nothing user-facing says "account".

### 2.3 No persisted "setup mode" flag

Whether the Dashboard shows its empty state or the full portfolio view is derived entirely from whether any holdings exist — no new schema column or app-level "setup complete" flag. The wizard is an *action*, launched from two entry points:

1. **First run** — Dashboard has zero holdings → its empty state's one CTA is "Add your holdings."
2. **Later** — `/holdings` with zero holdings shows the same CTA.

### 2.4 Empty states

- **Dashboard, zero holdings:** one primary CTA, "Add your holdings."
- **`/holdings`, zero holdings:** same CTA and copy (the editor has nothing to pre-fill yet).

No screen shows an unusable form (an empty `<select>`, a placeholder-only field).

---

## 3. Setup journey — state model

### 3.1 Draft state is disposable

Before Save, all wizard data (the as-of date and the holdings list) lives in **client-side state only**. Cancelling, closing the tab, or navigating away at any point before Save leaves nothing to clean up. No draft persistence/recovery across a browser refresh is in scope.

### 3.2 Atomic first write

Save is the single moment real data is written, and it is genuinely atomic. This matters because `transactions` is append-only (`UPDATE`/`DELETE` raise, per L4/AC-L5): a partial failure across separate auto-committing calls would leave irreversible committed rows with no delete path.

**Approved implementation approach:**

- `createAccount` (`lib/accounts.ts`), `applyTransaction` (`lib/ledger/applyTransaction.ts`), and `applyOpeningPositionAdjustment` (`lib/ledger/openingImport.ts`) each gain an **optional injected `client` parameter**.
  - **Omitted:** behaviour is unchanged — the function owns its own connection and its own `BEGIN`/`COMMIT`/`ROLLBACK`. Every existing caller and test is unaffected.
  - **Provided:** the function uses the given client and skips its own transaction control, letting a caller compose several calls into one transaction.
- A new orchestration function (`lib/ledger/setupAccount.ts`) owns the transaction: acquire one client, `BEGIN`, `createAccount` (always the single hidden `"My Portfolio"` account, `custodian: null` — no user input), `applyOpeningPositionAdjustment` per holding, **one portfolio snapshot-confirmation row in `audit_log`** (see §9.2), `COMMIT` on full success, `ROLLBACK` on any failure. A genuinely ambiguous `COMMIT` outcome (connection dropped mid-commit) throws the distinct `SetupCommitUncertainError` rather than being reported as a definite failure. **No opening-cash adjustment is ever written** — there is no cash in V1.
- No schema change. No new accounting rule. No change to what any existing function computes.

**Testing requirement:** a test proving that a failure on a later holding (e.g. the 3rd of 3) rolls back the entire setup — no account row, no earlier holdings rows remain.

### 3.3 Review is plain; Save is plain

The user reviews a plain summary of the holdings they entered, then clicks Save. There is no sign-off checkbox, no "check against your statement" framing, and no automatic post-save read-back verification screen — this is a mirror the user maintains.

- **Success:** a brief confirmation, then the Dashboard.
- **Failure (transaction rolled back):** stays on Review, all data intact, with a plain-language message and, where the error maps to a specific row, a link to it.
- **Uncertain (`SetupCommitUncertainError`, or the Save call itself rejecting):** an honest "we couldn't confirm whether this saved — check the Dashboard before trying again" message; never "nothing was saved".

An optional internal integrity check (`verifySetup`) may be added later behind the scenes; it is not part of the user-facing flow and is deferred (§9).

---

## 4. Setup wizard — step by step

Two numbered steps, followed by a brief confirmation.

### Step 1 of 2 — Your holdings

```
Add your holdings
Calboard mirrors the equities and crypto you already hold
elsewhere — as one combined portfolio. Enter what you hold now;
update it here whenever your real holdings change. Calboard never
places trades — you keep doing that in your own trading app.

These figures are current as of 2026-08-26.   [Change date]

Enter cost as:
  ( ) Average cost per unit   ( ) Total cost basis
Use whichever your statement shows — Calboard computes the other.
Chosen once; every holding below uses it.

Ticker symbol            [AAPL___]        e.g. AAPL, VOO, BTC
  → checking...  /  ✓ Resolved — last price $228.50 (2026-08-25)
  → Couldn't find a price for "XYZQ". Check the symbol, or add
    it anyway if you're sure it's correct.  [Add anyway]

Asset type                ( ) Equity  ( ) ETF  ( ) Crypto
Quantity you hold         [______]
Average cost per unit (USD)   [______]
  (label follows the mode chosen above)

[+ Add holding]

Added so far:
| Ticker | Type   | Qty | Avg cost | Cost basis |            |
|--------|--------|-----|----------|------------|------------|
| AAPL   | Equity | 10  | $180.00  | $1,800.00  | Edit/Remove|

[Cancel setup]                                     [Next: Review →]
```

- **The as-of date is not prominent.** It defaults to today and is shown as a single sentence; a small "Change date" affordance reveals a date picker for entering an older statement. Validation: must be a valid date, cannot be in the future (checked at the orchestration/action layer — §9). One date applies to the whole snapshot.
- **Cost-basis mode is chosen once**, not per holding. If Total cost basis is chosen, the wizard divides by quantity to derive average cost for internal use — `applyOpeningPositionAdjustment` continues to receive only `avgCostUsd`, unchanged. Locked once the first holding is added (removing all holdings unlocks it).
- **Ticker resolution:** on entering a ticker, the wizard calls the existing `upsertLatestPrice` as the resolution signal. A successful fetch shows a concrete confirmation (last price and date) before the holding can be added; a failed fetch shows a clear "couldn't find a price" state with an explicit "Add anyway" override — an unresolved symbol never *silently* becomes a position.
- Resolved ticker/asset identity must not go stale: editing the ticker text or asset type after resolution immediately clears the resolved identity, and Add is blocked until it's re-resolved.
- **Case-insensitive duplicate-ticker block within the draft.** If the same asset is held at two real brokers, the user enters one combined row.
- At least one holding is required to reach Review.
- Cancel: confirm-discard only if content has been entered.

### Step 2 of 2 — Review & save

```
Review
Nothing has been saved yet. Check the figures, then save.

As of — 2026-08-26                                          [Edit]
Holdings                                                    [Edit]
| Ticker | Type   | Qty | Avg cost | Cost basis |
|--------|--------|-----|----------|------------|
| AAPL   | Equity | 10  | $180.00  | $1,800.00  |

Total cost basis entered: $1,800.00
This is what you paid, not today's market value.

[  Save  ]

You can change any of these figures later from Holdings.
```

- No sign-off checkbox. No "check against your statement" framing. A plain summary with Edit links back to Step 1, and one Save button.
- On click: "Saving…", disabled (no double-submit).
- **Success:** brief "Portfolio saved" confirmation, then `[Go to dashboard →]`.
- **Failure (rolled back):** stays on Review, all data intact, plain-language message + "Take me to the problem" link where it maps to a row.
- **Uncertain:** honest "couldn't confirm whether this saved — check the Dashboard" message; never "nothing was saved".

### Back/Cancel, summarized

Step 1 → Step 2 preserves data on Back. Cancel — or closing the tab, or the browser back button — discards all client-side state, confirming only if something has been entered. The post-save confirmation has no Back — the data is already committed.

---

## 5. Dashboard and keeping the portfolio current

### `/` Dashboard — empty / populated states

- **Empty (zero holdings):** one-CTA empty state, "Add your holdings."
- **Populated:** one combined portfolio:
  - **Portfolio Value** (a.k.a. Total Investments) — the sum of each holding's current market value. Not labelled "Net Worth"; Calboard does not track cash or non-investment assets in V1.
  - **Holdings table** — symbol, quantity, average cost, current price (with the day's price movement where the provider supplies it), current market value, and **current unrealized gain/loss versus cost basis** in dollars and percent. See §8 for price/data-health treatment.
  - **Allocation** — share of portfolio value by holding (and optionally by asset type).
  - **"Holdings last updated: [when]"** — shown near the Portfolio Value, so manually mirrored quantities cannot go stale invisibly. This is the **confirmation time** of the last successful Save (wizard or `/holdings`) — i.e. the moment the user last confirmed the whole visible portfolio as correct, *not* the date any one holding changed, and *not* the snapshot's as-of date. Every successful Save advances it, including a Save that changed nothing. The snapshot's as-of date may be shown as secondary detail ("snapshot as of …"). Source: the latest `audit_log` `snapshot_confirm` row (§9.2).
  - No cash line, no per-broker breakdown, no entry forms.

### `/holdings` — the pre-filled editor

The surface for keeping the mirror current. It **is** the editor — no read-only recap precedes it. Every current holding is rendered as an editable row (ticker, quantity, average cost), pre-filled from `positions_current`, with add-a-holding and remove-a-holding controls (the add path reuses Step 1's ticker-resolution + staleness guard). The as-of date defaults to today, is **not prominent**, and an older date is available only behind a small **"Change date"** affordance.

- Save computes which holdings changed (quantity or average cost) and writes, per changed holding, **one `ADJUSTMENT` row carrying the absolute desired quantity and average cost** — an `ADJUSTMENT` sets the position absolutely, so one row fixes both at once; a removed holding is `quantity: 0`. It is **not** a quantity delta and does **not** use `applyOpeningPositionAdjustment`. All rows plus the snapshot-confirmation `audit_log` row (§9.2) commit in **one atomic transaction** (same injected-`client` mechanism as §3.2). A downward revision creates no realised P&L (§9.1). No `BUY`/`SELL`/`DEPOSIT`/`WITHDRAWAL`.
- **When a holding's quantity increases but its average cost is left unchanged**, show a non-blocking note beside that row: *"Your existing average cost is $X. Update it if your real average cost changed."* It informs; it never blocks Save.
- Entered values are preserved if validation fails (controlled inputs + a Server Action returning structured field errors, never a throwing `<form action>`).
- Submit is disabled while the request is in flight. Errors render inline, beside the relevant field, in plain language.
- Zero-holdings state: the editor is empty; the "Add your holdings" CTA launches the wizard.

### Activity (optional, deferred)

Because every update writes `ADJUSTMENT` rows, a read-only "Activity" list of what changed and when could be added later if it proves useful. It is not built in this pass. No transaction-entry UI exists anywhere.

---

## 6. Holdings entry — number entry and resolution

Applies to the wizard's Step 1 and the `/holdings` editor.

- **All quantities and costs are entered positive.** The user never enters or sees a signed number.
- **The as-of date is a light, non-prominent field** — defaults to today, older dates only behind "Change date", future dates rejected (enforced at the action/orchestration layer, per §9). Preserved on validation failure. It is never called a "trade date" or an "effective date".
- **No raw ledger/implementation detail is exposed** — no "cash effect" field, no signed values, no `txn_type`/`ADJUSTMENT` vocabulary, no "opening balance", no "starting value". Step 2's summary line is "Total cost basis entered", explicitly framed as what the user paid.
- **No cash-effect preview** — the editor shows the resulting holding quantities as plain current-state values, because that *is* what the user is editing.
- **Ticker resolution** on adding a holding uses the existing live-price-fetch confirmation, reusing `resolveTickerAction` — consistent in the wizard and the editor.
- **Editing an existing holding** operates on its known asset identity from `positions_current`; there is no free-text ticker + separately-chosen asset type that could contradict the real position.
- **Submit is disabled while the request is in flight.**

---

## 7. Reconciliation

In the snapshot/mirror model, "reconcile against my broker statement" and "update holdings" are the same action: the user compares Calboard to their real accounts and edits Calboard to match. The `/holdings` editor (§5) is that mechanic; "Holdings last updated" (§5) is the staleness signal that prompts it.

`recordAccountReconciliation` (`lib/accountReconciliation.ts`) remains in the codebase, untouched and unused by any UI in this pass. A fuller evidence-based periodic-reconciliation workflow is deferred — not built here. There is no duplicate-transaction warning, because there is no transaction stream being hand-entered.

---

## 8. Price / data-health states

The dashboard must not silently understate portfolio value when a current price is unavailable. Today, `getPortfolioView` (`lib/portfolio.ts`) treats a position with no fetched price as contributing **$0** to `totalMarketValueUsd` — a real, currently-existing gap, not a new concern introduced here (see §11).

Three explicit states, none implying setup failed:

| State | Meaning | Holdings-table treatment |
|---|---|---|
| **Price unavailable** | No price row exists yet for this asset | Price/market-value cells show "No price yet" instead of blank or $0 |
| **Stale price** | A price exists but is older than the freshness threshold | Price shown greyed with an age badge, e.g. "as of 2026-08-20 (4 days ago)" |
| **Fetch failure** | An active fetch attempt errored | "Price fetch failed" with the last-known price (if any) still shown, plus a retry affordance |

**Portfolio Value:** when any position lacks a current price, the total is no longer silently short — a visible disclosure accompanies it, e.g. *"Portfolio Value excludes 1 holding with no price yet — true value is higher."* This requires a small, additive change to `lib/portfolio.ts`: each `PositionView` gains a price-status classification, and `PortfolioView` gains a flag/list for positions excluded from the computed total. It does not change what the total computes for any priced position, and it does not touch ledger or cost-basis logic.

**Day price movement:** where the provider supplies a prior-close or intraday figure, the holdings table shows the day's change (absolute and percent) per holding. Where it does not, the cell is simply omitted — no fabricated value.

---

## 9. What V1 performance means, and where new logic lives

### 9.1 Performance scope (explicit)

V1 shows, and only shows:

- **Current market value** per holding and for the portfolio.
- **Current unrealized gain/loss versus cost basis** — `(current price − average cost) × quantity`, in dollars and percent, per holding and aggregated.
- **Relevant current / day price movement** where the market-data provider supplies it.

V1 does **not** compute or display: money-weighted return, time-weighted return, IRR, any contribution-aware return, or any investment-return time series. Snapshot-only data (current quantity + current average cost, with no per-trade cash-flow history entered by the user) cannot support those honestly, and V1 must not appear to offer them.

### 9.2 Where new validation and read logic lives

- **"As of" date cannot be in the future** (wizard and `/holdings`) — enforced at the app/action layer alongside the existing `parseDecimalField`-style validation, *not* inside `lib/ledger/openingImport.ts` or `lib/ledger/applyTransaction.ts`. Those functions' own validation (calendar-date format only) is unchanged.
- **Holdings-update diff → absolute `ADJUSTMENT` writes** — a new orchestration/action layer computes, per holding whose **quantity or average cost changed**, the **absolute desired target** `{ assetId, quantity, avgCostUsd }` (a removed holding → `quantity: 0`, with the prior positive average cost reused as the internal `priceUsd` placeholder). It writes **exactly one** `applyTransaction({ txnType: "ADJUSTMENT", accountId: <hidden>, assetId, tradeDate: asOfDate, quantity: desiredQuantity, priceUsd: desiredAvgCostUsd, feesUsd: 0, grossAmountUsd: 0, note: "SNAPSHOT UPDATE: <asOfDate>" }, client)` per changed holding — an `ADJUSTMENT` sets the position **absolutely** (`positions.ts` `applyAdjustment` ignores the prior quantity/cost), so a single row fixes quantity and average cost together. It does **not** send a quantity delta, and it does **not** call `applyOpeningPositionAdjustment` (that wrapper refuses any pre-existing non-zero position, forbids `quantity: 0`, and demands an `OPENING IMPORT:` note — it is for the empty-portfolio wizard only). All rows for one Save are composed into one transaction via the injected-`client` mechanism (§3.2). **A downward snapshot revision records no realised P&L** — V1 is a mirror/snapshot, not trade attribution (§9.1); the user's trading app owns realised-P&L history. No new accounting rule; no new write primitive.
- **Current-holdings read** (for the Dashboard table and the `/holdings` editor pre-fill) — a small read-only query against `positions_current` + `assets`. No write, no new table. No cash read.
- **"Holdings last updated" write** — on every successful Save (`setupAccount` and `updateHoldingsAction`), **including a zero-delta Save**, append one row to the existing `audit_log` table, **inside the same transaction as the Save** so a failed Save cannot advance freshness: `table_name = 'accounts'`, `row_id = <hidden account id>`, `action = 'snapshot_confirm'`, `actor = 'user'`, `after = {"as_of_date": "<asOfDate>"}` (JSONB), `before = NULL`, `at` = default `now()` (the confirmation timestamp). No schema change; `audit_log` has no CHECK/UNIQUE/trigger, so repeated same-day confirmations are just separate honest rows.
- **"Holdings last updated" read** — `SELECT at, after->>'as_of_date' FROM audit_log WHERE action = 'snapshot_confirm' AND row_id = <hidden account id> ORDER BY at DESC LIMIT 1`. The Dashboard shows `at` (confirmation time); `as_of_date` is optional secondary detail. Read-only; can live in `lib/portfolio.ts` or a tiny `lib/snapshotConfirmation.ts`.
- **Price-status classification and Portfolio-Value-exclusion disclosure** (§8) — an additive change to the existing read/aggregation query in `lib/portfolio.ts`. No change to cost basis or any write path.
- **Ticker resolution** — reuses the existing `upsertLatestPrice`/`MarketDataProvider.fetchLatestEod` call, invoked at draft-entry time. No new provider capability.
- **`verifySetup` read-back** — deferred. If added later it is an internal, read-only integrity check with no user-facing screen; it writes nothing.

---

## 10. Settled — do not reopen

- **The product model:** Calboard V1 is a monitoring mirror of equity + selected-crypto holdings owned elsewhere, presented as one combined portfolio. It does not execute trades; the user's trading app is the system of record. No trade-by-trade bookkeeping, no `BUY`/`SELL`/`DEPOSIT`/`WITHDRAWAL` entry UI, no realized-P&L attribution, no return time series. Ongoing currency is maintained by the user editing current quantities and average cost.
- **No user-facing cash.** V1 does not track brokerage cash. The metric is "Portfolio Value" / "Total Investments", not "Net Worth". Cash may return later as an asset/category if it proves genuinely useful — not retained now merely because the backend supports it.
- **No user-facing multi-account or per-broker "source".** One combined portfolio; combined quantity and average cost when an asset is held in several real places. The `accounts`/`sources` tables persist, used internally (a single hidden account).
- The M1 accounting model: USD-only, single-table transactions, append-only ledger, average-cost-only cost basis, account-level position grain (one hidden account). Unchanged.
- The opening-import guardrails in `lib/ledger/openingImport.ts` (mandatory `OPENING IMPORT:` note prefix, refusal on an existing non-zero position) — unchanged, only reached through the wizard.
- `ADJUSTMENT` transaction support (already built) — the primitive behind every holdings update; unchanged.
- Schema — no new tables, no new columns, no new constraints.
- M2/M3/M4 features: watchlist, attention queue, material moves, news/events, AI, SGD display.
- Transaction reversal/correction UI; draft persistence across refresh; mixed cost-basis-mode-per-holding.
- Visual branding and styling polish.

---

## 11. Self-review against the earlier independent (senior-UX) critique

*(Historical record from revision 2 — no task reopens any of these. Where revision 3 has since removed the surrounding feature, that is noted in §12.)*

1. **One account-level "as of" date** replaces separate/per-holding dates — now a single non-prominent field, "cutover" avoided in copy.
2. **A visible as-of date** on the ongoing-entry surface — defaults to today, older dates behind "Change date", future dates rejected, preserved on validation failure.
3. **Review moved before the write** and requires no re-typing of any figure.
4. **Post-save re-entry replaced** — revision 2 used automatic read-back; revision 3 removes even that from the user flow (§3.3, §12).
5. **Ticker resolution before acceptance**, with a clear "couldn't find a price" state and an explicit override — using the *existing* price-fetch capability. Company/asset-name display remains deferred (no such lookup exists in the codebase).
6. **Cost-basis mode (average vs. total) is chosen once**, not per row.
7. **Cash-preview formulas** were corrected in revision 2; revision 3 removes the cash preview entirely, along with all user-facing cash (§12).
8. **Duplicate-transaction warning** — added in revision 2, removed in revision 3 (§12).
9. **Price-unavailable/stale/fetch-failure states defined**, and Portfolio Value no longer silently excludes unpriced positions without disclosure. Retained.
10. **Step count reduced** — revision 2 reached four steps; revision 3 reaches two (§4).

**Deferred, with reasons:** company/asset-name confirmation on ticker entry (no lookup capability exists); mixed cost-basis mode within one snapshot (no genuine need); a fuller periodic-reconciliation workflow (`recordAccountReconciliation` retained, unused); transaction reversal/correction UI; draft persistence across refresh; M2+ features; visual polish.

**Did any approved v1.2 accounting/backend rule change? No.** Every backend-adjacent item is the already-approved optional-injected-`client` parameter, a new small read-only query, or an additive change to the existing read/aggregation query in `lib/portfolio.ts`. No schema changes. "No future date" validation lives at the action/orchestration layer.

---

## 12. Revision history — how this design narrowed

**Revision 2** modelled Calboard as a system-of-record bookkeeping ledger: hand-keyed Buy/Sell/Deposit/Withdrawal, derived cash, an irreversible accounting close, forensic corrections.

**Revision 3 (product-scope correction)** reframed it as a monitoring mirror: the trading app is the system of record; Calboard reflects the user's current position, kept current by editing figures.

**Revision 3 (final) — accepted Opus-review corrections, 2026-08-27:**

| Area | Before (rev 2) | Revision 3 (final) |
|---|---|---|
| Primary model | Dashboard + Accounts + Transactions | One combined portfolio Dashboard; **Holdings** as the only secondary destination |
| Nav | `Dashboard \| Transactions \| Accounts` | `Dashboard \| Holdings` |
| Broker / source | First-class setup concept | **Removed from V1 UX.** Combined quantity + average cost across real places. `accounts`/`sources` persist internally only. |
| Cash | Opening-cash step; derived cash; "Net Worth" | **Removed from V1 UX.** Metric is **Portfolio Value / Total Investments**. No cash field. |
| Wizard | 4 steps + automatic read-back verification | **2 steps** (Your holdings → Review & save) + brief confirmation |
| Review | "Review against your statement" + sign-off checkbox | Plain "Review" + one Save button |
| Post-save | Match / Mismatch / Unverified screens | Brief confirmation → Dashboard. `verifySetup` deferred to an optional internal check. |
| Save result | 4-way union | 3-way: `saved` / `save_failed` / `save_unknown` |
| `/holdings` | Read-only recap + a separate editor | **The pre-filled editor itself** — no recap table before it |
| Performance | Implied broader "performance and allocation" | **Explicitly scoped** (§9.1): current market value, current unrealized gain/loss vs cost basis, day price movement where available. No MWR/TWR/IRR, no return time series. |
| Staleness | — | **"Holdings last updated: [when]"** on the Dashboard = **confirmation time** of the last successful Save (latest `audit_log` `snapshot_confirm` row's `at`), advanced by every Save incl. zero-delta — not the as-of date, not a per-holding timestamp |
| As-of date | A labelled required field | Not prominent; defaults to today; older dates behind a small **"Change date"** affordance |
| Increased qty, same avg cost | — | Non-blocking per-row note prompting an average-cost update |
| Language | "trade/effective date", "opening balance", "starting value" | Neutral snapshot/portfolio language only |

**Preserved unchanged throughout:** the M1 accounting model and schema; the append-only ledger and `ADJUSTMENT` support; the atomic-first-write mechanism (injected `client` + `setupAccount` orchestration + `SetupCommitUncertainError`); ticker resolution via the existing price fetch; cost-basis-mode-chosen-once; the price/data-health states and honest Portfolio-Value disclosure (§8); disposable client-side draft state; the local-timezone date convention and future-date validation placement (§9).
