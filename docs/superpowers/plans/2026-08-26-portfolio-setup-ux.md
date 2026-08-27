# Portfolio Setup UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single debug-style page (`app/page.tsx`, `app/actions.ts`) with the structure from the spec (Revision 3, final) — a portfolio-first, persistent-nav Dashboard (`Dashboard | Holdings`) plus a client-side-draft 2-step setup wizard and the `/holdings` pre-filled editor — backed by an atomic first write and honest price/data-health states, using a **snapshot/mirror model** (the user edits current quantities and average cost; no trade-by-trade bookkeeping, no cash, no per-broker view), without touching the M1 accounting model, ledger rules, or schema.

> **⚠ READ FIRST — "## Product-scope correction (spec revision 3)" below.** It supersedes conflicting detail in the task bodies. Tasks carry a `⚠ Spec revision 3:` note where they are affected; Tasks 5, 12, 21, 22 are dropped/folded.

**Architecture:** Next.js 15 App Router, React 18.3 (no `useFormState`/`useActionState` at this React version — every new form is a `"use client"` component holding controlled state that calls a Server Action directly as an async function and renders the returned structured result, never `<form action={...}>` with a throwing action). Server Actions live under `app/actions/`, grouped by page. Pure, framework-free logic (cost-basis conversion, duplicate-ticker-in-draft check, the edited-vs-stored holdings diff, future-date check) is extracted into `lib/` and unit-tested there — not embedded untested inside client components. Money/quantity stays `Decimal` end-to-end in server code and pure `lib/` functions; values crossing the server→client boundary are serialized to plain strings first. Calendar-date "today" (the setup as-of date, the `/holdings` as-of date) is computed from **local** system time consistently on both client and server via one shared `localTodayIso`/`isFutureDate` pair in `lib/dateValidation.ts` — never `toISOString()`'s UTC slice, which can reject a legitimately-today date as future whenever the local timezone is ahead of UTC. `setupAccountAction` reports a three-way outcome — `save_failed` (rolled back, nothing saved), `saved` (committed), or `save_unknown` (a genuinely ambiguous `COMMIT`, i.e. `setupAccount` threw `SetupCommitUncertainError`, or the action call itself rejected) — and the UI must never reuse "nothing was saved" copy for `save_unknown`. Per spec revision 3 there is no post-commit read-back verification in the user flow.

**Slicing principle (per explicit instruction this session):** tasks are ordered so a real, growing UI is visible in the browser from very early on, instead of building all backend logic first and all UI last. Each UI-facing task ends with a manual "UX acceptance check" against a running `npm run dev`. Every task that has one also lists a "Functional acceptance check" — the automated tests that must pass. Where a task's automated tests require rendering a React component and observing interactive behaviour (draft-state disposal on Cancel, inline-error value preservation, double-submit prevention), it uses a new Vitest+jsdom+Testing-Library component-test setup (Task 1) — everything else follows the existing repo convention of Vitest integration tests against the real local Postgres.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, PostgreSQL 16 (local Docker), `pg`, `decimal.js`, Vitest. New devDependencies (Task 1 only): `@testing-library/react`, `@testing-library/jest-dom`, `@types/react-dom`, `jsdom`.

