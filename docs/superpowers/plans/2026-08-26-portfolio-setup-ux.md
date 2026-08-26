# Portfolio Setup UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single debug-style page (`app/page.tsx`, `app/actions.ts`) with the four-screen structure from the spec — a persistent-nav Dashboard/Accounts/Transactions app plus a client-side-draft account setup wizard — backed by an atomic setup commit, an automatic read-back verification, and honest price/data-health states, without touching the M1 accounting model, ledger rules, or schema.

**Architecture:** Next.js 15 App Router, React 18.3 (no `useFormState`/`useActionState` at this React version — every new form is a `"use client"` component holding controlled state that calls a Server Action directly as an async function and renders the returned structured result, never `<form action={...}>` with a throwing action). Server Actions live under `app/actions/`, grouped by page. Pure, framework-free logic (cost-basis conversion, duplicate-ticker-in-draft check, cash-preview formulas, future-date check) is extracted into `lib/` and unit-tested there — not embedded untested inside client components. Money/quantity stays `Decimal` end-to-end in server code and pure `lib/` functions; values crossing the server→client boundary are serialized to plain strings first. Calendar-date "today" (Portfolio-as-of, transaction trade date) is computed from **local** system time consistently on both client and server via one shared `localTodayIso`/`isFutureDate` pair in `lib/dateValidation.ts` — never `toISOString()`'s UTC slice, which can reject a legitimately-today date as future whenever the local timezone is ahead of UTC. Every write action that can fail *after* a real commit (`setupAccountAction`'s post-commit read-back verification) reports a three-way outcome — commit failed (nothing saved), commit succeeded and verified, or commit succeeded but verification itself errored — never collapsing the last two into "nothing was saved."

**Slicing principle (per explicit instruction this session):** tasks are ordered so a real, growing UI is visible in the browser from very early on, instead of building all backend logic first and all UI last. Each UI-facing task ends with a manual "UX acceptance check" against a running `npm run dev`. Every task that has one also lists a "Functional acceptance check" — the automated tests that must pass. Where a task's automated tests require rendering a React component and observing interactive behaviour (draft-state disposal on Cancel, inline-error value preservation, double-submit prevention), it uses a new Vitest+jsdom+Testing-Library component-test setup (Task 1) — everything else follows the existing repo convention of Vitest integration tests against the real local Postgres.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, PostgreSQL 16 (local Docker), `pg`, `decimal.js`, Vitest. New devDependencies (Task 1 only): `@testing-library/react`, `@testing-library/jest-dom`, `@types/react-dom`, `jsdom`.

