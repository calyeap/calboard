# Portfolio Setup UX — Design

**Status:** Approved for planning.
**Scope:** Presentation-layer redesign of the Phase B UI (`app/page.tsx`, `app/actions.ts`) plus one narrowly-scoped, behaviour-preserving backend addition needed for transactional integrity. No change to the M1 accounting model, ledger rules, or schema.
**Out of scope:** M2/M3/M4 features (attention queue, SGD display, news, AI), visual branding/polish, transaction reversal/correction UI.

---

## 1. Problem

The M1 portfolio core, historical backfill guardrails, and spot-only opening-import workflow are built and tested, but the real portfolio database is still empty. Before entering real financial data, the current single-page UI (`app/page.tsx`) reads as an engineering/debug screen:

- Dashboard, account creation, ongoing transactions, and one-time opening import all compete on one page.
- Forms rely on placeholder text instead of persistent labels.
- Implementation vocabulary ("Phase B", "cutover", "OPENING IMPORT:") is user-visible.
- There is no setup progression, no pre-commit review, and no way to verify imported data against a real statement.

This document defines the minimum UX restructuring needed before real data entry: an information architecture split, a guided per-account setup journey, and number-entry/feedback conventions for ongoing use. It does not reopen the accounting model, ledger design, or schema (see §9, "Settled — do not reopen").

---

## 2. Information architecture

### 2.1 Persistent primary navigation

The steady-state app (Dashboard, Accounts, Transactions) carries a persistent navigation bar — no reliance on browser Back or hidden links to move between them:

```
Calboard   ·   Dashboard | Transactions | Accounts
```

The setup wizard (§4) intentionally **suppresses this nav** while active, to keep the flow focused and prevent partial navigation away from an in-progress draft. Its own "Cancel setup" is the only exit path out of the wizard proper; Verify and Complete (post-commit) likewise have no persistent nav, returning the user to normal navigation only once they choose "Go to dashboard."

### 2.2 Screens

| Route | Purpose |
|---|---|
| `/` Dashboard | Read-oriented: portfolio value, holdings table, accounts summary. |
| `/accounts` | Account list, "+ Add account" (launches the wizard), per-account "Reconcile" (optional, reuses the Verify component — see §7). |
| `/transactions` | Ongoing transaction entry (deposit/withdrawal/buy/sell) + a simple chronological list. No reversal/correction UI in this pass. |
| *(wizard, not a route users navigate to directly)* | Per-account guided setup: create an account and declare its opening cash/holdings. Reachable from the Dashboard empty state and from `/accounts`. |

### 2.3 No persisted "setup mode" flag

Whether the Dashboard shows its empty state or the full portfolio view is derived entirely from whether any accounts/data exist — no new schema column or app-level "setup complete" flag is introduced. The wizard is an *action*, launched from two entry points, not a mode the app is "in":

1. **First run** — Dashboard has zero accounts → its empty state's one CTA is "Add your first account."
2. **Later** — `/accounts` → "+ Add account," for any additional account opened after initial setup.

Both launch the identical wizard.

### 2.4 Empty states

Empty states guide the next action; no screen shows an unusable form (e.g. an account `<select>` with nothing in it).

- **Dashboard, zero accounts:** one primary CTA, "Add your first account."
- **`/accounts`, zero accounts:** same CTA and copy as the Dashboard empty state.
- **`/transactions`, zero accounts:** the entry form is not shown. Instead: *"You need an account before you can add transactions."* + `[+ Add account]`, launching the wizard.

---

## 3. Setup journey — state model

### 3.1 Draft state is disposable

Before Confirm & Save, all wizard data (account name/custodian, opening cash, the holdings list) lives in **client-side state only**. Nothing is written to the database. Cancelling, closing the tab, or navigating away at any point before Confirm & Save leaves:

- no empty account,
- no partial opening-import rows,
- nothing to clean up or reverse.

No draft persistence/recovery (e.g. across a browser refresh) is in scope for this pass.

### 3.2 Atomic commit