**Spec:** `docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` (revision 2, approved; committed as `fec7b33` — the commit hash given in the request, `fce7b33`, doesn't exist in this repo; `fec7b33` is the actual "docs: revise portfolio setup UX spec per independent critique" commit and its content matches what this plan implements). Section references (§N) below refer to this document. Also read for context: `docs/spec/01-PRD-v1.2.md`, `docs/spec/02-TRD-v1.2.md`, `docs/spec/03-TDD-v1.2.md` (the approved v1.2 accounting model this plan must not reopen).

## Product-scope correction — spec Revision 3 (final)

**This section is authoritative. It supersedes any conflicting detail in the task bodies below.** Spec: `docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` Revision 3 (final), reflecting a product-scope correction plus accepted Opus-review corrections (2026-08-27). Where a task body's obsolete code was large it has been deleted (git history is the archive) and replaced with a short contract; only genuinely-used backend snippets/signatures remain.

Calboard V1 is a monitoring **mirror** of the equity + selected-crypto positions the user owns elsewhere, as **one combined portfolio**. The trading app is the system of record; the user keeps Calboard current by editing current quantities and average cost. **No user-facing cash, no multi-account, no per-broker "source", no Buy/Sell/Deposit/Withdrawal.** If an asset is held in several real places, the user enters the combined quantity and combined average cost.

**Model rules (apply everywhere):**

1. **Nav:** `Calboard · Dashboard | Holdings`. No Transactions, Accounts, or cash screen.
2. **Dashboard** = one combined portfolio: **Portfolio Value** (not "Net Worth"), holdings table (symbol, qty, avg cost, current price + day move where available, market value, **unrealized gain/loss vs cost basis** in $ and %), allocation, and **"Holdings last updated: [when]"** = the **confirmation time** of the last successful Save (latest `audit_log` `snapshot_confirm` row's `at`), advanced by every successful Save incl. a zero-delta one — *not* the as-of date, *not* a per-holding timestamp. `getPortfolioView` already aggregates across the backend account; do not display its `totalCashUsd`.
3. **`/holdings` IS the pre-filled editor** — no read-only recap table before it. Each current holding is an editable row (from `positions_current`), plus add/remove. On Save, `diffHoldings` emits the **absolute desired target** `{ assetId, quantity, avgCostUsd }` for every holding whose quantity **or** avg cost changed (removed → `quantity: 0`, prior avg cost as the internal `priceUsd`); `updateHoldingsAction` writes **exactly one raw `applyTransaction({ txnType: "ADJUSTMENT", quantity: desiredQuantity, priceUsd: desiredAvgCostUsd, feesUsd: 0, grossAmountUsd: 0, note: "SNAPSHOT UPDATE: <asOfDate>" }, client)` per changed holding** — `applyAdjustment` sets the position absolutely, so one row fixes quantity and avg cost together. **Never a quantity delta; never `applyOpeningPositionAdjustment`** (it refuses pre-existing positions, forbids `quantity: 0`, demands an `OPENING IMPORT:` note — wizard-only). A downward revision writes **no realised P&L** (V1 is a mirror, not trade attribution). All rows + one `audit_log` `snapshot_confirm` row commit in one transaction (Task 6 injected `client`). When a row's quantity increases but avg cost is unchanged, show a non-blocking note: *"Your existing average cost is $X. Update it if your real average cost changed."*
4. **As-of date** (wizard + editor): defaults to today, **not prominent**, older dates only behind a small **"Change date"** affordance. Future dates rejected at the action layer. Never called "trade date", "effective date", "opening balance", or "starting value".
5. **Wizard = 2 steps** + brief confirmation: **Step 1 "Your holdings"** (as-of date + cost-basis-mode toggle + repeatable holdings list) → **Step 2 "Review & save"** (plain summary + one Save) → "Portfolio saved" → `[Go to dashboard]`. No source field, no cash field, no sign-off checkbox, no post-save verification screen.
6. **`setupAccountAction` result** = 3-way `{ status: "saved" | "save_failed" | "save_unknown" }`. `save_unknown` = `SetupCommitUncertainError` **or** the action call itself rejecting. Never reuse "nothing was saved" copy for `save_unknown`. No `verifySetup` in the flow.
7. **`revalidatePath`** targets are `/` and `/holdings`.
8. **Performance scope (V1):** current market value; current unrealized gain/loss vs cost basis; day price movement where the provider supplies it. **No** money-weighted / time-weighted / IRR / contribution-aware return, **no** return time series — snapshot data cannot support them.
9. Backend unchanged: schema, ledger rules, `accounts`/`sources` tables (one hidden `"My Portfolio"` account), `ADJUSTMENT`, `SetupCommitUncertainError`, injected-`client` param.
10. **"Holdings last updated" = a portfolio snapshot-confirmation record.** Every successful Save (`setupAccount` **and** `updateHoldingsAction`), **including a zero-delta Save**, appends **one row to the existing `audit_log` table, inside the same Save transaction** (a failed Save must not advance freshness): `table_name = 'accounts'`, `row_id = <hidden account id>`, `action = 'snapshot_confirm'`, `actor = 'user'`, `after = {"as_of_date": "<asOfDate>"}` (JSONB), `before = NULL`, `at` defaults to `now()` (the **confirmation timestamp**). No schema change — `audit_log` has no CHECK/UNIQUE/trigger, so repeated same-day confirmations are separate honest rows. `account_reconciliations` is **not** used (a Save is not a broker reconciliation; we do not manufacture `broker_reported == system_computed`). The Dashboard read: `SELECT at, after->>'as_of_date' FROM audit_log WHERE action = 'snapshot_confirm' AND row_id = <hidden acct> ORDER BY at DESC LIMIT 1` — display `at`; `as_of_date` is optional secondary detail. Confirmation time ≠ as-of date: the former is when the user pressed Save, the latter is the date the entered figures represent.

**Task disposition:**

| Task | Disposition |
|---|---|
| 1, 2, 6, 11, 16 | **Unchanged.** |
| 7 | Keep — but `SetupAccountInput` drops `openingCashUsd` (no cash); `portfolioAsOfDate` → `asOfDate`; no `applyOpeningCashAdjustment` call. **Also writes one `audit_log` `snapshot_confirm` row inside the same transaction** (see rule 10). Rollback + `SetupCommitUncertainError` tests kept. |
| 17 | Keep — plus: adds the unrealized gain/loss ($ and %) column; labels the total "Portfolio Value" (never "Net Worth"; no cash line); and shows the real **"Holdings last updated"** = the latest `audit_log` `snapshot_confirm` row's `at` (confirmation time), via a small read helper (rule 10). |
| 3 | Nav → `Dashboard | Holdings`; empty-state CTA "Add your holdings" → `/accounts/new`; **remove** the "By source" section; add a "Holdings last updated: [date]" line near Portfolio Value; label the total "Portfolio Value", never "Net Worth". |
| 4 | **Repurposed** to the `/holdings` empty-state shell (`app/holdings/page.tsx`). Done — see its body. |
| 5 | **Dropped** — no `/transactions` page. Stub only. |
| 8 | **Dropped from this pass** — `verifySetup` is not in the flow. Stub only; `SetupCommitUncertainError` (Task 7) stays. |
| 9 | Keep `resolveTickerAction` only. **Delete `checkAccountNameAction`** and its tests — there is no source-name field to check. |
| 10 | Wizard shell + **Step 1 "Your holdings"** top: explanatory copy + the non-prominent as-of date (+ "Change date"). `type Step = 1 | 2 | "complete"`. No name/custodian/"Held at". Button "Next: Review →" → `setStep(2)`. `router.push("/holdings")` on cancel. Keep disposable-draft + future-date validation. |
| 12 | **Dropped** — no opening-cash step (no cash in V1). Stub only. |
| 13 | Appends the **holdings list + cost-basis-mode toggle** to Step 1 (not a separate step). No cash field. All ticker-resolution / staleness-guard / cost-basis-lock / dup-ticker mechanics unchanged; renumber "Step 3"→"Step 1". |
| 14 | `setupAccountAction` → 3-way union (rule 6). No `openingCashUsd` input/param, no cash adjustment, no `verifySetup`, no `saved_verification_error`/`roundedQuantityAssetIds`. Keep 10dp quantity normalization (unsurfaced), future-date validation, `SetupCommitUncertainError`→`save_unknown`. `revalidatePath("/")` + `revalidatePath("/holdings")`. Legacy impl block deleted — build to the contract in the task. |
| 15 | Builds **Step 2 "Review & save"** + Complete. Plain "Review" + one Save; no checkbox, no verification/mismatch/unverified screens. Keep `save_failed` (stay on Review) and `save_unknown`/call-rejection handling ("couldn't confirm — check the Dashboard"), double-submit prevention. Complete: `[Go to dashboard →]`. Legacy "complete final SetupWizard.tsx" block deleted — build to the contract. |
| 18 | Keep `getAccountHoldings` (+ an all-accounts `getAllHoldings()` variant) — feeds the Dashboard table and the `/holdings` editor pre-fill. Query unchanged. **Also add the tiny `getLastSnapshotConfirmation()` read** (rule 10) — `{ confirmedAt: Date; asOfDate: string } | null` from `audit_log`; consumed by Task 17. |
| 19–20 | Deferred (unchanged). Reconciliation == the `/holdings` editor. |
| 21 | **Dropped** — no duplicate-transaction warning. Stub only. |
| 22 | **Dropped** — no cash-effect preview. Stub only. |
| 23 | **Dropped** — `getAccountCashMap` was only for cash display / preview, both gone. Stub only. (`getRecentTransactions` / Activity also deferred.) |
| 24 | **Repurposed** to `updateHoldingsAction` + pure `lib/holdingsUpdate.ts` diff. Input = `{ asOfDate: string; holdings: {assetId,quantity,avgCostUsd}[] }` — **no cash**. `diffHoldings` emits **absolute desired targets** `{ assetId, quantity, avgCostUsd }` per changed holding (rule 3), **not deltas**; `updateHoldingsAction` writes one raw `applyTransaction({ txnType: "ADJUSTMENT", … quantity: desiredQuantity, priceUsd: desiredAvgCostUsd, grossAmountUsd: 0, note: "SNAPSHOT UPDATE: <asOfDate>" }, client)` per changed holding — **never a delta, never `applyOpeningPositionAdjustment`**. Plus one `audit_log` `snapshot_confirm` row (rule 10) — written even on a zero-delta Save. One transaction via injected-`client`; structured field errors, never throws; future-date rejected; quantities ≥ 0, avg cost > 0. A downward revision creates no realised P&L, by design. Legacy `submitTransactionAction` code deleted — build to the contract in the task. |
| 25 | **Repurposed** to the `/holdings` populated state = **the editor itself** (`app/holdings/page.tsx` + `HoldingsEditor` client component). Pre-filled rows from Task 18; add-a-holding reuses Step 1's resolver + staleness guard; the qty-up/avg-cost-unchanged non-blocking note (rule 3); "Change date" affordance (rule 4); calls `updateHoldingsAction`. No recap table, no cash, no preview, no duplicate warning, no Sell picker. Keep entered-values-preserved-on-error, double-submit prevention, honest rejected-call handling. Legacy `TransactionForm` code deleted — build to the contract. |
| 26 | Deletes `app/actions.ts`. Regression walkthrough: routes `/` + `/holdings` only; edit a holding's quantity at `/holdings`, Save, confirm the Dashboard's Portfolio Value / unrealized-P&L and "Holdings last updated" reflect it; no cash/transaction/source checks. |

For repurposed Tasks 14, 15, 24, 25 the detailed TDD steps are re-derived at execution time following the patterns Tasks 9–13 establish (controlled client component + Server Action returning a structured result; pure diff/validation logic in `lib/`, unit-tested; jsdom component test for interactive behaviour). The contract in each task body governs; there are no pre-correction code blocks left to mistake for instructions.

## Global Constraints

Carried directly from this session's explicit instructions and the spec's §10 "Settled — do not reopen":

- Preserve the tested M1 accounting model: USD-only, `NUMERIC(28,10)` in Postgres, `decimal.js` in application code, append-only `transactions`, average-cost-only, derived cash, account-level position grain.
- Preserve append-only ledger behaviour — no code path in this plan issues `UPDATE`/`DELETE` against `transactions`.
- Preserve average-cost accounting — no lot tracking, no FIFO, no per-holding cost-basis-mode mixing.
- No schema redesign — no new tables/columns/constraints anywhere in this plan.
- No M2/M3/M4 expansion (attention queue, SGD display, news, AI, watchlist, concentration panel).
- No final visual-branding/polish exercise.
- No reversal/correction UI in this pass.
- **No user-facing cash, multi-account, or per-broker "source" in V1** (spec Revision 3 §10). The Dashboard metric is **Portfolio Value / Total Investments**, never "Net Worth". `accounts`/`sources` persist as internal-only (one hidden `"My Portfolio"` account).
- **No user-entered transactions** — no Buy/Sell/Deposit/Withdrawal, no cash-effect preview, no duplicate-transaction warning, no statement sign-off. Ongoing currency is the `/holdings` editor writing `ADJUSTMENT` rows.
- **V1 performance is snapshot-scoped:** current market value, current unrealized gain/loss vs cost basis, day price movement where available. No MWR/TWR/IRR, no return time series.
- No full periodic-reconciliation system in this pass — deferred entirely (Tasks 19–20). In the mirror model, reconciliation *is* the `/holdings` editor.
- No new provider capability solely for company-name lookup — ticker resolution reuses the existing `upsertLatestPrice`/`MarketDataProvider.fetchLatestEod` call, invoked earlier (at draft-entry time) than it is today.
- Reuse existing tested functions where possible: `createAccount`, `applyTransaction`, `applyOpeningCashAdjustment`, `applyOpeningPositionAdjustment`, `upsertLatestPrice`, `resolveOrCreateAsset` are all reused, not reimplemented. `recordAccountReconciliation` remains untouched and tested but isn't wired into any UI in this pass — see Tasks 19–20's deferral note.
- Atomic setup must remain all-or-nothing — one Postgres transaction across account creation and every opening-position adjustment (Task 7). No opening-cash adjustment (no cash in V1).
- "No future date" validation lives at the app/action layer (`lib/dateValidation.ts`'s `isFutureDate`, called from `app/actions/*.ts`), never inside `lib/ledger/openingImport.ts` or `lib/ledger/applyTransaction.ts` — those functions' own tested validation is untouched.
- Calendar-date "today" (for `isFutureDate` and every date-input default) is the **local system calendar day** — `now.getFullYear()/getMonth()/getDate()`, never `now.getUTCFullYear()`/`toISOString().slice(0,10)`. This app is single-user and localhost-only, so the server process and the browser share one machine's timezone; UTC "today" can lag the real local day by up to a full day whenever the local offset is positive, which would wrongly reject a legitimately-today date as future for part of every day. `lib/dateValidation.ts` exports one shared `localTodayIso()` helper used by `isFutureDate` and by every client-side date default (the wizard, the Transactions form) — no second, divergent "today" implementation anywhere.
- Postgres `DATE` values read back by any new read helper are normalized through `lib/dateValidation.ts`'s `normalizePgDate` (handles both the raw string `lib/db.ts`'s global type-parser override already returns, and a `Date` object defensively) — never `String(value)`, which only happens to work today by relying on that global override and would silently produce a garbage, non-`YYYY-MM-DD` string if that override were ever changed.
- `setupAccountAction`'s result is a 3-way discriminated union (`status: "saved" | "save_failed" | "save_unknown"`), not a boolean `ok` (spec revision 3 — see the Product-scope correction section). `save_failed` = the transaction rolled back, nothing saved. `save_unknown` = a genuinely ambiguous outcome: `setupAccount()` threw `SetupCommitUncertainError` (an in-doubt `COMMIT`), **or** the action call itself rejected (transport failure). The UI must never reuse "Nothing was saved" copy for `save_unknown`. There is no `verifySetup()` read-back in the user flow.
- All BIGINT ids (`asset_id`, transaction `id`) are handled as `string` throughout, per the existing `lib/db.ts` `int8`-as-string convention already used in `lib/assets.ts` and `lib/ledger/applyTransaction.ts`. `lib/portfolio.ts`'s pre-existing `assetId: number` on `PositionView` is a latent inconsistency with that convention, corrected in Task 16 while that interface is touched anyway.
- Stale-price threshold (Task 16): **5 days**, measured against the price's own `price_date`, not `retrieved_at` — a display-only judgment call tolerating a normal weekend/holiday gap.
- Test isolation: every DB-backed Vitest test file follows the existing `TRUNCATE ... RESTART IDENTITY CASCADE` `beforeEach` pattern (`vitest.config.ts` already sets `fileParallelism: false` for exactly this reason). No automated test makes a live call to a market-data provider — tests that exercise `resolveTickerAction`/`upsertLatestPrice` pre-seed a fresh `prices_daily` row so the existing freshness-cache short-circuit (`isPriceCacheFresh`) is hit instead of the network, matching the existing repo convention (`lib/marketdata/index.test.ts` only tests the pure cache-freshness helper, never a live fetch).
- Task 26's cleanup commit stages files explicitly by path and inspects `git status` first — no `git add -A`, consistent with this repo's existing secret-safety discipline around `.env.local`.

## File structure

**`lib/` (Vitest, real-DB or pure — node environment):**
- `lib/dateValidation.ts` — *modify*: add `localTodayIso`, `isFutureDate` (local-timezone based), `normalizePgDate`.
- `lib/wizard/draftHoldings.ts` — *new*, pure: `computeAvgCostUsd`, `isDuplicateTickerInDraft`.
- `lib/accounts.ts` — *modify*: `createAccount` gains an optional injected `client`.
- `lib/ledger/applyTransaction.ts` — *modify*: `applyTransaction` gains an optional injected `client`.
- `lib/ledger/openingImport.ts` — *modify*: `applyOpeningPositionAdjustment` gains an optional injected `client` (the opening-cash variant is not used by this plan).
- `lib/ledger/setupAccount.ts` — *new*: atomic setup orchestrator (spec §3.2) — one hidden `"My Portfolio"` account + positions only, no cash — plus the `SetupCommitUncertainError` error class for a genuinely ambiguous COMMIT.
- `lib/portfolio.ts` — *modify*: price-status classification + Portfolio-Value-exclusion disclosure (spec §8); expose the "holdings last updated" date.
- `lib/holdings.ts` — *new*: `getAccountHoldings` + `getAllHoldings()` (Dashboard table + `/holdings` editor pre-fill) + `getLastSnapshotConfirmation()` (reads the latest `audit_log` `snapshot_confirm` row for "Holdings last updated" — spec §5, §9.2).
- `lib/holdingsUpdate.ts` — *new* (repurposed Task 24): pure diff of edited-vs-stored holdings → per changed holding, the **absolute desired target** `{ assetId, quantity, avgCostUsd }` (not a delta); unit-tested. **No cash.**
- ~~`lib/ledger/verifySetup.ts`~~ — **dropped this pass** — not in the user flow.
- ~~`lib/transactionPreview.ts`~~ / ~~`lib/duplicateTransactionCheck.ts`~~ / ~~`lib/accountCash.ts`~~ / ~~`lib/transactionHistory.ts`~~ — **dropped** — no cash, no cash-effect preview, no duplicate-transaction warning, no Activity list in V1.

**`app/actions/` (Vitest, real DB, node environment — Server Actions get the same integration-test treatment as `lib/`):**
- `app/actions/setup.ts` — *new*: `resolveTickerAction` (Task 9), then `setupAccountAction` (Task 14). *(`checkAccountNameAction` dropped — no source-name field.)*
- `app/actions/holdings.ts` — *new* (repurposed Task 24): `updateHoldingsAction` (absolute-target diff → one raw `ADJUSTMENT` per changed holding + one `audit_log` `snapshot_confirm` row, all in one transaction; structured field errors; no cash).
- `app/actions/prices.ts` — *new*: `retryPriceFetchAction` (Task 17).

**`app/` pages/components (jsdom component tests for the interactive behaviours; otherwise manual UX acceptance checks):**
- `app/components/NavBar.tsx` — persistent nav (`Dashboard | Holdings`) + shared button-link style (Task 3).
- `app/components/PriceCell.tsx` — price/data-health cell with retry affordance (Task 17).
- `app/page.tsx` — Dashboard, the primary experience (Task 3: empty state + shell incl. "Holdings last updated"; Task 17: price-health upgrade).
- `app/holdings/page.tsx` + `HoldingsEditor.tsx` — the `/holdings` pre-filled editor (Task 4: empty-state shell; Task 25: the editor itself — no recap table).
- `app/accounts/new/page.tsx` + `SetupWizard.tsx` — the 2-step portfolio setup wizard (Task 10: shell + Step 1 top; Task 13: Step 1 holdings list; Task 15: Step 2 Review). Route path is legacy; nothing user-facing says "account".
- ~~`app/transactions/page.tsx` + `TransactionForm.tsx`~~ / ~~`app/accounts/page.tsx`~~ — **dropped**.
- `app/actions.ts` — *deleted* in Task 26 once superseded.

## Task order at a glance (visual-inspection-first)

*(Revised per spec Revision 3 (final) — see the Product-scope correction section, which is authoritative.)*

1. Component-testing infra · 2. `isFutureDate`/`localTodayIso`/`normalizePgDate` · 3. Dashboard shell (empty, dynamic; nav `Dashboard | Holdings`; "Holdings last updated") · 4. `/holdings` editor shell (empty, dynamic) · 5. *dropped — no `/transactions` page* · 6. injected-`client` param · 7. `setupAccount` (positions only, no cash; + `audit_log` snapshot-confirm row in-txn) + rollback + uncertain-commit hardening · 8. *dropped — `verifySetup` not in the flow* · 9. `resolveTickerAction` · **10. Wizard shell + Step 1 top — as-of date (not prominent) + copy (visible)** · 11. cost-basis/duplicate-ticker pure fns · 12. *dropped — no opening-cash step* · **13. Step 1 holdings list + cost-basis-mode lock + ticker-staleness guard (visible)** · 14. `setupAccountAction` (3-way `saved`/`save_failed`/`save_unknown`; no cash; no verify) · **15. Step 2 — plain Review & Save + rejection/uncertain handling (visible, wizard functional)** · 16. price-status classification · **17. Dashboard price-health + unrealized-P&L + "Holdings last updated" (visible)** · 18. `getAccountHoldings` + `getAllHoldings()` + `getLastSnapshotConfirmation()` · 19–20. *deferred — periodic-reconciliation* · 21. *dropped — no duplicate-transaction warning* · 22. *dropped — no cash-effect preview* · 23. *dropped — no cash / Activity* · 24. `updateHoldingsAction` + `lib/holdingsUpdate.ts` (absolute-target diff → one raw `ADJUSTMENT` per changed holding + `audit_log` snapshot-confirm row, one txn; structured errors; no cash) · **25. `/holdings` pre-filled editor (visible)** · 26. cleanup + full regression.

---

### Task 1: Component-testing infrastructure

**Files:**
- Modify: `package.json`, `vitest.setup.ts`
- Create: `app/testing-infra.test.tsx`

**Interfaces:**
- Produces: a working Vitest + jsdom + `@testing-library/react` pipeline, opt-in per test file via a `// @vitest-environment jsdom` docblock (the global environment in `vitest.config.ts` stays `"node"` for the existing DB-integration tests). Consumed by every component test in this plan (Tasks 10, 15, 25).

- [ ] **Step 1: Add the devDependencies**

Modify `package.json`'s `devDependencies` block — add these four entries (keep existing entries as-is):

```json
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@types/react-dom": "^18.3.0",
    "jsdom": "^25.0.0",
```

- [ ] **Step 2: Install**

```bash
npm install
```
Expected: completes with no errors.

- [ ] **Step 3: Register jest-dom matchers globally**

Modify `vitest.setup.ts` — append one line:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Write the failing smoke test**

Create `app/testing-infra.test.tsx` (a top-level non-page file — Next.js App Router only treats `page.tsx`/`layout.tsx`/`route.ts`-named files as routes, so this is safely ignored by the app itself):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello() {
  return <p>hello from jsdom</p>;
}

describe("component-testing infrastructure", () => {
  it("renders a React component in jsdom via Testing Library", () => {
    render(<Hello />);
    expect(screen.getByText("hello from jsdom")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run app/testing-infra.test.tsx`
Expected: PASS, 1 test. (This is infrastructure, not a product feature — there's no prior "write failing test first" step here since there's no implementation to drive; the test itself proves the pipeline works.)

Run: `npm test`
Expected: full existing suite still PASS — confirms the global `"node"` environment default is untouched for every pre-existing test file, and jest-dom's import doesn't break node-environment tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.setup.ts app/testing-infra.test.tsx
git commit -m "chore: add Vitest+jsdom+Testing-Library infra for component-level interaction tests"
```

**Functional acceptance check:** `npx vitest run app/testing-infra.test.tsx` and `npm test` both PASS.
**UX acceptance check:** none — no visible product change.

---

### Task 2: Future-date validation helper (local timezone) + DATE normalization

**Files:**
- Modify: `lib/dateValidation.ts`
- Test: `lib/dateValidation.test.ts` (new)

**Interfaces:**
- Produces: `localTodayIso(now?: Date): string`, `isFutureDate(dateStr: string, now?: Date): boolean`, `normalizePgDate(value: string | Date): string`. `isFutureDate` is consumed by `app/actions/setup.ts` (Task 14) and `app/actions/holdings.ts` (repurposed Task 24) for the "Holdings as of" and holdings-update as-of-date validation respectively (spec §9). `localTodayIso` is consumed by both of those call sites' local-timezone semantics AND by the client-side date defaults in `SetupWizard.tsx` (Tasks 10, 15) and the Update-Holdings editor (Task 25) — one shared definition of "today" on both sides. `normalizePgDate` is consumed by Task 9's `resolveTickerAction` and Task 16's `lib/portfolio.ts` (Tasks 8/21/23 consumers dropped per spec revision 3).

**Why local, not UTC:** the original draft of this helper compared against `now.getUTCFullYear()/getUTCMonth()/getUTCDate()`. In any timezone ahead of UTC, local midnight arrives before UTC midnight — so for the first several hours of a new local day, `now`'s UTC calendar date is still *yesterday*. A user picking today's real calendar date during that window would have it rejected as "in the future" purely because the app's own clock read the wrong day, not because the date was actually ahead of anything. This app is single-user and localhost-only (server process and browser share one machine's timezone), so the correct, unambiguous fix is to use the **local** calendar day everywhere, not UTC.

- [ ] **Step 1: Write the failing test**

Create `lib/dateValidation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidCalendarDate, isFutureDate, localTodayIso, normalizePgDate } from "./dateValidation";

describe("localTodayIso", () => {
  it("formats a Date's own local year/month/day, not its UTC ones", () => {
    // Constructed via local components (JS Date's (y, m, d, h, ...) constructor
    // always uses the machine's local timezone) — this must round-trip exactly,
    // regardless of what timezone the machine running this test is in.
    const now = new Date(2026, 7, 26, 14, 30); // Aug 26, 2026, 14:30 local time
    expect(localTodayIso(now)).toBe("2026-08-26");
  });
});

describe("isFutureDate", () => {
  it("returns true for a date clearly in the future", () => {
    expect(isFutureDate("2099-01-01")).toBe(true);
  });

  it("returns false for today", () => {
    const now = new Date(2026, 7, 26, 12, 0);
    expect(isFutureDate("2026-08-26", now)).toBe(false);
  });

  it("returns false for a past date", () => {
    const now = new Date(2026, 7, 26, 12, 0);
    expect(isFutureDate("2026-08-25", now)).toBe(false);
  });

  it("returns true for tomorrow relative to a fixed now", () => {
    const now = new Date(2026, 7, 26, 23, 59);
    expect(isFutureDate("2026-08-27", now)).toBe(true);
  });

  it("does not reject local 'today' as future shortly after local midnight (the UTC-boundary bug)", () => {
    // 00:05 LOCAL time — constructed via setHours, which operates in the
    // machine's own local timezone. In any timezone ahead of UTC this
    // moment's UTC calendar date is still the PREVIOUS day; the old
    // UTC-based implementation would have compared "today" against that
    // earlier UTC day and wrongly flagged the real local today as future.
    const now = new Date();
    now.setHours(0, 5, 0, 0);
    const localToday = localTodayIso(now);
    expect(isFutureDate(localToday, now)).toBe(false);
  });
});

describe("isValidCalendarDate (regression, unchanged)", () => {
  it("still rejects a malformed date", () => {
    expect(isValidCalendarDate("2026/08/26")).toBe(false);
  });
});

describe("normalizePgDate", () => {
  it("passes through an already-string DATE value unchanged", () => {
    expect(normalizePgDate("2026-03-14")).toBe("2026-03-14");
  });

  it("formats a Date object using its own LOCAL year/month/day, not a UTC conversion", () => {
    const value = new Date(2026, 2, 14, 0, 0); // local midnight, March 14 2026
    expect(normalizePgDate(value)).toBe("2026-03-14");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dateValidation.test.ts`
Expected: FAIL — `isFutureDate`, `localTodayIso`, and `normalizePgDate` are not exported yet.

- [ ] **Step 3: Write the implementation**

Modify `lib/dateValidation.ts` — append after `isValidCalendarDate`:

```ts
// The app's single definition of "today" — the LOCAL system calendar day.
// Used both server-side (isFutureDate) and client-side (every date-input
// default in SetupWizard.tsx / HoldingsEditor.tsx import this directly,
// rather than each re-deriving "today" with its own toISOString() call).
// This app is single-user and localhost-only, so the server process and the
// browser share one machine's timezone — using UTC here would reject a
// legitimately-today date as future for part of every day (see Task 2's
// header note for why).
export function localTodayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isFutureDate(dateStr: string, now: Date = new Date()): boolean {
  return dateStr > localTodayIso(now);
}

// Normalizes a value read back from a Postgres DATE column to a plain
// "YYYY-MM-DD" string. lib/db.ts's global type parser already keeps DATE
// columns as raw strings, but this helper is defensive against that
// changing, and against any query path that ends up handing back a JS Date
// (node-postgres's undecorated default) — using .toISOString() on a Date
// would convert through UTC and can shift the date by one day for any
// caller running behind UTC, so this reads a Date's own LOCAL
// year/month/day components instead, exactly like localTodayIso above.
export function normalizePgDate(value: string | Date): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/dateValidation.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dateValidation.ts lib/dateValidation.test.ts
git commit -m "feat: local-timezone isFutureDate/localTodayIso, plus normalizePgDate for DATE read helpers"
```

**Functional acceptance check:** `npx vitest run lib/dateValidation.test.ts` PASS, 10/10 — includes the explicit local-midnight boundary test proving a legitimately-today date is never rejected as future.
**UX acceptance check:** none — no visible product change yet (wired into the UI in Tasks 10, 14, 15, 24, 25).

---

### Task 3: Dashboard shell — NavBar + empty state (first visible slice)

> **⚠ Spec Revision 3 (final):** nav is `Dashboard | Holdings`. Empty-state copy "No holdings yet." / "Add your holdings" → `/accounts/new`. **No "By source" section** (no user-facing source/account in V1). Label the total **"Portfolio Value"**, never "Net Worth"; **do not render `totalCashUsd`**. Add a **"Holdings last updated: [when]"** line near the total — for this shell task render a `—` placeholder (the real value is a *confirmation timestamp* wired in Task 17 via `getLastSnapshotConfirmation()`); do not block the shell on it. Read "account" as "holdings"/"portfolio" in copy and commit message.

**Files:**
- Create: `app/components/NavBar.tsx`
- Rewrite: `app/page.tsx`

**Interfaces:**
- Produces: `NavBar` component, `buttonLinkStyle` shared style constant (reused by Task 4's empty state).
- Consumes: `listAccounts` (`lib/accounts.ts`) — only to detect "any holdings exist yet" — and `getPortfolioView` (`lib/portfolio.ts`, unmodified until Task 16 — this task's populated branch renders the *original* columns, no price-health cell yet).

Per spec §5, the populated Dashboard has **no entry forms** — this task removes the old inline add-account/add-transaction/opening-import forms from `app/page.tsx` entirely (superseded by the wizard, Task 15, and the `/holdings` editor, Task 25). `app/actions.ts` becomes unused by this page from this task onward, deleted in Task 26.

- [ ] **Step 1: Write `app/components/NavBar.tsx`**

```tsx
import Link from "next/link";

export const buttonLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  background: "#111",
  color: "#fff",
  textDecoration: "none",
  borderRadius: 4,
};

export function NavBar() {
  return (
    <nav
      style={{
        display: "flex",
        gap: "1.5rem",
        alignItems: "center",
        padding: "1rem 2rem",
        borderBottom: "1px solid #ddd",
        marginBottom: "2rem",
        fontFamily: "system-ui",
      }}
    >
      <strong>Calboard</strong>
      <Link href="/">Dashboard</Link>
      <Link href="/holdings">Holdings</Link>
    </nav>
  );
}
```

- [ ] **Step 2: Rewrite `app/page.tsx`**

```tsx
import Link from "next/link";
import { NavBar, buttonLinkStyle } from "./components/NavBar";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";

// Always render dynamically — this page reads live DB state (accounts,
// portfolio positions) on every request and must never be frozen as a
// static build-time snapshot. Per this session's final-review correction,
// this is stated explicitly rather than relied on implicitly, so the
// revalidatePath("/") calls in app/actions/setup.ts (Task 14) and
// app/actions/prices.ts (Task 17) always have a per-request render to
// invalidate.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = accounts.length > 0 ? await getPortfolioView() : null;

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Dashboard</h1>

        {!portfolio ? (
          <section>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your holdings</Link>
          </section>
        ) : (
          <>
            <section>
              <h2>Portfolio Value</h2>
              <p style={{ fontSize: "1.5rem" }}>US${portfolio.totalMarketValueUsd.toFixed(2)}</p>
              {/* Task 17 replaces the placeholder with the real most-recent as-of date. */}
              <p style={{ color: "#666" }}>Holdings last updated: —</p>
            </section>

            <section>
              <h2>Holdings</h2>
              <table border={1} cellPadding={6}>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Qty</th><th>Avg cost</th>
                    <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((p) => (
                    <tr key={`${p.accountId}-${p.assetId}`}>
                      <td>{p.symbol}</td>
                      <td>{p.quantity.toFixed(4)}</td>
                      <td>{p.avgCostUsd ? p.avgCostUsd.toFixed(2) : "—"}</td>
                      <td>{p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : "no price yet"}</td>
                      <td>{p.priceDate ?? "—"}</td>
                      <td>{p.marketValueUsd ? p.marketValueUsd.toFixed(2) : "—"}</td>
                      <td>{p.unrealisedPlUsd ? p.unrealisedPlUsd.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </>
  );
}
```

Note: the "Price" and "Price date" columns here are the *original* pre-existing rendering (this task doesn't touch `lib/portfolio.ts`) — Task 17 replaces this cell with the price-health `PriceCell` component once `priceStatus` exists.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`.

**UX acceptance check:** NavBar shows `Dashboard | Holdings`. With zero holdings in the dev DB (true at this point), the page shows `<h1>Dashboard</h1>`, "No holdings yet.", and an "Add your holdings" button-styled link to `/accounts/new` (this route 404s until Task 10 — expected). No entry forms anywhere. No cash figure, no "by source" list.

- [ ] **Step 4: Commit**

```bash
git add app/components/NavBar.tsx app/page.tsx
git commit -m "feat: persistent nav and Dashboard empty-state shell (Portfolio Value, no cash, no entry forms)"
```

**Functional acceptance check:** none (no new lib/ logic in this task).

---

### Task 4: `/holdings` page shell (empty state)

> **⚠ Spec Revision 3 (final):** the `/holdings` page (spec §5) — `app/holdings/page.tsx`. Task 25 makes its populated state **the pre-filled editor itself** (no read-only recap table first). Heading "Holdings".

**Files:**
- Create: `app/holdings/page.tsx`

**Interfaces:**
- Consumes: `listAccounts` (`lib/accounts.ts`) — used only to detect "any holdings/data exist yet" — and `NavBar`/`buttonLinkStyle` (Task 3).

- [ ] **Step 1: Write `app/holdings/page.tsx`**

```tsx
import Link from "next/link";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { listAccounts } from "@/lib/accounts";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const accounts = await listAccounts();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Holdings</h1>
        {accounts.length === 0 && (
          <>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your holdings</Link>
          </>
        )}
      </main>
    </>
  );
}
```

Task 25 replaces the populated branch with the pre-filled editor itself (no recap table). In the mirror model this editor *is* the reconciliation surface (spec §7); the fuller periodic-reconciliation workflow stays deferred (Tasks 19–20).

- [ ] **Step 2: Manual verification**

**UX acceptance check:** open `http://localhost:3000/holdings`. Expected: NavBar (`Dashboard | Holdings`), "No holdings yet.", "Add your holdings" link (→ `/accounts/new`, which 404s until Task 10 — expected here).

- [ ] **Step 3: Commit**

```bash
git add app/holdings/page.tsx
git commit -m "feat: /holdings empty-state shell"
```

---

### Task 5: *(dropped — spec Revision 3)*

There is no `/transactions` page. The mirror model has no transaction-entry surface; ongoing currency lives at `/holdings` (Tasks 4, 25). Numbered slot retained so later tasks' numbering and cross-references stay stable. No files, no commit.

---

### Task 6: Optional injected `client` param on the ledger write primitives

> **⚠ Spec Revision 3 (final):** adding the optional `client?` to all four functions is fine and harmless; only `createAccount`, `applyOpeningPositionAdjustment`, and `applyTransaction({ txnType: "ADJUSTMENT" })` are actually composed by this plan (Tasks 7, 24). `applyOpeningCashAdjustment` gets the param for consistency but no code path in this plan calls it (no cash in V1).

**Files:**
- Modify: `lib/accounts.ts`, `lib/ledger/applyTransaction.ts`, `lib/ledger/openingImport.ts`
- Test: `lib/ledger/applyTransaction.test.ts` (append)

**Interfaces:**
- Produces: `createAccount(name, custodian, client?: PoolClient)`, `applyTransaction(input, client?: PoolClient)`, `applyOpeningCashAdjustment(input, client?: PoolClient)`, `applyOpeningPositionAdjustment(input, client?: PoolClient)`. Task 7's `setupAccount` and Task 24's `updateHoldingsAction` compose the used ones inside one transaction — the mechanism behind "atomic setup must remain all-or-nothing."

- [ ] **Step 1: Write the failing test**

Append to `lib/ledger/applyTransaction.test.ts` (existing imports already cover `getPool`, `createAccount`, `Decimal`, `applyTransaction`):

```ts
describe("applyTransaction with an injected client", () => {
  it("participates in the caller's transaction and rolls back together when the caller rolls back", async () => {
    const account = await createAccount("Injected Client Test", null);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyTransaction(
        {
          accountId: account.id, assetId: null, txnType: "DEPOSIT",
          tradeDate: "2026-01-01", quantity: null, priceUsd: null,
          feesUsd: new Decimal(0), grossAmountUsd: new Decimal(500), note: null,
        },
        client
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(cashRow.rows).toHaveLength(0);
    const txnRow = await pool.query(`SELECT id FROM transactions WHERE account_id = $1`, [account.id]);
    expect(txnRow.rows).toHaveLength(0);
  });

  it("omitted client still commits its own transaction as before (regression)", async () => {
    const account = await createAccount("No Injected Client Test", null);
    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(500), note: null,
    });
    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("500.00");
  });

  it("createAccount with an injected client rolls back with the caller's transaction", async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await createAccount("Injected Client Account", null, client);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const row = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Injected Client Account"]);
    expect(row.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ledger/applyTransaction.test.ts`
Expected: FAIL to compile — `applyTransaction`/`createAccount` don't accept a second `client` argument yet.

- [ ] **Step 3: Modify `lib/accounts.ts`**

```ts
import { getPool } from "./db";
import type { Pool, PoolClient } from "pg";

export interface Account {
  id: number;
  name: string;
  custodian: string | null;
}

export async function createAccount(
  name: string,
  custodian: string | null,
  client?: PoolClient
): Promise<Account> {
  const db: Pool | PoolClient = client ?? getPool();
  const result = await db.query<Account>(
    `INSERT INTO accounts (name, custodian) VALUES ($1, $2) RETURNING id, name, custodian`,
    [name, custodian]
  );
  return result.rows[0];
}

export async function listAccounts(): Promise<Account[]> {
  const pool = getPool();
  const result = await pool.query<Account>(
    `SELECT id, name, custodian FROM accounts WHERE is_active = TRUE ORDER BY name`
  );
  return result.rows;
}
```

- [ ] **Step 4: Modify `lib/ledger/applyTransaction.ts`**

Only the signature and the transaction-control lines change — the SQL body between `BEGIN` and `COMMIT` is byte-for-byte unchanged:

```ts
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { computeCashEffectUsd, SupportedTxnType } from "./cashEffect";
import { EMPTY_POSITION, applyBuy, applySell, applyAdjustment, avgCostUsd, PositionState } from "./positions";

export interface NewTransactionInput {
  accountId: number;
  assetId: string | null;
  txnType: SupportedTxnType;
  tradeDate: string;
  quantity: Decimal | null;
  priceUsd: Decimal | null;
  feesUsd: Decimal;
  grossAmountUsd: Decimal | null;
  note: string | null;
}

export async function applyTransaction(
  input: NewTransactionInput,
  providedClient?: PoolClient
): Promise<{ transactionId: string }> {
  const cashEffectUsd = computeCashEffectUsd({
    txnType: input.txnType,
    quantity: input.quantity,
    priceUsd: input.priceUsd,
    feesUsd: input.feesUsd,
    grossAmountUsd: input.grossAmountUsd,
  });

  const pool = getPool();
  const client = providedClient ?? (await pool.connect());
  const ownsTransaction = !providedClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");

    const grossAmount =
      input.quantity && input.priceUsd
        ? input.quantity.mul(input.priceUsd)
        : input.grossAmountUsd;

    const txnResult = await client.query<{ id: string }>(
      `INSERT INTO transactions
         (account_id, asset_id, txn_type, trade_date, quantity, price_usd,
          gross_amount_usd, fees_usd, cash_effect_usd, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.accountId,
        input.assetId,
        input.txnType,
        input.tradeDate,
        input.quantity ? input.quantity.toFixed(10) : null,
        input.priceUsd ? input.priceUsd.toFixed(10) : null,
        grossAmount ? grossAmount.toFixed(10) : null,
        input.feesUsd.toFixed(10),
        cashEffectUsd.toFixed(10),
        input.note,
      ]
    );
    const transactionId = txnResult.rows[0].id;

    const cashRow = await client.query<{ total: string | null }>(
      `SELECT SUM(cash_effect_usd) AS total FROM transactions WHERE account_id = $1`,
      [input.accountId]
    );
    const cashTotal = new Decimal(cashRow.rows[0].total ?? "0");
    await client.query(
      `INSERT INTO account_cash (account_id, cash_usd, computed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET cash_usd = EXCLUDED.cash_usd, computed_at = now()`,
      [input.accountId, cashTotal.toFixed(10)]
    );

    if (input.assetId && (input.txnType === "BUY" || input.txnType === "SELL" || input.txnType === "ADJUSTMENT")) {
      const priorRow = await client.query<{
        quantity: string; cost_basis_usd: string; realised_pl_usd: string; first_acquired: string | null;
      }>(
        `SELECT quantity, cost_basis_usd, realised_pl_usd, first_acquired FROM positions_current
         WHERE account_id = $1 AND asset_id = $2`,
        [input.accountId, input.assetId]
      );
      const hasPrior = priorRow.rows.length > 0;
      const prior: PositionState = hasPrior
        ? {
            quantity: new Decimal(priorRow.rows[0].quantity),
            costBasisUsd: new Decimal(priorRow.rows[0].cost_basis_usd),
            realisedPlUsd: new Decimal(priorRow.rows[0].realised_pl_usd),
          }
        : EMPTY_POSITION;
      const firstAcquired = hasPrior ? priorRow.rows[0].first_acquired : input.tradeDate;

      const next =
        input.txnType === "BUY"
          ? applyBuy(prior, input.quantity!, input.priceUsd!, input.feesUsd)
          : input.txnType === "SELL"
            ? applySell(prior, input.quantity!, input.priceUsd!, input.feesUsd)
            : applyAdjustment(prior, input.quantity!, input.priceUsd!);

      const avg = avgCostUsd(next);

      await client.query(
        `INSERT INTO positions_current
           (account_id, asset_id, quantity, cost_basis_usd, avg_cost_usd, realised_pl_usd, first_acquired, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (account_id, asset_id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           cost_basis_usd = EXCLUDED.cost_basis_usd,
           avg_cost_usd = EXCLUDED.avg_cost_usd,
           realised_pl_usd = EXCLUDED.realised_pl_usd,
           computed_at = now()`,
        [
          input.accountId,
          input.assetId,
          next.quantity.toFixed(10),
          next.costBasisUsd.toFixed(10),
          avg ? avg.toFixed(10) : null,
          next.realisedPlUsd.toFixed(10),
          firstAcquired,
        ]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return { transactionId };
  } catch (err) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}
```

- [ ] **Step 5: Modify `lib/ledger/openingImport.ts`**

```ts
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { isValidCalendarDate } from "../dateValidation";
import { applyTransaction } from "./applyTransaction";

const OPENING_IMPORT_PREFIX = "OPENING IMPORT:";

function requireOpeningImportNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error("note is required for an opening import adjustment");
  }
  if (!trimmed.startsWith(OPENING_IMPORT_PREFIX)) {
    throw new Error(`note must begin with "${OPENING_IMPORT_PREFIX}"`);
  }
  return trimmed;
}

function requireValidTradeDate(tradeDate: string): void {
  if (!isValidCalendarDate(tradeDate)) {
    throw new Error(`tradeDate must be a valid YYYY-MM-DD calendar date (got "${tradeDate}")`);
  }
}

export interface OpeningCashAdjustmentInput {
  accountId: number;
  tradeDate: string;
  cashEffectUsd: Decimal;
  note: string;
}

export async function applyOpeningCashAdjustment(
  input: OpeningCashAdjustmentInput,
  client?: PoolClient
): Promise<{ transactionId: string }> {
  const note = requireOpeningImportNote(input.note);
  requireValidTradeDate(input.tradeDate);

  return applyTransaction(
    {
      accountId: input.accountId,
      assetId: null,
      txnType: "ADJUSTMENT",
      tradeDate: input.tradeDate,
      quantity: null,
      priceUsd: null,
      feesUsd: new Decimal(0),
      grossAmountUsd: input.cashEffectUsd,
      note,
    },
    client
  );
}

export interface OpeningPositionAdjustmentInput {
  accountId: number;
  assetId: string;
  tradeDate: string;
  quantity: Decimal;
  avgCostUsd: Decimal;
  note: string;
}

export async function applyOpeningPositionAdjustment(
  input: OpeningPositionAdjustmentInput,
  client?: PoolClient
): Promise<{ transactionId: string }> {
  const note = requireOpeningImportNote(input.note);
  requireValidTradeDate(input.tradeDate);
  if (!input.quantity.isFinite() || input.quantity.lte(0)) {
    throw new Error("quantity must be positive");
  }
  if (!input.avgCostUsd.isFinite() || input.avgCostUsd.lte(0)) {
    throw new Error("avgCostUsd must be positive");
  }

  const db = client ?? getPool();
  const existing = await db.query<{ quantity: string }>(
    `SELECT quantity FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
    [input.accountId, input.assetId]
  );
  if (existing.rows.length > 0 && !new Decimal(existing.rows[0].quantity).eq(0)) {
    throw new Error(
      "This account/asset already has a non-zero position on record — opening-position import only " +
        "supports a fresh position. The approved model does not define a safe adjustment-to-existing-" +
        "position rule, so this is refused rather than guessed."
    );
  }

  return applyTransaction(
    {
      accountId: input.accountId,
      assetId: input.assetId,
      txnType: "ADJUSTMENT",
      tradeDate: input.tradeDate,
      quantity: input.quantity,
      priceUsd: input.avgCostUsd,
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(0),
      note,
    },
    client
  );
}
```

- [ ] **Step 6: Run tests to verify they pass, and run the full suite for regressions**

Run: `npx vitest run lib/ledger/applyTransaction.test.ts lib/ledger/openingImport.test.ts`
Expected: PASS — the 3 new tests, plus every pre-existing `openingImport.test.ts` test unaffected (since `client` is optional everywhere).

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/accounts.ts lib/ledger/applyTransaction.ts lib/ledger/openingImport.ts lib/ledger/applyTransaction.test.ts
git commit -m "feat: optional injected client param on createAccount/applyTransaction/openingImport for atomic multi-call composition"
```

**Functional acceptance check:** `npx vitest run lib/ledger/applyTransaction.test.ts lib/ledger/openingImport.test.ts` PASS; `npm test` PASS in full.
**UX acceptance check:** none — pure backend plumbing, no UI surface yet.

---

### Task 7: Atomic setup orchestration (`lib/ledger/setupAccount.ts`)

**Files:** create `lib/ledger/setupAccount.ts` + `lib/ledger/setupAccount.test.ts`.

**Interfaces:**
- Consumes: `createAccount`, `applyOpeningPositionAdjustment` (Task 6).
- Produces: `SetupHoldingInput { assetId: string; quantity: Decimal; avgCostUsd: Decimal }`, `SetupAccountInput { name: string; custodian: string | null; asOfDate: string; holdings: SetupHoldingInput[] }`, `SetupAccountResult { accountId: number; holdingTransactionIds: string[] }`, `setupAccount(input): Promise<SetupAccountResult>`, `SetupCommitUncertainError`.

**Contract:**
1. Acquire one `PoolClient`; `BEGIN`; `createAccount(name, custodian, client)`; for each holding `applyOpeningPositionAdjustment({ accountId, assetId, quantity, avgCostUsd, tradeDate: asOfDate, note: "OPENING IMPORT: setup" }, client)` (the wizard starts from an empty portfolio, so `applyOpeningPositionAdjustment` is correct here — its "refuse if a non-zero position exists" guard never trips); then **one snapshot-confirmation row on the same `client`** — `INSERT INTO audit_log (table_name, row_id, action, actor, before, after) VALUES ('accounts', <accountId>, 'snapshot_confirm', 'user', NULL, jsonb_build_object('as_of_date', $asOfDate))`; then `COMMIT`. **No opening-cash call.** Release the client in `finally`.
2. **Any failure before `COMMIT` is issued:** attempt `ROLLBACK`, then re-throw the original error. If `ROLLBACK` itself throws, attach it as diagnostic detail — never let it replace/mask the original error. Nothing was saved (the `audit_log` row rolls back with everything else).
3. **`COMMIT` itself throws** (e.g. connection dropped between sending it and receiving Postgres's ack): the server-side outcome is genuinely unknown — do **not** attempt `ROLLBACK`, do **not** infer the outcome from whether an account now exists. Throw `SetupCommitUncertainError` (wrapping the underlying error). Task 14 maps this to `status: "save_unknown"`.

**Tests** (integration, real DB): (a) a valid 2-holding input creates the account + both positions **+ exactly one `audit_log` `snapshot_confirm` row** (`after->>'as_of_date'` = the input date) atomically; (b) **rollback** — an input where the 2nd of 2 holdings is invalid (bad `assetId` / non-positive quantity) leaves **no** account row, **no** position rows, **and no `audit_log` row**; (c) rollback-masking — stub the client so a pre-`COMMIT` statement throws *and* `ROLLBACK` throws → the original error surfaces, not the rollback error; (d) `COMMIT` stubbed to throw → `setupAccount` throws `SetupCommitUncertainError` (not a plain error).

**Commit:** `feat: setupAccount — atomic account+positions setup, rollback-masking + uncertain-commit hardening`

### Task 8: *(dropped this pass — spec Revision 3)*

`verifySetup` read-back is **not part of the user flow** (plain Review & Save). Do not build `lib/ledger/verifySetup.ts` or wire any read-back into `setupAccountAction`. `SetupCommitUncertainError` (Task 7) is unaffected and still used. If a background integrity check is ever wanted it can be added later as an internal, screen-less, read-only helper. Numbered slot retained; no files, no commit.

### Task 9: Ticker resolution Server Action (`app/actions/setup.ts`, part 1)

**Files:**
- Create: `app/actions/setup.ts` (this task writes `resolveTickerAction` only; `setupAccountAction` is appended in Task 14)
- Test: `app/actions/setup.test.ts`

**Interfaces:**
- Consumes: `resolveOrCreateAsset` (`lib/assets.ts`), `upsertLatestPrice` (`lib/marketdata`), `normalizePgDate` (Task 2).
- Produces: `TickerResolutionResult`, `resolveTickerAction(ticker, assetClass)`. Consumed by the wizard's Step 1 holdings list (Task 13) and the `/holdings` editor's add-a-holding path (Task 25).

> Spec Revision 3 dropped `checkAccountNameAction` — there is no user-facing source/account-name field to check. Build `resolveTickerAction` only.

`resolveTickerAction(ticker, assetClass)` — trims/uppercases the symbol; empty → `{ ok:false, assetId:null, message:"Enter a ticker symbol." }`. Calls `resolveOrCreateAsset(symbol, assetClass, symbol)` (always upserts a reference row), then `upsertLatestPrice(asset.id, symbol, assetClass)` as the resolution signal. On a price-fetch throw or no `prices_daily` row → `{ ok:false, assetId: asset.id, message: "Couldn't find a price for \"SYM\". Check the symbol, or add it anyway if you're sure it's correct." }` (assetId still returned so an explicit "Add anyway" can proceed). On success → `{ ok:true, assetId, assetClass, priceUsd: Decimal(close).toFixed(2), priceDate: normalizePgDate(price_date) }`.

**Test** (`app/actions/setup.test.ts`, integration, real DB, node env): pre-seed a fresh `prices_daily` row so the freshness cache short-circuits before any network call (repo convention — no live provider calls in tests). Cover: (1) resolves from a fresh cached price without a live call → `ok:true`, correct `assetId`/`priceUsd`; (2) empty ticker → `ok:false`, `assetId:null`, friendly message, no asset created.

**Commit:** `feat: ticker-resolution Server Action`

### Task 10: Wizard shell + Step 1 top — as-of date (first visible wizard slice)

**Files:** create `app/accounts/new/page.tsx`, `app/accounts/new/SetupWizard.tsx`, `app/accounts/new/SetupWizard.test.tsx` (jsdom).

**Interfaces:** produces the `SetupWizard` client component, extended by Tasks 13 and 15. Consumes `localTodayIso` (Task 2). No Server Action yet.

Per spec §2.1 the wizard suppresses the persistent NavBar while active — no `<NavBar />` on this route. Route path `/accounts/new` is legacy; nothing user-facing says "account".

**Contract (build to this):**
- `type Step = 1 | 2 | "complete"`. This task renders **Step 1's top only**: the explanatory copy from spec §4 Step 1 (`<h1>Add your holdings</h1>` + the "Calboard mirrors the equities and crypto you already hold elsewhere…" paragraph) and the **as-of date**.
- **As-of date is not prominent:** a line "These figures are current as of <localTodayIso()>" with a small **"Change date"** button that reveals a `<input type="date">`. State: `asOfDate` (default `localTodayIso()`), `datePickerOpen` (default false). Never labelled "trade date", "effective date", "opening", or "portfolio as of".
- **No source/"Held at"/account-name field. No custodian. No cash field.**
- Disposable draft: nothing is persisted; `handleCancel()` → confirm only if content has been entered (here: `asOfDate !== localTodayIso()`), then `router.push("/holdings")`.
- `goToStep2()` validates the date: non-empty, not after `localTodayIso()` → else set `step1Error`. On success `setStep(2)` (Step 2 renders nothing until Task 15 — expected).
- Button row: `[Cancel setup]  [Next: Review →]`.

**Tests (jsdom):** mounts on Step 1 with the as-of line showing today and no date input visible; "Change date" reveals the input; a future date + "Next: Review →" shows an inline error and stays on Step 1; Cancel with an unchanged date navigates to `/holdings` without a confirm; Cancel after changing the date prompts `window.confirm`.

**Commit:** `feat: setup wizard shell + Step 1 as-of date (disposable draft, not-prominent date)`

### Task 11: Cost-basis-mode and duplicate-ticker pure functions

**Files:**
- Create: `lib/wizard/draftHoldings.ts`
- Test: `lib/wizard/draftHoldings.test.ts`

**Interfaces:**
- Produces: `CostBasisMode = "average" | "total"`, `computeAvgCostUsd(quantity: Decimal, costInput: Decimal, mode: CostBasisMode): Decimal`, `isDuplicateTickerInDraft(existingTickers: string[], newTicker: string): boolean`. Consumed by Task 13's wizard holdings list (and reusable by the Task 25 editor) — extracted here as plain, framework-free functions so cost-basis-mode handling and duplicate-ticker prevention get real unit tests instead of only being exercised through component rendering.

- [ ] **Step 1: Write the failing test**

Create `lib/wizard/draftHoldings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeAvgCostUsd, isDuplicateTickerInDraft } from "./draftHoldings";

describe("computeAvgCostUsd", () => {
  it("returns the cost input directly in average mode", () => {
    expect(computeAvgCostUsd(new Decimal(10), new Decimal(42.5), "average").toFixed(2)).toBe("42.50");
  });

  it("divides by quantity in total mode", () => {
    expect(computeAvgCostUsd(new Decimal(10), new Decimal(425), "total").toFixed(2)).toBe("42.50");
  });

  it("is exact (no floating-point drift) for a non-terminating decimal division", () => {
    // 100 / 3 = 33.333... — Decimal keeps this to its configured precision,
    // unlike a native float division.
    const result = computeAvgCostUsd(new Decimal(3), new Decimal(100), "total");
    expect(result.mul(3).toFixed(2)).toBe("100.00");
  });

  it("throws when deriving an average from a total cost basis at zero quantity", () => {
    expect(() => computeAvgCostUsd(new Decimal(0), new Decimal(100), "total")).toThrow(/quantity is zero/);
  });
});

describe("isDuplicateTickerInDraft", () => {
  it("is case-insensitive", () => {
    expect(isDuplicateTickerInDraft(["AAPL", "VOO"], "aapl")).toBe(true);
  });

  it("is false for a genuinely new ticker", () => {
    expect(isDuplicateTickerInDraft(["AAPL", "VOO"], "BTC")).toBe(false);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(isDuplicateTickerInDraft(["AAPL"], "  aapl  ")).toBe(true);
  });

  it("is false against an empty draft list", () => {
    expect(isDuplicateTickerInDraft([], "AAPL")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/wizard/draftHoldings.test.ts`
Expected: FAIL — `./draftHoldings` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/wizard/draftHoldings.ts`:

```ts
import Decimal from "decimal.js";

export type CostBasisMode = "average" | "total";

// Spec §4: cost-basis mode is chosen once for the snapshot. When
// "total" is chosen, the wizard divides by quantity to derive the average
// cost that applyOpeningPositionAdjustment actually stores — that function
// only ever receives an average cost, regardless of which mode the user
// picked in the UI.
export function computeAvgCostUsd(quantity: Decimal, costInput: Decimal, mode: CostBasisMode): Decimal {
  if (mode === "average") return costInput;
  if (quantity.eq(0)) {
    throw new Error("Cannot derive an average cost from a total cost basis when quantity is zero");
  }
  return costInput.div(quantity);
}

// Spec §4: case-insensitive duplicate-ticker block within the draft.
export function isDuplicateTickerInDraft(existingTickers: string[], newTicker: string): boolean {
  const normalized = newTicker.trim().toUpperCase();
  return existingTickers.some((t) => t.trim().toUpperCase() === normalized);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/wizard/draftHoldings.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/wizard/draftHoldings.ts lib/wizard/draftHoldings.test.ts
git commit -m "feat: pure cost-basis-mode and duplicate-ticker-in-draft functions for the wizard's holdings step"
```

**Functional acceptance check:** `npx vitest run lib/wizard/draftHoldings.test.ts` PASS, 8/8 — directly covers "cost-basis mode handling" and "duplicate ticker prevention" per this session's required test list, as pure-function tests rather than component tests (faster, more precise, and independent of rendering details).
**UX acceptance check:** none yet — wired into the wizard in Task 13.

---

### Task 12: *(dropped — spec Revision 3)*

V1 has no user-facing cash, so there is no opening-cash wizard step. Numbered slot retained; no files, no commit. The holdings list is appended to Step 1 by Task 13.

### Task 13: Step 1 holdings list — ticker resolution, cost-basis mode, repeatable rows

**Files:** modify `app/accounts/new/SetupWizard.tsx` + `SetupWizard.test.tsx` (append).

**Interfaces:** consumes `resolveTickerAction` (Task 9), `computeAvgCostUsd` / `isDuplicateTickerInDraft` / `CostBasisMode` (Task 11).

**Contract — appends the holdings list to Step 1 (there is no separate step, no cash field):**
- **Cost-basis-mode toggle** (`average` | `total`), chosen once. If `total`, divide by quantity to derive average cost for storage — `applyOpeningPositionAdjustment` still receives only `avgCostUsd`. Both radios `disabled` once `holdings.length > 0`, with a visible "locked once a holding is added — remove all to change" note; clearing all holdings unlocks them.
- **Add-a-holding row:** ticker (resolved on blur via `resolveTickerAction`), asset type (`equity`/`etf`/`crypto`), quantity, cost (label follows the mode). Resolution shows `checking…` → `✓ Resolved — last price $X (date)` or the couldn't-find message + an explicit **Add anyway** (the `resolveOrCreateAsset` id is still present).
- **Resolved-identity staleness guard (critical):** track `resolvedTicker` = the normalized symbol the current `assetId` was resolved for. The ticker input's and asset-type's `onChange` clear `assetId` + the resolution display immediately. `addHolding()` refuses unless the current normalized ticker `=== resolvedTicker` and `assetId` is set ("Resolve the ticker first…").
- **Duplicate-ticker block within the draft**, case-insensitive (`isDuplicateTickerInDraft`) — one combined row per asset even if held at several real brokers.
- Validation on add: quantity `> 0`, cost `> 0`, both parseable.
- **Added-so-far table:** Ticker | Type | Qty | Avg cost | Cost basis | Edit/Remove. `Edit` pulls the row back into the draft (its `assetId` carried, `resolvedTicker` set to its ticker so re-adding unchanged needs no re-resolve).
- At least one holding is required before Step 1's `[Next: Review →]` proceeds.

**Tests (jsdom):** resolves a ticker and shows the confirmed price before Add is allowed; blocks a duplicate ticker case-insensitively; switches the cost label when `total` mode is chosen; locks the mode once a holding exists and an existing row's displayed avg cost is unchanged by a (blocked) mode switch; blocks Add when the ticker was edited after resolution without re-resolving (resolved AAPL → typed MSFT → Add blocked, no MSFT row saved under AAPL's id).

**Commit:** `feat: setup wizard Step 1 holdings list — ticker resolution (staleness-guarded), cost-basis mode (locked once used), repeatable rows`

### Task 14: `setupAccountAction` (`app/actions/setup.ts`, part 2)

**Files:** modify `app/actions/setup.ts` (append `setupAccountAction`) + `app/actions/setup.test.ts` (append).

**Interfaces:**
- Consumes: `setupAccount`, `SetupCommitUncertainError` (Task 7), `isValidCalendarDate`/`isFutureDate` (Task 2).
- Produces: `SetupWizardHolding { assetId: string; quantity: string; avgCostUsd: string }`, `SetupWizardInput { asOfDate: string; holdings: SetupWizardHolding[] }`, `SetupWizardResult`, `setupAccountAction(input)`. Consumed by the wizard's Step 2 (Task 15).

**Contract (build to this — no legacy code retained):**

```ts
export type SetupWizardResult =
  | { status: "saved"; accountId: number }
  | { status: "save_failed"; message: string }
  | { status: "save_unknown"; message: string };
```

1. **Validate at the action layer** (never inside the ledger fns): `asOfDate` is a valid calendar date and `!isFutureDate(asOfDate)` → else `save_failed`. Each holding: `quantity` and `avgCostUsd` parse as `Decimal`, `quantity > 0`, `avgCostUsd > 0` → else `save_failed`. At least one holding.
2. **Normalize** each holding's `quantity` to `.toDecimalPlaces(10)` (matches `NUMERIC(28,10)` on write) before use — not surfaced to the user.
3. **Commit** in one `try/catch`: `const { accountId } = await setupAccount({ name: "My Portfolio", custodian: null, asOfDate, holdings })` — `setupAccount` opens one client, `BEGIN`, `createAccount`, `applyOpeningPositionAdjustment` per holding at the trusted avg cost, `COMMIT`. **No opening-cash call.**
   - `catch (SetupCommitUncertainError)` → `{ status: "save_unknown", message: "We couldn't confirm whether this saved — check the Dashboard before trying again." }` (never inferred from whether an account now exists).
   - any other `catch` → `{ status: "save_failed", message }` (the transaction rolled back; nothing saved).
4. On success: `revalidatePath("/")`, `revalidatePath("/holdings")`, `return { status: "saved", accountId }`. **No `verifySetup`, no second `try/catch`.**

**Tests** (integration, real DB): future-`asOfDate` → `save_failed`, nothing written; valid input → `saved`, positions present, `account_cash` untouched/zero; an invalid holding (`quantity: "-1"` / bad `assetId`) → `save_failed`, full rollback (no account row); a `>10dp` quantity round-trips (`status: "saved"`, stored value read back at exactly 10dp); `setupAccount` mocked to throw `SetupCommitUncertainError` → `save_unknown`, and an account row may or may not exist (not asserted either way).

**Commit:** `feat: setupAccountAction — validated, atomic, 3-way outcome (saved/save_failed/save_unknown), no cash`

### Task 15: Step 2 — plain Review & Save + Complete (wizard fully functional)

**Files:** modify `app/accounts/new/SetupWizard.tsx` + `SetupWizard.test.tsx` (append).

**Interfaces:** consumes `setupAccountAction` (Task 14).

**Contract — Step 2 is a plain review, no ceremony:**
- Renders when `step === 2`: heading "Review", a "Nothing has been saved yet." line, the as-of date (with `[Edit]` → `setStep(1)`), the holdings table, and a `Total cost basis entered: $X` line framed as "what you paid, not today's market value".
- **No sign-off checkbox. No "check against your statement" framing. No post-save verification / mismatch / unverified screens.**
- One `Save` button. On click: `saving` true, button disabled (no double-submit). `try { const r = await setupAccountAction({ asOfDate, holdings }) } catch { …reject… } finally { setSaving(false) }`.
  - `r.status === "saved"` → `setStep("complete")`.
  - `r.status === "save_failed"` → stay on Step 2, draft intact, red banner with `r.message` ("Nothing was saved. Fix the issue and try again.") + a "Take me to the problem" link where it maps to a row.
  - `r.status === "save_unknown"` **or** the call rejected → amber banner: "We couldn't confirm whether this saved — check the Dashboard before trying again." Never the "Nothing was saved" copy.
- **Complete screen** (`step === "complete"`): "Portfolio saved" + `[Go to dashboard →]` (`router.push("/")`). No Back.
- Keep a non-throwing parse for any `Decimal` built from draft text on a render path (values are validated before Save; a momentary unparseable keystroke must not crash the wizard).

**Tests (jsdom):** Save disabled while a request is in flight and fires once, then advances to Complete on `saved`; `save_failed` keeps the draft and shows the red banner (not Complete); `save_unknown` shows the amber "couldn't confirm" banner and never the "Nothing was saved" copy; a rejected `setupAccountAction` call shows the same amber copy and re-enables Save; typing an intermediate invalid character on a draft field does not throw.

**Commit:** `feat: setup wizard Step 2 — plain Review & Save, honest save-outcome handling, Complete`

### Task 16: Price-status classification and total-exclusion disclosure (`lib/portfolio.ts`)

**Files:**
- Modify: `lib/portfolio.ts`
- Test: `lib/portfolio.test.ts` (append)

**Interfaces:**
- Consumes: `normalizePgDate` (Task 2).
- Produces: `PriceStatus = "current" | "stale" | "unavailable"`, `PositionView` gains `priceStatus: PriceStatus` and `assetClass: AssetClass` (needed by Task 17's `PriceCell` retry affordance), `PortfolioView` gains `excludedFromTotalSymbols: string[]`. `assetId` on `PositionView` changes from `number` to `string` (BIGINT convention fix — see Global Constraints). `getPortfolioView` gains an optional `asOf: Date` param (defaults to `new Date()`).

Now that Task 15 makes the wizard capable of creating a real account, this task's populated-state can finally be visually inspected against real data (Task 17 does the visual wiring).

- [ ] **Step 1: Write the failing tests**

Append to `lib/portfolio.test.ts` (existing imports already cover everything needed):

```ts
it("classifies a position with no price row as unavailable and excludes it from the total, with disclosure", async () => {
  const account = await createAccount("No Price Brokerage", null);
  const asset = await resolveOrCreateAsset("NOPRICE", "equity", "No Price Corp");
  await applyTransaction({
    accountId: account.id, assetId: asset.id, txnType: "BUY",
    tradeDate: "2026-01-02", quantity: new Decimal(5), priceUsd: new Decimal(50),
    feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
  });

  const view = await getPortfolioView();
  const position = view.positions.find((p) => p.symbol === "NOPRICE")!;
  expect(position.priceStatus).toBe("unavailable");
  expect(position.marketValueUsd).toBeNull();
  expect(view.excludedFromTotalSymbols).toContain("NOPRICE");
});

it("classifies a price older than the freshness threshold as stale, but still includes it in the total", async () => {
  const account = await createAccount("Stale Price Brokerage", null);
  const asset = await resolveOrCreateAsset("STALE", "equity", "Stale Corp");
  await applyTransaction({
    accountId: account.id, assetId: asset.id, txnType: "BUY",
    tradeDate: "2026-01-02", quantity: new Decimal(5), priceUsd: new Decimal(50),
    feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
  });
  const pool = getPool();
  const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
  const tenDaysAgo = new Date();
  tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
  const staleDate = tenDaysAgo.toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
     VALUES ($1, $2, 60.00, 60.00, $3, now())`,
    [asset.id, staleDate, sourceRow.rows[0].id]
  );

  const view = await getPortfolioView();
  const position = view.positions.find((p) => p.symbol === "STALE")!;
  expect(position.priceStatus).toBe("stale");
  expect(position.marketValueUsd!.toFixed(2)).toBe("300.00");
  expect(view.excludedFromTotalSymbols).not.toContain("STALE");
});

it("classifies a fresh price (within the threshold) as current", async () => {
  const account = await createAccount("Current Price Brokerage", null);
  const asset = await resolveOrCreateAsset("CURR", "equity", "Current Corp");
  await applyTransaction({
    accountId: account.id, assetId: asset.id, txnType: "BUY",
    tradeDate: "2026-01-02", quantity: new Decimal(2), priceUsd: new Decimal(10),
    feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
  });
  const pool = getPool();
  const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await pool.query(
    `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
     VALUES ($1, $2, 15.00, 15.00, $3, now())`,
    [asset.id, yesterday.toISOString().slice(0, 10), sourceRow.rows[0].id]
  );

  const view = await getPortfolioView();
  const position = view.positions.find((p) => p.symbol === "CURR")!;
  expect(position.priceStatus).toBe("current");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portfolio.test.ts`
Expected: FAIL — `priceStatus`/`excludedFromTotalSymbols` don't exist yet.

- [ ] **Step 3: Write the implementation**

Replace `lib/portfolio.ts` in full:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";
import type { AssetClass } from "./assets";
import { normalizePgDate } from "./dateValidation";

export type PriceStatus = "current" | "stale" | "unavailable";

// Price age is measured against the EOD price's own date (price_date), not
// when it was fetched (retrieved_at) — a 3-day-old EOD close fetched a
// minute ago is still a 3-day-old price. 5 days tolerates a normal weekend
// or market holiday without flagging an ordinary gap as stale.
const STALE_PRICE_THRESHOLD_DAYS = 5;

function daysSince(dateStr: string, today: Date): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateUtc = Date.UTC(y, m - 1, d);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((todayUtc - dateUtc) / (1000 * 60 * 60 * 24));
}

export interface PositionView {
  accountId: number;
  accountName: string;
  assetId: string;
  symbol: string;
  assetName: string;
  assetClass: AssetClass;
  quantity: Decimal;
  avgCostUsd: Decimal | null;
  costBasisUsd: Decimal;
  latestPriceUsd: Decimal | null;
  priceDate: string | null;
  priceSourceId: number | null;
  priceStatus: PriceStatus;
  marketValueUsd: Decimal | null;
  unrealisedPlUsd: Decimal | null;
}

export interface PortfolioView {
  positions: PositionView[];
  totalCashUsd: Decimal;
  totalMarketValueUsd: Decimal;
  totalPortfolioValueUsd: Decimal;
  // Symbols excluded from totalMarketValueUsd because no price row exists at
  // all yet — used to disclose that the total is a floor, not the true value
  // (spec §8). Stale-but-present prices still contribute their last-known
  // market value and are NOT in this list.
  excludedFromTotalSymbols: string[];
}

export async function getPortfolioView(asOf: Date = new Date()): Promise<PortfolioView> {
  const pool = getPool();

  const positionsResult = await pool.query(`
    SELECT
      pc.account_id, a.name AS account_name,
      pc.asset_id, ast.primary_symbol AS symbol, ast.name AS asset_name, ast.asset_class,
      pc.quantity, pc.avg_cost_usd, pc.cost_basis_usd,
      lp.close AS latest_price, lp.price_date, lp.source_id AS price_source_id
    FROM positions_current pc
    JOIN accounts a ON a.id = pc.account_id
    JOIN assets ast ON ast.id = pc.asset_id
    LEFT JOIN LATERAL (
      -- prices_daily's PK is (asset_id, price_date, source_id), so the same
      -- asset/date can hold one row per provider. price_date DESC alone is
      -- not a deterministic tiebreaker among same-date rows from different
      -- sources — break ties with retrieved_at DESC (most recently fetched
      -- wins) and surface source_id so callers can see provenance.
      SELECT close, price_date, source_id FROM prices_daily
      WHERE asset_id = pc.asset_id
      ORDER BY price_date DESC, retrieved_at DESC LIMIT 1
    ) lp ON true
    WHERE pc.quantity <> 0
    ORDER BY ast.primary_symbol
  `);

  const positions: PositionView[] = positionsResult.rows.map((row) => {
    const quantity = new Decimal(row.quantity);
    const costBasisUsd = new Decimal(row.cost_basis_usd);
    const avgCostUsd = row.avg_cost_usd ? new Decimal(row.avg_cost_usd) : null;
    const latestPriceUsd = row.latest_price ? new Decimal(row.latest_price) : null;
    const marketValueUsd = latestPriceUsd ? quantity.mul(latestPriceUsd) : null;
    const unrealisedPlUsd = marketValueUsd ? marketValueUsd.sub(costBasisUsd) : null;
    // Per this session's final-review correction: reuse the shared
    // normalizePgDate helper (Task 2) for this DATE read instead of a
    // duplicated inline conversion — normalizePgDate is the app's ONE
    // definition of how a Postgres DATE becomes a plain "YYYY-MM-DD"
    // string, handling both the raw string lib/db.ts's global type-parser
    // override returns and a JS Date object defensively via LOCAL
    // year/month/day components (never toISOString(), which converts
    // through UTC and can shift the date by a day).
    const priceDate: string | null = row.price_date ? normalizePgDate(row.price_date) : null;

    const priceStatus: PriceStatus =
      !latestPriceUsd || !priceDate
        ? "unavailable"
        : daysSince(priceDate, asOf) > STALE_PRICE_THRESHOLD_DAYS
          ? "stale"
          : "current";

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      assetId: row.asset_id,
      symbol: row.symbol,
      assetName: row.asset_name,
      assetClass: row.asset_class,
      quantity,
      avgCostUsd,
      costBasisUsd,
      latestPriceUsd,
      priceDate,
      priceSourceId: row.price_source_id ?? null,
      priceStatus,
      marketValueUsd,
      unrealisedPlUsd,
    };
  });

  const cashResult = await pool.query(`SELECT COALESCE(SUM(cash_usd), 0) AS total FROM account_cash`);
  const totalCashUsd = new Decimal(cashResult.rows[0].total);

  const totalMarketValueUsd = positions.reduce(
    (sum, p) => (p.marketValueUsd ? sum.add(p.marketValueUsd) : sum),
    new Decimal(0)
  );

  const excludedFromTotalSymbols = positions
    .filter((p) => p.priceStatus === "unavailable")
    .map((p) => p.symbol);

  return {
    positions,
    totalCashUsd,
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalCashUsd.add(totalMarketValueUsd),
    excludedFromTotalSymbols,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portfolio.test.ts`
Expected: PASS, 4 tests (1 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio.ts lib/portfolio.test.ts
git commit -m "feat: price-status classification and total-exclusion disclosure (spec 8)"
```

**Functional acceptance check:** `npx vitest run lib/portfolio.test.ts` PASS, 4/4 — directly covers "missing/stale price display" per this session's required test list (unavailable, stale, current, and the total-exclusion disclosure list).
**UX acceptance check:** none yet — wired into the Dashboard in Task 17.

---

### Task 17: Dashboard price-health + unrealized-P&L + "Holdings last updated"

> **⚠ Spec Revision 3 (final) — this task also finishes the Dashboard content:**
> - Add a **current unrealized gain/loss vs cost basis** column, in **$ and %** (`(price − avgCost) × qty`; `%` = that over `avgCost × qty`), per row and an aggregate. This is V1's entire "performance" surface — no MWR/TWR/IRR, no return time series (spec §9.1).
> - Replace the Task 3 placeholder with the real **"Holdings last updated"** = the **confirmation time** of the last successful Save — `getLastSnapshotConfirmation()` (Task 18) → the latest `audit_log` `snapshot_confirm` row's `at`. Display `at` (e.g. "2026-08-27 14:03"); the row's `as_of_date` may be shown as secondary detail ("snapshot as of …"). **Not** `MAX(transactions.trade_date)`, **not** `positions_current.computed_at`. Empty portfolio (no confirmation row) → hide the line or show "—".
> - Label the total **"Portfolio Value"**; never "Net Worth"; no cash line; no "by source" list.
> - Day price movement per row where the provider supplies a prior close; omit the cell otherwise.

**Files:**
- Create: `app/components/PriceCell.tsx`, `app/actions/prices.ts`
- Modify: `app/page.tsx`; `lib/portfolio.ts` (unrealized-P&L aggregate, if not already from Task 16). Consumes `getLastSnapshotConfirmation()` from Task 18.

**Interfaces:**
- Consumes: `getPortfolioView` (Task 16, now returning `priceStatus`/`assetClass`/`excludedFromTotalSymbols`), `upsertLatestPrice` (`lib/marketdata`).
- Produces: `retryPriceFetchAction(assetId, symbol, assetClass)`, `PriceCell` component.

- [ ] **Step 1: Write `app/actions/prices.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { upsertLatestPrice } from "@/lib/marketdata";
import type { AssetClass } from "@/lib/assets";

// Spec §8's "retry affordance" for an unavailable/stale price. Attempts a
// fresh fetch on demand; failures are reported back to the caller rather
// than thrown, since this runs from a button click, not a form submission.
export async function retryPriceFetchAction(
  assetId: string,
  symbol: string,
  assetClass: AssetClass
): Promise<{ ok: boolean; message?: string }> {
  try {
    await upsertLatestPrice(assetId, symbol, assetClass);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Price fetch failed." };
  }
}
```

- [ ] **Step 2: Write `app/components/PriceCell.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryPriceFetchAction } from "@/app/actions/prices";
import type { AssetClass } from "@/lib/assets";
import type { PriceStatus } from "@/lib/portfolio";

export function PriceCell({
  assetId,
  symbol,
  assetClass,
  priceStatus,
  priceUsd,
  priceDate,
}: {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  priceStatus: PriceStatus;
  priceUsd: string | null;
  priceDate: string | null;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    const result = await retryPriceFetchAction(assetId, symbol, assetClass);
    setRetrying(false);
    if (!result.ok) {
      setRetryError(result.message ?? "Price fetch failed.");
      return;
    }
    router.refresh();
  }

  if (priceStatus === "current") {
    return <span>${priceUsd}</span>;
  }

  if (priceStatus === "stale") {
    return (
      <span style={{ color: "#888" }}>
        ${priceUsd} <span style={{ fontSize: "0.85em" }}>(as of {priceDate})</span>{" "}
        <button type="button" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry"}
        </button>
        {retryError && <div style={{ color: "#b00020" }}>{retryError}</div>}
      </span>
    );
  }

  return (
    <span>
      No price yet{" "}
      <button type="button" onClick={handleRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
      {retryError && <div style={{ color: "#b00020" }}>{retryError}</div>}
    </span>
  );
}
```

- [ ] **Step 3: Modify `app/page.tsx`**

Add the import:

```ts
import { PriceCell } from "./components/PriceCell";
```

Add the total-exclusion disclosure — insert immediately after the "Cash: ... Holdings: ..." `<p>` inside the "Portfolio value" section:

```tsx
              {portfolio.excludedFromTotalSymbols.length > 0 && (
                <p style={{ color: "#a15c00" }}>
                  Portfolio total excludes {portfolio.excludedFromTotalSymbols.length} holding
                  {portfolio.excludedFromTotalSymbols.length === 1 ? "" : "s"} with no price yet (
                  {portfolio.excludedFromTotalSymbols.join(", ")}) — true value is higher.
                </p>
              )}
```

Replace the table header's two price columns:

```tsx
                    <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
```

with one:

```tsx
                    <th>Price</th><th>Market value</th><th>Unrealised P&amp;L</th>
```

Replace the two `<td>` cells that render `p.latestPriceUsd`/`p.priceDate`:

```tsx
                      <td>{p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : "no price yet"}</td>
                      <td>{p.priceDate ?? "—"}</td>
```

with one:

```tsx
                      <td>
                        <PriceCell
                          assetId={p.assetId}
                          symbol={p.symbol}
                          assetClass={p.assetClass}
                          priceStatus={p.priceStatus}
                          priceUsd={p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : null}
                          priceDate={p.priceDate}
                        />
                      </td>
```

- [ ] **Step 4: Manual verification**

With `npm run dev` running and the account created via Task 15's wizard walkthrough still in the dev DB:

**UX acceptance check:** open `http://localhost:3000/`. The resolved holding shows a plain `$price`; the unresolved ("Add anyway") holding shows "No price yet" with a working "Retry" button (clicking it re-attempts the fetch — it will likely fail again for a fake ticker, showing an inline red error, or succeed and update if you used a real-but-cold ticker). The "Portfolio total excludes 1 holding..." disclosure line names that ticker. To see the "stale" styling, run:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U calboard -d calboard -c "UPDATE prices_daily SET price_date = CURRENT_DATE - 10 WHERE asset_id = (SELECT id FROM assets WHERE primary_symbol = '<your resolved ticker>');"
```
then refresh the Dashboard — the price now renders greyed with "(as of ...)" and its own Retry button.

- [ ] **Step 5: Commit**

```bash
git add app/actions/prices.ts app/components/PriceCell.tsx app/page.tsx
git commit -m "feat: Dashboard price-health cells (current/stale/unavailable) with retry and total-exclusion disclosure"
```

**Functional acceptance check:** none new (Task 16 already covers the underlying classification logic; this task is presentation-only).
**UX acceptance check:** see Step 4 above.

---

### Task 18: Current-holdings query + last-confirmation read (`lib/holdings.ts`)

**Files:** create `lib/holdings.ts` + `lib/holdings.test.ts`.

**Interfaces:**
- `AccountHolding { assetId: string; symbol: string; assetClass: AssetClass; quantity: Decimal }`; `getAccountHoldings(accountId: number): Promise<AccountHolding[]>` and a no-arg `getAllHoldings(): Promise<AccountHolding[]>` (same query, no `account_id` filter — the whole portfolio; V1 has one hidden account so no source column). Consumed by `updateHoldingsAction` (Task 24, current-state read) and the `/holdings` editor + Dashboard table (Tasks 25, 17).
- `getLastSnapshotConfirmation(accountId: number): Promise<{ confirmedAt: Date; asOfDate: string } | null>` — reads the latest `audit_log` `snapshot_confirm` row (model rule 10): `SELECT at, after->>'as_of_date' AS as_of_date FROM audit_log WHERE action = 'snapshot_confirm' AND row_id = $1 ORDER BY at DESC LIMIT 1`. `null` when the portfolio has never been saved. Consumed by Task 17 for "Holdings last updated". Read-only; no write.

**Holdings query:** `SELECT pc.asset_id, a.primary_symbol AS symbol, a.asset_class, pc.quantity FROM positions_current pc JOIN assets a ON a.id = pc.asset_id WHERE pc.quantity <> 0 [AND pc.account_id = $1] ORDER BY a.primary_symbol`. Map `asset_id`/`quantity` to `string`/`Decimal` per the repo's `int8`-as-string + `decimal.js` conventions.

**Tests:** returns only non-zero positions (a fully-sold position is excluded); `getAccountHoldings(id)` scopes to one account; `getAllHoldings()` returns every non-zero position; empty portfolio → `[]`. `getLastSnapshotConfirmation`: after two `snapshot_confirm` rows inserted a moment apart, returns the later `confirmedAt` and its `asOfDate`; returns `null` when none exist.

**Commit:** `feat: getAccountHoldings / getAllHoldings / getLastSnapshotConfirmation for the Dashboard and editor`

### Task 19: *(deferred — periodic reconciliation)*

A fuller evidence-based periodic-reconciliation workflow (broker figures entered beside Calboard's, computed Match/Difference, sign-off) is **not built this pass**. In the snapshot/mirror model, reconciliation *is* the `/holdings` editor (Tasks 24–25): the user compares Calboard to their real accounts and edits it to match. `recordAccountReconciliation` (`lib/accountReconciliation.ts`) stays in the codebase, untouched and unwired. Numbered slot retained; no files, no commit.

### Task 20: *(folded into Task 19's deferral)*

No files, no commit. Numbered slot retained so later cross-references stay stable.

### Task 21: *(dropped — spec Revision 3)*

No user-entered transaction stream ⇒ no duplicate-transaction warning. Do not create `lib/duplicateTransactionCheck.ts`. Numbered slot retained; no files, no commit.

### Task 22: *(dropped — spec Revision 3)*

No cash and no transaction entry ⇒ no cash-effect preview. Do not create `lib/transactionPreview.ts`. Numbered slot retained; no files, no commit.

### Task 23: *(dropped — spec Revision 3)*

`getAccountCashMap` existed only for the cash display and the cash-effect preview, both removed in V1. `getRecentTransactions` / an Activity list is deferred. Do not create `lib/accountCash.ts` or `lib/transactionHistory.ts`. `getPortfolioView` already exposes portfolio aggregates for the Dashboard; the `/holdings` editor pre-fills from `getAccountHoldings` (Task 18). Numbered slot retained; no files, no commit.

### Task 24: Update-Holdings Server Action + diff (`app/actions/holdings.ts`, `lib/holdingsUpdate.ts`)

**Files:** create `lib/holdingsUpdate.ts` (+ test), `app/actions/holdings.ts` (+ integration test).

**Interfaces:**
- `lib/holdingsUpdate.ts` — pure: `diffHoldings(current, desired)` where each side is `{ assetId: string; quantity: Decimal; avgCostUsd: Decimal }[]`. Returns `{ targets: { assetId: string; quantity: Decimal; avgCostUsd: Decimal }[] }` — **absolute desired target state**, one entry per holding whose **quantity OR average cost** differs from `current`. A holding absent from `desired` → a target with `quantity: 0` and `avgCostUsd` = its prior positive average cost (used only as the internal `priceUsd` placeholder). Unchanged quantity **and** avg cost → omitted. **No `quantityDelta`.** (The ADJUSTMENT primitive sets a position absolutely — `positions.ts` `applyAdjustment` ignores prior quantity/cost — so the diff emits targets, not deltas; verified in the feasibility check.)
- `app/actions/holdings.ts` — `updateHoldingsAction(input)`, `input = { asOfDate: string; holdings: { assetId: string; quantity: string; avgCostUsd: string }[] }`. **No cash field.**

**Contract:**
1. Validate at the action layer: `asOfDate` valid + `!isFutureDate`; each `quantity` parses and `>= 0`; each `avgCostUsd` parses and `> 0`. Structured per-field errors → `{ ok: false, errors }`. Never throw.
2. Read current stored state via `getAccountHoldings(<hidden account id>)` (Task 18); `diffHoldings(current, desired)`.
3. Open **one transaction** via the injected-`client` orchestration (same pattern as `setupAccount`). For each `target`, write **exactly one** `applyTransaction({ txnType: "ADJUSTMENT", accountId: <hidden>, assetId: target.assetId, tradeDate: asOfDate, quantity: target.quantity /* absolute; 0 for removal */, priceUsd: target.avgCostUsd /* the desired average cost; prior avg for a removal */, feesUsd: new Decimal(0), grossAmountUsd: new Decimal(0), note: "SNAPSHOT UPDATE: " + asOfDate }, client)`. **Do NOT pass a delta. Do NOT call `applyOpeningPositionAdjustment`** — it throws on any pre-existing non-zero position, forbids `quantity: 0`, and requires an `OPENING IMPORT:` note; it is wizard-only. A downward revision produces **no realised P&L** — `applyAdjustment` carries `realisedPlUsd` through unchanged; V1 is a mirror, not trade attribution.
4. **Always** — even when `targets` is empty (a zero-delta Save) — write one `audit_log` `snapshot_confirm` row on the same `client` (model rule 10): `INSERT INTO audit_log (table_name, row_id, action, actor, before, after) VALUES ('accounts', <hidden id>, 'snapshot_confirm', 'user', NULL, jsonb_build_object('as_of_date', $asOfDate))`. Then `COMMIT`.
5. On success: `revalidatePath("/")`, `revalidatePath("/holdings")`, `return { ok: true }`. On `SetupCommitUncertainError` (COMMIT ambiguous) → `{ ok: "unknown", message }`. On a definite failure → `{ ok: false, errors: { form: message } }` (whole transaction rolled back, including the `audit_log` row).

**Tests:** `diffHoldings` pure cases — no-op (empty `targets`); qty ↑ same avg; qty ↑ **and** avg change (one target with both new values); qty ↓ same avg; qty ↓ and avg change; avg-cost-only (target `quantity` = prior quantity); holding removed (`quantity: 0`, `avgCostUsd` = prior avg); holding added. Action: future `asOfDate` rejected, nothing written (no `audit_log` row); a qty increase writes **exactly one** `ADJUSTMENT` and `positions_current` becomes the exact target `{quantity, cost_basis = quantity×avg, avg_cost = avg}`; a qty+avg simultaneous change reaches the exact target in one row; an avg-cost-only edit writes one row and quantity is unchanged; a removal sets `positions_current.quantity = 0` (row filtered out of reads); **every successful Save — including a zero-delta Save — writes exactly one `audit_log` `snapshot_confirm` row** whose `after->>'as_of_date'` matches and whose `at` is fresh; entered values echoed back on a validation failure.

**Commit:** `feat: updateHoldingsAction + diffHoldings — absolute-target ADJUSTMENT writes + snapshot-confirm row`

### Task 25: `/holdings` — the pre-filled editor (final visible slice)

**Files:** modify `app/holdings/page.tsx`; create `app/holdings/HoldingsEditor.tsx` (+ jsdom component test).

**Interfaces:** consumes `getAllHoldings` (Task 18), `getPortfolioView` (`lib/portfolio.ts`, for price/market-value/price-health per row), `updateHoldingsAction` (Task 24), `resolveTickerAction` (Task 9), `localTodayIso` (Task 2), `NavBar` (Task 3). Reuse the wizard's holding-row sub-UI (extract a shared component from `SetupWizard.tsx` if practical).

**Contract — `/holdings` IS the editor; there is no read-only recap table before it:**
- Server component reads current holdings + per-row price/market-value/unrealized-P&L; passes them as `initial` to `<HoldingsEditor initial={…} />`. Zero holdings → the Task 4 empty-state CTA (launches the wizard).
- `HoldingsEditor` (`"use client"`): every current holding is an editable row pre-filled with quantity and average cost (symbol/asset shown read-only; identity from `positions_current`). Add-a-holding row reuses Step 1's `resolveTickerAction` + the same resolved-ticker staleness guard as Task 13. Remove-a-holding sets the row's target quantity to 0.
- **As-of date:** not prominent — a line reading "As of <today>" with a small **"Change date"** toggle revealing a date input (defaults to `localTodayIso()`; future rejected client-side and in the action). Never labelled "trade date" / "effective date".
- **Non-blocking avg-cost note:** when a row's quantity is edited upward while its average cost is left unchanged, show beside that row: "Your existing average cost is $X. Update it if your real average cost changed." It never blocks Save.
- One **Save** button → `updateHoldingsAction({ asOfDate, holdings })`. Disabled while in flight. `try/catch/finally`: `finally` clears the pending flag; a rejected call shows honest "couldn't reach the server — we don't know whether it saved" copy (no blind-retry invite). `{ ok: false, errors }` → inline field errors with every entered value preserved (controlled inputs; never a throwing `<form action>`). `{ ok: true }` → "Holdings updated" and the rows reflect the saved state.
- **No** cash field, **no** cash-effect preview, **no** duplicate warning, **no** Buy/Sell/Deposit/Withdrawal, **no** `router.refresh`-for-cash machinery.

**Tests (jsdom):** a rejected-submit shows the field error and keeps the entered quantity; Save is disabled while the request is in flight and fires once; a quantity increased with unchanged avg cost renders the non-blocking note; the add-a-holding path blocks Add when the ticker was edited after resolution without re-resolving; a rejected action call surfaces the "couldn't reach the server" copy and re-enables Save.

**Manual UX check:** with a portfolio from the wizard walkthrough, open `/holdings`; edit AAPL's quantity up, Save; `/` shows the new quantity, market value, unrealized P&L, and an updated "Holdings last updated". Add a resolvable ticker; remove a holding; confirm each is reflected after Save.

**Commit:** `feat: /holdings pre-filled editor — snapshot edits, ticker-resolution (staleness-guarded), non-blocking avg-cost note, honest rejection handling`

### Task 26: Remove the superseded monolith and run the full end-to-end regression

**Files:**
- Delete: `app/actions.ts`
- No other file changes — this task is verification + cleanup.

**Interfaces:**
- Consumes: everything built in Tasks 1–25.

- [ ] **Step 1: Confirm nothing still imports the old `app/actions.ts`**

Run:
```bash
grep -rn "from \"./actions\"" app/ ; grep -rn "from '@/app/actions'" app/ ; grep -rln "app/actions\"" app/
```
Expected: no matches — Task 3 replaced `app/page.tsx`'s only prior use of it, and every new page uses `app/actions/*.ts` instead.

- [ ] **Step 2: Delete the old file**

```bash
rm app/actions.ts
```

- [ ] **Step 3: Full end-to-end manual regression** (routes `/` and `/holdings` only)

With `npm run dev` and the portfolio from the wizard walkthrough:

1. **Dashboard** (`/`): Portfolio Value, the unpriced-holding disclosure, price-health cells, the unrealized gain/loss ($ and %) column, and "Holdings last updated" all correct. No cash figure, no "by source" list.
2. **Holdings** (`/holdings`): the pre-filled editor lists every current holding as an editable row (no recap table).
3. In the editor: increase a holding's quantity without touching its avg cost → the non-blocking "update it if your real average cost changed" note appears; Save; `/` reflects the new quantity, market value, unrealized P&L, and an updated "Holdings last updated".
4. In the editor: add a resolvable ticker and remove a holding; Save; confirm both on `/`.
5. Re-run the 2-step wizard once (fresh DB) to confirm nothing in Tasks 16–25 regressed it.

- [ ] **Step 4: Run the full automated suite and type-check**

Run: `npm test`
Expected: PASS — the full suite, combining every `lib/**/*.test.ts`, `app/actions/**/*.test.ts` (node environment, real DB) and every `*.test.tsx` component test (jsdom) introduced by this plan, plus all pre-existing tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

Stage explicitly by path and inspect what's staged before committing — no `git add -A`, consistent with this repo's existing `.env.local` secret-safety discipline:

```bash
git status
git rm app/actions.ts
git status
```

Confirm the `git status` output shows exactly `deleted: app/actions.ts` and nothing else unexpected (in particular, confirm `.env.local` never appears) before committing:

```bash
git commit -m "chore: remove superseded app/actions.ts now that all pages use app/actions/*"
```

**Functional acceptance check:** `npm test` PASS in full; `npx tsc --noEmit` clean.
**UX acceptance check:** see Step 3 above — full golden-path regression across every screen.

---

## Self-review against the spec and constraints

*(Rewritten for spec Revision 3 (final). The "## Product-scope correction" section near the top is the authoritative task-disposition map; this is the spec-coverage cross-check.)*

**Spec coverage (`docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` Revision 3):**

| Spec § | Task(s) |
|---|---|
| §2 IA — nav `Dashboard \| Holdings`, routes, empty states | 3, 4 |
| §3.1 Disposable draft state | 10, 13, 15 |
| §3.2 Atomic first write (positions only, `SetupCommitUncertainError`) | 6, 7, 14 |
| §3.3 Plain Review & Save (no read-back verification) | 14, 15 |
| §4 Step 1 — as-of date (not prominent) + holdings + cost-basis mode | 10, 11, 13; resolver: 9 |
| §4 Step 2 — plain Review & Save + Complete | 14, 15 |
| §5 Dashboard (Portfolio Value, "Holdings last updated"), `/holdings` = the editor | 3, 17 (dashboard); 4, 18, 24, 25 (editor) |
| §6 Holdings entry — positive numbers, resolution, no cash/preview | 9, 13, 25 |
| §7 Reconciliation == the `/holdings` editor; periodic workflow deferred | 25; 19–20 (deferred) |
| §8 Price / data-health states + Portfolio-Value disclosure | 16, 17 |
| §9.1 Performance scope — market value, unrealized G/L vs cost basis, day move | 16, 17 |
| §9.2 Validation/read placement (future-date at action layer; diff→`ADJUSTMENT`; small reads) | 2, 14, 18, 24 |
| §10 Settled — do not reopen | Global Constraints |

**Key tests (by requirement):**

| Requirement | Task | Test file |
|---|---|---|
| Disposable pre-save wizard draft | 10 | `app/accounts/new/SetupWizard.test.tsx` |
| As-of date not-future validation (client + action) | 2, 10, 14 | `lib/dateValidation.test.ts`, `SetupWizard.test.tsx`, `app/actions/setup.test.ts` |
| Atomic rollback on a later-holding failure | 7, 14 | `lib/ledger/setupAccount.test.ts`, `app/actions/setup.test.ts` |
| `save_unknown` vs `save_failed` (uncertain commit / call rejection) | 7, 14, 15 | `setupAccount.test.ts`, `app/actions/setup.test.ts`, `SetupWizard.test.tsx` |
| `>10dp` quantity round-trips (normalized once, unsurfaced) | 14 | `app/actions/setup.test.ts` |
| Cost-basis mode chosen once + locked after first holding | 11, 13 | `lib/wizard/draftHoldings.test.ts`, `SetupWizard.test.tsx` |
| Duplicate-ticker block in draft (combined row per asset) | 11, 13 | `draftHoldings.test.ts`, `SetupWizard.test.tsx` |
| Resolved-ticker staleness guard (resolve A → edit to B → Add blocked) | 13, 25 | `SetupWizard.test.tsx`, `HoldingsEditor.test.tsx` |
| Missing / stale / fetch-failure price display + Portfolio-Value disclosure | 16, 17 | `lib/portfolio.test.ts` |
| `diffHoldings` absolute targets → one `ADJUSTMENT` per changed holding; zero-delta Save still writes one `audit_log` snapshot-confirm row; future-date rejected | 24 | `lib/holdingsUpdate.test.ts`, `app/actions/holdings.test.ts` |
| Inline validation with entered values preserved; double-submit prevention; honest rejected-call copy | 15, 25 | `SetupWizard.test.tsx`, `HoldingsEditor.test.tsx` |
| Qty-up / avg-cost-unchanged non-blocking note | 25 | `HoldingsEditor.test.tsx` |
| Local-timezone `isFutureDate`/`localTodayIso` | 2 | `lib/dateValidation.test.ts` |

**Constraint check:** no task modifies `migrations/*.sql`, `lib/ledger/cashEffect.ts`, `lib/ledger/positions.ts`, or the append-only trigger. Every reused function (`createAccount`, `applyTransaction`, `applyOpeningPositionAdjustment`, `upsertLatestPrice`, `resolveOrCreateAsset`) is behaviour-unchanged when called without the optional `client` param (Task 6 regression tests). `recordAccountReconciliation` is untouched and unwired (Tasks 19–20 deferred). No user-facing cash, source/account, or transaction entry; no M2+ feature; no schema change. `SetupCommitUncertainError` is a new error class, not persisted state.

---

## Execution

This plan has **not** been executed — no code has been written or modified. Per this session's instructions, it's presented here for review only.

Once reviewed, the two standard execution paths are:

1. **Subagent-Driven (recommended)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. A fresh subagent per task, with review between tasks.
2. **Inline Execution** — REQUIRED SUB-SKILL: `superpowers:executing-plans`. Batch execution in this session with checkpoints.

---

## UI-pass extension — Task 31 (Command Center authorized)

*Tasks 27–30 (allocation chart, shared visual foundation, status feedback & accessibility,
responsive Holdings editor) were authorized via Command Center after this plan's original Task 1–26
scope and are recorded in git history (`6b88da3`, `cabef2f`, `cd3062c`, `e23ef93`, `6fbe6ff`,
`5584997`). Task 31 is likewise Command-Center authorized; its contract is recorded here so the
repository carries it. No Task 32 content is defined.*

### Task 31 — Dashboard hierarchy and allocation layout

**Goal:** make the existing Dashboard (`/`, `app/page.tsx`) easier to scan and responsive at
desktop and narrow widths **without adding new information or functionality**. Presentation-layer
only.

**Desktop reading order (≥ 641px):** (1) Portfolio summary + health/freshness, (2) Allocation,
(3) Holdings detail. Portfolio Value remains the strongest visual element; price health and
holdings freshness stay visible but visually secondary. The Holdings detail remains a native
desktop `<table>` with its `<thead>`.

**Narrow reading order (≤ 640px):** (1) Portfolio summary, (2) health / freshness, (3) Allocation
and legend, (4) responsive Holdings presentation. Same information, same components/markup — no
separate mobile Dashboard, no duplicated data markup, no different mobile information architecture.

**Holdings table responsiveness:** above 640px the Dashboard Holdings detail stays a native
`<table>`. At ≤ 640px each holding restacks into a readable block using the **existing Task 30
single-DOM mechanism** — wrap the table in `.editor-table` and give each `<td>` a real-text
`<span class="cell-label">` field label. This resolves the previously-known Dashboard page-level
horizontal overflow at narrow mobile widths (explicitly in scope for Task 31). It must not be
solved by whole-page horizontal scroll, a second mobile Dashboard, a duplicate table, or by hiding
any financial value.

**Allocation section:** the existing priced donut + legend remain; layout/hierarchy only. Donut and
legend form one coherent, visually balanced section. Allocation percentage and USD market value
stay visible; the text legend stays sufficient to understand allocation without colour; the
excluded-unpriced-holdings disclosure and the allocation-unavailable state stay clear. No
allocation calculation change, no new allocation dimension, no sector/historical allocation, no
interactions/filters/drill-downs.

**Accessibility:** native desktop table headers + semantics preserved; real-text (not CSS
`::before`) field context for responsive holdings values, reusing the Task 30 `.cell-label`
pattern; logical DOM + keyboard order; visible keyboard focus; state (current/stale/unavailable/
error) and allocation comprehension never depend on colour alone; chart values available through
the text legend. No redundant ARIA where native/real-text semantics already provide context.

**Preserved unchanged:** every calculation; every displayed value and rounding rule; current /
stale / unavailable price presentation; `PriceCell` Retry behaviour, its disabled/loading state,
its error handling, and its Task 29 `role="alert"` retry-error semantics; the
excluded-unpriced-holdings disclosure; all Task 30 Holdings-editor behaviour and tests.

**Out of scope:** new widgets / whitespace-filling content / performance or historical charts /
daily-change calculations / sector allocation / filters / new interactions / new metrics /
calculation, persistence, database or price-fetch-architecture changes / automatic price refreshing
/ watchlists / news / AI / setup-wizard changes / Task 32 / unjustified dependencies / push /
merge / deploy. Do not add information merely because visual space is available. Do not refactor
Task 30's Holdings editor to share code — reuse the CSS mechanism as-is.

**Breakpoint:** the project's existing `@media (max-width: 640px)` (Task 28). No new breakpoint.

**Browser acceptance widths:** 1280px, 640px, 375px. At 375px
`document.documentElement.scrollWidth <= document.documentElement.clientWidth` must hold (no
page-level horizontal overflow), including with long ticker / long value content.