**Spec:** `docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md` (revision 2, approved; committed as `fec7b33` — the commit hash given in the request, `fce7b33`, doesn't exist in this repo; `fec7b33` is the actual "docs: revise portfolio setup UX spec per independent critique" commit and its content matches what this plan implements). Section references (§N) below refer to this document. Also read for context: `docs/spec/01-PRD-v1.2.md`, `docs/spec/02-TRD-v1.2.md`, `docs/spec/03-TDD-v1.2.md` (the approved v1.2 accounting model this plan must not reopen).

## Global Constraints

Carried directly from this session's explicit instructions and the spec's §10 "Settled — do not reopen":

- Preserve the tested M1 accounting model: USD-only, `NUMERIC(28,10)` in Postgres, `decimal.js` in application code, append-only `transactions`, average-cost-only, derived cash, account-level position grain.
- Preserve append-only ledger behaviour — no code path in this plan issues `UPDATE`/`DELETE` against `transactions`.
- Preserve average-cost accounting — no lot tracking, no FIFO, no per-holding cost-basis-mode mixing.
- No schema redesign — no new tables/columns/constraints anywhere in this plan.
- No M2/M3/M4 expansion (attention queue, SGD display, news, AI, watchlist, concentration panel).
- No final visual-branding/polish exercise.
- No reversal/correction UI in this pass.
- No full periodic-reconciliation system in this pass. Per this session's narrow-correction-pass review, the Reconcile link/page (originally Tasks 19–20) is **deferred entirely** rather than shipped as a cash-only page under a "Reconcile" label — the approved §7.2 design implies a fuller broker-statement comparison than `recordAccountReconciliation` (unchanged) actually supports. See Tasks 19–20.
- No new provider capability solely for company-name lookup — ticker resolution reuses the existing `upsertLatestPrice`/`MarketDataProvider.fetchLatestEod` call, invoked earlier (at draft-entry time) than it is today.
- Reuse existing tested functions where possible: `createAccount`, `applyTransaction`, `applyOpeningCashAdjustment`, `applyOpeningPositionAdjustment`, `upsertLatestPrice`, `resolveOrCreateAsset` are all reused, not reimplemented. `recordAccountReconciliation` remains untouched and tested but isn't wired into any UI in this pass — see Tasks 19–20's deferral note.
- Atomic account + opening import must remain all-or-nothing — one Postgres transaction across account creation, the opening-cash adjustment, and every opening-position adjustment (Task 7).
- "No future date" validation lives at the app/action layer (`lib/dateValidation.ts`'s `isFutureDate`, called from `app/actions/*.ts`), never inside `lib/ledger/openingImport.ts` or `lib/ledger/applyTransaction.ts` — those functions' own tested validation is untouched.
- Calendar-date "today" (for `isFutureDate` and every date-input default) is the **local system calendar day** — `now.getFullYear()/getMonth()/getDate()`, never `now.getUTCFullYear()`/`toISOString().slice(0,10)`. This app is single-user and localhost-only, so the server process and the browser share one machine's timezone; UTC "today" can lag the real local day by up to a full day whenever the local offset is positive, which would wrongly reject a legitimately-today date as future for part of every day. `lib/dateValidation.ts` exports one shared `localTodayIso()` helper used by `isFutureDate` and by every client-side date default (the wizard, the Transactions form) — no second, divergent "today" implementation anywhere.
- Postgres `DATE` values read back by any new read helper are normalized through `lib/dateValidation.ts`'s `normalizePgDate` (handles both the raw string `lib/db.ts`'s global type-parser override already returns, and a `Date` object defensively) — never `String(value)`, which only happens to work today by relying on that global override and would silently produce a garbage, non-`YYYY-MM-DD` string if that override were ever changed.
- `setupAccountAction`'s result is a 3-way discriminated union (`status: "save_failed" | "saved_verified" | "saved_verification_error"`), not a boolean `ok`. `setupAccount()`'s commit and the subsequent `verifySetup()` read-back are wrapped in **separate** `try/catch` blocks: a failure in the first means nothing was saved; a failure in the second means the account **was** saved but Calboard couldn't confirm it, and the UI must say so explicitly — it must never reuse "Nothing was saved" copy for a post-commit failure.
- All BIGINT ids (`asset_id`, transaction `id`) are handled as `string` throughout, per the existing `lib/db.ts` `int8`-as-string convention already used in `lib/assets.ts` and `lib/ledger/applyTransaction.ts`. `lib/portfolio.ts`'s pre-existing `assetId: number` on `PositionView` is a latent inconsistency with that convention, corrected in Task 16 while that interface is touched anyway.
- Stale-price threshold (Task 16): **5 days**, measured against the price's own `price_date`, not `retrieved_at` — a display-only judgment call tolerating a normal weekend/holiday gap.
- Duplicate-transaction date window (Task 21): **±3 days** of the entered trade date — a display-only judgment call.
- Test isolation: every DB-backed Vitest test file follows the existing `TRUNCATE ... RESTART IDENTITY CASCADE` `beforeEach` pattern (`vitest.config.ts` already sets `fileParallelism: false` for exactly this reason). No automated test makes a live call to a market-data provider — tests that exercise `resolveTickerAction`/`upsertLatestPrice` pre-seed a fresh `prices_daily` row so the existing freshness-cache short-circuit (`isPriceCacheFresh`) is hit instead of the network, matching the existing repo convention (`lib/marketdata/index.test.ts` only tests the pure cache-freshness helper, never a live fetch).
- Task 26's cleanup commit stages files explicitly by path and inspects `git status` first — no `git add -A`, consistent with this repo's existing secret-safety discipline around `.env.local`.

## File structure

**`lib/` (Vitest, real-DB or pure — node environment):**
- `lib/dateValidation.ts` — *modify*: add `localTodayIso`, `isFutureDate` (local-timezone based), `normalizePgDate`.
- `lib/wizard/draftHoldings.ts` — *new*, pure: `computeAvgCostUsd`, `isDuplicateTickerInDraft`.
- `lib/transactionPreview.ts` — *new*, pure: `computeCashPreview`.
- `lib/accounts.ts` — *modify*: `createAccount` gains an optional injected `client`.
- `lib/ledger/applyTransaction.ts` — *modify*: `applyTransaction` gains an optional injected `client`.
- `lib/ledger/openingImport.ts` — *modify*: both functions gain an optional injected `client`.
- `lib/ledger/setupAccount.ts` — *new*: atomic account-setup orchestrator (spec §3.2), plus the `SetupCommitUncertainError` error class for a genuinely ambiguous COMMIT outcome (this session's final-review correction).
- `lib/ledger/verifySetup.ts` — *new*: read-back verification (spec §3.3).
- `lib/portfolio.ts` — *modify*: price-status classification + total-exclusion disclosure (spec §8).
- `lib/holdings.ts` — *new*: `getAccountHoldings` for the Sell picker (spec §6). (Reconcile-page reuse deferred — Tasks 19–20.)
- `lib/duplicateTransactionCheck.ts` — *new*: `findLikelyDuplicateTransaction` (spec §7.1).
- `lib/accountCash.ts` — *new*: `getAccountCashMap`.
- `lib/transactionHistory.ts` — *new*: `getRecentTransactions`.

**`app/actions/` (Vitest, real DB, node environment — Server Actions are plain async functions and get the same integration-test treatment as `lib/`):**
- `app/actions/setup.ts` — *new*: `resolveTickerAction`, `checkAccountNameAction` (Task 9), then `setupAccountAction` (Task 14).
- `app/actions/transactions.ts` — *new*: `submitTransactionAction`, `getAccountHoldingsAction` (Task 24).
- `app/actions/prices.ts` — *new*: `retryPriceFetchAction` (Task 17).

**`app/` pages/components (Vitest+jsdom+Testing-Library component tests only for the specific interactive behaviours listed in the request; otherwise manual UX acceptance checks):**
- `app/components/NavBar.tsx` — persistent nav + shared button-link style (Task 3).
- `app/components/PriceCell.tsx` — price/data-health cell with retry affordance (Task 17).
- `app/page.tsx` — Dashboard (Task 3: empty state + read-only shell; Task 17: price-health upgrade).
- `app/accounts/page.tsx` — Accounts list (Task 4: empty state). Populated-state "Reconcile" link deferred — Tasks 19–20.
- `app/accounts/new/page.tsx` + `SetupWizard.tsx` — the wizard, built step-by-step (Tasks 10, 12, 13, 15).
- `app/transactions/page.tsx` + `TransactionForm.tsx` — Task 5 (empty state), Task 25 (full form).
- `app/actions.ts` — *deleted* in Task 26 once superseded.

## Task order at a glance (visual-inspection-first)

1. Component-testing infra · 2. `isFutureDate`/`localTodayIso`/`normalizePgDate` · 3. Dashboard shell (empty, dynamic) · 4. Accounts shell (empty, dynamic) · 5. Transactions shell (empty, dynamic) · 6. injected-`client` param · 7. `setupAccount` + rollback test + uncertain-commit/rollback-masking hardening · 8. `verifySetup` (+ account-row/opening-date checks) · 9. `resolveTickerAction`/`checkAccountNameAction` · **10. Wizard Step 1 (visible)** · 11. cost-basis/duplicate-ticker pure fns · **12. Wizard Step 2 + opening-cash validation (visible)** · **13. Wizard Step 3 + cost-basis-mode lock + ticker-staleness guard (visible)** · 14. `setupAccountAction` (4-way outcome, pre-verify revalidation, quantity-precision normalization) · **15. Wizard Step 4 + save + verify + render-safety + rejection/uncertain-outcome handling (visible, wizard fully functional)** · 16. price-status classification · **17. Dashboard price-health upgrade (visible)** · 18. `getAccountHoldings` (Sell picker) · 19–20. *deferred — Reconcile link/page not built this pass* · 21. duplicate-transaction check · 22. cash-preview pure fn · 23. cash-map/history reads · 24. `submitTransactionAction` (strictly-positive price) · **25. Transactions full form + cash refresh, ticker-staleness guard, rejection handling, holdings race guard (visible)** · 26. cleanup + full regression.

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
- Produces: `localTodayIso(now?: Date): string`, `isFutureDate(dateStr: string, now?: Date): boolean`, `normalizePgDate(value: string | Date): string`. `isFutureDate` is consumed by `app/actions/setup.ts` (Task 14) and `app/actions/transactions.ts` (Task 24) for "Portfolio as of" and transaction trade-date validation respectively (spec §9, §11 point 2). `localTodayIso` is consumed by both of those call sites' local-timezone semantics AND by the client-side date defaults in `SetupWizard.tsx` (Tasks 10, 15) and `TransactionForm.tsx` (Task 25) — one shared definition of "today" on both sides. `normalizePgDate` is consumed by Task 8's `verifySetup`, Task 21's `findLikelyDuplicateTransaction`, and Task 23's `getRecentTransactions`.

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
// default in SetupWizard.tsx / TransactionForm.tsx import this directly,
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

**Files:**
- Create: `app/components/NavBar.tsx`
- Rewrite: `app/page.tsx`

**Interfaces:**
- Produces: `NavBar` component, `buttonLinkStyle` shared style constant (reused by Tasks 4 and 5's empty states).
- Consumes: `listAccounts` (`lib/accounts.ts`), `getPortfolioView` (`lib/portfolio.ts`, unmodified until Task 16 — this task's populated-state branch renders the *original* columns, no price-health cell yet).

Per spec §5, the populated Dashboard has **no entry forms** — this task removes the old inline add-account/add-transaction/opening-import forms from `app/page.tsx` entirely (they're superseded by the wizard, Task 15, and the Transactions page, Task 25). `app/actions.ts` becomes unused by this page from this task onward, though the file itself isn't deleted until Task 26.

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
      <Link href="/transactions">Transactions</Link>
      <Link href="/accounts">Accounts</Link>
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
            <p>No accounts yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your first account</Link>
          </section>
        ) : (
          <>
            <section>
              <h2>Portfolio value</h2>
              <p style={{ fontSize: "1.5rem" }}>US${portfolio.totalPortfolioValueUsd.toFixed(2)}</p>
              <p>
                Cash: US${portfolio.totalCashUsd.toFixed(2)} &middot; Holdings: US$
                {portfolio.totalMarketValueUsd.toFixed(2)}
              </p>
            </section>

            <section>
              <h2>Holdings</h2>
              <table border={1} cellPadding={6}>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Account</th><th>Qty</th><th>Avg cost</th>
                    <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((p) => (
                    <tr key={`${p.accountId}-${p.assetId}`}>
                      <td>{p.symbol}</td>
                      <td>{p.accountName}</td>
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

            <section>
              <h2>Accounts</h2>
              <ul>
                {accounts.map((a) => (
                  <li key={a.id}>{a.name}{a.custodian ? ` (${a.custodian})` : ""}</li>
                ))}
              </ul>
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

**UX acceptance check:** NavBar shows Dashboard/Transactions/Accounts links. With zero accounts in the dev DB (true at this point in the plan), the page shows `<h1>Dashboard</h1>`, "No accounts yet.", and an "Add your first account" button-styled link to `/accounts/new` (this route 404s until Task 10 — expected at this point). No add-account/add-transaction/opening-import forms are present anywhere on the page.

- [ ] **Step 4: Commit**

```bash
git add app/components/NavBar.tsx app/page.tsx
git commit -m "feat: persistent nav and Dashboard empty-state shell (no entry forms per spec 5)"
```

**Functional acceptance check:** none (no new lib/ logic in this task).

---

### Task 4: Accounts page shell (empty state)

**Files:**
- Create: `app/accounts/page.tsx`

**Interfaces:**
- Consumes: `listAccounts` (`lib/accounts.ts`), `NavBar`/`buttonLinkStyle` (Task 3).

- [ ] **Step 1: Write `app/accounts/page.tsx`**

```tsx
import Link from "next/link";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { listAccounts } from "@/lib/accounts";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Accounts</h1>
        {accounts.length === 0 ? (
          <>
            <p>No accounts yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your first account</Link>
          </>
        ) : (
          <>
            <ul>
              {accounts.map((a) => (
                <li key={a.id} style={{ marginBottom: "0.5rem" }}>
                  {a.name}{a.custodian ? ` (${a.custodian})` : ""}
                </li>
              ))}
            </ul>
            <Link href="/accounts/new" style={buttonLinkStyle}>+ Add account</Link>
          </>
        )}
      </main>
    </>
  );
}
```

A per-account "Reconcile" link was originally planned for Task 19, but Tasks 19–20 are now deferred in full (see those tasks' notes) — this page stays exactly as written here for the remainder of this plan.

- [ ] **Step 2: Manual verification**

**UX acceptance check:** with the dev server running, open `http://localhost:3000/accounts`. Expected: NavBar, "No accounts yet.", "Add your first account" link.

- [ ] **Step 3: Commit**

```bash
git add app/accounts/page.tsx
git commit -m "feat: Accounts page empty-state shell"
```

---

### Task 5: Transactions page shell (empty state)

**Files:**
- Create: `app/transactions/page.tsx`

**Interfaces:**
- Consumes: `listAccounts` (`lib/accounts.ts`), `NavBar`/`buttonLinkStyle` (Task 3).

- [ ] **Step 1: Write `app/transactions/page.tsx`**

```tsx
import Link from "next/link";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { listAccounts } from "@/lib/accounts";

// Always render dynamically — see app/page.tsx (Task 3) for why. Carried
// forward when Task 25 replaces this file's contents in full.
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const accounts = await listAccounts();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Transactions</h1>
        {accounts.length === 0 && (
          <>
            <p>You need an account before you can add transactions.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>+ Add account</Link>
          </>
        )}
      </main>
    </>
  );
}
```

The real form (Task 25) replaces the `accounts.length === 0` branch's sibling content once `getAccountCashMap`/`getRecentTransactions`/`submitTransactionAction` exist.

- [ ] **Step 2: Manual verification**

**UX acceptance check:** open `http://localhost:3000/transactions`. Expected: NavBar, "You need an account before you can add transactions.", "+ Add account" link. No form.

- [ ] **Step 3: Commit**

```bash
git add app/transactions/page.tsx
git commit -m "feat: Transactions page empty-state shell"
```

---

### Task 6: Optional injected `client` param on the ledger write primitives

**Files:**
- Modify: `lib/accounts.ts`, `lib/ledger/applyTransaction.ts`, `lib/ledger/openingImport.ts`
- Test: `lib/ledger/applyTransaction.test.ts` (append)

**Interfaces:**
- Produces: `createAccount(name, custodian, client?: PoolClient)`, `applyTransaction(input, client?: PoolClient)`, `applyOpeningCashAdjustment(input, client?: PoolClient)`, `applyOpeningPositionAdjustment(input, client?: PoolClient)`. Task 7's `setupAccount` composes all four inside one transaction — this is the mechanism behind "atomic account + opening import must remain all-or-nothing."

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

**Files:**
- Create: `lib/ledger/setupAccount.ts`
- Test: `lib/ledger/setupAccount.test.ts`

**Interfaces:**
- Consumes: `createAccount`, `applyOpeningCashAdjustment`, `applyOpeningPositionAdjustment` (Task 6).
- Produces: `SetupHoldingInput { assetId: string; quantity: Decimal; avgCostUsd: Decimal }`, `SetupAccountInput { name, custodian, portfolioAsOfDate, openingCashUsd: Decimal, holdings: SetupHoldingInput[] }`, `SetupAccountResult { accountId: number; openingCashTransactionId: string | null; holdingTransactionIds: string[] }`, `setupAccount(input): Promise<SetupAccountResult>`, `SetupCommitUncertainError` (thrown instead of a normal error when the COMMIT itself fails in a way that leaves the write outcome ambiguous). Consumed by Task 8's `verifySetup` test and Task 14's `setupAccountAction` (which maps `SetupCommitUncertainError` to a distinct `status: "save_unknown"`, never `"save_failed"`).

Per this session's final-review correction, `setupAccount` also hardens two failure paths beyond the happy-path/pre-COMMIT-failure cases already covered by the rollback test below:
- **A failing ROLLBACK must never mask the original error.** If `client.query("BEGIN")` or any statement before `COMMIT` throws, that error is what actually explains why nothing was saved — a `ROLLBACK` is still attempted (to release locks / abort the aborted transaction cleanly), but if `ROLLBACK` itself also throws, that secondary failure is attached as diagnostic detail rather than replacing the original thrown error.
- **A failure of `COMMIT` itself is fundamentally different from every earlier failure.** Every failure before `COMMIT` is issued means Postgres never received a commit instruction — `ROLLBACK` is safe and the account definitely wasn't saved. But if the `COMMIT` command itself throws (e.g. the connection drops between sending it and receiving Postgres's acknowledgement), Postgres's actual server-side outcome is unknown — it may have applied the commit before the failure. Issuing a `ROLLBACK` in that state is meaningless (there may be nothing left to roll back) and could itself throw without telling us anything new, so none is attempted; instead this case throws the distinct `SetupCommitUncertainError`, which Task 14 maps to its own honest `"save_unknown"` outcome rather than a false "nothing was saved" claim. Per this session's explicit instruction: this outcome must **never** be inferred by checking whether an account of the given name now exists — duplicate account names are intentionally allowed, so a name match proves nothing about whether *this* attempt is the one that succeeded.

- [ ] **Step 1: Write the failing test**

Create `lib/ledger/setupAccount.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { setupAccount, SetupCommitUncertainError } from "./setupAccount";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("setupAccount", () => {
  it("atomically creates the account, opening cash, and every holding", async () => {
    const assetA = await resolveOrCreateAsset("SETA", "equity", "Setup A Corp");
    const assetB = await resolveOrCreateAsset("SETB", "etf", "Setup B ETF");

    const result = await setupAccount({
      name: "Full Setup Brokerage",
      custodian: "IBKR",
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(5000),
      holdings: [
        { assetId: assetA.id, quantity: new Decimal(10), avgCostUsd: new Decimal(180) },
        { assetId: assetB.id, quantity: new Decimal(5), avgCostUsd: new Decimal(400) },
      ],
    });

    expect(result.holdingTransactionIds).toHaveLength(2);
    expect(result.openingCashTransactionId).not.toBeNull();

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [result.accountId]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("5000.00");

    const posRows = await pool.query(
      `SELECT asset_id, quantity, avg_cost_usd FROM positions_current WHERE account_id = $1 ORDER BY asset_id`,
      [result.accountId]
    );
    expect(posRows.rows).toHaveLength(2);
  });

  it("records no opening-cash transaction when openingCashUsd is zero (no-op)", async () => {
    const result = await setupAccount({
      name: "Cash Only Skip",
      custodian: null,
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(0),
      holdings: [],
    });
    expect(result.openingCashTransactionId).toBeNull();

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [result.accountId]);
    expect(cashRow.rows).toHaveLength(0);
  });

  it("allows a cash-only account (zero holdings)", async () => {
    const result = await setupAccount({
      name: "Cash Only Brokerage",
      custodian: null,
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(1000),
      holdings: [],
    });
    expect(result.holdingTransactionIds).toHaveLength(0);
  });

  it("rolls back the entire setup when a later holding fails — the 3rd of 3 (AC: no account row, no cash row, no earlier holdings rows remain)", async () => {
    const assetA = await resolveOrCreateAsset("DUPX", "equity", "Dup Test Corp");
    const assetB = await resolveOrCreateAsset("OKAY", "equity", "Okay Corp");

    await expect(
      setupAccount({
        name: "Rollback Test Brokerage",
        custodian: null,
        portfolioAsOfDate: "2026-01-01",
        openingCashUsd: new Decimal(1000),
        holdings: [
          { assetId: assetA.id, quantity: new Decimal(10), avgCostUsd: new Decimal(5) },
          { assetId: assetB.id, quantity: new Decimal(20), avgCostUsd: new Decimal(3) },
          { assetId: assetA.id, quantity: new Decimal(1), avgCostUsd: new Decimal(9) }, // duplicate asset -> guard rejects
        ],
      })
    ).rejects.toThrow(/already has a non-zero position/);

    const pool = getPool();
    const accountRow = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Rollback Test Brokerage"]);
    expect(accountRow.rows).toHaveLength(0);

    const txnRow = await pool.query(`SELECT id FROM transactions WHERE note LIKE $1`, ["OPENING IMPORT:%"]);
    expect(txnRow.rows).toHaveLength(0);

    const cashRow = await pool.query(`SELECT id FROM account_cash`);
    expect(cashRow.rows).toHaveLength(0);

    const posRow = await pool.query(`SELECT id FROM positions_current`);
    expect(posRow.rows).toHaveLength(0);
  });

  it("throws SetupCommitUncertainError — never a normal rollback — when COMMIT itself fails, and never attempts ROLLBACK on that ambiguous outcome", async () => {
    const pool = getPool();
    const realClient = await pool.connect();
    const originalQuery = realClient.query.bind(realClient);
    const querySpy = vi.spyOn(realClient, "query").mockImplementation(((text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string" && text.trim() === "COMMIT") {
        return Promise.reject(new Error("simulated: connection dropped during COMMIT"));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as typeof realClient.query);
    const connectSpy = vi.spyOn(pool, "connect").mockResolvedValueOnce(realClient);

    await expect(
      setupAccount({
        name: "Commit Uncertain Test",
        custodian: null,
        portfolioAsOfDate: "2026-01-01",
        openingCashUsd: new Decimal(100),
        holdings: [],
      })
    ).rejects.toBeInstanceOf(SetupCommitUncertainError);

    expect(querySpy.mock.calls.some(([q]) => typeof q === "string" && q.trim() === "ROLLBACK")).toBe(false);

    querySpy.mockRestore();
    connectSpy.mockRestore();
    realClient.release();
  });

  it("propagates the ORIGINAL error even when the ROLLBACK issued in response to it also fails", async () => {
    const pool = getPool();
    const dupAsset = await resolveOrCreateAsset("RBM", "equity", "Rollback Masking Corp");
    const realClient = await pool.connect();
    const originalQuery = realClient.query.bind(realClient);
    let sawRollbackAttempt = false;
    const querySpy = vi.spyOn(realClient, "query").mockImplementation(((text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string" && text.trim() === "ROLLBACK") {
        sawRollbackAttempt = true;
        return Promise.reject(new Error("simulated: ROLLBACK itself failed (e.g. connection already dropped)"));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as typeof realClient.query);
    const connectSpy = vi.spyOn(pool, "connect").mockResolvedValueOnce(realClient);

    await expect(
      setupAccount({
        name: "Rollback Masking Test",
        custodian: null,
        portfolioAsOfDate: "2026-01-01",
        openingCashUsd: new Decimal(100),
        // A duplicate asset across two holdings makes the 2nd
        // applyOpeningPositionAdjustment reject with the ORIGINAL error
        // this test asserts on — a genuine, pre-COMMIT failure that must
        // still trigger a ROLLBACK attempt (which this test then makes fail).
        holdings: [
          { assetId: dupAsset.id, quantity: new Decimal(1), avgCostUsd: new Decimal(1) },
          { assetId: dupAsset.id, quantity: new Decimal(1), avgCostUsd: new Decimal(1) },
        ],
      })
    ).rejects.toThrow(/already has a non-zero position/);

    expect(sawRollbackAttempt).toBe(true);

    querySpy.mockRestore();
    connectSpy.mockRestore();
    realClient.release();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ledger/setupAccount.test.ts`
Expected: FAIL — `./setupAccount` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/ledger/setupAccount.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "../db";
import { createAccount, type Account } from "../accounts";
import { applyOpeningCashAdjustment, applyOpeningPositionAdjustment } from "./openingImport";

export interface SetupHoldingInput {
  assetId: string;
  quantity: Decimal;
  avgCostUsd: Decimal;
}

export interface SetupAccountInput {
  name: string;
  custodian: string | null;
  portfolioAsOfDate: string; // YYYY-MM-DD — the single "portfolio as of" date (spec §4 Step 1)
  openingCashUsd: Decimal; // >= 0; 0 means no cash adjustment is recorded (spec §4 Step 2)
  holdings: SetupHoldingInput[];
}

export interface SetupAccountResult {
  accountId: number;
  openingCashTransactionId: string | null;
  holdingTransactionIds: string[];
}

// One fixed note for every transaction this orchestrator writes — satisfies
// openingImport.ts's mandatory "OPENING IMPORT:" prefix without exposing
// that implementation vocabulary anywhere in the wizard's own UI copy.
const SETUP_NOTE = "OPENING IMPORT: initial account setup";

// Thrown only when the COMMIT command itself failed in a way that leaves
// the write outcome genuinely ambiguous (e.g. the connection dropped
// between sending COMMIT and receiving Postgres's acknowledgement).
// Postgres may have applied the commit before the failure — a ROLLBACK in
// this state would be meaningless (there may be nothing left to roll back)
// and could itself throw without telling us anything new, so none is
// attempted. Callers (Task 14's setupAccountAction) must treat this as a
// distinct, honest "unknown" outcome — never as "nothing was saved," and
// never inferred by checking whether an account of this name now exists
// (duplicate account names are intentionally allowed, so a name match
// proves nothing about whether this particular attempt succeeded).
export class SetupCommitUncertainError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "SetupCommitUncertainError";
  }
}

// Spec §3.2: the single moment real setup data is written, and it is
// genuinely atomic — one client, one BEGIN/COMMIT/ROLLBACK around
// createAccount + (optional) opening cash + every opening-position holding.
export async function setupAccount(input: SetupAccountInput): Promise<SetupAccountResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const account: Account = await createAccount(input.name, input.custodian, client);

    let openingCashTransactionId: string | null = null;
    if (!input.openingCashUsd.eq(0)) {
      const result = await applyOpeningCashAdjustment(
        {
          accountId: account.id,
          tradeDate: input.portfolioAsOfDate,
          cashEffectUsd: input.openingCashUsd,
          note: SETUP_NOTE,
        },
        client
      );
      openingCashTransactionId = result.transactionId;
    }

    const holdingTransactionIds: string[] = [];
    for (const holding of input.holdings) {
      const result = await applyOpeningPositionAdjustment(
        {
          accountId: account.id,
          assetId: holding.assetId,
          tradeDate: input.portfolioAsOfDate,
          quantity: holding.quantity,
          avgCostUsd: holding.avgCostUsd,
          note: SETUP_NOTE,
        },
        client
      );
      holdingTransactionIds.push(result.transactionId);
    }

    try {
      await client.query("COMMIT");
    } catch (commitErr) {
      throw new SetupCommitUncertainError(
        "The setup commit could not be confirmed — the account may or may not have been saved.",
        commitErr
      );
    }
    return { accountId: account.id, openingCashTransactionId, holdingTransactionIds };
  } catch (err) {
    if (err instanceof SetupCommitUncertainError) {
      // No ROLLBACK attempt — the outcome is already ambiguous, and issuing
      // one here could itself throw without telling us anything new.
      throw err;
    }
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // A failing ROLLBACK must never mask the ORIGINAL error — attach the
      // rollback failure as diagnostic detail without replacing what's thrown.
      if (err instanceof Error) {
        (err as Error & { rollbackError?: unknown }).rollbackError = rollbackErr;
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ledger/setupAccount.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/setupAccount.ts lib/ledger/setupAccount.test.ts
git commit -m "feat: atomic account-setup orchestration, with a distinct uncertain-commit outcome and rollback-masking protection (spec 3.2)"
```

**Functional acceptance check:** `npx vitest run lib/ledger/setupAccount.test.ts` PASS, 6/6 — including the explicit atomic-rollback test required by this session's instructions, plus this session's final-review tests for `SetupCommitUncertainError` (no ROLLBACK attempted on an ambiguous COMMIT failure) and rollback-masking protection (the original error survives a ROLLBACK that itself fails).
**UX acceptance check:** none — not wired to any UI yet (Task 15).

---

### Task 8: Read-back verification (`lib/ledger/verifySetup.ts`)

**Files:**
- Create: `lib/ledger/verifySetup.ts`
- Test: `lib/ledger/verifySetup.test.ts`

**Interfaces:**
- Consumes: `setupAccount` (Task 7, in the test only), `normalizePgDate` (Task 2).
- Produces: `VerifyHolding { assetId: string; quantity: Decimal; avgCostUsd: Decimal }`, `VerifySetupInput { accountId: number; expectedName: string; expectedCustodian: string | null; expectedPortfolioAsOfDate: string; expectedCashUsd: Decimal; expectedHoldings: VerifyHolding[] }`, `VerifySetupResult { matches: boolean; mismatches: string[] }`, `verifySetup(input): Promise<VerifySetupResult>`. Consumed by Task 14's `setupAccountAction`.

Per this session's correction: the approved design's read-back check must also confirm the account row itself was written correctly, not only cash and positions — and, where practical, that the "portfolio as of" date was actually persisted. This task now additionally re-reads the `accounts` row (name/custodian) and the `trade_date` on every opening-import transaction this setup wrote.

**Precision contract (this session's final-review correction, enforced by the caller — Task 14):** `positions_current.quantity` is `NUMERIC(28,10)`, so anything `applyTransaction` writes is silently rounded to 10 decimal places on the way in. `verifySetup` compares `expectedHoldings[].quantity` against that stored, already-rounded value with an exact `Decimal.eq()` — it does no rounding of its own. If a caller ever passed an un-rounded `expectedHoldings[].quantity` (e.g. a value entered with more than 10 decimal places) while the same un-rounded value was what actually got written and rounded by `applyTransaction`, the two would diverge and this function would report a mismatch that looks like a system bug rather than an expected, disclosable rounding of entered precision. Task 14 avoids this entirely by normalizing every holding's quantity to `.toDecimalPlaces(10)` **once**, before it is used for both the write and this function's `expectedHoldings` — so `verifySetup` itself needs no quantity-rounding logic of its own.

- [ ] **Step 1: Write the failing test**

Create `lib/ledger/verifySetup.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { setupAccount } from "./setupAccount";
import { verifySetup } from "./verifySetup";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("verifySetup", () => {
  it("reports a match when the saved data equals what was approved", async () => {
    const asset = await resolveOrCreateAsset("VERA", "equity", "Verify A Corp");
    const setup = await setupAccount({
      name: "Verify Match Brokerage",
      custodian: "IBKR",
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(2500),
      holdings: [{ assetId: asset.id, quantity: new Decimal(10), avgCostUsd: new Decimal(50) }],
    });

    const result = await verifySetup({
      accountId: setup.accountId,
      expectedName: "Verify Match Brokerage",
      expectedCustodian: "IBKR",
      expectedPortfolioAsOfDate: "2026-01-01",
      expectedCashUsd: new Decimal(2500),
      expectedHoldings: [{ assetId: asset.id, quantity: new Decimal(10), avgCostUsd: new Decimal(50) }],
    });

    expect(result.matches).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("reports a cash mismatch when the approved cash figure doesn't match what's stored", async () => {
    const setup = await setupAccount({
      name: "Verify Cash Mismatch",
      custodian: null,
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(2500),
      holdings: [],
    });

    const result = await verifySetup({
      accountId: setup.accountId,
      expectedName: "Verify Cash Mismatch",
      expectedCustodian: null,
      expectedPortfolioAsOfDate: "2026-01-01",
      expectedCashUsd: new Decimal(9999), // deliberately wrong
      expectedHoldings: [],
    });

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes("cash"))).toBe(true);
  });

  it("reports a missing-holding mismatch when an expected holding wasn't saved", async () => {
    const asset = await resolveOrCreateAsset("VERB", "equity", "Verify B Corp");
    const missingAsset = await resolveOrCreateAsset("VERM", "equity", "Verify Missing Corp");
    const setup = await setupAccount({
      name: "Verify Missing Holding",
      custodian: null,
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(0),
      holdings: [{ assetId: asset.id, quantity: new Decimal(5), avgCostUsd: new Decimal(20) }],
    });

    const result = await verifySetup({
      accountId: setup.accountId,
      expectedName: "Verify Missing Holding",
      expectedCustodian: null,
      expectedPortfolioAsOfDate: "2026-01-01",
      expectedCashUsd: new Decimal(0),
      expectedHoldings: [
        { assetId: asset.id, quantity: new Decimal(5), avgCostUsd: new Decimal(20) },
        { assetId: missingAsset.id, quantity: new Decimal(1), avgCostUsd: new Decimal(1) },
      ],
    });

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes(missingAsset.id))).toBe(true);
  });

  it("reports an account-row mismatch when the expected name/custodian don't match what's stored", async () => {
    const setup = await setupAccount({
      name: "Verify Account Row Test",
      custodian: "Real Custodian",
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(0),
      holdings: [],
    });

    const result = await verifySetup({
      accountId: setup.accountId,
      expectedName: "A Different Name", // deliberately wrong
      expectedCustodian: "Real Custodian",
      expectedPortfolioAsOfDate: "2026-01-01",
      expectedCashUsd: new Decimal(0),
      expectedHoldings: [],
    });

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes("account name"))).toBe(true);
  });

  it("reports a missing-account mismatch when the account row itself can't be found", async () => {
    const result = await verifySetup({
      accountId: 999999,
      expectedName: "Nonexistent",
      expectedCustodian: null,
      expectedPortfolioAsOfDate: "2026-01-01",
      expectedCashUsd: new Decimal(0),
      expectedHoldings: [],
    });

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes("no account row found"))).toBe(true);
  });

  it("reports an opening-date mismatch when the expected portfolio-as-of date doesn't match the persisted trade_date", async () => {
    const setup = await setupAccount({
      name: "Verify Opening Date Test",
      custodian: null,
      portfolioAsOfDate: "2026-01-01",
      openingCashUsd: new Decimal(100),
      holdings: [],
    });

    const result = await verifySetup({
      accountId: setup.accountId,
      expectedName: "Verify Opening Date Test",
      expectedCustodian: null,
      expectedPortfolioAsOfDate: "2026-02-15", // deliberately wrong
      expectedCashUsd: new Decimal(100),
      expectedHoldings: [],
    });

    expect(result.matches).toBe(false);
    expect(result.mismatches.some((m) => m.includes("opening trade date"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ledger/verifySetup.test.ts`
Expected: FAIL — `./verifySetup` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/ledger/verifySetup.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "../db";
import { normalizePgDate } from "../dateValidation";

export interface VerifyHolding {
  assetId: string;
  quantity: Decimal;
  avgCostUsd: Decimal;
}

export interface VerifySetupInput {
  accountId: number;
  expectedName: string;
  expectedCustodian: string | null;
  expectedPortfolioAsOfDate: string;
  expectedCashUsd: Decimal;
  expectedHoldings: VerifyHolding[];
}

export interface VerifySetupResult {
  matches: boolean;
  mismatches: string[];
}

// The fixed note setupAccount.ts writes on every opening-import transaction
// (account creation, opening cash, every holding) — used here to identify
// which rows to check the persisted "portfolio as of" date against.
const SETUP_NOTE = "OPENING IMPORT: initial account setup";

// Spec §3.3: a system-integrity check, not a second manual data-entry
// exercise. Re-fetches exactly what setupAccount wrote — the account row
// itself, the opening trade date, cash, and every holding — and compares it
// to the draft the user approved on Review. Writes nothing; never calls
// recordAccountReconciliation (that's reserved for the optional §7.2 action,
// currently deferred — see Tasks 19–20).
export async function verifySetup(input: VerifySetupInput): Promise<VerifySetupResult> {
  const pool = getPool();
  const mismatches: string[] = [];

  const accountRow = await pool.query<{ name: string; custodian: string | null }>(
    `SELECT name, custodian FROM accounts WHERE id = $1`,
    [input.accountId]
  );
  if (accountRow.rows.length === 0) {
    mismatches.push(`account ${input.accountId}: no account row found`);
  } else {
    const actual = accountRow.rows[0];
    if (actual.name !== input.expectedName) {
      mismatches.push(`account name: expected "${input.expectedName}", found "${actual.name}"`);
    }
    if ((actual.custodian ?? null) !== (input.expectedCustodian ?? null)) {
      mismatches.push(
        `account custodian: expected "${input.expectedCustodian ?? "(none)"}", found "${actual.custodian ?? "(none)"}"`
      );
    }
  }

  const openingDateRows = await pool.query<{ trade_date: string }>(
    `SELECT DISTINCT trade_date FROM transactions WHERE account_id = $1 AND note = $2`,
    [input.accountId, SETUP_NOTE]
  );
  for (const row of openingDateRows.rows) {
    const tradeDate = normalizePgDate(row.trade_date);
    if (tradeDate !== input.expectedPortfolioAsOfDate) {
      mismatches.push(`opening trade date: expected ${input.expectedPortfolioAsOfDate}, found ${tradeDate}`);
    }
  }

  const cashRow = await pool.query<{ cash_usd: string }>(
    `SELECT cash_usd FROM account_cash WHERE account_id = $1`,
    [input.accountId]
  );
  const actualCash = cashRow.rows.length > 0 ? new Decimal(cashRow.rows[0].cash_usd) : new Decimal(0);
  if (!actualCash.eq(input.expectedCashUsd)) {
    mismatches.push(`cash: expected ${input.expectedCashUsd.toFixed(2)}, found ${actualCash.toFixed(2)}`);
  }

  const positionRows = await pool.query<{ asset_id: string; quantity: string; avg_cost_usd: string | null }>(
    `SELECT asset_id, quantity, avg_cost_usd FROM positions_current WHERE account_id = $1 AND quantity <> 0`,
    [input.accountId]
  );
  const actualByAsset = new Map(positionRows.rows.map((r) => [r.asset_id, r]));

  for (const expected of input.expectedHoldings) {
    const actual = actualByAsset.get(expected.assetId);
    if (!actual) {
      mismatches.push(`holding asset ${expected.assetId}: expected quantity ${expected.quantity.toFixed(4)}, found none`);
      continue;
    }
    if (!new Decimal(actual.quantity).eq(expected.quantity)) {
      mismatches.push(
        `holding asset ${expected.assetId}: expected quantity ${expected.quantity.toFixed(4)}, found ${actual.quantity}`
      );
    }
    const actualAvg = actual.avg_cost_usd ? new Decimal(actual.avg_cost_usd) : null;
    if (!actualAvg || !actualAvg.eq(expected.avgCostUsd)) {
      mismatches.push(
        `holding asset ${expected.assetId}: expected avg cost ${expected.avgCostUsd.toFixed(4)}, found ${
          actualAvg ? actualAvg.toFixed(4) : "none"
        }`
      );
    }
    actualByAsset.delete(expected.assetId);
  }
  for (const [assetId] of actualByAsset) {
    mismatches.push(`unexpected extra holding on asset ${assetId}`);
  }

  return { matches: mismatches.length === 0, mismatches };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ledger/verifySetup.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/verifySetup.ts lib/ledger/verifySetup.test.ts
git commit -m "feat: automatic saved-data read-back verification, now including the account row and opening date (spec 3.3)"
```

**Functional acceptance check:** `npx vitest run lib/ledger/verifySetup.test.ts` PASS, 6/6 — covers "automatic post-save read-back verification" end to end at the lib level (match, cash mismatch, missing-holding mismatch, account-row mismatch, missing-account, opening-date mismatch).
**UX acceptance check:** none yet — wired into the wizard's Complete/Mismatch/Unverified screens in Task 15.

---

### Task 9: Ticker resolution and duplicate-name check (`app/actions/setup.ts`, part 1)

**Files:**
- Create: `app/actions/setup.ts` (this task writes `resolveTickerAction` and `checkAccountNameAction` only — `setupAccountAction` is appended in Task 14)
- Test: `app/actions/setup.test.ts`

**Interfaces:**
- Consumes: `resolveOrCreateAsset` (`lib/assets.ts`), `upsertLatestPrice` (`lib/marketdata`), `normalizePgDate` (Task 2).
- Produces: `TickerResolutionResult`, `resolveTickerAction(ticker, assetClass)`, `checkAccountNameAction(name)`. Consumed by Task 13's wizard Step 3, Task 10's wizard Step 1, and Task 25's `TransactionForm.tsx` (`resolveTickerAction` is reused for Buy, per spec §6).

Per this session's instruction to keep every backend behaviour under real automated test, this Server Action file gets a Vitest integration test against the real local Postgres (node environment) — the same treatment as `lib/`. No live network call is made: the test pre-seeds a fresh `prices_daily` row so `upsertLatestPrice`'s existing freshness-cache check short-circuits before reaching the provider, matching this repo's existing convention (`lib/marketdata/index.test.ts` only ever tests the pure cache-freshness helper).

- [ ] **Step 1: Write the failing test**

Create `app/actions/setup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset } from "@/lib/assets";
import { resolveTickerAction, checkAccountNameAction } from "./setup";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("resolveTickerAction", () => {
  const originalProvider = process.env.MARKET_DATA_PROVIDER;
  beforeEach(() => { process.env.MARKET_DATA_PROVIDER = "YAHOO"; });
  afterEach(() => { process.env.MARKET_DATA_PROVIDER = originalProvider; });

  it("resolves using a fresh cached price, without a live network call", async () => {
    const asset = await resolveOrCreateAsset("CACHED", "equity", "Cached Corp");
    const pool = getPool();
    const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'YAHOO'`);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, CURRENT_DATE, 42.50, 42.50, $2, now())`,
      [asset.id, sourceRow.rows[0].id]
    );

    const result = await resolveTickerAction("cached", "equity");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetId).toBe(asset.id);
      expect(result.priceUsd).toBe("42.50");
    }
  });

  it("returns ok:false with a friendly message for an empty ticker, without creating any asset", async () => {
    const result = await resolveTickerAction("   ", "equity");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.assetId).toBeNull();
      expect(result.message).toMatch(/enter a ticker/i);
    }
  });
});

describe("checkAccountNameAction", () => {
  it("reports exists:true case-insensitively for an existing account name", async () => {
    await createAccount("Existing Brokerage", null);
    const result = await checkAccountNameAction("existing brokerage");
    expect(result.exists).toBe(true);
  });

  it("reports exists:false for a name not on record", async () => {
    const result = await checkAccountNameAction("Nobody Here");
    expect(result.exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/actions/setup.test.ts`
Expected: FAIL — `./setup` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `app/actions/setup.ts`:

```ts
"use server";

import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset, type AssetClass } from "@/lib/assets";
import { upsertLatestPrice } from "@/lib/marketdata";
import { normalizePgDate } from "@/lib/dateValidation";

export type TickerResolutionResult =
  | { ok: true; assetId: string; assetClass: AssetClass; priceUsd: string; priceDate: string }
  | { ok: false; assetId: string | null; message: string };

// Reused by both the wizard's holdings step (Task 13) and the Transactions
// page's Buy field (Task 25) — spec §4 Step 3, §6. resolveOrCreateAsset
// never fails to find a ticker (it upserts a reference row unconditionally);
// what can fail is the live price fetch, which is the actual resolution
// signal here. On failure the caller still gets back the created assetId so
// an explicit "Add anyway" can proceed without a second resolution attempt.
export async function resolveTickerAction(ticker: string, assetClass: AssetClass): Promise<TickerResolutionResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return { ok: false, assetId: null, message: "Enter a ticker symbol." };

  const asset = await resolveOrCreateAsset(symbol, assetClass, symbol);

  try {
    await upsertLatestPrice(asset.id, symbol, assetClass);
  } catch {
    return {
      ok: false,
      assetId: asset.id,
      message: `Couldn't find a price for "${symbol}". Check the symbol, or add it anyway if you're sure it's correct.`,
    };
  }

  const pool = getPool();
  const priceRow = await pool.query<{ close: string; price_date: string }>(
    `SELECT close, price_date FROM prices_daily WHERE asset_id = $1 ORDER BY price_date DESC LIMIT 1`,
    [asset.id]
  );
  if (priceRow.rows.length === 0) {
    return {
      ok: false,
      assetId: asset.id,
      message: `Couldn't find a price for "${symbol}". Check the symbol, or add it anyway if you're sure it's correct.`,
    };
  }

  return {
    ok: true,
    assetId: asset.id,
    assetClass,
    priceUsd: new Decimal(priceRow.rows[0].close).toFixed(2),
    // Per this session's final-review correction: reuse the shared
    // normalizePgDate helper for every new DATE read rather than a
    // duplicated String(...)/ad hoc conversion — String() on a value
    // node-postgres has decoded into a JS Date would format via toString()
    // in the SERVER's local zone, not the app's single date convention.
    priceDate: normalizePgDate(priceRow.rows[0].price_date),
  };
}

// Spec §4 Step 1: "soft, non-blocking duplicate-account-name check."
export async function checkAccountNameAction(name: string): Promise<{ exists: boolean }> {
  const pool = getPool();
  const result = await pool.query(`SELECT 1 FROM accounts WHERE lower(name) = lower($1) LIMIT 1`, [name]);
  return { exists: result.rows.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/actions/setup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/actions/setup.ts app/actions/setup.test.ts
git commit -m "feat: ticker-resolution and duplicate-name-check Server Actions"
```

**Functional acceptance check:** `npx vitest run app/actions/setup.test.ts` PASS, 4/4 — no live network call made.
**UX acceptance check:** none yet — wired into the wizard in Tasks 10 and 13.

---

### Task 10: Wizard Step 1 (first visible wizard slice)

**Files:**
- Create: `app/accounts/new/page.tsx`, `app/accounts/new/SetupWizard.tsx`
- Test: `app/accounts/new/SetupWizard.test.tsx` (jsdom component test)

**Interfaces:**
- Consumes: `checkAccountNameAction` (Task 9).
- Produces: `SetupWizard` component (extended in Tasks 12, 13, 15). At this point it implements Step 1 only (account name, custodian, portfolio-as-of date, soft duplicate-name check, Cancel-with-discard-confirmation) — Steps 2–4 don't exist yet, so `goToStep2` advances internal state to `2` but nothing renders for it until Task 12. This is expected, not a bug, at this point in the plan.

Per spec §2.1, the wizard suppresses the persistent NavBar while active — no `<NavBar />` on this route.

- [ ] **Step 1: Write the failing component test**

Create `app/accounts/new/SetupWizard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const checkAccountNameActionMock = vi.fn().mockResolvedValue({ exists: false });
vi.mock("@/app/actions/setup", () => ({
  checkAccountNameAction: (...args: unknown[]) => checkAccountNameActionMock(...args),
}));

beforeEach(() => {
  pushMock.mockClear();
  checkAccountNameActionMock.mockClear();
});

describe("SetupWizard — disposable pre-save draft state (spec 3.1)", () => {
  it("starts with every field empty on mount", () => {
    render(<SetupWizard />);
    expect(screen.getByLabelText(/account name/i)).toHaveValue("");
    expect(screen.getByLabelText(/custodian/i)).toHaveValue("");
  });

  it("Cancel with nothing entered navigates away without prompting", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.click(screen.getByText("Cancel setup"));

    expect(window.confirm).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/accounts");
  });

  it("Cancel, once confirmed, discards entered content and navigates away", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);

    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Throwaway Brokerage" } });
    fireEvent.change(screen.getByLabelText(/custodian/i), { target: { value: "Some Broker" } });

    fireEvent.click(screen.getByText("Cancel setup"));

    expect(window.confirm).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/accounts");
  });

  it("Cancel, declined, leaves the entered draft in place and does not navigate", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SetupWizard />);

    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Keep Me" } });
    fireEvent.click(screen.getByText("Cancel setup"));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/account name/i)).toHaveValue("Keep Me");
  });
});