Confirm & Save is the single moment real data is written, and it is genuinely atomic — not a best-effort sequence of the existing separate actions. This matters specifically because `transactions` is append-only (`UPDATE`/`DELETE` raise, per L4/AC-L5): if account creation, opening cash, and per-holding opening-position writes happened as separate auto-committing calls, a failure partway through (e.g. holding #3 in a wizard draft violates a guardrail) would leave irreversible committed rows behind, with no delete path — only a reversing entry with a reason, i.e. ledger noise for what should have been a no-op. Wrapping the whole sequence in one transaction is required to honor "nothing exists until Confirm," not merely a nicety.

**Implementation approach (approved, minimal-scope):**

- `createAccount` (`lib/accounts.ts`), `applyTransaction` (`lib/ledger/applyTransaction.ts`), and `applyOpeningCashAdjustment` / `applyOpeningPositionAdjustment` (`lib/ledger/openingImport.ts`) each gain an **optional injected `client` parameter**.
  - **Omitted:** behaviour is unchanged from today — the function acquires its own connection and owns its own `BEGIN`/`COMMIT`/`ROLLBACK`. Every existing caller and test is unaffected.
  - **Provided:** the function uses the given client and does not `BEGIN`/`COMMIT`/`ROLLBACK` itself, letting a caller compose several calls into one transaction.
- A new orchestration function, e.g. `lib/ledger/setupAccount.ts`, owns the transaction for the wizard's Confirm & Save:
  1. Acquire one client, `BEGIN`.
  2. `createAccount(...)`.
  3. `applyOpeningCashAdjustment(...)` — only if a non-zero opening cash amount was entered.
  4. `applyOpeningPositionAdjustment(...)` for each holding in the draft, in order.
  5. `COMMIT` if every step succeeded; `ROLLBACK` on any failure (including the existing "already has a non-zero position" guardrail, which — because all writes share one transaction — can now also correctly catch two holdings for the same asset entered within a single draft, which the UI additionally prevents client-side, see §4 Step 3).
- No schema change. No new accounting rule. No change to what any existing function computes.

**Testing requirement:** add a test specifically proving that a failure on a later holding (e.g. the 3rd of 3) rolls back the entire setup — no account row, no cash row, no earlier holdings rows remain.

### 3.3 Mandatory post-save verification

Verification (quantity, cost, and cash comparison against a broker/exchange statement) is a **mandatory step of initial account setup**, not an optional follow-up — see §4, Verify. This is functionally and visually distinct from the optional periodic reconciliation reachable later from `/accounts` (§7): the first-run version cannot be skipped; the periodic version is invoked on demand and has no bearing on whether initial setup counts as complete.

---

## 4. Setup wizard — step by step

Progress indicator: Steps 1–4 show **"Step X of 4"**. After Confirm & Save succeeds, the indicator switches to **"Saved ✓ → Verify → Complete"** — a visual marker that the meaning of "back" has changed from editable draft to committed data.

### Step 1 of 4 — Account details

```
Let's set up an account
An account is a brokerage, exchange, or bank account you hold
investments or cash in — e.g. Interactive Brokers, Coinbase,
DBS Multiplier.

Account name (required)
[__________________]
e.g. Interactive Brokers, Coinbase, DBS Multiplier

Custodian / broker (optional)
[__________________]
The bank or broker that holds this account.

[Cancel setup]                          [Next: Opening cash →]
```

- Validation: name required, non-empty → inline "Account name is required."
- Soft, non-blocking duplicate-name check against existing accounts: "You already have an account named '[X]' — continue anyway?"
- Cancel: exits immediately if both fields are empty; otherwise confirms — *"Discard this account setup? Nothing has been saved."* [Discard] / [Keep editing].

### Step 2 of 4 — Opening cash

```
How much cash does [Account name] currently hold?
This is a starting balance, not a transaction — the amount
sitting in this account as of your chosen date. Leave it at
$0 if there's no cash to declare.

As of date
[2026-08-26 ▾]

Opening cash balance (USD)
[0.00]
Enter 0 if this account holds no cash right now.

[← Back]  [Cancel setup]              [Next: Current holdings →]
```

- Validation: amount ≥ 0 → "Enter a valid amount, 0 or more."
- A $0 balance is valid and is simply not written as a transaction at commit time.

### Step 3 of 4 — Current holdings (repeatable)

```
What does [Account name] currently hold?
Add each position you currently hold. If this account is
cash-only, skip straight to Review.

Ticker symbol           [AAPL]         e.g. AAPL, VOO, BTC
Asset type               ( ) Equity  ( ) ETF  ( ) Crypto
Quantity you hold       [______]
Average cost per unit (USD) [______]
  Your average purchase price — used for cost basis and P&L.
  Check your broker's cost-basis report if unsure.
As of date               [2026-08-26 ▾]

[+ Add holding]

Added so far:
| Ticker | Type    | Qty | Avg cost | Cost basis |          |
|--------|---------|-----|----------|------------|----------|
| AAPL   | Equity  | 10  | $180.00  | $1,800.00  | Edit / Remove |

(empty state: "No holdings added yet. Add one above, or
continue if this account is cash-only.")

[← Back]  [Cancel setup]                      [Next: Review →]
```

- Validation on Add: ticker required; quantity > 0; avg cost > 0.
- **Duplicate-ticker block:** adding a ticker already present in the draft is refused inline — *"You've already added AAPL below. Remove or edit that entry instead of adding it again."* This is what prevents the one failure mode that would otherwise trigger a full atomic rollback at Confirm & Save (§3.2).
- "Next: Review" is enabled with zero holdings — cash-only accounts are valid.

### Step 4 of 4 — Review (pre-commit)

```
Review before saving
Nothing has been saved yet. Check everything below, then confirm.

Account — Interactive Brokers                            [Edit]
Opening cash — $5,000.00 as of 2026-08-26                [Edit]
Holdings                                                  [Edit]
| Ticker | Type   | Qty | Avg cost | Cost basis |
|--------|--------|-----|----------|------------|
| AAPL   | Equity | 10  | $180.00  | $1,800.00  |

Total starting value entered: $6,800.00
Based on your entered average cost, not live market prices.
Market prices populate on the dashboard after saving.

[← Back]  [Cancel setup]

[  Confirm & Save  ]
Review these figures carefully before saving. After setup,
any corrections are recorded separately so your portfolio
history stays accurate.
```

- On click: button shows "Saving…", disabled (no double-submit).
- **Success:** advances straight to Verify with a green confirmation banner.
- **Failure (transaction rolled back):** stays on Review, all data intact. Red banner: *"Nothing was saved. Fix the issue below and try again."* — a plain-language translation of the failure, with a "Take me to the problem" link back to the offending step/row where the error maps to one.

### Verify (post-commit — no step count, no Back/Cancel)

```
✓ Interactive Brokers has been created and saved to your portfolio.

Verify against your broker/exchange statement
Enter the figures from your broker's statement below. Calboard
checks them against what was saved.

Cash
  Calboard's computed cash balance: $5,000.00
  Broker/exchange reported cash balance (USD) (required) [______]
  → Match ✓  /  Difference: $120.00 (2.4%)

Holdings — one panel per position:

  AAPL
  ─────────────────────────────────────────
  Quantity
    Calboard: 10
    Broker/exchange reported quantity (required): [______]
    → Match ✓  /  Difference: 2 shares (broker reports 12)

  Cost
    Calboard average cost: $180.00/unit (cost basis $1,800.00)
    Enter as: ( ) Average cost per unit  ( ) Total cost basis
    Broker/exchange reported value (required): [______]
    → Match ✓ (within rounding)  /  Difference: $4.50/unit ($45.00 total)

How does this look?
  ( ) Everything matches
  ( ) There's a discrepancy I need to look into

Notes (auto-drafted from any Difference lines, editable)
[______________________________]

☐ I have checked these figures against my broker/exchange statement.

[  Save verification  ]  (disabled until the checkbox is ticked)
```

- Both quantity and cost are **required per holding** — no blank-implies-match. Match/Difference is computed the moment both values are present; there is no manual "matches" checkbox per row.
- A holding whose quantity matches but whose cost differs still shows a cost-line Difference — quantity matching alone is never sufficient for a holding to read as verified.
- The "Total cost basis" entry mode derives implied average cost (`total ÷ broker-reported quantity`) for display and compares the total directly against Calboard's stored cost basis.
- The status radio is pre-selected based on the computed matches (all Match → "Everything matches") but always overridable.
- The final checkbox is the deliberate sign-off, required regardless of which status is chosen — "investigating" is as legitimate and deliberate an outcome as "matches."
- No Back/Cancel: the underlying ledger data is already committed; a genuine data-entry mistake is corrected outside this wizard (existing reversing-entry mechanism), not by a Back button here.
- Failure saving the reconciliation record itself: *"Verification wasn't saved — your account and holdings are safe either way. Try again."* [Retry]

### Complete

```
Setup complete for Interactive Brokers
Cash: $5,000.00 · Holdings: 1 position · Verification: Everything matches

[+ Add another account]              [Go to dashboard →]
```

Equal visual weight on both actions. "Add another account" relaunches the wizard fresh at Step 1.

### Back/Cancel, summarized

Steps 1–4 preserve data on Back. Cancel — or closing the tab, or the browser back button — discards all client-side state, with a confirm dialog only if something has been entered; there is nothing to clean up server-side, since nothing was ever written (§3.1). Verify and Complete have no Back: the data is already committed, so "going back" would misleadingly imply it is still an editable draft.

---

## 5. Dashboard, Accounts, Transactions

### `/` Dashboard — empty state

```
Welcome — let's set up your portfolio
Add your first account to start tracking what you own.

[+ Add your first account]
```

### `/` Dashboard — populated state

```
Calboard  ·  Dashboard | Transactions | Accounts

US$6,800.00
Cash: $5,000.00 · Holdings: $1,800.00

Holdings
(Symbol · Account · Qty · Avg cost · Price · Price date ·
 Market value · Unrealised P&L — same data and columns as
 today, no longer sharing the page with entry forms)

Accounts
Interactive Brokers · $5,000.00 cash · 1 holding
[Manage accounts →]
```

No entry forms live on this screen. SGD display, attention queue, and other M2 dashboard elements are explicitly out of scope for this pass.

### `/accounts`

```
Accounts                                    [+ Add account]

| Account             | Custodian | Cash      | Holdings |            |
|----------------------|-----------|-----------|----------|------------|
| Interactive Brokers  | —         | $5,000.00 | 1        | [Reconcile]|

(zero-account state: same single CTA as the Dashboard empty state)
```

"+ Add account" launches the setup wizard. "Reconcile" is discussed in §7.

### `/transactions`

```
Transactions

Add a transaction
Account          [select ▾]
Type             ( ) Deposit  ( ) Withdrawal  ( ) Buy  ( ) Sell

  — Deposit/Withdrawal only —
  Amount (USD)     [______]

  — Buy/Sell only —
  Ticker           [______]
  Asset type       ( ) Equity  ( ) ETF  ( ) Crypto
  Quantity         [______]
  Price (USD)      [______]

Fees (USD)         [0.00]   (optional)
Note                [______]  (optional)

This will decrease Interactive Brokers's cash by $1,800.00
  (computed preview — see §6)

[Add transaction]   (disabled while saving)

Recent transactions
(reverse-chronological: date, account, type, amount/qty×price,
note — read-only; no edit/reversal UI in this pass)
```

Only the fields relevant to the selected Type are shown — replacing today's single form that displays every field regardless of relevance (the direct fix for "inputs compressed horizontally" and unused-field clutter).

**Zero-account empty state:** the form above is not rendered. Instead:

```
You need an account before you can add transactions.

[+ Add account]
```

---

## 6. Transaction number-entry conventions

Applies to `/transactions` and, where relevant, the wizard:

- **All amounts are entered positive.** Deposit vs. Withdrawal determines cash direction; Buy vs. Sell determines transaction meaning. The user never enters or sees a signed number.
- **Fees are zero or positive.**
- This matches the existing backend validation (`parseDecimalField` in `app/actions.ts` already enforces positive amount/quantity and non-negative fees) — this is a UI-copy and layout requirement, not a new validation rule.
- **No raw ledger/implementation detail is exposed** — no field named "cash effect," no signed values, no mention of `txn_type` or `cash_effect_usd`.
- **PRD L7 ("cash effect is computed and validated, not free-entered... shown to the user before commit") is satisfied via a plain-language computed preview line** above the submit button, e.g. *"This will decrease [Account]'s cash by $1,800.00"* / *"This will increase [Account]'s cash by $5,000.00"* — computed client-side from quantity×price+fees or the entered amount, phrased as increase/decrease rather than as a signed figure.
- **Labels stay visible above fields at all times** — no placeholder-as-label pattern anywhere in these forms.
- **Entered values are preserved if validation fails.** The current pattern (a plain `<form action={serverAction}>` that throws on invalid input) does not guarantee this — a thrown error is likely to lose the user's typed values on re-render. This is a genuine gap the redesign must close: the form needs a pattern that returns structured validation errors without discarding user input (e.g. controlled inputs with server-returned field errors), left as an implementation-plan decision, not specified further here.
- **Submit is disabled while the request is in flight**, on every form in this redesign (wizard and `/transactions` alike) — no double-submission of financial data.
- **Errors render inline, beside the relevant field, in plain language** — not as a thrown exception or a generic error page. This applies uniformly to `/transactions`, `/accounts`, and the wizard.

---

## 7. Success feedback

After a transaction on `/transactions` succeeds:

- A clear, visible success message confirms the save (e.g. an inline banner or toast — exact treatment is an implementation choice, not specified here).
- The relevant figures (recent transactions list, and any portfolio/account totals visible on the same load) refresh automatically — the user is never left wondering whether the click worked. This requires the existing `revalidatePath` calls to be updated to match the new route structure (`/`, `/accounts`, `/transactions` as appropriate for what each action affects), which is an implementation detail flagged here for the plan, not decided in this document.

The wizard's own success states (Confirm & Save → green "✓ Saved" banner; Save verification → Complete screen) are specified in §4 and follow the same principle.

### Optional: periodic reconciliation on `/accounts`

The "Reconcile" action per account (§5) reuses the Verify screen's comparison mechanics (evidence entry → computed match/difference → confirmation checkbox), reframed for periodic use and additionally offering a "resolved" status for following up on a previously flagged account. This is a light reuse of an existing component, not new scope, and is **optional** for the implementation plan — it does not affect whether initial setup (§3.3, §4 Verify) counts as complete.

---

## 8. Terminology cleanup

| Internal/engineering term | User-facing replacement |
|---|---|
| "Phase B opening import (one-time cutover only)" | Not shown in steady state; wizard says "Add an account," "Opening cash," "Current holdings" |
| `OPENING IMPORT: ` note prefix, previously a field the user had to type into | Removed from the UI entirely — the wizard supplies this prefix to the existing actions behind the scenes |
| "cutover" | Never appears in UI copy |
| `ADJUSTMENT` txn type | Never surfaced as a raw label anywhere user-facing |
| "Reconciliation" | Kept as a concept, always paired with plain description text ("Verify against your broker/exchange statement" / "Reconcile [account]"), never shown as a bare heading alone |
| Raw thrown-error strings (e.g. `"quantity must be greater than zero"`) | Rendered as inline, per-field, plain-language messages — not a generic error page |

---

## 9. Settled — do not reopen

Everything below is unchanged by this document and is out of scope for any resulting implementation plan:

- The M1 accounting model: USD-only, single-table transactions, append-only ledger, average-cost-only cost basis, derived cash, account-level position grain.
- The opening-import guardrails in `lib/ledger/openingImport.ts` (mandatory `OPENING IMPORT:` note prefix, refusal on an existing non-zero position) — unchanged in behaviour, only reached through the wizard instead of raw form fields.
- Schema — no new tables, no new columns, no new constraints. The only backend change in scope is the optional-`client`-parameter plumbing in §3.2, which changes no computation, no constraint, and no default behaviour.
- M2/M3/M4 features: SGD display, attention queue, material moves, news/events, AI.
- Transaction reversal/correction UI.
- Draft persistence/recovery across a browser refresh.
- Visual branding and styling polish — this document specifies structure, hierarchy, labels, and states, not a visual design system.

---

## 10. Acceptance checklist for this UX pass

- A user with an empty database can go from "no accounts" to a fully verified account (cash + holdings, reconciled) via the wizard alone, never seeing a raw `<select>` with no options or a placeholder-only field.
- No engineering term ("Phase B", "cutover", "OPENING IMPORT", "ADJUSTMENT") appears anywhere in user-facing copy.
- Nothing is written to the database before Confirm & Save; abandoning the wizard at any prior point leaves no trace.
- A failure on any holding during Confirm & Save rolls back the entire setup — proven by a dedicated test (§3.2).
- Verification cannot be skipped during initial setup, and a holding with matching quantity but mismatched cost is shown as unverified.
- Dashboard, Accounts, and Transactions are reachable via persistent navigation from one another at all times outside the wizard.
- `/transactions` never renders an entry form when there are zero accounts.
- All transaction forms: positive-only numeric entry, visible persistent labels, values preserved on validation failure, submit disabled while saving, inline plain-language errors, and a plain-language cash-effect preview instead of any raw signed figure.
- A successful transaction produces visible confirmation and refreshed figures without a manual reload.