describe("SetupWizard — Step 1 validation", () => {
  it("blocks advancing without an account name", () => {
    render(<SetupWizard />);
    fireEvent.click(screen.getByText("Next: Opening cash →"));
    expect(screen.getByText("Account name is required.")).toBeInTheDocument();
  });

  it("blocks advancing when the portfolio-as-of date is in the future", () => {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Future Date Test" } });
    fireEvent.change(screen.getByLabelText(/portfolio as of/i), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));
    expect(screen.getByText("Portfolio as of date cannot be in the future.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: FAIL — `./SetupWizard` does not exist yet.

- [ ] **Step 3: Write `app/accounts/new/SetupWizard.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkAccountNameAction } from "@/app/actions/setup";
import { localTodayIso } from "@/lib/dateValidation";

type Step = 1 | 2 | 3 | 4 | "complete" | "mismatch";

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [name, setName] = useState("");
  const [custodian, setCustodian] = useState("");
  const [portfolioAsOfDate, setPortfolioAsOfDate] = useState(localTodayIso());
  const [nameWarning, setNameWarning] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const hasEnteredContent = name.trim() !== "" || custodian.trim() !== "";

  function handleCancel() {
    if (hasEnteredContent && !window.confirm("Discard everything entered so far?")) return;
    router.push("/accounts");
  }

  async function handleNameBlur() {
    if (!name.trim()) { setNameWarning(null); return; }
    const result = await checkAccountNameAction(name.trim());
    setNameWarning(
      result.exists
        ? `An account named "${name.trim()}" already exists — continuing is fine if this is a different account.`
        : null
    );
  }

  function goToStep2() {
    if (!name.trim()) { setStep1Error("Account name is required."); return; }
    if (!portfolioAsOfDate) { setStep1Error("Portfolio as-of date is required."); return; }
    if (portfolioAsOfDate > localTodayIso()) { setStep1Error("Portfolio as of date cannot be in the future."); return; }
    setStep1Error(null);
    setStep(2);
  }

  return (
    <div>
      <h1>Let&apos;s set up an account</h1>

      {step === 1 && (
        <div>
          <p>
            An account is a brokerage, exchange, or bank account you hold investments or cash in — e.g. Interactive
            Brokers, Coinbase, DBS Multiplier.
          </p>
          <label>Account name (required)<br />
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={handleNameBlur} placeholder="e.g. Interactive Brokers, Coinbase, DBS Multiplier" />
          </label>
          {nameWarning && <p style={{ color: "#a15c00" }}>{nameWarning}</p>}
          <br /><br />
          <label>Custodian / broker (optional)<br />
            <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="The bank or broker that holds this account." />
          </label><br /><br />
          <label>Portfolio as of (required)<br />
            <input type="date" value={portfolioAsOfDate} onChange={(e) => setPortfolioAsOfDate(e.target.value)} />
          </label>
          <p>
            These balances and holdings are correct as of this date. From the next day onward, record every real
            transaction in Calboard under Transactions — don&apos;t also enter transactions from before this date here.
          </p>
          {step1Error && <p style={{ color: "#b00020" }}>{step1Error}</p>}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={goToStep2}>Next: Opening cash →</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write `app/accounts/new/page.tsx`**

```tsx
import { SetupWizard } from "./SetupWizard";

export default function NewAccountPage() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
      <SetupWizard />
    </main>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/accounts/new`.

**UX acceptance check:** no NavBar; Step 1 renders with Account name, Custodian, Portfolio-as-of fields and the copy from spec §4 Step 1. Clicking "Next: Opening cash →" with an empty name shows the inline error. Filling a name and clicking Next makes Step 1 disappear (Step 2 isn't visible yet — expected, built in Task 12). Typing a name, then clicking "Cancel setup", prompts a browser `confirm()` dialog; confirming returns to `/accounts`.

- [ ] **Step 7: Commit**

```bash
git add app/accounts/new/page.tsx app/accounts/new/SetupWizard.tsx app/accounts/new/SetupWizard.test.tsx
git commit -m "feat: setup wizard Step 1 — account name/custodian/portfolio-as-of date, disposable draft state"
```

**Functional acceptance check:** `npx vitest run app/accounts/new/SetupWizard.test.tsx` PASS, 6/6 — directly covers "disposable pre-save wizard state" and "Portfolio-as-of date validation" per this session's required test list.
**UX acceptance check:** see Step 6 above.

---

### Task 11: Cost-basis-mode and duplicate-ticker pure functions

**Files:**
- Create: `lib/wizard/draftHoldings.ts`
- Test: `lib/wizard/draftHoldings.test.ts`

**Interfaces:**
- Produces: `CostBasisMode = "average" | "total"`, `computeAvgCostUsd(quantity: Decimal, costInput: Decimal, mode: CostBasisMode): Decimal`, `isDuplicateTickerInDraft(existingTickers: string[], newTicker: string): boolean`. Consumed by Task 13's wizard Step 3 — extracted here as plain, framework-free functions specifically so "cost-basis mode handling" and "duplicate ticker prevention" (both explicitly required by this session) get real unit tests instead of only being exercised indirectly through component rendering.

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

// Spec §4 Step 3: cost-basis mode is chosen once per account setup. When
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

// Spec §4 Step 3: case-insensitive duplicate-ticker block within the draft.
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

### Task 12: Wizard Step 2 (opening cash)

**Files:**
- Modify: `app/accounts/new/SetupWizard.tsx`
- Modify: `app/accounts/new/SetupWizard.test.tsx` (append)

**Interfaces:**
- Adds `openingCashUsd` state and the Step 2 screen (spec §4 Step 2). No new external dependency.

Per this session's correction: Step 2 must validate the opening-cash text before advancing, and invalid text must never reach an unguarded `new Decimal(...)` call anywhere in the component. The "Next" button gains a real validation gate (mirroring Step 1's `step1Error` pattern) rather than advancing unconditionally.

- [ ] **Step 1: Write the failing test**

Append to `app/accounts/new/SetupWizard.test.tsx`, inside a new `describe` block:

```tsx
describe("SetupWizard — Step 2 (opening cash)", () => {
  it("Back from Step 2 returns to Step 1 with the entered data intact", () => {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Persisted Name" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));
    fireEvent.click(screen.getByText("← Back"));
    expect(screen.getByLabelText(/account name/i)).toHaveValue("Persisted Name");
  });

  it("entering a non-zero opening cash value counts as entered content for the Cancel-discard prompt", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Cash Draft Test" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));
    fireEvent.change(screen.getByLabelText(/opening cash balance/i), { target: { value: "500" } });

    fireEvent.click(screen.getByText("Cancel setup"));
    expect(window.confirm).toHaveBeenCalled();
  });

  it("blocks advancing with unparseable opening-cash text, shows an inline error, and preserves the entered value", () => {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Cash Validation Test" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));

    const cashInput = screen.getByLabelText(/opening cash balance/i);
    fireEvent.change(cashInput, { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByText("Next: Current holdings →"));

    expect(screen.getByText(/enter a valid dollar amount/i)).toBeInTheDocument();
    expect(cashInput).toHaveValue("not-a-number");
    // Still on Step 2 — Step 3's own heading must not have rendered.
    expect(screen.queryByText(/what does .* currently hold/i)).not.toBeInTheDocument();
  });

  it("blocks advancing with a negative opening-cash value", () => {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Negative Cash Test" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));
    fireEvent.change(screen.getByLabelText(/opening cash balance/i), { target: { value: "-100" } });
    fireEvent.click(screen.getByText("Next: Current holdings →"));
    expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: FAIL — no "Next: Opening cash →" click lands anywhere with a Step 2 to Back out of, and the validation error text doesn't exist yet.

- [ ] **Step 3: Modify `app/accounts/new/SetupWizard.tsx`**

Add the `openingCashUsd` and `step2Error` state — insert immediately after the existing `step1Error` state line:

```ts
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const [openingCashUsd, setOpeningCashUsd] = useState("0.00");
  const [step2Error, setStep2Error] = useState<string | null>(null);
```

Update `hasEnteredContent` to include it:

```ts
  const hasEnteredContent = name.trim() !== "" || custodian.trim() !== "" || openingCashUsd !== "0.00";
```

Add a `goToStep3` validation handler — insert after `goToStep2`:

```ts
  function goToStep3() {
    let value: Decimal;
    try {
      value = new Decimal(openingCashUsd || "0");
    } catch {
      setStep2Error("Enter a valid dollar amount.");
      return;
    }
    if (!value.isFinite() || value.lt(0)) {
      setStep2Error("Opening cash cannot be negative.");
      return;
    }
    setStep2Error(null);
    setStep(3);
  }
```

This requires `Decimal` — add the import at the top of the file alongside the existing ones:

```ts
import Decimal from "decimal.js";
```

Insert the Step 2 block immediately after Step 1's closing `)}` (i.e. right after the `<button onClick={goToStep2}>Next: Opening cash →</button>` line's enclosing `</div>` and `)}`):

```tsx
      {step === 2 && (
        <div>
          <h2>How much cash does {name} currently hold?</h2>
          <p>
            This is a starting balance, not a transaction — the amount sitting in this account as of{" "}
            {portfolioAsOfDate}. Leave it at $0 if there&apos;s no cash to declare.
          </p>
          <label>Opening cash balance (USD)<br />
            <input value={openingCashUsd} onChange={(e) => setOpeningCashUsd(e.target.value)} />
          </label>
          <p>Enter 0 if this account holds no cash right now.</p>
          {step2Error && <p style={{ color: "#b00020" }}>{step2Error}</p>}
          <button onClick={() => setStep(1)}>← Back</button>{" "}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={goToStep3}>Next: Current holdings →</button>
        </div>
      )}
```

Note: this gate only prevents *advancing past* Step 2 with unparseable text — it does not, by itself, make every render path safe, since React re-renders on every keystroke regardless of which step is showing. Task 15 (where `totalStartingValueUsd` and the Review/Complete screens are introduced) adds the actual crash-safety fix for that; see its own note.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: PASS, 10 tests (6 from Task 10 + 4 new).

- [ ] **Step 5: Manual verification**

**UX acceptance check:** with `npm run dev` running, fill Step 1, click Next. Step 2 now renders: "How much cash does {name} currently hold?", opening-cash field defaulting to `0.00`, Back/Cancel/Next buttons. Back returns to Step 1 with the name still filled in. Typing `abc` and clicking Next shows "Enter a valid dollar amount." and stays on Step 2 with the typed text intact. Typing a valid non-negative amount and clicking Next advances state to Step 3 (nothing visible yet — expected, built in Task 13).

- [ ] **Step 6: Commit**

```bash
git add app/accounts/new/SetupWizard.tsx app/accounts/new/SetupWizard.test.tsx
git commit -m "feat: setup wizard Step 2 — opening cash balance, with validation before advancing"
```

**Functional acceptance check:** `npx vitest run app/accounts/new/SetupWizard.test.tsx` PASS, 10/10 — the two new tests directly cover this session's "opening cash validation" requirement.
**UX acceptance check:** see Step 5 above.

---

### Task 13: Wizard Step 3 (current holdings — ticker resolution, cost-basis mode, repeatable list)

**Files:**
- Modify: `app/accounts/new/SetupWizard.tsx`
- Modify: `app/accounts/new/SetupWizard.test.tsx` (append)

**Interfaces:**
- Consumes: `resolveTickerAction` (Task 9), `computeAvgCostUsd`/`isDuplicateTickerInDraft`/`CostBasisMode` (Task 11).
- Adds the full Step 3 screen (spec §4 Step 3): ticker resolution with a checking/resolved/couldn't-find state, asset-type selection, quantity/cost entry, a cost-basis-mode toggle chosen once per account, the "Added so far" table with Edit/Remove, and the case-insensitive duplicate-ticker block.

Per this session's correction: `avgCostFor(h)` interprets every holding's stored `costInput` using the **current** `costBasisMode` state, not whatever mode was active when that holding was added. If the mode could be freely toggled after holdings already exist, switching it would silently reinterpret an already-added holding's cost basis (e.g. a `costInput` of `42.50` entered as an average cost, later re-read as a total cost basis divided by quantity). The simplest safe fix — and the one used here — is to **lock the mode once the first holding has been added**: both radios become `disabled` while `holdings.length > 0`, with a visible note explaining why, so `costBasisMode` cannot change out from under any holding already in the list. Removing every holding un-disables the radios, giving an explicit, deliberate way to change the mode rather than a silent one.

Per this session's final-review correction (CRITICAL item 1): resolved ticker/asset identity must never go stale. `holdingDraft.assetId` — the identity `addHolding` actually saves — is set once, on blur, by `resolveTickerAction`. Without a fix, editing the ticker text afterward (e.g. resolving "AAPL," then typing over it to "MSFT" without tabbing out again) would leave `assetId` pointing at AAPL while the visible field reads MSFT, and `addHolding` would silently save MSFT's row under AAPL's asset id. The fix tracks the normalized symbol that was actually resolved (`resolvedTicker`), clears both `holdingDraft.assetId` and `resolvedTicker` the instant the ticker text OR the asset type changes (its own `onChange`, not waiting for the next blur), and has `addHolding` require the current normalized ticker to still equal `resolvedTicker` before allowing a save.

- [ ] **Step 1: Write the failing test**

Append to `app/accounts/new/SetupWizard.test.tsx` — first extend the `@/app/actions/setup` mock at the top of the file to include `resolveTickerAction`:

```tsx
const resolveTickerActionMock = vi.fn();
vi.mock("@/app/actions/setup", () => ({
  checkAccountNameAction: (...args: unknown[]) => checkAccountNameActionMock(...args),
  resolveTickerAction: (...args: unknown[]) => resolveTickerActionMock(...args),
}));
```

(This replaces the Task 10 version of the same `vi.mock("@/app/actions/setup", ...)` call — one mock factory per module per test file.)

Then add a new `describe` block:

```tsx
function goToStep3() {
  render(<SetupWizard />);
  fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Holdings Draft Test" } });
  fireEvent.click(screen.getByText("Next: Opening cash →"));
  fireEvent.click(screen.getByText("Next: Current holdings →"));
}

describe("SetupWizard — Step 3 (current holdings)", () => {
  beforeEach(() => {
    resolveTickerActionMock.mockClear();
  });

  it("resolves a ticker and shows the confirmed price before it can be added", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true, assetId: "1", assetClass: "equity", priceUsd: "228.50", priceDate: "2026-08-25",
    });
    goToStep3();

    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "AAPL" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));

    await waitFor(() => expect(screen.getByText(/Resolved — last price \$228.50/)).toBeInTheDocument());
  });

  it("blocks adding two holdings with the same ticker, case-insensitively", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true, assetId: "1", assetClass: "equity", priceUsd: "100.00", priceDate: "2026-08-25",
    });
    goToStep3();

    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "aapl" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));
    await waitFor(() => expect(screen.getByText(/Resolved/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/quantity you hold/i), { target: { value: "10" } });
    // Anchored to "(USD)" to target only the cost text field — an unanchored
    // /average cost per unit/i also matches the radio button's own label
    // ("Average cost per unit", no "(USD)" suffix) and getByLabelText throws
    // on multiple matches.
    fireEvent.change(screen.getByLabelText(/average cost per unit \(usd\)/i), { target: { value: "150" } });
    fireEvent.click(screen.getByText("+ Add holding"));

    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "AAPL" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));
    await waitFor(() => expect(screen.getByText(/Resolved/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/quantity you hold/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/average cost per unit \(usd\)/i), { target: { value: "160" } });
    fireEvent.click(screen.getByText("+ Add holding"));

    expect(screen.getByText(/is already in this account's list/)).toBeInTheDocument();
  });

  it("switches the cost-input label when Total cost basis mode is selected", () => {
    goToStep3();
    fireEvent.click(screen.getByLabelText(/total cost basis/i));
    expect(screen.getByLabelText(/^total cost basis \(usd\)/i)).toBeInTheDocument();
  });

  it("locks the cost-basis mode once a holding has been added, so an existing holding's cost basis cannot silently change", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true, assetId: "1", assetClass: "equity", priceUsd: "100.00", priceDate: "2026-08-25",
    });
    goToStep3();

    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "LOCK" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));
    await waitFor(() => expect(screen.getByText(/Resolved/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/quantity you hold/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/average cost per unit \(usd\)/i), { target: { value: "50" } });
    fireEvent.click(screen.getByText("+ Add holding"));

    expect(screen.getByText("$50.00")).toBeInTheDocument(); // LOCK's Avg-cost cell, average mode

    // Switching to Total cost basis mode must be blocked now that a holding
    // exists — the radio is disabled and the click is a no-op.
    fireEvent.click(screen.getByLabelText(/total cost basis/i));

    expect(screen.getByLabelText(/total cost basis/i)).toBeDisabled();
    expect(screen.getByLabelText(/average cost per unit$/i)).toBeChecked();
    // LOCK's displayed average cost must still read $50.00, not a figure
    // re-derived under a different (never-actually-applied) mode.
    expect(screen.getByText("$50.00")).toBeInTheDocument();
  });

  it("blocks adding a holding when the ticker was edited after resolution without re-resolving (resolved AAPL, edited to MSFT)", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true, assetId: "1", assetClass: "equity", priceUsd: "228.50", priceDate: "2026-08-25",
    });
    goToStep3();

    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "AAPL" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));
    await waitFor(() => expect(screen.getByText(/Resolved — last price \$228.50/)).toBeInTheDocument());

    // Edit the ticker text WITHOUT triggering another blur/resolve.
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "MSFT" } });

    // The stale AAPL confirmation must be gone immediately — before any blur.
    expect(screen.queryByText(/Resolved — last price \$228.50/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/quantity you hold/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/average cost per unit \(usd\)/i), { target: { value: "150" } });
    fireEvent.click(screen.getByText("+ Add holding"));

    expect(screen.getByText(/resolve the ticker first/i)).toBeInTheDocument();
    // Never silently saved MSFT's row under AAPL's already-resolved assetId.
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: FAIL — Step 3 doesn't render anything yet.

- [ ] **Step 3: Modify `app/accounts/new/SetupWizard.tsx`**

Update the import line at the top of the file:

```ts
import { checkAccountNameAction, resolveTickerAction, type TickerResolutionResult } from "@/app/actions/setup";
import { computeAvgCostUsd, isDuplicateTickerInDraft, type CostBasisMode } from "@/lib/wizard/draftHoldings";
import type { AssetClass } from "@/lib/assets";
import Decimal from "decimal.js";
```

Add a `DraftHolding` interface and `emptyHolding()` helper near the top of the file, alongside the `Step` type:

```ts
interface DraftHolding {
  key: string;
  ticker: string;
  assetId: string | null;
  assetClass: AssetClass;
  quantity: string;
  costInput: string; // interpreted per costBasisMode
}

function emptyHolding(): DraftHolding {
  return { key: Math.random().toString(36).slice(2), ticker: "", assetId: null, assetClass: "equity", quantity: "", costInput: "" };
}
```

Add Step 3 state — insert after the `openingCashUsd` state line:

```ts
  const [costBasisMode, setCostBasisMode] = useState<CostBasisMode>("average");
  const [holdings, setHoldings] = useState<DraftHolding[]>([]);
  const [holdingDraft, setHoldingDraft] = useState<DraftHolding>(emptyHolding());
  const [holdingResolution, setHoldingResolution] = useState<TickerResolutionResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  // The normalized ticker text that holdingDraft.assetId was actually
  // resolved for (per this session's final-review correction). Ticker
  // text and asset class can change after a resolution completes; without
  // tracking this separately and re-checking it in addHolding(), an edit
  // from a resolved "AAPL" to "MSFT" could submit MSFT's ticker text with
  // AAPL's already-resolved assetId.
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
```

Update `hasEnteredContent`:

```ts
  const hasEnteredContent =
    name.trim() !== "" || custodian.trim() !== "" || openingCashUsd !== "0.00" || holdings.length > 0;
```

Add the holdings-draft handlers — insert after `goToStep2`:

```ts
  async function handleHoldingTickerBlur() {
    const normalized = holdingDraft.ticker.trim().toUpperCase();
    if (!normalized) return;
    setResolving(true);
    const result = await resolveTickerAction(holdingDraft.ticker, holdingDraft.assetClass);
    setResolving(false);
    setHoldingResolution(result);
    setResolvedTicker(normalized);
    setHoldingDraft((d) => ({ ...d, assetId: result.assetId }));
  }

  function avgCostFor(h: DraftHolding): Decimal {
    return computeAvgCostUsd(new Decimal(h.quantity), new Decimal(h.costInput), costBasisMode);
  }

  function addHolding() {
    setHoldingError(null);
    const ticker = holdingDraft.ticker.trim().toUpperCase();
    if (!ticker) { setHoldingError("Enter a ticker symbol."); return; }
    // Per this session's final-review correction: require the CURRENT
    // normalized ticker to still match what holdingDraft.assetId was
    // actually resolved for. onChange below already clears assetId the
    // instant the ticker text or asset type changes, so this is a second,
    // explicit guard against ever adding a holding whose visible ticker
    // doesn't match its resolved identity.
    if (!holdingDraft.assetId || resolvedTicker !== ticker) {
      setHoldingError("Resolve the ticker first (wait for the checking… state to finish, or re-enter it if you changed it after resolving).");
      return;
    }
    if (isDuplicateTickerInDraft(holdings.map((h) => h.ticker), ticker)) {
      setHoldingError(`${ticker} is already in this account's list.`);
      return;
    }
    let quantity: Decimal, costInput: Decimal;
    try {
      quantity = new Decimal(holdingDraft.quantity);
      costInput = new Decimal(holdingDraft.costInput);
    } catch {
      setHoldingError("Quantity and cost must be valid numbers.");
      return;
    }
    if (quantity.lte(0) || costInput.lte(0)) {
      setHoldingError("Quantity and cost must be greater than zero.");
      return;
    }
    setHoldings((hs) => [...hs, { ...holdingDraft, ticker }]);
    setHoldingDraft(emptyHolding());
    setHoldingResolution(null);
    setResolvedTicker(null);
  }

  function removeHolding(key: string) {
    setHoldings((hs) => hs.filter((h) => h.key !== key));
  }

  function editHolding(h: DraftHolding) {
    setHoldings((hs) => hs.filter((x) => x.key !== h.key));
    setHoldingDraft(h);
    setHoldingResolution(null);
    // h.assetId is already resolved for h.ticker (it was only ever added
    // via addHolding's own resolvedTicker check above) — carrying that
    // forward means re-adding it unchanged doesn't spuriously demand a
    // fresh resolution, while any edit to the ticker text still clears it
    // via the input's onChange handler below.
    setResolvedTicker(h.ticker);
  }
```

Replace the Step 2 block's `<button onClick={() => setStep(3)}>Next: Current holdings →</button>` line — it's unchanged (Step 3 now has real content to advance to). Insert the Step 3 block immediately after Step 2's closing `)}`:

```tsx
      {step === 3 && (
        <div>
          <h2>What does {name} currently hold?</h2>
          <p>
            Add each position you currently hold as of {portfolioAsOfDate}. If this account is cash-only, skip
            straight to Review.
          </p>
          <p>For this account, you&apos;ll enter cost as:</p>
          <label><input type="radio" checked={costBasisMode === "average"} disabled={holdings.length > 0} onChange={() => setCostBasisMode("average")} /> Average cost per unit</label>{" "}
          <label><input type="radio" checked={costBasisMode === "total"} disabled={holdings.length > 0} onChange={() => setCostBasisMode("total")} /> Total cost basis</label>
          <p>Use whichever your broker/exchange statement shows — Calboard computes the other figure for you. Chosen once for this account; every holding below uses the same figure.</p>
          {holdings.length > 0 && (
            <p style={{ color: "#666", fontSize: "0.9em" }}>
              Cost-basis mode is locked once a holding has been added — remove every holding below to change it.
            </p>
          )}

          <label>Ticker symbol<br />
            <input
              value={holdingDraft.ticker}
              onChange={(e) => {
                // Per this session's final-review correction: the instant
                // the ticker text changes, any previous resolution is for a
                // DIFFERENT symbol and must never be reused — clear it
                // immediately rather than waiting for the next blur.
                const value = e.target.value;
                setHoldingDraft((d) => ({ ...d, ticker: value, assetId: null }));
                setHoldingResolution(null);
                setResolvedTicker(null);
              }}
              onBlur={handleHoldingTickerBlur}
              placeholder="e.g. AAPL, VOO, BTC"
            />
          </label><br />
          {resolving && <p>checking…</p>}
          {holdingResolution && holdingResolution.ok && (
            <p>✓ Resolved — last price ${holdingResolution.priceUsd} ({holdingResolution.priceDate})</p>
          )}
          {holdingResolution && !holdingResolution.ok && <p>{holdingResolution.message}</p>}
          <br />

          <label>Asset type<br />
            <select
              value={holdingDraft.assetClass}
              onChange={(e) => {
                // Asset class was part of what was resolved (resolveOrCreateAsset
                // is class-specific) — changing it invalidates the resolution
                // just like changing the ticker text does.
                const value = e.target.value as AssetClass;
                setHoldingDraft((d) => ({ ...d, assetClass: value, assetId: null }));
                setHoldingResolution(null);
                setResolvedTicker(null);
              }}
            >
              <option value="equity">Equity</option>
              <option value="etf">ETF</option>
              <option value="crypto">Crypto</option>
            </select>
          </label><br /><br />

          <label>Quantity you hold<br />
            <input value={holdingDraft.quantity} onChange={(e) => setHoldingDraft((d) => ({ ...d, quantity: e.target.value }))} />
          </label><br /><br />

          <label>{costBasisMode === "average" ? "Average cost per unit (USD)" : "Total cost basis (USD)"}<br />
            <input value={holdingDraft.costInput} onChange={(e) => setHoldingDraft((d) => ({ ...d, costInput: e.target.value }))} />
          </label><br /><br />

          {holdingError && <p style={{ color: "#b00020" }}>{holdingError}</p>}
          <button onClick={addHolding}>+ Add holding</button>

          <h3>Added so far</h3>
          {holdings.length === 0 ? (
            <p>No holdings added yet. Add one above, or continue if this account is cash-only.</p>
          ) : (
            <table border={1} cellPadding={6}>
              <thead><tr><th>Ticker</th><th>Type</th><th>Qty</th><th>Avg cost</th><th>Cost basis</th><th></th></tr></thead>
              <tbody>
                {holdings.map((h) => {
                  const avg = avgCostFor(h);
                  const quantity = new Decimal(h.quantity);
                  return (
                    <tr key={h.key}>
                      <td>{h.ticker}</td>
                      <td>{h.assetClass}</td>
                      <td>{quantity.toFixed(4)}</td>
                      <td>${avg.toFixed(2)}</td>
                      <td>${quantity.mul(avg).toFixed(2)}</td>
                      <td>
                        <button onClick={() => editHolding(h)}>Edit</button>{" "}
                        <button onClick={() => removeHolding(h.key)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <br />
          <button onClick={() => setStep(2)}>← Back</button>{" "}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={() => setStep(4)}>Next: Review →</button>
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: PASS, 15 tests (10 from Tasks 10–12 + 5 new).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/accounts/new`, walk to Step 3.

**UX acceptance check:** enter a ticker your active `MARKET_DATA_PROVIDER` can resolve (e.g. `AAPL`), tab out — see "checking…" then "✓ Resolved — last price $... (...)"; add it with a quantity/cost. Confirm both cost-basis radios are now disabled and the "locked" note appears. Enter a deliberately unresolvable ticker (e.g. `ZZZQQQ123`) — see the "Couldn't find a price..." message, and confirm Quantity/Cost/+Add holding still work (the override path — `holdingDraft.assetId` was still populated from `resolveOrCreateAsset` even though the price fetch failed). Try adding the first ticker again — see the inline duplicate error. Remove both holdings — the radios re-enable; toggle "Total cost basis" and re-add a holding — the cost field's label now reads "Total cost basis (USD)" and its Avg-cost cell is correctly derived. Click "Next: Review →" — nothing renders yet (expected, built in Task 15).

- [ ] **Step 6: Commit**

```bash
git add app/accounts/new/SetupWizard.tsx app/accounts/new/SetupWizard.test.tsx
git commit -m "feat: setup wizard Step 3 — ticker resolution (staleness-guarded), cost-basis mode (locked once a holding exists), repeatable holdings list"
```

**Functional acceptance check:** `npx vitest run app/accounts/new/SetupWizard.test.tsx` PASS, 15/15 — the lock test covers this session's "cost-basis mode after holdings already exist" requirement, and the new staleness test covers this session's CRITICAL "resolved ticker/asset identity must never go stale" requirement (resolve A → edit to B → submit blocked).
**UX acceptance check:** see Step 5 above.

---

### Task 14: `setupAccountAction` (`app/actions/setup.ts`, part 2)

**Files:**
- Modify: `app/actions/setup.ts` (append `setupAccountAction`)
- Modify: `app/actions/setup.test.ts` (append)

**Interfaces:**
- Consumes: `setupAccount`, `SetupCommitUncertainError` (Task 7), `verifySetup` (Task 8), `isValidCalendarDate`/`isFutureDate` (Task 2).
- Produces: `SetupWizardHolding`, `SetupWizardInput`, `SetupWizardResult`, `setupAccountAction(input)`. Consumed by Task 15's wizard Step 4.

Per this session's correction: `setupAccount()` commits before `verifySetup()` runs, so a thrown error from `verifySetup` (or from `revalidatePath`) must never be reported with "nothing was saved" copy — the account genuinely exists at that point. `SetupWizardResult` is now a 4-way discriminated union on a `status` field, and the commit and the post-commit verification are wrapped in **separate** `try/catch` blocks so each failure mode is reported accurately.

Per this session's final-review correction, this task also fixes three issues reachable only once this action exists:
- **A genuinely ambiguous commit outcome gets its own status.** `setupAccount` throwing `SetupCommitUncertainError` (Task 7) is neither a definite failure nor a definite success — it is mapped to a new `status: "save_unknown"`, distinct from `"save_failed"`, directing the user to check Accounts rather than either assuming nothing was saved or blindly retrying. This is never inferred by checking whether an account of the given name now exists (duplicate names are intentionally allowed, so that would prove nothing).
- **Cache revalidation happens BEFORE verification, not after.** The account is genuinely committed the instant `setupAccount()` returns — `revalidatePath` (now covering `/`, `/accounts`, **and** `/transactions`) runs immediately after that, so a subsequent failure in `verifySetup` can never leave the DB-backed pages serving stale cached data for an account that really was saved.
- **Quantity precision is normalized once, before it can diverge.** `positions_current.quantity` is `NUMERIC(28,10)` — `applyTransaction` already rounds to that on write. Every holding's quantity is rounded to `.toDecimalPlaces(10)` here, before the SAME rounded value is used for both `setupAccount`'s write and `verifySetup`'s `expectedHoldings`, so read-back verification can never falsely report a mismatch purely because of entered precision beyond what the column holds. `SetupWizardResult`'s `saved_verified` variant carries `roundedQuantityAssetIds` so the wizard can disclose this positively rather than let it look like a data-entry error.

- [ ] **Step 1: Write the failing test**

Append to `app/actions/setup.test.ts` — extend the imports at the top:

```ts
import { vi } from "vitest";
import Decimal from "decimal.js";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import * as verifySetupModule from "@/lib/ledger/verifySetup";
import * as setupAccountModule from "@/lib/ledger/setupAccount";
import { setupAccountAction } from "./setup";
```

`setupAccountAction` needs to be able to force a *post-commit* verification failure, and to force `setupAccount` itself to throw `SetupCommitUncertainError`, independently of a real DB failure — that requires spying on both real functions without disabling either for every other test. Add these partial mocks at the top level of the file (Vitest hoists `vi.mock` calls regardless of where they're written, but placing them near the imports is clearest):

```ts
vi.mock("@/lib/ledger/verifySetup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ledger/verifySetup")>();
  // Wraps the REAL verifySetup in a spy that calls through by default — every
  // test gets real behaviour unless it explicitly overrides one call with
  // .mockRejectedValueOnce/.mockResolvedValueOnce.
  return { ...actual, verifySetup: vi.fn(actual.verifySetup) };
});

vi.mock("@/lib/ledger/setupAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ledger/setupAccount")>();
  return { ...actual, setupAccount: vi.fn(actual.setupAccount) };
});
```

Per this session's final-review correction (item 8): a queued `.mockRejectedValueOnce()` on either mock must never leak into a LATER test that doesn't intend to simulate a failure — if some earlier assertion changes and the action under test returns before ever calling the mocked function, the queued rejection would sit unconsumed and fire unexpectedly on the next test that does call it. Add an explicit `beforeEach` inside the `describe("setupAccountAction", ...)` block below (Step 3) that resets both mocks back to their real implementation before every test, using `vi.importActual` directly (independent of the `importOriginal` closure above, and unaffected by whatever the previous test queued):

```ts
beforeEach(async () => {
  const actualVerifySetup = await vi.importActual<typeof import("@/lib/ledger/verifySetup")>("@/lib/ledger/verifySetup");
  vi.mocked(verifySetupModule.verifySetup).mockReset();
  vi.mocked(verifySetupModule.verifySetup).mockImplementation(actualVerifySetup.verifySetup);

  const actualSetupAccount = await vi.importActual<typeof import("@/lib/ledger/setupAccount")>("@/lib/ledger/setupAccount");
  vi.mocked(setupAccountModule.setupAccount).mockReset();
  vi.mocked(setupAccountModule.setupAccount).mockImplementation(actualSetupAccount.setupAccount);
});
```

Add a new `describe` block:

```ts
describe("setupAccountAction", () => {
  beforeEach(async () => {
    const actualVerifySetup = await vi.importActual<typeof import("@/lib/ledger/verifySetup")>("@/lib/ledger/verifySetup");
    vi.mocked(verifySetupModule.verifySetup).mockReset();
    vi.mocked(verifySetupModule.verifySetup).mockImplementation(actualVerifySetup.verifySetup);

    const actualSetupAccount = await vi.importActual<typeof import("@/lib/ledger/setupAccount")>("@/lib/ledger/setupAccount");
    vi.mocked(setupAccountModule.setupAccount).mockReset();
    vi.mocked(setupAccountModule.setupAccount).mockImplementation(actualSetupAccount.setupAccount);
  });

  it("rejects a future portfolio-as-of date without writing anything (status: save_failed)", async () => {
    const result = await setupAccountAction({
      name: "Future Date Test", custodian: "", portfolioAsOfDate: "2099-01-01",
      openingCashUsd: "100", holdings: [],
    });
    expect(result.status).toBe("save_failed");
    if (result.status === "save_failed") expect(result.message).toMatch(/future/i);

    const pool = getPool();
    const row = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Future Date Test"]);
    expect(row.rows).toHaveLength(0);
  });

  it("commits atomically and returns a matching verification on success (status: saved_verified)", async () => {
    const asset = await resolveOrCreateAsset("SETX", "equity", "Setup X Corp");
    const result = await setupAccountAction({
      name: "Action Setup Brokerage", custodian: "IBKR", portfolioAsOfDate: "2026-01-01",
      openingCashUsd: "1000", holdings: [{ assetId: asset.id, quantity: "5", avgCostUsd: "20" }],
    });
    expect(result.status).toBe("saved_verified");
    if (result.status === "saved_verified") {
      expect(result.verification.matches).toBe(true);
    }
  });

  it("rolls back and reports the failure when a holding is invalid, without touching the DB (status: save_failed)", async () => {
    const result = await setupAccountAction({
      name: "Invalid Holding Test", custodian: "", portfolioAsOfDate: "2026-01-01",
      openingCashUsd: "0", holdings: [{ assetId: "999999", quantity: "-1", avgCostUsd: "10" }],
    });
    expect(result.status).toBe("save_failed");

    const pool = getPool();
    const row = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Invalid Holding Test"]);
    expect(row.rows).toHaveLength(0);
  });

  it("returns saved_verification_error — never save_failed — when the commit succeeds but the read-back verification itself throws", async () => {
    const asset = await resolveOrCreateAsset("VERIFYERR", "equity", "Verify Error Corp");
    vi.mocked(verifySetupModule.verifySetup).mockRejectedValueOnce(new Error("simulated read-back failure"));

    const result = await setupAccountAction({
      name: "Verify Error Test", custodian: "", portfolioAsOfDate: "2026-01-01",
      openingCashUsd: "100", holdings: [{ assetId: asset.id, quantity: "1", avgCostUsd: "10" }],
    });

    expect(result.status).toBe("saved_verification_error");

    // The crux of the fix: the account was ACTUALLY committed. A UI that
    // reported this as "nothing was saved" would be lying to the user.
    const pool = getPool();
    const row = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Verify Error Test"]);
    expect(row.rows).toHaveLength(1);
  });

  it("normalizes a >10-decimal-place quantity to NUMERIC(28,10)'s own precision consistently, so read-back verification matches instead of reporting a false mismatch (round-trip)", async () => {
    const asset = await resolveOrCreateAsset("PRECISE", "crypto", "Precise Coin");
    const result = await setupAccountAction({
      name: "Precision Round Trip Test", custodian: "", portfolioAsOfDate: "2026-01-01",
      openingCashUsd: "0",
      holdings: [{ assetId: asset.id, quantity: "1.123456789012345", avgCostUsd: "10" }], // 15 decimal places
    });

    expect(result.status).toBe("saved_verified");
    if (result.status === "saved_verified") {
      // The core fix: normalizing BEFORE both the write and the expected
      // value means verifySetup never sees a divergence to report.
      expect(result.verification.matches).toBe(true);
      expect(result.roundedQuantityAssetIds).toContain(asset.id);
    }

    const pool = getPool();
    const posRow = await pool.query<{ quantity: string }>(
      `SELECT quantity FROM positions_current WHERE account_id = $1`,
      [result.status === "saved_verified" ? result.accountId : -1]
    );
    expect(posRow.rows[0].quantity).toBe("1.1234567890"); // rounded to exactly 10dp
  });

  it("returns status: save_unknown — never save_failed — when setupAccount's commit outcome is genuinely ambiguous", async () => {
    vi.mocked(setupAccountModule.setupAccount).mockRejectedValueOnce(
      new setupAccountModule.SetupCommitUncertainError("simulated in-doubt commit", new Error("connection reset"))
    );

    const result = await setupAccountAction({
      name: "Uncertain Commit Test", custodian: "", portfolioAsOfDate: "2026-01-01",
      openingCashUsd: "100", holdings: [],
    });

    expect(result.status).toBe("save_unknown");
    if (result.status === "save_unknown") {
      expect(result.message).toMatch(/check the accounts page/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/actions/setup.test.ts`
Expected: FAIL — `setupAccountAction` is not exported yet.

- [ ] **Step 3: Append the implementation to `app/actions/setup.ts`**

Add these imports to the top of the file (alongside the existing ones):

```ts
import { revalidatePath } from "next/cache";
import { setupAccount, SetupCommitUncertainError, type SetupHoldingInput } from "@/lib/ledger/setupAccount";
import { verifySetup, type VerifySetupResult } from "@/lib/ledger/verifySetup";
import { isValidCalendarDate, isFutureDate } from "@/lib/dateValidation";
```

Append to the end of the file:

```ts
export interface SetupWizardHolding {
  assetId: string;
  quantity: string;
  avgCostUsd: string;
}

export interface SetupWizardInput {
  name: string;
  custodian: string;
  portfolioAsOfDate: string;
  openingCashUsd: string;
  holdings: SetupWizardHolding[];
}

export type SetupWizardResult =
  | { status: "save_failed"; message: string }
  | { status: "save_unknown"; message: string }
  | { status: "saved_verified"; accountId: number; verification: VerifySetupResult; roundedQuantityAssetIds: string[] }
  | { status: "saved_verification_error"; accountId: number; verificationError: string };

// The Confirm & Save action (spec §4 Step 4): validates, atomically commits
// via setupAccount, then immediately runs the automatic read-back
// verification (spec §3.3) before returning. The commit and the
// verification are two SEPARATE try/catch blocks on purpose — once
// setupAccount() has returned successfully, the account is committed, and
// nothing past that point may be reported as "nothing was saved."
export async function setupAccountAction(input: SetupWizardInput): Promise<SetupWizardResult> {
  const name = input.name.trim();
  if (!name) return { status: "save_failed", message: "Account name is required." };
  if (!isValidCalendarDate(input.portfolioAsOfDate)) {
    return { status: "save_failed", message: "Portfolio as-of date must be a valid date." };
  }
  if (isFutureDate(input.portfolioAsOfDate)) {
    return { status: "save_failed", message: "Portfolio as of date cannot be in the future." };
  }

  let openingCashUsd: Decimal;
  try {
    openingCashUsd = new Decimal(input.openingCashUsd || "0");
  } catch {
    return { status: "save_failed", message: "Opening cash must be a valid number." };
  }
  if (openingCashUsd.lt(0)) {
    return { status: "save_failed", message: "Opening cash cannot be negative." };
  }

  const custodian = input.custodian.trim() || null;
  const holdings: SetupHoldingInput[] = [];
  const roundedQuantityAssetIds: string[] = [];
  for (const h of input.holdings) {
    let quantity: Decimal, avgCostUsd: Decimal;
    try {
      quantity = new Decimal(h.quantity);
      avgCostUsd = new Decimal(h.avgCostUsd);
    } catch {
      return { status: "save_failed", message: "Every holding needs a valid quantity and average cost." };
    }
    if (quantity.lte(0) || avgCostUsd.lte(0)) {
      return { status: "save_failed", message: "Quantity and average cost must be greater than zero." };
    }
    // positions_current.quantity is NUMERIC(28,10) — applyTransaction's own
    // INSERT already rounds to that via .toFixed(10). Rounding HERE too,
    // before the same value is used for both the write (setupAccount) and
    // the read-back comparison (verifySetup), keeps the two from silently
    // diverging into a false verification mismatch over entered precision
    // beyond what the column can hold.
    const normalizedQuantity = quantity.toDecimalPlaces(10);
    if (!normalizedQuantity.eq(quantity)) {
      roundedQuantityAssetIds.push(h.assetId);
    }
    holdings.push({ assetId: h.assetId, quantity: normalizedQuantity, avgCostUsd });
  }

  let accountId: number;
  try {
    const result = await setupAccount({
      name,
      custodian,
      portfolioAsOfDate: input.portfolioAsOfDate,
      openingCashUsd,
      holdings,
    });
    accountId = result.accountId;
  } catch (err) {
    if (err instanceof SetupCommitUncertainError) {
      // The commit's own outcome is ambiguous — NOT the same as a definite
      // "nothing was saved." Never inferred by checking whether an account
      // of this name now exists (duplicate names are intentionally
      // allowed, so a name match would prove nothing about whether THIS
      // attempt is the one that succeeded).
      return {
        status: "save_unknown",
        message:
          "We couldn't confirm whether this setup was saved. Check the Accounts page before trying again — " +
          "creating it a second time could result in a duplicate account if the first attempt actually succeeded.",
      };
    }
    // Nothing was saved — setupAccount rolled back the whole transaction.
    return { status: "save_failed", message: err instanceof Error ? err.message : "Setup failed — nothing was saved." };
  }

  // From this point on, the account IS committed. Revalidate the DB-backed
  // pages BEFORE running verification, so a verification failure below can
  // never skip cache invalidation for data that is genuinely saved.
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/transactions");

  try {
    const verification = await verifySetup({
      accountId,
      expectedName: name,
      expectedCustodian: custodian,
      expectedPortfolioAsOfDate: input.portfolioAsOfDate,
      expectedCashUsd: openingCashUsd,
      expectedHoldings: holdings,
    });
    return { status: "saved_verified", accountId, verification, roundedQuantityAssetIds };
  } catch (err) {
    return {
      status: "saved_verification_error",
      accountId,
      verificationError: err instanceof Error ? err.message : "Could not verify the saved data.",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/actions/setup.test.ts`
Expected: PASS, 10 tests (4 from Task 9 + 6 new).

Run: `npx tsc --noEmit 2>&1 | grep "app/actions/setup.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/actions/setup.ts app/actions/setup.test.ts
git commit -m "feat: setupAccountAction — validated, atomic, auto-verified account setup with a 4-way commit/verify outcome, pre-verification revalidation, and quantity-precision normalization"
```

**Functional acceptance check:** `npx vitest run app/actions/setup.test.ts` PASS, 10/10 — covers "Portfolio-as-of date validation" and "atomic rollback" at the action layer, this session's "commit succeeds, verification then fails" requirement via `saved_verification_error`, and this session's final-review requirements for the `>10dp` quantity round-trip and the `save_unknown` uncertain-commit outcome.
**UX acceptance check:** none yet — wired into the wizard's Step 4 in Task 15.

---

### Task 15: Wizard Step 4 — Review, Confirm & Save, verification outcome, Complete (wizard fully functional)

**Files:**
- Modify: `app/accounts/new/SetupWizard.tsx`
- Modify: `app/accounts/new/SetupWizard.test.tsx` (append)

**Interfaces:**
- Consumes: `setupAccountAction` (Task 14).
- Completes the wizard: Review screen with Edit links back to Steps 1–3, the sign-off checkbox gating Confirm & Save, double-submit prevention while saving, and the automatic verification outcome — now a genuine 3-way branch (Complete / Mismatch / Unverified) matching `setupAccountAction`'s `status` field, plus the Complete screen's two equal-weight actions.

Per this session's correction, this task also fixes two issues that only become reachable once this step's code exists:
- **Render-safety:** `totalStartingValueUsd` and the Step 4/Complete screens previously called `new Decimal(openingCashUsd || "0")` directly. That expression is evaluated on **every render**, regardless of which step is showing — so simply typing an intermediate invalid character (e.g. a lone `-`) into the Step 2 field, before ever clicking Next, would throw during render and crash the whole wizard. A `openingCashUsdSafe()` helper replaces every such call site; it never throws, falling back to `$0` display if the text is momentarily unparseable (Step 2's own gate, added in Task 12, is what actually prevents that unparseable value from ever reaching Confirm & Save).
- **3-way save outcome:** `handleConfirmSave` now branches on `setupAccountAction`'s `status` field. A `status: "saved_verification_error"` result — the commit succeeded but the read-back check itself failed — routes to a **new** `"unverified"` step, distinct from `"mismatch"` (verification ran and found a genuine difference). Both screens say the data **was** saved; neither can be confused with `"save_failed"`'s "Nothing was saved" copy.

This is the largest single change to the file — shown here as the complete, final `SetupWizard.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `app/accounts/new/SetupWizard.test.tsx` — extend the `@/app/actions/setup` mock (replacing the Task 13 version) to include `setupAccountAction`:

```tsx
let resolveSetupAccountAction: (value: unknown) => void;
const setupAccountActionMock = vi.fn(
  () => new Promise((resolve) => { resolveSetupAccountAction = resolve; })
);
vi.mock("@/app/actions/setup", () => ({
  checkAccountNameAction: (...args: unknown[]) => checkAccountNameActionMock(...args),
  resolveTickerAction: (...args: unknown[]) => resolveTickerActionMock(...args),
  setupAccountAction: (...args: unknown[]) => setupAccountActionMock(...args),
}));
```

Add `setupAccountActionMock.mockClear();` to the existing top-level `beforeEach`. Then add a new `describe` block:

```tsx
function goToReviewStep() {
  render(<SetupWizard />);
  fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Double Submit Test" } });
  fireEvent.click(screen.getByText("Next: Opening cash →"));
  fireEvent.click(screen.getByText("Next: Current holdings →"));
  fireEvent.click(screen.getByText("Next: Review →"));
}

describe("SetupWizard — Step 4 (Review) and Confirm & Save", () => {
  it("Confirm & Save is disabled until the sign-off checkbox is ticked", () => {
    goToReviewStep();
    expect(screen.getByText("Confirm & Save")).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    expect(screen.getByText("Confirm & Save")).toBeEnabled();
  });

  it("prevents double-submit: disables the button after the first click and calls the action exactly once", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));

    const confirmButton = screen.getByText("Confirm & Save");
    fireEvent.click(confirmButton);
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton); // second click while pending — native disabled semantics must block this
    expect(setupAccountActionMock).toHaveBeenCalledTimes(1);

    resolveSetupAccountAction({
      status: "saved_verified", accountId: 1,
      verification: { matches: true, mismatches: [] }, roundedQuantityAssetIds: [],
    });
    await waitFor(() => expect(screen.getByText(/Setup complete/i)).toBeInTheDocument());
  });

  it("shows the mismatch screen (not Complete) — and says the data WAS saved — when verification ran and found a real difference", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    fireEvent.click(screen.getByText("Confirm & Save"));

    resolveSetupAccountAction({
      status: "saved_verified", accountId: 1,
      verification: { matches: false, mismatches: ["cash: expected 0.00, found 5.00"] },
    });

    await waitFor(() => expect(screen.getByText(/was saved/i)).toBeInTheDocument());
    expect(screen.getByText("cash: expected 0.00, found 5.00")).toBeInTheDocument();
  });

  it("shows a distinct 'unverified' screen — and still says the data WAS saved — when the commit succeeded but verification itself errored", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    fireEvent.click(screen.getByText("Confirm & Save"));

    resolveSetupAccountAction({
      status: "saved_verification_error", accountId: 1, verificationError: "simulated read-back failure",
    });

    await waitFor(() => expect(screen.getByText(/setup was saved, but calboard couldn't automatically confirm/i)).toBeInTheDocument());
    // Must never be confused with the "Nothing was saved" copy used for a real save failure.
    expect(screen.queryByText(/nothing was saved/i)).not.toBeInTheDocument();
  });

  it("on a real save failure, stays on Review with the draft intact and shows the rejection banner", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    fireEvent.click(screen.getByText("Confirm & Save"));

    resolveSetupAccountAction({ status: "save_failed", message: "This account/asset already has a non-zero position on record" });

    await waitFor(() => expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument());
    expect(screen.getByText(/already has a non-zero position/)).toBeInTheDocument();
    expect(screen.getByText("Review against your statement")).toBeInTheDocument();
  });

  it("shows an uncertain-outcome banner (never 'Nothing was saved') and re-enables Confirm & Save, when the Server Action call itself rejects", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    setupAccountActionMock.mockRejectedValueOnce(new Error("simulated network drop"));

    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Nothing was saved/i)).not.toBeInTheDocument();
    // finally clears `saving` even on rejection — the user isn't stuck.
    expect(screen.getByText("Confirm & Save")).toBeEnabled();
  });

  it("shows a distinct uncertain-outcome banner for status: save_unknown — never confused with a definite save_failed", async () => {
    goToReviewStep();
    fireEvent.click(screen.getByLabelText(/checked these figures/i));
    fireEvent.click(screen.getByText("Confirm & Save"));

    resolveSetupAccountAction({
      status: "save_unknown",
      message: "We couldn't confirm whether this setup was saved. Check the Accounts page before trying again.",
    });

    await waitFor(() => expect(screen.getByText(/couldn't confirm whether this was saved/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Nothing was saved/i)).not.toBeInTheDocument();
  });
});

describe("SetupWizard — opening-cash render safety (spec: no unguarded new Decimal() on user text)", () => {
  it("does not crash when the opening-cash field holds unparseable text, even though totalStartingValueUsd is computed on every render regardless of step", () => {
    render(<SetupWizard />);
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Render Safety Test" } });
    fireEvent.click(screen.getByText("Next: Opening cash →"));

    const cashInput = screen.getByLabelText(/opening cash balance/i);
    expect(() => fireEvent.change(cashInput, { target: { value: "-" } })).not.toThrow();
    expect(() => fireEvent.change(cashInput, { target: { value: "12.34.56" } })).not.toThrow();
    expect(cashInput).toHaveValue("12.34.56");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: FAIL — Step 4 doesn't exist yet.

- [ ] **Step 3: Write the complete `app/accounts/new/SetupWizard.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import {
  resolveTickerAction,
  checkAccountNameAction,
  setupAccountAction,
  type TickerResolutionResult,
} from "@/app/actions/setup";
import { computeAvgCostUsd, isDuplicateTickerInDraft, type CostBasisMode } from "@/lib/wizard/draftHoldings";
import { localTodayIso } from "@/lib/dateValidation";
import type { AssetClass } from "@/lib/assets";

type Step = 1 | 2 | 3 | 4 | "complete" | "mismatch" | "unverified";

interface DraftHolding {
  key: string;
  ticker: string;
  assetId: string | null;
  assetClass: AssetClass;
  quantity: string;
  costInput: string; // interpreted per costBasisMode
}

function emptyHolding(): DraftHolding {
  return { key: Math.random().toString(36).slice(2), ticker: "", assetId: null, assetClass: "equity", quantity: "", costInput: "" };
}

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [name, setName] = useState("");
  const [custodian, setCustodian] = useState("");
  const [portfolioAsOfDate, setPortfolioAsOfDate] = useState(localTodayIso());
  const [nameWarning, setNameWarning] = useState<string | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2
  const [openingCashUsd, setOpeningCashUsd] = useState("0.00");
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3
  const [costBasisMode, setCostBasisMode] = useState<CostBasisMode>("average");
  const [holdings, setHoldings] = useState<DraftHolding[]>([]);
  const [holdingDraft, setHoldingDraft] = useState<DraftHolding>(emptyHolding());
  const [holdingResolution, setHoldingResolution] = useState<TickerResolutionResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  // The normalized ticker text that holdingDraft.assetId was actually
  // resolved for (per this session's final-review correction). Ticker
  // text and asset class can change after a resolution completes; without
  // tracking this separately and re-checking it in addHolding(), an edit
  // from a resolved "AAPL" to "MSFT" could submit MSFT's ticker text with
  // AAPL's already-resolved assetId.
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);

  // Step 4 / save
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null); // definite status: "save_failed"
  // Per this session's final-review correction: a genuinely uncertain
  // outcome — status: "save_unknown", OR the setupAccountAction call
  // itself rejecting (a transport/network failure) — is tracked SEPARATELY
  // from saveError, so the Review screen never reuses "Nothing was saved"
  // copy (a definite claim) for an outcome that is actually unknown.
  const [saveUncertain, setSaveUncertain] = useState<string | null>(null);
  const [mismatches, setMismatches] = useState<string[]>([]);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [roundedQuantityAssetIds, setRoundedQuantityAssetIds] = useState<string[]>([]);

  const hasEnteredContent =
    name.trim() !== "" || custodian.trim() !== "" || openingCashUsd !== "0.00" || holdings.length > 0;

  function resetAll() {
    setStep(1);
    setName(""); setCustodian(""); setPortfolioAsOfDate(localTodayIso()); setNameWarning(null); setStep1Error(null);
    setOpeningCashUsd("0.00"); setStep2Error(null);
    setCostBasisMode("average"); setHoldings([]); setHoldingDraft(emptyHolding()); setHoldingResolution(null); setHoldingError(null); setResolvedTicker(null);
    setConfirmChecked(false); setSaving(false); setSaveError(null); setSaveUncertain(null); setMismatches([]); setVerificationError(null); setRoundedQuantityAssetIds([]);
  }

  function handleCancel() {
    if (hasEnteredContent && !window.confirm("Discard everything entered so far?")) return;
    router.push("/accounts");
  }

  async function handleNameBlur() {
    if (!name.trim()) { setNameWarning(null); return; }
    const result = await checkAccountNameAction(name.trim());
    setNameWarning(
      result.exists
        ? `An account named "${name.trim()}" already exists — continuing is fine if this is a different account.`
        : null
    );
  }

  function goToStep2() {
    if (!name.trim()) { setStep1Error("Account name is required."); return; }
    if (!portfolioAsOfDate) { setStep1Error("Portfolio as-of date is required."); return; }
    if (portfolioAsOfDate > localTodayIso()) { setStep1Error("Portfolio as of date cannot be in the future."); return; }
    setStep1Error(null);
    setStep(2);
  }

  // Render-safety: parses openingCashUsd for DISPLAY only, never throwing.
  // totalStartingValueUsd below is computed on every render regardless of
  // which step is showing, so an unguarded new Decimal(openingCashUsd) would
  // crash the whole wizard the moment the user typed an intermediate
  // unparseable character into Step 2's field — long before Step 2's own
  // goToStep3 gate ever runs. goToStep3 is what stops a genuinely invalid
  // value from being carried into Confirm & Save; this helper is what stops
  // it from crashing the render in the meantime.
  function openingCashUsdSafe(): Decimal {
    try {
      const d = new Decimal(openingCashUsd || "0");
      return d.isFinite() ? d : new Decimal(0);
    } catch {
      return new Decimal(0);
    }
  }

  function goToStep3() {
    let value: Decimal;
    try {
      value = new Decimal(openingCashUsd || "0");
    } catch {
      setStep2Error("Enter a valid dollar amount.");
      return;
    }
    if (!value.isFinite() || value.lt(0)) {
      setStep2Error("Opening cash cannot be negative.");
      return;
    }
    setStep2Error(null);
    setStep(3);
  }

  async function handleHoldingTickerBlur() {
    const normalized = holdingDraft.ticker.trim().toUpperCase();
    if (!normalized) return;
    setResolving(true);
    const result = await resolveTickerAction(holdingDraft.ticker, holdingDraft.assetClass);
    setResolving(false);
    setHoldingResolution(result);
    setResolvedTicker(normalized);
    setHoldingDraft((d) => ({ ...d, assetId: result.assetId }));
  }

  function avgCostFor(h: DraftHolding): Decimal {
    return computeAvgCostUsd(new Decimal(h.quantity), new Decimal(h.costInput), costBasisMode);
  }

  function addHolding() {
    setHoldingError(null);
    const ticker = holdingDraft.ticker.trim().toUpperCase();
    if (!ticker) { setHoldingError("Enter a ticker symbol."); return; }
    // Per this session's final-review correction: require the CURRENT
    // normalized ticker to still match what holdingDraft.assetId was
    // actually resolved for. onChange below already clears assetId the
    // instant the ticker text or asset type changes, so this is a second,
    // explicit guard against ever adding a holding whose visible ticker
    // doesn't match its resolved identity.
    if (!holdingDraft.assetId || resolvedTicker !== ticker) {
      setHoldingError("Resolve the ticker first (wait for the checking… state to finish, or re-enter it if you changed it after resolving).");
      return;
    }
    if (isDuplicateTickerInDraft(holdings.map((h) => h.ticker), ticker)) {
      setHoldingError(`${ticker} is already in this account's list.`);
      return;
    }
    let quantity: Decimal, costInput: Decimal;
    try {
      quantity = new Decimal(holdingDraft.quantity);
      costInput = new Decimal(holdingDraft.costInput);
    } catch {
      setHoldingError("Quantity and cost must be valid numbers.");
      return;
    }
    if (quantity.lte(0) || costInput.lte(0)) {
      setHoldingError("Quantity and cost must be greater than zero.");
      return;
    }
    setHoldings((hs) => [...hs, { ...holdingDraft, ticker }]);
    setHoldingDraft(emptyHolding());
    setHoldingResolution(null);
    setResolvedTicker(null);
  }

  function removeHolding(key: string) {
    setHoldings((hs) => hs.filter((h) => h.key !== key));
  }

  function editHolding(h: DraftHolding) {
    setHoldings((hs) => hs.filter((x) => x.key !== h.key));
    setHoldingDraft(h);
    setHoldingResolution(null);
    // h.assetId is already resolved for h.ticker (it was only ever added
    // via addHolding's own resolvedTicker check above) — carrying that
    // forward means re-adding it unchanged doesn't spuriously demand a
    // fresh resolution, while any edit to the ticker text still clears it
    // via the input's onChange handler below.
    setResolvedTicker(h.ticker);
  }

  const totalStartingValueUsd = holdings.reduce(
    (sum, h) => sum.add(new Decimal(h.quantity).mul(avgCostFor(h))),
    openingCashUsdSafe()
  );

  async function handleConfirmSave() {
    setSaving(true);
    setSaveError(null);
    setSaveUncertain(null);
    try {
      const result = await setupAccountAction({
        name: name.trim(),
        custodian: custodian.trim(),
        portfolioAsOfDate,
        openingCashUsd,
        holdings: holdings.map((h) => ({
          assetId: h.assetId!,
          quantity: h.quantity,
          avgCostUsd: avgCostFor(h).toFixed(10),
        })),
      });
      if (result.status === "save_failed") {
        setSaveError(result.message);
        return;
      }
      if (result.status === "save_unknown") {
        setSaveUncertain(result.message);
        return;
      }
      if (result.status === "saved_verification_error") {
        setVerificationError(result.verificationError);
        setStep("unverified");
        return;
      }
      // result.status === "saved_verified"
      setRoundedQuantityAssetIds(result.roundedQuantityAssetIds);
      if (result.verification.matches) {
        setStep("complete");
      } else {
        setMismatches(result.verification.mismatches);
        setStep("mismatch");
      }
    } catch {
      // The setupAccountAction call itself rejected — a transport/network
      // failure, not a returned outcome. We genuinely don't know whether
      // the commit reached the server, so this must never be shown with
      // "Nothing was saved" copy (a definite claim), and must never invite
      // a blind retry.
      setSaveUncertain(
        "We couldn't reach the server to confirm whether this setup was saved. Check the Accounts page before " +
          "trying again — submitting again could create a duplicate account if the first attempt actually succeeded."
      );
    } finally {
      setSaving(false);
    }
  }

  if (step === "complete") {
    const roundedTickers = holdings
      .filter((h) => h.assetId && roundedQuantityAssetIds.includes(h.assetId))
      .map((h) => h.ticker);
    return (
      <div>
        <h1>Setup complete for {name}</h1>
        <p>Cash: ${openingCashUsdSafe().toFixed(2)} &middot; Holdings: {holdings.length} position{holdings.length === 1 ? "" : "s"}</p>
        {roundedTickers.length > 0 && (
          <p style={{ color: "#666", fontSize: "0.9em" }}>
            Note: the quantity entered for {roundedTickers.join(", ")} had more decimal places than Calboard
            stores — it was rounded to 10 decimal places for storage.
          </p>
        )}
        <button onClick={resetAll}>+ Add another account</button>{" "}
        <button onClick={() => router.push("/")}>Go to dashboard →</button>
      </div>
    );
  }

  if (step === "mismatch") {
    return (
      <div>
        <p>
          Your account was saved, but the saved data doesn&apos;t exactly match what you approved. This needs a
          closer look — compare the figures below against your broker/exchange statement and the Accounts page.
        </p>
        <ul>{mismatches.map((m, i) => <li key={i}>{m}</li>)}</ul>
        <button onClick={() => router.push("/accounts")}>Go to Accounts</button>
      </div>
    );
  }

  if (step === "unverified") {
    return (
      <div>
        <p>
          Your setup was saved, but Calboard couldn&apos;t automatically confirm the saved data matches what you
          approved. This is a system issue, not a sign your broker figures were wrong. Check the Accounts page, or
          try refreshing.
        </p>
        {verificationError && <p style={{ color: "#888", fontSize: "0.9em" }}>({verificationError})</p>}
        <button onClick={() => router.push("/accounts")}>Go to Accounts</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Let&apos;s set up an account</h1>

      {step === 1 && (
        <div>
          <p>
            An account is a brokerage, exchange, or bank account you hold investments or cash in — e.g. Interactive
            Brokers, Coinbase, DBS Multiplier.
          </p>
          <label>Account name (required)<br />
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={handleNameBlur} placeholder="e.g. Interactive Brokers, Coinbase, DBS Multiplier" />
          </label>
          {nameWarning && <p style={{ color: "#a15c00" }}>{nameWarning}</p>}
          <br /><br />
          <label>Custodian / broker (optional)<br />
            <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="The bank or broker that holds this account." />
          </label><br /><br />
          <label>Portfolio as of (required)<br />
            <input type="date" value={portfolioAsOfDate} onChange={(e) => setPortfolioAsOfDate(e.target.value)} />
          </label>
          <p>
            These balances and holdings are correct as of this date. From the next day onward, record every real
            transaction in Calboard under Transactions — don&apos;t also enter transactions from before this date here.
          </p>
          {step1Error && <p style={{ color: "#b00020" }}>{step1Error}</p>}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={goToStep2}>Next: Opening cash →</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2>How much cash does {name} currently hold?</h2>
          <p>
            This is a starting balance, not a transaction — the amount sitting in this account as of{" "}
            {portfolioAsOfDate}. Leave it at $0 if there&apos;s no cash to declare.
          </p>
          <label>Opening cash balance (USD)<br />
            <input value={openingCashUsd} onChange={(e) => setOpeningCashUsd(e.target.value)} />
          </label>
          <p>Enter 0 if this account holds no cash right now.</p>
          {step2Error && <p style={{ color: "#b00020" }}>{step2Error}</p>}
          <button onClick={() => setStep(1)}>← Back</button>{" "}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={goToStep3}>Next: Current holdings →</button>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>What does {name} currently hold?</h2>
          <p>
            Add each position you currently hold as of {portfolioAsOfDate}. If this account is cash-only, skip
            straight to Review.
          </p>
          <p>For this account, you&apos;ll enter cost as:</p>
          <label><input type="radio" checked={costBasisMode === "average"} disabled={holdings.length > 0} onChange={() => setCostBasisMode("average")} /> Average cost per unit</label>{" "}
          <label><input type="radio" checked={costBasisMode === "total"} disabled={holdings.length > 0} onChange={() => setCostBasisMode("total")} /> Total cost basis</label>
          <p>Use whichever your broker/exchange statement shows — Calboard computes the other figure for you. Chosen once for this account; every holding below uses the same figure.</p>
          {holdings.length > 0 && (
            <p style={{ color: "#666", fontSize: "0.9em" }}>
              Cost-basis mode is locked once a holding has been added — remove every holding below to change it.
            </p>
          )}

          <label>Ticker symbol<br />
            <input
              value={holdingDraft.ticker}
              onChange={(e) => {
                // Per this session's final-review correction: the instant
                // the ticker text changes, any previous resolution is for a
                // DIFFERENT symbol and must never be reused — clear it
                // immediately rather than waiting for the next blur.
                const value = e.target.value;
                setHoldingDraft((d) => ({ ...d, ticker: value, assetId: null }));
                setHoldingResolution(null);
                setResolvedTicker(null);
              }}
              onBlur={handleHoldingTickerBlur}
              placeholder="e.g. AAPL, VOO, BTC"
            />
          </label><br />
          {resolving && <p>checking…</p>}
          {holdingResolution && holdingResolution.ok && (
            <p>✓ Resolved — last price ${holdingResolution.priceUsd} ({holdingResolution.priceDate})</p>
          )}
          {holdingResolution && !holdingResolution.ok && <p>{holdingResolution.message}</p>}
          <br />

          <label>Asset type<br />
            <select
              value={holdingDraft.assetClass}
              onChange={(e) => {
                // Asset class was part of what was resolved (resolveOrCreateAsset
                // is class-specific) — changing it invalidates the resolution
                // just like changing the ticker text does.
                const value = e.target.value as AssetClass;
                setHoldingDraft((d) => ({ ...d, assetClass: value, assetId: null }));
                setHoldingResolution(null);
                setResolvedTicker(null);
              }}
            >
              <option value="equity">Equity</option>
              <option value="etf">ETF</option>
              <option value="crypto">Crypto</option>
            </select>
          </label><br /><br />

          <label>Quantity you hold<br />
            <input value={holdingDraft.quantity} onChange={(e) => setHoldingDraft((d) => ({ ...d, quantity: e.target.value }))} />
          </label><br /><br />

          <label>{costBasisMode === "average" ? "Average cost per unit (USD)" : "Total cost basis (USD)"}<br />
            <input value={holdingDraft.costInput} onChange={(e) => setHoldingDraft((d) => ({ ...d, costInput: e.target.value }))} />
          </label><br /><br />

          {holdingError && <p style={{ color: "#b00020" }}>{holdingError}</p>}
          <button onClick={addHolding}>+ Add holding</button>

          <h3>Added so far</h3>
          {holdings.length === 0 ? (
            <p>No holdings added yet. Add one above, or continue if this account is cash-only.</p>
          ) : (
            <table border={1} cellPadding={6}>
              <thead><tr><th>Ticker</th><th>Type</th><th>Qty</th><th>Avg cost</th><th>Cost basis</th><th></th></tr></thead>
              <tbody>
                {holdings.map((h) => {
                  const avg = avgCostFor(h);
                  const quantity = new Decimal(h.quantity);
                  return (
                    <tr key={h.key}>
                      <td>{h.ticker}</td>
                      <td>{h.assetClass}</td>
                      <td>{quantity.toFixed(4)}</td>
                      <td>${avg.toFixed(2)}</td>
                      <td>${quantity.mul(avg).toFixed(2)}</td>
                      <td>
                        <button onClick={() => editHolding(h)}>Edit</button>{" "}
                        <button onClick={() => removeHolding(h.key)}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <br />
          <button onClick={() => setStep(2)}>← Back</button>{" "}
          <button onClick={handleCancel}>Cancel setup</button>{" "}
          <button onClick={() => setStep(4)}>Next: Review →</button>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2>Review against your statement</h2>
          <p>Nothing has been saved yet. Compare everything below against your broker/exchange statement, then confirm.</p>

          <p>Account — {name}{custodian ? ` (${custodian})` : ""} <button onClick={() => setStep(1)}>Edit</button></p>
          <p>Portfolio as of — {portfolioAsOfDate} <button onClick={() => setStep(1)}>Edit</button></p>
          <p>Opening cash — ${openingCashUsdSafe().toFixed(2)} <button onClick={() => setStep(2)}>Edit</button></p>

          <p>Holdings <button onClick={() => setStep(3)}>Edit</button></p>
          {holdings.length === 0 ? (
            <p>No holdings — cash-only account.</p>
          ) : (
            <table border={1} cellPadding={6}>
              <thead><tr><th>Ticker</th><th>Type</th><th>Qty</th><th>Avg cost</th><th>Cost basis</th></tr></thead>
              <tbody>
                {holdings.map((h) => {
                  const avg = avgCostFor(h);
                  const quantity = new Decimal(h.quantity);
                  return (
                    <tr key={h.key}>
                      <td>{h.ticker}</td><td>{h.assetClass}</td><td>{quantity.toFixed(4)}</td>
                      <td>${avg.toFixed(2)}</td><td>${quantity.mul(avg).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p>Total starting value entered: ${totalStartingValueUsd.toFixed(2)}</p>
          <p>Based on your entered average cost, not live market prices.</p>

          <label>
            <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />{" "}
            I have checked these figures against my broker/exchange statement.
          </label><br /><br />

          {saveError && (
            <p style={{ color: "#b00020" }}>Nothing was saved. Fix the issue below and try again.<br />{saveError}</p>
          )}
          {saveUncertain && (
            <p style={{ color: "#b00020" }}>
              We couldn&apos;t confirm whether this was saved — do not assume nothing was saved.<br />{saveUncertain}
            </p>
          )}

          <button onClick={handleConfirmSave} disabled={!confirmChecked || saving}>
            {saving ? "Saving…" : "Confirm & Save"}
          </button>
          <p>After saving, any corrections are recorded separately so your portfolio history stays accurate.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/accounts/new/SetupWizard.test.tsx`
Expected: PASS, 23 tests (15 from Tasks 10–13 + 8 new).

- [ ] **Step 5: Manual verification — full wizard walkthrough**

With `npm run dev` running and the dev DB still empty of accounts (true at this point in the plan):

1. Open `http://localhost:3000/accounts/new`, walk through Steps 1–3 as in Tasks 10/12/13, adding one resolvable holding and one "Add anyway" unresolvable holding.
2. Click "Next: Review →". Expected: Review screen lists both holdings with correct per-row and total figures; "Confirm & Save" is disabled until the checkbox is ticked; each section has a working "Edit" button that returns to the right step with data intact.
3. Tick the checkbox, click "Confirm & Save". Expected: brief "Saving…" (button disabled), then the Complete screen naming the account, its cash, and holding count.
4. Click "Go to dashboard →". Expected: navigates to `/`.

**UX acceptance check:** all of the above. The five failure/outcome paths (save failed, saved-but-mismatched, saved-but-unverified, uncertain/save_unknown, transport rejection) are exercised precisely and deterministically by the automated tests above (Step 4) rather than manually — the "commit succeeds, verification then fails" scenario in particular isn't practically reproducible by hand (it requires a read-back that fails after a write that succeeded, which is what Task 14's mocked `verifySetup` test is for). As a lighter manual sanity check only, stopping Postgres mid-Confirm (`docker compose stop postgres`, click Confirm & Save, then `docker compose start postgres`) should show either the "Nothing was saved" banner (the connection drops before COMMIT is ever reached — the common case) or the distinct "couldn't confirm whether this was saved" banner (if the drop happens to land during the COMMIT round-trip itself) — never the reverse of what actually happened.

- [ ] **Step 6: Commit**

```bash
git add app/accounts/new/SetupWizard.tsx app/accounts/new/SetupWizard.test.tsx
git commit -m "feat: setup wizard Step 4 — review, atomic Confirm & Save, 4-way verification outcome (incl. uncertain-commit and transport-rejection handling), render-safe opening-cash display, rounded-quantity disclosure"
```

**Functional acceptance check:** `npx vitest run app/accounts/new/SetupWizard.test.tsx` PASS, 23/23 — directly covers "double-submit prevention" and "opening cash validation / render safety" per this session's required test list, plus the now-4-way Complete/Mismatch/Unverified/Uncertain branching (the "commit succeeds, verification then fails" case is exercised precisely at Task 14's action layer; this level confirms the UI routes it to the distinct "unverified" screen and never shows "Nothing was saved"), and this session's final-review requirements for a rejected Server Action call and a `save_unknown` result (both bannered distinctly from a definite save failure, and both leave Confirm & Save re-enabled via the `finally` block).
**UX acceptance check:** see Step 5 above. The wizard is now fully functional end to end.

---

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

### Task 17: Dashboard price-health upgrade (`PriceCell`, retry action)

**Files:**
- Create: `app/components/PriceCell.tsx`, `app/actions/prices.ts`
- Modify: `app/page.tsx`

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

### Task 18: Sell-picker holdings query (`lib/holdings.ts`)

**Files:**
- Create: `lib/holdings.ts`
- Test: `lib/holdings.test.ts`

**Interfaces:**
- Produces: `AccountHolding { assetId: string; symbol: string; assetClass: AssetClass; quantity: Decimal }`, `getAccountHoldings(accountId: number): Promise<AccountHolding[]>`. Consumed by Task 24's `getAccountHoldingsAction` (the Sell picker). Originally also planned for a Reconcile page's holdings display — that page is deferred (see Tasks 19–20) — but this function is unaffected and still required on its own for the Sell picker.

- [ ] **Step 1: Write the failing test**

Create `lib/holdings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { getAccountHoldings } from "./holdings";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("getAccountHoldings", () => {
  it("returns only this account's non-zero positions", async () => {
    const account = await createAccount("Holdings Test", null);
    const other = await createAccount("Other Account", null);
    const held = await resolveOrCreateAsset("HELD", "equity", "Held Corp");
    const closed = await resolveOrCreateAsset("CLOSED", "equity", "Closed Corp");

    await applyTransaction({
      accountId: account.id, assetId: held.id, txnType: "BUY",
      tradeDate: "2026-01-01", quantity: new Decimal(10), priceUsd: new Decimal(5),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: closed.id, txnType: "BUY",
      tradeDate: "2026-01-01", quantity: new Decimal(4), priceUsd: new Decimal(5),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: closed.id, txnType: "SELL",
      tradeDate: "2026-01-02", quantity: new Decimal(4), priceUsd: new Decimal(6),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: other.id, assetId: held.id, txnType: "BUY",
      tradeDate: "2026-01-01", quantity: new Decimal(1), priceUsd: new Decimal(5),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const holdings = await getAccountHoldings(account.id);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].symbol).toBe("HELD");
    expect(holdings[0].quantity.toFixed(4)).toBe("10.0000");
  });

  it("returns an empty list for an account with no holdings", async () => {
    const account = await createAccount("Empty Holdings", null);
    expect(await getAccountHoldings(account.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/holdings.test.ts`
Expected: FAIL — `./holdings` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/holdings.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";
import type { AssetClass } from "./assets";

export interface AccountHolding {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: Decimal;
}

// Spec §6: the Sell form's "Holding" picker selects from the account's real
// current holdings instead of a free-text ticker + a separately chosen,
// contradictable asset-type field. (Originally also planned for the
// Reconcile page's holdings display, §7.2 — that page is deferred, see
// Tasks 19–20 — but this function stands on its own for the Sell picker.)
export async function getAccountHoldings(accountId: number): Promise<AccountHolding[]> {
  const pool = getPool();
  const result = await pool.query<{
    asset_id: string; symbol: string; asset_class: AssetClass; quantity: string;
  }>(
    `SELECT pc.asset_id, a.primary_symbol AS symbol, a.asset_class, pc.quantity
     FROM positions_current pc
     JOIN assets a ON a.id = pc.asset_id
     WHERE pc.account_id = $1 AND pc.quantity <> 0
     ORDER BY a.primary_symbol`,
    [accountId]
  );
  return result.rows.map((r) => ({
    assetId: r.asset_id,
    symbol: r.symbol,
    assetClass: r.asset_class,
    quantity: new Decimal(r.quantity),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/holdings.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/holdings.ts lib/holdings.test.ts
git commit -m "feat: getAccountHoldings for the Sell picker and Reconcile display (spec 6, 7.2)"
```

**Functional acceptance check:** `npx vitest run lib/holdings.test.ts` PASS, 2/2.
**UX acceptance check:** none yet — wired into the UI in Tasks 20 and 25.

---

### Task 19: Accounts page populated state (Reconcile link) — deferred

**Decision (narrow-correction-pass review):** the approved §7.2 design describes a genuine broker-statement comparison — broker-reported cash *and*, per holding, broker-reported quantity/cost entered beside Calboard's current values, with a computed Match/Difference. `recordAccountReconciliation` (`lib/accountReconciliation.ts`, unchanged) only ever accepted a single cash figure — it has no per-holding broker-input parameter and never did. Shipping a page titled "Reconcile" that silently only checks cash, while displaying a holdings table the user can look at but never actually reconcile against, would be a misleading half-version of the approved feature rather than a legitimate minimum slice of it.

Per this session's explicit instruction, this task (the Accounts page's "Reconcile" link) and Task 20 (the Reconcile page/action/form) are **deliberately deferred out of this pass** rather than built. `app/accounts/page.tsx` stays exactly as Task 4 left it — no Reconcile link, no route to a page that doesn't exist. `getAccountHoldings` (Task 18) is unaffected and retained — it's independently required by Task 25's Sell picker.

No files are created or modified by this task. No commit.

**Functional acceptance check:** n/a — nothing built.
**UX acceptance check:** n/a — `/accounts` continues to show exactly what Task 4 built.

---

### Task 20: (folded into Task 19's deferral — see above)

No files, no commit. Retained as a numbered slot only so every other task's numbering and cross-references in this plan stay stable.

---

### Task 21: Duplicate-transaction check (`lib/duplicateTransactionCheck.ts`)

**Files:**
- Create: `lib/duplicateTransactionCheck.ts`
- Test: `lib/duplicateTransactionCheck.test.ts`

**Interfaces:**
- Consumes: `normalizePgDate` (Task 2).
- Produces: `DuplicateCheckInput { accountId: number; assetId: string; txnType: "BUY" | "SELL"; quantity: Decimal; priceUsd: Decimal; tradeDate: string }`, `LikelyDuplicate { transactionId: string; tradeDate: string }`, `findLikelyDuplicateTransaction(input): Promise<LikelyDuplicate | null>`. Consumed by Task 24's `submitTransactionAction`.

- [ ] **Step 1: Write the failing test**

Create `lib/duplicateTransactionCheck.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { findLikelyDuplicateTransaction } from "./duplicateTransactionCheck";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("findLikelyDuplicateTransaction", () => {
  it("finds a same account/asset/type/quantity/price transaction within the date window", async () => {
    const account = await createAccount("Dup Test", null);
    const asset = await resolveOrCreateAsset("DUP", "equity", "Dup Corp");
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-10", quantity: new Decimal(10), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const found = await findLikelyDuplicateTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      quantity: new Decimal(10), priceUsd: new Decimal(50), tradeDate: "2026-01-12",
    });
    expect(found).not.toBeNull();
    expect(found!.tradeDate).toBe("2026-01-10");
  });

  it("does not flag a transaction with a different quantity", async () => {
    const account = await createAccount("Dup Test 2", null);
    const asset = await resolveOrCreateAsset("DUP2", "equity", "Dup Corp 2");
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-10", quantity: new Decimal(10), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const found = await findLikelyDuplicateTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      quantity: new Decimal(20), priceUsd: new Decimal(50), tradeDate: "2026-01-11",
    });
    expect(found).toBeNull();
  });

  it("does not flag a transaction outside the date window", async () => {
    const account = await createAccount("Dup Test 3", null);
    const asset = await resolveOrCreateAsset("DUP3", "equity", "Dup Corp 3");
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-01", quantity: new Decimal(10), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const found = await findLikelyDuplicateTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      quantity: new Decimal(10), priceUsd: new Decimal(50), tradeDate: "2026-01-10",
    });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/duplicateTransactionCheck.test.ts`
Expected: FAIL — `./duplicateTransactionCheck` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/duplicateTransactionCheck.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";
import { normalizePgDate } from "./dateValidation";

export interface DuplicateCheckInput {
  accountId: number;
  assetId: string;
  txnType: "BUY" | "SELL";
  quantity: Decimal;
  priceUsd: Decimal;
  tradeDate: string; // YYYY-MM-DD
}

export interface LikelyDuplicate {
  transactionId: string;
  tradeDate: string;
}

// Display-only judgment call (spec §7.1 doesn't specify an exact window):
// ±3 days catches same-trade double-entry without flagging genuinely
// repeated regular trades further apart.
const DUPLICATE_WINDOW_DAYS = 3;

export async function findLikelyDuplicateTransaction(
  input: DuplicateCheckInput
): Promise<LikelyDuplicate | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string; trade_date: string }>(
    `SELECT id, trade_date FROM transactions
     WHERE account_id = $1 AND asset_id = $2 AND txn_type = $3
       AND quantity = $4 AND price_usd = $5
       AND trade_date BETWEEN $6::date - $7::int AND $6::date + $7::int
     ORDER BY trade_date DESC
     LIMIT 1`,
    [
      input.accountId,
      input.assetId,
      input.txnType,
      input.quantity.toFixed(10),
      input.priceUsd.toFixed(10),
      input.tradeDate,
      DUPLICATE_WINDOW_DAYS,
    ]
  );
  if (result.rows.length === 0) return null;
  return { transactionId: result.rows[0].id, tradeDate: normalizePgDate(result.rows[0].trade_date) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/duplicateTransactionCheck.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/duplicateTransactionCheck.ts lib/duplicateTransactionCheck.test.ts
git commit -m "feat: non-blocking duplicate-transaction check (spec 7.1)"
```

**Functional acceptance check:** `npx vitest run lib/duplicateTransactionCheck.test.ts` PASS, 3/3 — covers "duplicate-transaction warning" at the query level; Task 24 adds action-level coverage of the full warn→confirm flow.
**UX acceptance check:** none yet — wired into the Transactions page in Task 25.

---

### Task 22: Cash-preview pure function (`lib/transactionPreview.ts`)

**Files:**
- Create: `lib/transactionPreview.ts`
- Test: `lib/transactionPreview.test.ts`

**Interfaces:**
- Produces: `PreviewTxnType`, `CashPreviewInput`, `computeCashPreview(input): Decimal | null`. Consumed by Task 25's `TransactionForm.tsx` — extracted as a pure function specifically so "correct Buy/Sell/Deposit/Withdrawal cash previews" (explicitly required by this session) gets a real unit test instead of only being exercised indirectly through component rendering.

- [ ] **Step 1: Write the failing test**

Create `lib/transactionPreview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCashPreview } from "./transactionPreview";

describe("computeCashPreview", () => {
  const currentCashUsd = new Decimal(1000);

  it("Deposit increases cash by the entered amount", () => {
    const result = computeCashPreview({ txnType: "DEPOSIT", currentCashUsd, amountUsd: new Decimal(200), feesUsd: new Decimal(0) });
    expect(result!.toFixed(2)).toBe("1200.00");
  });

  it("Withdrawal decreases cash by the entered amount", () => {
    const result = computeCashPreview({ txnType: "WITHDRAWAL", currentCashUsd, amountUsd: new Decimal(150), feesUsd: new Decimal(0) });
    expect(result!.toFixed(2)).toBe("850.00");
  });

  it("Buy decreases cash by quantity*price plus fees", () => {
    const result = computeCashPreview({
      txnType: "BUY", currentCashUsd, quantity: new Decimal(10), priceUsd: new Decimal(20), feesUsd: new Decimal(5),
    });
    expect(result!.toFixed(2)).toBe("795.00"); // 1000 - 200 - 5
  });

  it("Sell increases cash by quantity*price minus fees", () => {
    const result = computeCashPreview({
      txnType: "SELL", currentCashUsd, quantity: new Decimal(10), priceUsd: new Decimal(20), feesUsd: new Decimal(5),
    });
    expect(result!.toFixed(2)).toBe("1195.00"); // 1000 + 200 - 5
  });

  it("returns null when required fields for the chosen type aren't entered yet", () => {
    expect(computeCashPreview({ txnType: "BUY", currentCashUsd, feesUsd: new Decimal(0) })).toBeNull();
    expect(computeCashPreview({ txnType: "DEPOSIT", currentCashUsd, feesUsd: new Decimal(0) })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/transactionPreview.test.ts`
Expected: FAIL — `./transactionPreview` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/transactionPreview.ts`:

```ts
import Decimal from "decimal.js";

export type PreviewTxnType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";

export interface CashPreviewInput {
  txnType: PreviewTxnType;
  currentCashUsd: Decimal;
  amountUsd?: Decimal | null; // deposit/withdrawal
  quantity?: Decimal | null; // buy/sell
  priceUsd?: Decimal | null; // buy/sell
  feesUsd: Decimal;
}

// Spec §6's corrected cash-preview table: shows the resulting balance, not
// just the signed delta. Returns null when required fields for the chosen
// type aren't entered yet (nothing to preview).
export function computeCashPreview(input: CashPreviewInput): Decimal | null {
  const { txnType, currentCashUsd, amountUsd, quantity, priceUsd, feesUsd } = input;
  switch (txnType) {
    case "DEPOSIT":
      return amountUsd ? currentCashUsd.add(amountUsd) : null;
    case "WITHDRAWAL":
      return amountUsd ? currentCashUsd.sub(amountUsd) : null;
    case "BUY":
      return quantity && priceUsd ? currentCashUsd.sub(quantity.mul(priceUsd)).sub(feesUsd) : null;
    case "SELL":
      return quantity && priceUsd ? currentCashUsd.add(quantity.mul(priceUsd)).sub(feesUsd) : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/transactionPreview.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/transactionPreview.ts lib/transactionPreview.test.ts
git commit -m "feat: pure cash-preview formula for Deposit/Withdrawal/Buy/Sell (spec 6)"
```

**Functional acceptance check:** `npx vitest run lib/transactionPreview.test.ts` PASS, 5/5 — directly covers "correct Buy/Sell/Deposit/Withdrawal cash previews" per this session's required test list.
**UX acceptance check:** none yet — wired into the Transactions page in Task 25.

---

### Task 23: Transactions-page read helpers (`lib/accountCash.ts`, `lib/transactionHistory.ts`)

**Files:**
- Create: `lib/accountCash.ts`, `lib/transactionHistory.ts`
- Test: `lib/accountCash.test.ts`, `lib/transactionHistory.test.ts`

**Interfaces:**
- Consumes: `normalizePgDate` (Task 2, for `getRecentTransactions`).
- Produces: `getAccountCashMap(): Promise<Map<number, Decimal>>` and `TransactionHistoryRow`, `getRecentTransactions(limit?: number): Promise<TransactionHistoryRow[]>`. Both consumed by Task 25's `app/transactions/page.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `lib/accountCash.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { applyTransaction } from "./ledger/applyTransaction";
import { getAccountCashMap } from "./accountCash";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("getAccountCashMap", () => {
  it("maps each account id to its current cash balance", async () => {
    const a = await createAccount("Cash Map A", null);
    const b = await createAccount("Cash Map B", null);
    await applyTransaction({
      accountId: a.id, assetId: null, txnType: "DEPOSIT", tradeDate: "2026-01-01",
      quantity: null, priceUsd: null, feesUsd: new Decimal(0), grossAmountUsd: new Decimal(1000), note: null,
    });
    await applyTransaction({
      accountId: b.id, assetId: null, txnType: "DEPOSIT", tradeDate: "2026-01-01",
      quantity: null, priceUsd: null, feesUsd: new Decimal(0), grossAmountUsd: new Decimal(250), note: null,
    });

    const map = await getAccountCashMap();
    expect(map.get(a.id)!.toFixed(2)).toBe("1000.00");
    expect(map.get(b.id)!.toFixed(2)).toBe("250.00");
  });
});
```

Create `lib/transactionHistory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { getRecentTransactions } from "./transactionHistory";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("getRecentTransactions", () => {
  it("returns transactions newest-first with account and symbol joined in", async () => {
    const account = await createAccount("History Test", "IBKR");
    const asset = await resolveOrCreateAsset("HIST", "equity", "History Corp");
    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT", tradeDate: "2026-01-01",
      quantity: null, priceUsd: null, feesUsd: new Decimal(0), grossAmountUsd: new Decimal(1000), note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY", tradeDate: "2026-01-02",
      quantity: new Decimal(5), priceUsd: new Decimal(20), feesUsd: new Decimal(0), grossAmountUsd: null, note: "test buy",
    });

    const rows = await getRecentTransactions();
    expect(rows).toHaveLength(2);
    expect(rows[0].txnType).toBe("BUY");
    expect(rows[0].symbol).toBe("HIST");
    expect(rows[0].accountName).toBe("History Test");
    expect(rows[1].txnType).toBe("DEPOSIT");
    expect(rows[1].symbol).toBeNull();
  });

  it("respects the limit parameter", async () => {
    const account = await createAccount("Limit Test", null);
    for (let i = 1; i <= 5; i++) {
      await applyTransaction({
        accountId: account.id, assetId: null, txnType: "DEPOSIT",
        tradeDate: `2026-01-0${i}`, quantity: null, priceUsd: null,
        feesUsd: new Decimal(0), grossAmountUsd: new Decimal(10), note: null,
      });
    }
    const rows = await getRecentTransactions(2);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/accountCash.test.ts lib/transactionHistory.test.ts`
Expected: FAIL — neither module exists yet.

- [ ] **Step 3: Write the implementations**

Create `lib/accountCash.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";

// Loaded once per Transactions-page render so the client-side cash preview
// (spec §6) can compute off an already-loaded figure with no per-keystroke
// backend call.
export async function getAccountCashMap(): Promise<Map<number, Decimal>> {
  const pool = getPool();
  const result = await pool.query<{ account_id: number; cash_usd: string }>(
    `SELECT account_id, cash_usd FROM account_cash`
  );
  return new Map(result.rows.map((r) => [r.account_id, new Decimal(r.cash_usd)]));
}
```

Create `lib/transactionHistory.ts`:

```ts
import Decimal from "decimal.js";
import { getPool } from "./db";
import { normalizePgDate } from "./dateValidation";

export interface TransactionHistoryRow {
  id: string;
  tradeDate: string;
  accountName: string;
  txnType: string;
  symbol: string | null;
  quantity: Decimal | null;
  priceUsd: Decimal | null;
  grossAmountUsd: Decimal | null;
  note: string | null;
}

export async function getRecentTransactions(limit: number = 25): Promise<TransactionHistoryRow[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT t.id, t.trade_date, acc.name AS account_name, t.txn_type,
            ast.primary_symbol AS symbol, t.quantity, t.price_usd, t.gross_amount_usd, t.note
     FROM transactions t
     JOIN accounts acc ON acc.id = t.account_id
     LEFT JOIN assets ast ON ast.id = t.asset_id
     ORDER BY t.trade_date DESC, t.id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    tradeDate: normalizePgDate(r.trade_date),
    accountName: r.account_name,
    txnType: r.txn_type,
    symbol: r.symbol,
    quantity: r.quantity ? new Decimal(r.quantity) : null,
    priceUsd: r.price_usd ? new Decimal(r.price_usd) : null,
    grossAmountUsd: r.gross_amount_usd ? new Decimal(r.gross_amount_usd) : null,
    note: r.note,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/accountCash.test.ts lib/transactionHistory.test.ts`
Expected: PASS, 3 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/accountCash.ts lib/accountCash.test.ts lib/transactionHistory.ts lib/transactionHistory.test.ts
git commit -m "feat: account-cash map and recent-transactions read helpers for the Transactions page"
```

**Functional acceptance check:** `npx vitest run lib/accountCash.test.ts lib/transactionHistory.test.ts` PASS, 3/3.
**UX acceptance check:** none yet — wired into the Transactions page in Task 25.

---

### Task 24: Transaction Server Actions (`app/actions/transactions.ts`)

**Files:**
- Create: `app/actions/transactions.ts`
- Test: `app/actions/transactions.test.ts`

**Interfaces:**
- Consumes: `applyTransaction` (Task 6), `getAccountHoldings` (Task 18), `findLikelyDuplicateTransaction` (Task 21), `isValidCalendarDate`/`isFutureDate` (Task 2).
- Produces: `TxnType`, `TransactionFormInput`, `TransactionFieldErrors`, `SubmitTransactionResult`, `submitTransactionAction(input)`, `getAccountHoldingsAction(accountId)`. Consumed by Task 25's `TransactionForm.tsx`.

- [ ] **Step 1: Write the failing test**

Create `app/actions/transactions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset } from "@/lib/assets";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { submitTransactionAction, getAccountHoldingsAction } from "./transactions";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("submitTransactionAction", () => {
  it("rejects a future trade date without writing anything, via a structured field error", async () => {
    const account = await createAccount("Future Trade Test", null);
    const result = await submitTransactionAction({
      accountId: account.id, txnType: "DEPOSIT", tradeDate: "2099-01-01", amount: "100",
      assetId: "", quantity: "", priceUsd: "", feesUsd: "0", note: "", confirmDuplicate: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "errors" in result) expect(result.errors.tradeDate).toMatch(/future/i);

    const pool = getPool();
    const row = await pool.query(`SELECT id FROM transactions WHERE account_id = $1`, [account.id]);
    expect(row.rows).toHaveLength(0);
  });

  it("rejects a non-positive amount via a structured field error, without writing anything", async () => {
    const account = await createAccount("Bad Amount Test", null);
    const result = await submitTransactionAction({
      accountId: account.id, txnType: "DEPOSIT", tradeDate: "2026-01-01", amount: "-5",
      assetId: "", quantity: "", priceUsd: "", feesUsd: "0", note: "", confirmDuplicate: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "errors" in result) expect(result.errors.amount).toMatch(/greater than zero/i);
  });

  it("commits a valid deposit and reflects it in account_cash", async () => {
    const account = await createAccount("Deposit Action Test", null);
    const result = await submitTransactionAction({
      accountId: account.id, txnType: "DEPOSIT", tradeDate: "2026-01-01", amount: "250",
      assetId: "", quantity: "", priceUsd: "", feesUsd: "0", note: "", confirmDuplicate: false,
    });
    expect(result.ok).toBe(true);

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("250.00");
  });

  it("returns ok:'duplicate' for a same-shape Buy within the window, then commits once confirmDuplicate is true", async () => {
    const account = await createAccount("Dup Action Test", null);
    const asset = await resolveOrCreateAsset("DUPACT", "equity", "Dup Action Corp");
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY", tradeDate: "2026-01-10",
      quantity: new Decimal(5), priceUsd: new Decimal(10), feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const first = await submitTransactionAction({
      accountId: account.id, txnType: "BUY", tradeDate: "2026-01-11", amount: "",
      assetId: asset.id, quantity: "5", priceUsd: "10", feesUsd: "0", note: "", confirmDuplicate: false,
    });
    expect(first.ok).toBe("duplicate");

    const second = await submitTransactionAction({
      accountId: account.id, txnType: "BUY", tradeDate: "2026-01-11", amount: "",
      assetId: asset.id, quantity: "5", priceUsd: "10", feesUsd: "0", note: "", confirmDuplicate: true,
    });
    expect(second.ok).toBe(true);
  });

  it("rejects a Buy priced at exactly zero — price must be greater than zero, not merely non-negative", async () => {
    const account = await createAccount("Zero Price Test", null);
    const asset = await resolveOrCreateAsset("ZEROP", "equity", "Zero Price Corp");
    const result = await submitTransactionAction({
      accountId: account.id, txnType: "BUY", tradeDate: "2026-01-01", amount: "",
      assetId: asset.id, quantity: "5", priceUsd: "0", feesUsd: "0", note: "", confirmDuplicate: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "errors" in result) expect(result.errors.priceUsd).toMatch(/greater than zero/i);

    const pool = getPool();
    const row = await pool.query(`SELECT id FROM transactions WHERE account_id = $1`, [account.id]);
    expect(row.rows).toHaveLength(0);
  });
});

describe("getAccountHoldingsAction", () => {
  it("serializes Decimal quantities to strings for the client", async () => {
    const account = await createAccount("Holdings Action Test", null);
    const asset = await resolveOrCreateAsset("HACT", "equity", "Holdings Action Corp");
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY", tradeDate: "2026-01-01",
      quantity: new Decimal(7), priceUsd: new Decimal(1), feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const holdings = await getAccountHoldingsAction(account.id);
    expect(holdings).toEqual([{ assetId: asset.id, symbol: "HACT", quantity: "7.0000" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/actions/transactions.test.ts`
Expected: FAIL — `./transactions` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `app/actions/transactions.ts`:

```ts
"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { getAccountHoldings } from "@/lib/holdings";
import { findLikelyDuplicateTransaction } from "@/lib/duplicateTransactionCheck";
import { isValidCalendarDate, isFutureDate } from "@/lib/dateValidation";

export type TxnType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";

export interface TransactionFormInput {
  accountId: number;
  txnType: TxnType;
  tradeDate: string;
  amount: string; // deposit/withdrawal
  assetId: string; // buy (from ticker resolution) / sell (from the holdings picker)
  quantity: string; // buy/sell
  priceUsd: string; // buy/sell
  feesUsd: string;
  note: string;
  confirmDuplicate: boolean; // true once the user has clicked "Add anyway" past a duplicate warning
}

export type TransactionFieldErrors = Partial<
  Record<"tradeDate" | "amount" | "quantity" | "priceUsd" | "feesUsd" | "form", string>
>;

export type SubmitTransactionResult =
  | { ok: true; transactionId: string }
  | { ok: false; errors: TransactionFieldErrors }
  | { ok: "duplicate"; duplicateTradeDate: string };

function parsePositiveOrError(raw: string, allowZero: boolean): { value: Decimal | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: "This field is required." };
  let value: Decimal;
  try {
    value = new Decimal(trimmed);
  } catch {
    return { value: null, error: "Enter a valid number." };
  }
  if (allowZero ? value.lt(0) : value.lte(0)) {
    return { value: null, error: allowZero ? "Must not be negative." : "Must be greater than zero." };
  }
  return { value, error: null };
}

// Spec §6: controlled inputs + a Server Action that returns structured field
// errors instead of throwing — entered values are never lost on a rejected
// submission, since the caller never unmounts the form.
export async function submitTransactionAction(input: TransactionFormInput): Promise<SubmitTransactionResult> {
  const errors: TransactionFieldErrors = {};

  if (!isValidCalendarDate(input.tradeDate)) {
    errors.tradeDate = "Enter a valid date.";
  } else if (isFutureDate(input.tradeDate)) {
    errors.tradeDate = "Trade date cannot be in the future.";
  }

  const fees = parsePositiveOrError(input.feesUsd || "0", true);
  if (fees.error) errors.feesUsd = fees.error;

  let quantity: Decimal | null = null;
  let priceUsd: Decimal | null = null;
  let grossAmountUsd: Decimal | null = null;

  if (input.txnType === "DEPOSIT" || input.txnType === "WITHDRAWAL") {
    const amount = parsePositiveOrError(input.amount, false);
    if (amount.error) errors.amount = amount.error;
    else grossAmountUsd = amount.value;
  } else {
    const q = parsePositiveOrError(input.quantity, false);
    if (q.error) errors.quantity = q.error;
    else quantity = q.value;
    // Per this session's final-review correction: price must be greater
    // than zero, not merely non-negative — a $0 Buy/Sell price isn't a
    // meaningful transaction (unlike fees, which genuinely can be zero).
    const p = parsePositiveOrError(input.priceUsd, false);
    if (p.error) errors.priceUsd = p.error;
    else priceUsd = p.value;
    if (!input.assetId) {
      errors.form = input.txnType === "BUY" ? "Resolve a ticker before adding this transaction." : "Select a holding to sell.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  if ((input.txnType === "BUY" || input.txnType === "SELL") && !input.confirmDuplicate) {
    const duplicate = await findLikelyDuplicateTransaction({
      accountId: input.accountId,
      assetId: input.assetId,
      txnType: input.txnType,
      quantity: quantity!,
      priceUsd: priceUsd!,
      tradeDate: input.tradeDate,
    });
    if (duplicate) {
      return { ok: "duplicate", duplicateTradeDate: duplicate.tradeDate };
    }
  }

  try {
    const { transactionId } = await applyTransaction({
      accountId: input.accountId,
      assetId: input.txnType === "BUY" || input.txnType === "SELL" ? input.assetId : null,
      txnType: input.txnType,
      tradeDate: input.tradeDate,
      quantity,
      priceUsd,
      feesUsd: fees.value!,
      grossAmountUsd,
      note: input.note.trim() || null,
    });
    revalidatePath("/");
    revalidatePath("/transactions");
    return { ok: true, transactionId };
  } catch (err) {
    return { ok: false, errors: { form: err instanceof Error ? err.message : "Could not save this transaction." } };
  }
}

export async function getAccountHoldingsAction(
  accountId: number
): Promise<{ assetId: string; symbol: string; quantity: string }[]> {
  const holdings = await getAccountHoldings(accountId);
  return holdings.map((h) => ({ assetId: h.assetId, symbol: h.symbol, quantity: h.quantity.toFixed(4) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/actions/transactions.test.ts`
Expected: PASS, 6 tests.

Run: `npx tsc --noEmit 2>&1 | grep "app/actions/transactions.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/actions/transactions.ts app/actions/transactions.test.ts
git commit -m "feat: transaction Server Action with structured field errors, duplicate check, sell-picker wiring, strictly-positive price validation"
```

**Functional acceptance check:** `npx vitest run app/actions/transactions.test.ts` PASS, 6/6 — covers "transaction date validation" and "duplicate-transaction warning" end-to-end at the action layer (in addition to Task 21's query-level test), plus this session's final-review "price must be greater than zero" requirement.
**UX acceptance check:** none yet — wired into the Transactions page in Task 25.

---

### Task 25: Transactions page full form (final visible slice)

**Files:**
- Modify: `app/transactions/page.tsx`
- Create: `app/transactions/TransactionForm.tsx`
- Test: `app/transactions/TransactionForm.test.tsx` (jsdom component test)

**Interfaces:**
- Consumes: `getAccountCashMap`/`getRecentTransactions` (Task 23), `submitTransactionAction`/`getAccountHoldingsAction` (Task 24), `resolveTickerAction` (Task 9), `computeCashPreview` (Task 22), `localTodayIso` (Task 2), `NavBar`/`buttonLinkStyle` (Task 3).

Per this session's correction: `accounts` (and each account's `cashUsd`) is a prop, set once from the server component's initial render — without a fix, a second transaction entered right after a successful first one would preview against the now-stale original balance, not the balance the first transaction actually produced. This task adds a per-account local cash override, updated immediately from the just-computed preview on a successful submit (the preview *is* the new balance — no extra read needed), plus a `router.refresh()` so the next full page load also picks up the server-computed figure.

Per this session's final-review correction, this task also fixes four issues:
- **Resolved ticker/asset identity must never go stale (CRITICAL item 1).** The same bug as Task 13's holdings step exists here for Buy: editing the ticker text or asset type after a resolution completes must immediately clear the resolved `assetId`, and `submit()` must require the current normalized ticker still matches what was actually resolved before allowing an Add.
- **The Server Action call itself can reject, not just resolve with an error (CRITICAL item 2).** `submit()` now wraps the `submitTransactionAction` call in `try/catch/finally` — `finally` always clears `submitting` (so the form never gets permanently stuck), and a rejection shows honest "couldn't reach the server, don't know whether it saved" copy rather than inviting a blind retry.
- **`cashOverride` must only bridge latency, never permanently shadow fresher server data (item 6).** Without a fix, once set, the local override always wins over the `accounts` prop forever — even after `router.refresh()` (or a later full page load) delivers genuinely newer server-computed cash. It's now cleared whenever the `accounts` prop itself changes identity (i.e. a fresh server render actually landed), so the server value becomes authoritative again the moment it arrives.
- **The Sell holdings fetch has no staleness guard (item 7).** Switching accounts quickly while Sell is selected fires overlapping `getAccountHoldingsAction` calls; without a guard, an older account's slower response can overwrite state after the user has already moved to a different account. A request-id guard fixes the race, and the same fetch now also re-runs after a successful Buy or Sell on the current account (previously it only ever ran on account/type change, so a just-changed position never refreshed the picker without switching away and back).

- [ ] **Step 1: Write the failing component tests**

Create `app/transactions/TransactionForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionForm } from "./TransactionForm";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const submitTransactionActionMock = vi.fn();
const getAccountHoldingsActionMock = vi.fn().mockResolvedValue([]);
vi.mock("@/app/actions/transactions", () => ({
  submitTransactionAction: (...args: unknown[]) => submitTransactionActionMock(...args),
  getAccountHoldingsAction: (...args: unknown[]) => getAccountHoldingsActionMock(...args),
}));

const resolveTickerActionMock = vi.fn();
vi.mock("@/app/actions/setup", () => ({
  resolveTickerAction: (...args: unknown[]) => resolveTickerActionMock(...args),
}));

const accounts = [{ id: 1, name: "Test Brokerage", custodian: null, cashUsd: "1000.00" }];

beforeEach(() => {
  submitTransactionActionMock.mockClear();
  getAccountHoldingsActionMock.mockClear();
  getAccountHoldingsActionMock.mockResolvedValue([]);
  resolveTickerActionMock.mockClear();
  refreshMock.mockClear();
});

describe("TransactionForm — inline validation with entered values preserved", () => {
  it("shows the field error and keeps the entered amount after a rejected submit", async () => {
    submitTransactionActionMock.mockResolvedValue({ ok: false, errors: { amount: "Must be greater than zero." } });
    render(<TransactionForm accounts={accounts} />);

    const amountInput = screen.getByLabelText(/amount \(usd\)/i);
    fireEvent.change(amountInput, { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Add transaction"));

    await waitFor(() => expect(screen.getByText("Must be greater than zero.")).toBeInTheDocument());
    expect(amountInput).toHaveValue("-5");
  });
});

describe("TransactionForm — double-submit prevention", () => {
  it("disables the submit button while a request is in flight and only submits once", async () => {
    let resolveSubmit: (value: unknown) => void;
    submitTransactionActionMock.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));
    render(<TransactionForm accounts={accounts} />);

    fireEvent.change(screen.getByLabelText(/amount \(usd\)/i), { target: { value: "100" } });
    const submitButton = screen.getByText("Add transaction");
    fireEvent.click(submitButton);
    expect(screen.getByText("Adding…")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Adding…")); // second click while pending — native disabled semantics must block this
    expect(submitTransactionActionMock).toHaveBeenCalledTimes(1);

    resolveSubmit!({ ok: true, transactionId: "1" });
    await waitFor(() => expect(screen.getByText("Transaction added.")).toBeInTheDocument());
  });
});

describe("TransactionForm — cash refresh after a successful transaction", () => {
  it("previews a second, immediately-following transaction against the balance the first one just produced, not the stale initial prop", async () => {
    submitTransactionActionMock.mockResolvedValueOnce({ ok: true, transactionId: "1" });
    render(<TransactionForm accounts={accounts} />);

    // Deposit 1: 1000.00 -> 1200.00.
    fireEvent.change(screen.getByLabelText(/amount \(usd\)/i), { target: { value: "200" } });
    expect(screen.getByText(/cash after this transaction: \$1200\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add transaction"));
    await waitFor(() => expect(screen.getByText("Transaction added.")).toBeInTheDocument());

    // Deposit 2, entered right after with no page reload: must preview off
    // 1200.00 (what Deposit 1 actually produced), not the original 1000.00 prop.
    fireEvent.change(screen.getByLabelText(/amount \(usd\)/i), { target: { value: "50" } });
    expect(screen.getByText(/cash after this transaction: \$1250\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\(currently \$1200\.00\)/)).toBeInTheDocument();

    // Also refreshes the server-rendered page so a later full reload reflects it too.
    expect(refreshMock).toHaveBeenCalled();
  });

  it("does not permanently shadow a fresher accounts prop — once new server data arrives (e.g. via router.refresh()), it becomes authoritative again", async () => {
    submitTransactionActionMock.mockResolvedValueOnce({ ok: true, transactionId: "1" });
    const { rerender } = render(<TransactionForm accounts={accounts} />);

    fireEvent.change(screen.getByLabelText(/amount \(usd\)/i), { target: { value: "200" } });
    fireEvent.click(screen.getByText("Add transaction"));
    await waitFor(() => expect(screen.getByText("Transaction added.")).toBeInTheDocument());
    expect(screen.getByText(/\(currently \$1200\.00\)/)).toBeInTheDocument(); // the client-side override

    // Simulate router.refresh() delivering a NEW accounts prop — e.g. a
    // second transaction was also applied (another tab, or a wizard-created
    // account), so the true server balance is 1500.00, not the client's
    // own 1200.00 override.
    const refreshedAccounts = [{ id: 1, name: "Test Brokerage", custodian: null, cashUsd: "1500.00" }];
    rerender(<TransactionForm accounts={refreshedAccounts} />);

    expect(screen.getByText(/\(currently \$1500\.00\)/)).toBeInTheDocument();
  });
});

describe("TransactionForm — resolved-ticker staleness guard (Buy)", () => {
  it("blocks submitting a Buy when the ticker was edited after resolution without re-resolving (resolved AAPL, edited to MSFT)", async () => {
    resolveTickerActionMock.mockResolvedValue({
      ok: true, assetId: "1", assetClass: "equity", priceUsd: "228.50", priceDate: "2026-08-25",
    });
    render(<TransactionForm accounts={accounts} />);

    fireEvent.click(screen.getByLabelText("BUY"));
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "AAPL" } });
    fireEvent.blur(screen.getByLabelText(/ticker symbol/i));
    await waitFor(() => expect(screen.getByText(/Resolved — last price \$228.50/)).toBeInTheDocument());

    // Edit the ticker text WITHOUT triggering another blur/resolve.
    fireEvent.change(screen.getByLabelText(/ticker symbol/i), { target: { value: "MSFT" } });
    expect(screen.queryByText(/Resolved — last price \$228.50/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^quantity$/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/price \(usd\)/i), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Add transaction"));

    await waitFor(() => expect(screen.getByText(/resolve the ticker first/i)).toBeInTheDocument());
    expect(submitTransactionActionMock).not.toHaveBeenCalled();
  });
});

describe("TransactionForm — Server Action rejection handling", () => {
  it("shows an honest 'couldn't reach the server' message and re-enables the submit button when the Server Action call itself rejects", async () => {
    submitTransactionActionMock.mockRejectedValueOnce(new Error("simulated network drop"));
    render(<TransactionForm accounts={accounts} />);

    fireEvent.change(screen.getByLabelText(/amount \(usd\)/i), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Add transaction"));

    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument());
    // finally clears `submitting` even on rejection.
    expect(screen.getByText("Add transaction")).toBeEnabled();
  });
});

describe("TransactionForm — Sell holdings freshness/race guard", () => {
  it("does not let a slow response for a previous account overwrite the holdings picker after switching accounts", async () => {
    const twoAccounts = [
      { id: 1, name: "Account A", custodian: null, cashUsd: "1000.00" },
      { id: 2, name: "Account B", custodian: null, cashUsd: "500.00" },
    ];
    let resolveAccountA: (value: unknown) => void;
    getAccountHoldingsActionMock.mockImplementation((accountId: number) => {
      if (accountId === 1) return new Promise((resolve) => { resolveAccountA = resolve; });
      return Promise.resolve([{ assetId: "b1", symbol: "BBB", quantity: "3.0000" }]);
    });

    render(<TransactionForm accounts={twoAccounts} />);
    fireEvent.click(screen.getByLabelText("SELL"));
    // Account A's holdings request is now in flight (deliberately unresolved).

    fireEvent.change(screen.getByLabelText(/^account$/i), { target: { value: "2" } });
    await waitFor(() => expect(screen.getByText(/BBB — 3\.0000 held/)).toBeInTheDocument());

    // NOW let Account A's stale, slower response resolve.
    resolveAccountA!([{ assetId: "a1", symbol: "AAA", quantity: "9.0000" }]);

    // It must NOT clobber the already-current Account B holdings.
    expect(screen.getByText(/BBB — 3\.0000 held/)).toBeInTheDocument();
    expect(screen.queryByText(/AAA — 9\.0000 held/)).not.toBeInTheDocument();
  });

  it("refetches holdings after a successful Sell on the current account, without requiring an account switch", async () => {
    submitTransactionActionMock.mockResolvedValueOnce({ ok: true, transactionId: "1" });
    getAccountHoldingsActionMock
      .mockResolvedValueOnce([{ assetId: "a1", symbol: "AAA", quantity: "5.0000" }])
      .mockResolvedValueOnce([{ assetId: "a1", symbol: "AAA", quantity: "3.0000" }]);

    render(<TransactionForm accounts={accounts} />);
    fireEvent.click(screen.getByLabelText("SELL"));
    await waitFor(() => expect(screen.getByText(/AAA — 5\.0000 held/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^holding$/i), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText(/^quantity$/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/price \(usd\)/i), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Add transaction"));
    await waitFor(() => expect(screen.getByText("Transaction added.")).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText(/AAA — 3\.0000 held/)).toBeInTheDocument());
    expect(getAccountHoldingsActionMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/transactions/TransactionForm.test.tsx`
Expected: FAIL — `./TransactionForm` does not exist yet.

- [ ] **Step 3: Write `app/transactions/TransactionForm.tsx`**

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { resolveTickerAction, type TickerResolutionResult } from "@/app/actions/setup";
import {
  submitTransactionAction,
  getAccountHoldingsAction,
  type TxnType,
  type TransactionFieldErrors,
} from "@/app/actions/transactions";
import { computeCashPreview } from "@/lib/transactionPreview";
import { localTodayIso } from "@/lib/dateValidation";
import type { AssetClass } from "@/lib/assets";

interface AccountOption {
  id: number;
  name: string;
  custodian: string | null;
  cashUsd: string;
}

export function TransactionForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [txnType, setTxnType] = useState<TxnType>("DEPOSIT");
  const [tradeDate, setTradeDate] = useState(localTodayIso());
  const [amount, setAmount] = useState("");
  const [ticker, setTicker] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity");
  const [tickerResolution, setTickerResolution] = useState<TickerResolutionResult | null>(null);
  // The normalized ticker text tickerResolution was actually resolved for
  // (per this session's final-review correction — same fix as Task 13's
  // wizard holdings step). Ticker text and asset class can change after a
  // resolution completes; without tracking this and re-checking it in
  // submit(), an edit from a resolved "AAPL" to "MSFT" could submit MSFT's
  // ticker text with AAPL's already-resolved assetId.
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [holdings, setHoldings] = useState<{ assetId: string; symbol: string; quantity: string }[]>([]);
  const [selectedHoldingAssetId, setSelectedHoldingAssetId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [feesUsd, setFeesUsd] = useState("0");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<TransactionFieldErrors>({});
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Per-account cash, updated immediately on a successful submit from the
  // preview that was just applied — the preview IS the new balance. Without
  // this, a second transaction entered right after the first would preview
  // against the stale `accounts` prop (fixed at the server component's last
  // render) instead of the balance the first transaction actually produced.
  const [cashOverride, setCashOverride] = useState<Record<number, string>>({});

  // Per this session's final-review correction: cashOverride must only
  // bridge the latency until router.refresh() (called on every successful
  // submit below) actually delivers a fresh `accounts` prop — it must
  // never permanently shadow that fresher server data. Whenever the
  // `accounts` prop's IDENTITY changes (a new server render actually
  // landed, whether from THIS component's own refresh() or any other
  // cause), the override is dropped so the incoming prop is authoritative
  // again. A ref (not state) tracks the previous prop purely to detect
  // that change — it never itself drives a render.
  const previousAccountsRef = useRef(accounts);
  useEffect(() => {
    if (previousAccountsRef.current !== accounts) {
      setCashOverride({});
      previousAccountsRef.current = accounts;
    }
  }, [accounts]);

  // Per this session's final-review correction: guards the Sell holdings
  // fetch against two races — (a) switching accounts while a slower
  // request for the PREVIOUS account is still in flight must not let that
  // stale response overwrite the current account's holdings, and (b) a
  // successful Buy/Sell changes the account's real positions, so the
  // picker must refetch even though neither txnType nor accountId changed.
  const holdingsRequestIdRef = useRef(0);
  async function refreshHoldings(forAccountId: number) {
    const requestId = ++holdingsRequestIdRef.current;
    const result = await getAccountHoldingsAction(forAccountId);
    if (requestId === holdingsRequestIdRef.current) {
      setHoldings(result);
    }
  }

  useEffect(() => {
    if (txnType !== "SELL") return;
    refreshHoldings(accountId);
  }, [txnType, accountId]);

  useEffect(() => {
    setTickerResolution(null);
    setResolvedTicker(null);
    setSelectedHoldingAssetId("");
  }, [txnType, accountId]);

  async function handleTickerBlur() {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) return;
    setResolving(true);
    const result = await resolveTickerAction(ticker, assetClass);
    setResolving(false);
    setTickerResolution(result);
    setResolvedTicker(normalized);
  }

  const currentCashUsd = new Decimal(
    cashOverride[accountId] ?? accounts.find((a) => a.id === accountId)!.cashUsd
  );
  let preview: Decimal | null = null;
  try {
    preview = computeCashPreview({
      txnType,
      currentCashUsd,
      amountUsd: amount ? new Decimal(amount) : null,
      quantity: quantity ? new Decimal(quantity) : null,
      priceUsd: priceUsd ? new Decimal(priceUsd) : null,
      feesUsd: feesUsd ? new Decimal(feesUsd) : new Decimal(0),
    });
  } catch {
    preview = null;
  }

  function resetEntryFields() {
    setAmount(""); setTicker(""); setTickerResolution(null); setResolvedTicker(null); setSelectedHoldingAssetId("");
    setQuantity(""); setPriceUsd(""); setFeesUsd("0"); setNote("");
  }

  async function submit(confirmDuplicate: boolean) {
    setSubmitting(true);
    setErrors({});
    setDuplicateWarning(null);

    if (txnType === "BUY") {
      // Require the CURRENT normalized ticker to still match what
      // tickerResolution.assetId was actually resolved for — the input's
      // onChange below already clears both the instant the ticker text or
      // asset type changes, so this is a second, explicit guard.
      const normalizedTicker = ticker.trim().toUpperCase();
      if (!tickerResolution?.assetId || resolvedTicker !== normalizedTicker) {
        setSubmitting(false);
        setErrors({ form: "Resolve the ticker first (wait for the checking… state to finish, or re-enter it if you changed it after resolving)." });
        return;
      }
    }

    const assetId = txnType === "BUY" ? (tickerResolution?.assetId ?? "") : txnType === "SELL" ? selectedHoldingAssetId : "";
    const appliedPreview = preview; // capture before resetEntryFields() clears the inputs it was derived from

    try {
      const result = await submitTransactionAction({
        accountId, txnType, tradeDate, amount, assetId, quantity, priceUsd, feesUsd, note, confirmDuplicate,
      });

      if (result.ok === "duplicate") {
        setDuplicateWarning(
          `This looks similar to a transaction from ${result.duplicateTradeDate} (same account, ticker, type, quantity and price).`
        );
        return;
      }
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setSuccessMessage("Transaction added.");
      if (appliedPreview) {
        setCashOverride((prev) => ({ ...prev, [accountId]: appliedPreview.toFixed(2) }));
      }
      if (txnType === "BUY" || txnType === "SELL") {
        await refreshHoldings(accountId); // the just-applied Buy/Sell changed real positions
      }
      router.refresh(); // keeps the server-rendered accounts/recent-transactions in sync too
      resetEntryFields();
    } catch {
      // The Server Action call itself rejected (network/transport
      // failure), not a returned outcome. We genuinely don't know whether
      // it committed, so this must never invite a blind retry.
      setErrors({
        form:
          "We couldn't reach the server to confirm whether this transaction was saved. Check the recent-transactions " +
          "list below before trying again — submitting again could create a duplicate if the first attempt actually succeeded.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    await submit(false);
  }

  return (
    <section>
      <h2>Add a transaction</h2>
      <form onSubmit={handleSubmit}>
        <label>Account<br />
          <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label><br /><br />

        <div>
          Type:{" "}
          {(["DEPOSIT", "WITHDRAWAL", "BUY", "SELL"] as TxnType[]).map((t) => (
            <label key={t} style={{ marginRight: "1rem" }}>
              <input type="radio" name="txnType" checked={txnType === t} onChange={() => setTxnType(t)} /> {t}
            </label>
          ))}
        </div><br />

        <label>Trade date<br />
          <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
        </label>
        {errors.tradeDate && <p style={{ color: "#b00020" }}>{errors.tradeDate}</p>}
        <br />

        {(txnType === "DEPOSIT" || txnType === "WITHDRAWAL") && (
          <>
            <label>Amount (USD)<br />
              <input value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            {errors.amount && <p style={{ color: "#b00020" }}>{errors.amount}</p>}
            <br />
          </>
        )}

        {txnType === "BUY" && (
          <>
            <label>Ticker symbol<br />
              <input
                value={ticker}
                onChange={(e) => {
                  // Per this session's final-review correction: clear the
                  // resolved identity the instant the ticker text changes
                  // — a previous resolution is for a DIFFERENT symbol now.
                  setTicker(e.target.value);
                  setTickerResolution(null);
                  setResolvedTicker(null);
                }}
                onBlur={handleTickerBlur}
              />
            </label><br />
            {resolving && <p>checking…</p>}
            {tickerResolution && tickerResolution.ok && (
              <p>✓ Resolved — last price ${tickerResolution.priceUsd} ({tickerResolution.priceDate})</p>
            )}
            {tickerResolution && !tickerResolution.ok && <p>{tickerResolution.message}</p>}
            <label>Asset type<br />
              <select
                value={assetClass}
                onChange={(e) => {
                  // Asset class was part of what was resolved — changing
                  // it invalidates the resolution just like the ticker does.
                  setAssetClass(e.target.value as AssetClass);
                  setTickerResolution(null);
                  setResolvedTicker(null);
                }}
              >
                <option value="equity">Equity</option>
                <option value="etf">ETF</option>
                <option value="crypto">Crypto</option>
              </select>
            </label><br /><br />
            <label>Quantity<br />
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            {errors.quantity && <p style={{ color: "#b00020" }}>{errors.quantity}</p>}
            <br />
            <label>Price (USD)<br />
              <input value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} />
            </label>
            {errors.priceUsd && <p style={{ color: "#b00020" }}>{errors.priceUsd}</p>}
            <br />
          </>
        )}

        {txnType === "SELL" && (
          <>
            <label>Holding<br />
              <select value={selectedHoldingAssetId} onChange={(e) => setSelectedHoldingAssetId(e.target.value)}>
                <option value="">Select a holding…</option>
                {holdings.map((h) => (
                  <option key={h.assetId} value={h.assetId}>{h.symbol} — {h.quantity} held</option>
                ))}
              </select>
            </label><br /><br />
            <label>Quantity<br />
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            {errors.quantity && <p style={{ color: "#b00020" }}>{errors.quantity}</p>}
            <br />
            <label>Price (USD)<br />
              <input value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} />
            </label>
            {errors.priceUsd && <p style={{ color: "#b00020" }}>{errors.priceUsd}</p>}
            <br />
          </>
        )}

        <label>Fees (USD)<br />
          <input value={feesUsd} onChange={(e) => setFeesUsd(e.target.value)} />
        </label>
        {errors.feesUsd && <p style={{ color: "#b00020" }}>{errors.feesUsd}</p>}
        <br />
        <label>Note (optional)<br />
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label><br /><br />

        {preview && (
          <p>
            {accounts.find((a) => a.id === accountId)!.name} cash after this transaction: ${preview.toFixed(2)}{" "}
            (currently ${currentCashUsd.toFixed(2)})
          </p>
        )}

        {errors.form && <p style={{ color: "#b00020" }}>{errors.form}</p>}
        {successMessage && <p style={{ color: "#0a7d2c" }}>{successMessage}</p>}

        {duplicateWarning ? (
          <div>
            <p>{duplicateWarning} Add it anyway?</p>
            <button type="button" onClick={() => submit(true)} disabled={submitting}>Add anyway</button>{" "}
            <button type="button" onClick={() => setDuplicateWarning(null)}>Cancel</button>
          </div>
        ) : (
          <button type="submit" disabled={submitting}>{submitting ? "Adding…" : "Add transaction"}</button>
        )}
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Modify `app/transactions/page.tsx`**

Replace the whole file:

```tsx
import Link from "next/link";
import Decimal from "decimal.js";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { listAccounts } from "@/lib/accounts";
import { getAccountCashMap } from "@/lib/accountCash";
import { getRecentTransactions } from "@/lib/transactionHistory";
import { TransactionForm } from "./TransactionForm";

// Always render dynamically — this page reads live DB state (accounts,
// cash, recent transactions) on every request and must never be frozen as
// a static build-time snapshot. This also ensures the revalidatePath("/transactions")
// calls in app/actions/setup.ts (Task 14) and app/actions/transactions.ts
// (Task 24) have a per-request render to invalidate.
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const accounts = await listAccounts();

  if (accounts.length === 0) {
    return (
      <>
        <NavBar />
        <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
          <h1>Transactions</h1>
          <p>You need an account before you can add transactions.</p>
          <Link href="/accounts/new" style={buttonLinkStyle}>+ Add account</Link>
        </main>
      </>
    );
  }

  const cashMap = await getAccountCashMap();
  const accountsWithCash = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    custodian: a.custodian,
    cashUsd: (cashMap.get(a.id) ?? new Decimal(0)).toFixed(2),
  }));
  const recentTransactions = await getRecentTransactions();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Transactions</h1>
        <TransactionForm accounts={accountsWithCash} />
        <section>
          <h2>Recent transactions</h2>
          <table border={1} cellPadding={6}>
            <thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Detail</th><th>Note</th></tr></thead>
            <tbody>
              {recentTransactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.tradeDate}</td>
                  <td>{t.accountName}</td>
                  <td>{t.txnType}</td>
                  <td>
                    {t.symbol && t.quantity && t.priceUsd
                      ? `${t.symbol} ${t.quantity.toFixed(4)} @ $${t.priceUsd.toFixed(2)}`
                      : t.grossAmountUsd
                        ? `$${t.grossAmountUsd.toFixed(2)}`
                        : "—"}
                  </td>
                  <td>{t.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/transactions/TransactionForm.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Manual verification — full golden path**

With `npm run dev` running and the account from Task 15's walkthrough still present:

1. Open `http://localhost:3000/transactions`. Add a **Deposit** of `500` — confirm the cash-preview line is correct before submit, and `/` reflects the new total after.
2. Immediately add a **second Deposit** of `100` without reloading the page — confirm its "currently $..." figure already reflects the first deposit's result (not the page's original load-time balance).
3. Add a **Buy** using a resolvable ticker — confirm ticker resolution works the same as the wizard's. Then resolve a ticker, edit the text afterward WITHOUT tabbing out again, and click "Add transaction" — confirm it's blocked with "Resolve the ticker first..." rather than silently submitting under the previously-resolved symbol's identity.
4. Immediately re-submit the **exact same Buy**. Confirm the duplicate warning appears with "Add anyway"/"Cancel", and "Add anyway" successfully submits.
5. Add a **Sell**: confirm the "Holding" dropdown is populated from real current positions, and that it reflects the reduced quantity immediately after the Sell completes (no account switch needed).
6. Submit an invalid **Withdrawal** (e.g. `-5`). Confirm an inline field error appears beside Amount, the page doesn't blank/throw, and every other field retains what was entered.
7. Submit a **Buy priced at `0`**. Confirm it's rejected with a "must be greater than zero" error beside Price, not silently accepted.

**UX acceptance check:** all of the above. The Server Action rejection and holdings-race scenarios (item 6 above's sibling checks) aren't practically reproducible by hand — they're covered deterministically by the automated tests in Step 5.

- [ ] **Step 7: Commit**

```bash
git add app/transactions/page.tsx app/transactions/TransactionForm.tsx app/transactions/TransactionForm.test.tsx
git commit -m "feat: Transactions page full form — ticker resolution (staleness-guarded), sell picker (race-guarded, refetched after Buy/Sell), duplicate warning, cash preview refreshed after each success without permanently shadowing fresh server data, Server Action rejection handling"
```

**Functional acceptance check:** `npx vitest run app/transactions/TransactionForm.test.tsx` PASS, 8/8 — directly covers "inline validation with entered values preserved," "double-submit prevention," and this session's "cash refresh after successful transaction" requirement (two sequential transactions/previews) for the Transactions form, plus this session's final-review requirements for resolved-ticker staleness (Buy), Server Action rejection handling, the cash-override-must-not-permanently-shadow-fresh-props fix, and the Sell holdings race/refetch guard.
**UX acceptance check:** see Step 6 above.

---

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

- [ ] **Step 3: Full end-to-end manual regression**

With `npm run dev` running against a dev DB that now has the one account from Task 15's walkthrough (plus whatever transactions were added in Task 25's walkthrough):

1. **Dashboard** (`/`): totals, the total-exclusion disclosure, and price-health cells all still correct.
2. **Accounts** (`/accounts`): the account is listed (no Reconcile link — deferred per Tasks 19–20).
3. **Transactions** (`/transactions`): Deposit/Withdrawal/Buy/Sell, the duplicate-transaction warning, inline-error value preservation, and the cash-refresh-after-success behaviour all still work as verified in Task 25.
4. Re-run through **Steps 4–6 of Task 15's wizard walkthrough** once more end to end (create a *second* account) to confirm nothing in Tasks 16–25 regressed the wizard.

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

## Self-review against the spec and this session's constraints

**Spec coverage (docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md):**

| Spec section | Task(s) |
|---|---|
| §2 Information architecture (nav, routes, empty states) | 3, 4, 5 |
| §3.1 Disposable draft state | 10 (test), 12, 13, 15 |
| §3.2 Atomic commit | 6, 7, 14 |
| §3.3 Read-back verification | 8, 14, 15 |
| §4 Step 1 (account/date) | 9, 10 |
| §4 Step 2 (opening cash) | 12 |
| §4 Step 3 (holdings, ticker resolution, cost-basis mode) | 9, 11, 13 |
| §4 Step 4 (review, confirm, verification outcome, Complete) | 14, 15 |
| §5 Dashboard/Accounts/Transactions structure | 3, 4, 5, 17, 25 |
| §6 Number entry, resolution, preview | 9, 21, 22, 24, 25 |
| §7.1 Duplicate-transaction warning | 21, 24, 25 |
| §7.2 Periodic reconciliation | **Deferred** — Tasks 19–20 (see their deferral note); `getAccountHoldings` (Task 18) retained for the Sell picker only |
| §8 Price/data-health states | 16, 17 |
| §9 Validation/read-logic placement | 2 (constraint honoured throughout) |
| §10 Settled — do not reopen | Global Constraints |
| §11 Self-review items (already resolved in the spec itself) | inherited — no task reopens any of them |

**This session's required test list, mapped:**

| Requirement | Task | Test file |
|---|---|---|
| Disposable pre-save wizard state | 10 | `app/accounts/new/SetupWizard.test.tsx` |
| Atomic rollback | 7, 14 | `lib/ledger/setupAccount.test.ts`, `app/actions/setup.test.ts` |
| Portfolio-as-of date validation | 2, 10, 14 | `lib/dateValidation.test.ts`, `SetupWizard.test.tsx`, `app/actions/setup.test.ts` |
| Transaction date validation | 2, 24 | `lib/dateValidation.test.ts`, `app/actions/transactions.test.ts` |
| Cost-basis mode handling | 11, 13 | `lib/wizard/draftHoldings.test.ts`, `SetupWizard.test.tsx` (mode-lock regression) |
| Duplicate ticker prevention | 11, 13 | `draftHoldings.test.ts`, `SetupWizard.test.tsx` |
| Duplicate-transaction warning | 21, 24 | `lib/duplicateTransactionCheck.test.ts`, `app/actions/transactions.test.ts` |
| Correct Buy/Sell/Deposit/Withdrawal cash previews | 22 | `lib/transactionPreview.test.ts` |
| Missing/stale price display | 16 | `lib/portfolio.test.ts` |
| Automatic post-save read-back verification | 8, 14, 15 | `verifySetup.test.ts`, `app/actions/setup.test.ts`, `SetupWizard.test.tsx` |
| Inline validation with entered values preserved | 25 | `app/transactions/TransactionForm.test.tsx` |
| Double-submit prevention | 12, 15, 25 | `SetupWizard.test.tsx` (also opening-cash render-safety), `TransactionForm.test.tsx` |

**This session's five correction issues, mapped:**

| Issue | Fix | Task(s) | Test |
|---|---|---|---|
| 1. Calendar-date timezone semantics | `isFutureDate`/date defaults use local calendar day (`localTodayIso`), never UTC | 2, 10, 15, 25 | `lib/dateValidation.test.ts`'s local-midnight boundary test |
| 2. Opening-cash validation / render safety | Step 2 gates advancement (`goToStep3`); every render path uses a non-throwing `openingCashUsdSafe()` | 12, 15 | `SetupWizard.test.tsx` (blocks-invalid, blocks-negative, no-crash-while-typing) |
| 3. Cost-basis mode after holdings exist | Mode radios `disabled` once `holdings.length > 0`, with an explanatory note | 13 | `SetupWizard.test.tsx`'s lock regression test |
| 4. Commit vs. post-commit verification failure | `setupAccountAction` returns a 3-way `status`; commit and verification are separate `try/catch` blocks; `verifySetup` also checks the account row and opening date | 8, 14, 15 | `app/actions/setup.test.ts`'s `saved_verification_error` test (real commit, mocked verify failure), `verifySetup.test.ts`'s account-row/opening-date tests, `SetupWizard.test.tsx`'s "unverified" screen test |
| 5. Transaction cash not refreshed after success | `TransactionForm` tracks a per-account cash override, updated from the applied preview on success, plus `router.refresh()` | 25 | `TransactionForm.test.tsx`'s two-sequential-transactions test |

**This session's final-review (independent Opus review) corrections, mapped:**

| # | Issue | Fix | Task(s) | Test |
|---|---|---|---|---|
| 1 (CRITICAL) | Resolved ticker/asset identity could go stale (edit after resolve keeps the old assetId) | `resolvedTicker` tracked separately; ticker/asset-type `onChange` clears resolution immediately; the pre-submit gate requires the current normalized ticker to still equal `resolvedTicker` | 13, 15 (wizard), 25 (Buy) | `SetupWizard.test.tsx`'s and `TransactionForm.test.tsx`'s "resolve A → edit to B → submit blocked" tests |
| 2 (CRITICAL) | A rejected Server Action call (transport failure) left `saving`/`submitting` stuck true and gave no feedback | `handleConfirmSave`/`submit` wrap the call in `try/catch/finally`; `finally` always clears the pending flag; the `catch` shows honest "couldn't reach the server, don't know if it saved" copy, never inviting a blind retry | 15 (wizard), 25 (transactions) | `SetupWizard.test.tsx`'s and `TransactionForm.test.tsx`'s Server-Action-rejection tests |
| 3 | Quantity entered beyond `NUMERIC(28,10)`'s precision could diverge between the write and the read-back verification, looking like a system bug | `setupAccountAction` normalizes every holding's quantity to `.toDecimalPlaces(10)` once, before using the SAME value for both `setupAccount` and `verifySetup`'s `expectedHoldings`; rounded holdings are disclosed positively on the Complete screen | 14, 15 | `app/actions/setup.test.ts`'s `>10dp` round-trip test |
| 4 | Cache revalidation ran after verification (could be skipped by a verification failure); DB-backed pages weren't explicitly dynamic | `revalidatePath` (now `/`, `/accounts`, `/transactions`) moved to immediately after the commit succeeds, before `verifySetup` runs; `export const dynamic = "force-dynamic"` added to all three DB-backed pages | 3, 4, 5, 14, 25 | Covered by existing `setupAccountAction` tests exercising the success path; dynamic-export presence is a manual/type-level check (no runtime test framework hook for Next's route config) |
| 5 | A `ROLLBACK` failure could mask the original transaction error; an in-doubt `COMMIT` failure had no distinct outcome and risked being inferred from account-name existence (unsound — duplicate names are allowed) | `setupAccount` preserves the original error when `ROLLBACK` itself fails; a `COMMIT` failure throws the distinct `SetupCommitUncertainError` (no `ROLLBACK` attempted); `setupAccountAction` maps it to `status: "save_unknown"`, distinct from `save_failed` | 7, 14, 15 | `setupAccount.test.ts`'s rollback-masking and commit-uncertain tests; `app/actions/setup.test.ts`'s `save_unknown` test; `SetupWizard.test.tsx`'s uncertain-outcome banner test |
| 6 | `cashOverride` could permanently shadow a fresher `accounts` prop | Cleared via a `useEffect` keyed on the `accounts` prop's own identity change, so newer server data supersedes it the moment it arrives | 25 | `TransactionForm.test.tsx`'s "does not permanently shadow a fresher accounts prop" test |
| 7 | The Sell holdings fetch had no staleness guard and never refetched after a Buy/Sell without an account switch | `refreshHoldings` uses a request-id ref to discard an out-of-order response; called both by the mount/account-switch effect and explicitly after a successful Buy/Sell | 25 | `TransactionForm.test.tsx`'s race-guard and refetch-after-Sell tests |
| 8 | A queued `.mockRejectedValueOnce()` on a partial mock could leak into a later, unrelated test | `beforeEach` inside `describe("setupAccountAction", ...)` resets both the `verifySetup` and `setupAccount` mocks to their real implementation via `vi.importActual`, every test | 14 | Structural (defensive) — no dedicated assertion; verified by the existing suite passing deterministically regardless of test order |
| 9 | `resolveTickerAction` and `lib/portfolio.ts` each duplicated DATE-normalization logic instead of reusing `normalizePgDate` | Both now import and call the shared `normalizePgDate` (Task 2) | 9, 16 | Covered by each task's existing tests (no behavioural change, only de-duplication) |
| 10 | Buy/Sell price allowed `0` (only non-negative was enforced) | `parsePositiveOrError(input.priceUsd, false)` — strictly greater than zero | 24 | `app/actions/transactions.test.ts`'s zero-price rejection test |
| 11 | Dangerous-path test coverage checklist | Every item (stale-resolved-symbol, `>10dp` round-trip, Server Action rejection/uncertain outcome, new-account visible on Transactions, refreshed cash on a 2nd transaction, stale/racing Sell holdings) is covered by the tests listed against issues 1–7 above | 13, 14, 15, 25 | See rows above; "new account visible on Transactions" is covered by Task 26's full regression walkthrough (Step 3) rather than a unit test, since it's an end-to-end cross-page assertion |

**Constraint check:** no task modifies `migrations/001_portfolio_core.sql`; no task changes `lib/ledger/cashEffect.ts` or `lib/ledger/positions.ts`'s accumulation logic; no task touches the append-only trigger; every task that reuses an existing function (`createAccount`, `applyTransaction`, `applyOpeningCashAdjustment`, `applyOpeningPositionAdjustment`, `upsertLatestPrice`, `resolveOrCreateAsset`) does so unmodified in behaviour when called without the new optional `client` param (Task 6's own regression tests confirm this explicitly); `recordAccountReconciliation` is untouched and not wired into any UI in this pass (Tasks 19–20 deferred); no M2/M3/M4 feature, reversal UI, full reconciliation workflow, or company-name lookup appears anywhere in this plan. This session's final-review pass adds no schema change either — `SetupCommitUncertainError` is a new *error class*, not new persisted state, and every fix above is confined to the `app/actions/*.ts` / `lib/ledger/setupAccount.ts` / component layers already touched by the original plan; no task count changed (still 26, with 19–20 still deferred as a numbered slot) and no new files were introduced by this pass.

---

## Execution

This plan has **not** been executed — no code has been written or modified. Per this session's instructions, it's presented here for review only.

Once reviewed, the two standard execution paths are:

1. **Subagent-Driven (recommended)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. A fresh subagent per task, with review between tasks.
2. **Inline Execution** — REQUIRED SUB-SKILL: `superpowers:executing-plans`. Batch execution in this session with checkpoints.
