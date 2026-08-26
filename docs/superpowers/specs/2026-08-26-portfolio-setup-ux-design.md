# Portfolio Setup UX — Design

**Status:** Approved for planning. Revision 2 — narrowed per an independent senior UX critique (see §11 for the resolved/deferred breakdown against that critique).
**Scope:** Presentation-layer redesign of the Phase B UI (`app/page.tsx`, `app/actions.ts`) plus a small set of narrowly-scoped, behaviour-preserving backend additions needed for transactional integrity and honest data display. No change to the M1 accounting model, ledger rules, or schema.
**Out of scope:** M2/M3/M4 features (attention queue, SGD display, news, AI), visual branding/polish, transaction reversal/correction UI, a full periodic-reconciliation workflow, mixed cost-basis-mode-per-holding.

---

## 1. Problem

The M1 portfolio core, historical backfill guardrails, and spot-only opening-import workflow are built and tested, but the real portfolio database is still empty. Before entering real financial data, the current single-page UI (`app/page.tsx`) reads as an engineering/debug screen:

- Dashboard, account creation, ongoing transactions, and one-time opening import all compete on one page.
- Forms rely on placeholder text instead of persistent labels.
- Implementation vocabulary ("Phase B", "cutover", "OPENING IMPORT:") is user-visible.
- There is no setup progression, no pre-commit review, and no way to check imported data against a real statement before it becomes an irreversible append-only commit.

This document defines the minimum UX restructuring needed before real data entry. It does not reopen the accounting model, ledger design, or schema (see §10, "Settled — do not reopen").

---

## 2. Information architecture

*(Unchanged from revision 1 — carried forward as approved.)*

### 2.1 Persistent primary navigation

The steady-state app (Dashboard, Accounts, Transactions) carries a persistent navigation bar — no reliance on browser Back or hidden links:

```
Calboard   ·   Dashboard | Transactions | Accounts
```

The setup wizard (§4) suppresses this nav while active, to keep the flow focused. Its own "Cancel setup" is the only exit path during the draft steps.

### 2.2 Screens

| Route | Purpose |
|---|---|
| `/` Dashboard | Read-oriented: portfolio value, holdings table, accounts summary. |
| `/accounts` | Account list, "+ Add account" (launches the wizard), per-account "Reconcile" (optional, periodic — see §7). |
| `/transactions` | Ongoing transaction entry (deposit/withdrawal/buy/sell) + a simple chronological list. No reversal/correction UI in this pass. |
| *(wizard, not a route users navigate to directly)* | Per-account guided setup. Reachable from the Dashboard empty state and from `/accounts`. |

### 2.3 No persisted "setup mode" flag

Whether the Dashboard shows its empty state or the full portfolio view is derived entirely from whether any accounts/data exist — no new schema column or app-level "setup complete" flag. The wizard is an *action*, launched from two entry points:

1. **First run** — Dashboard has zero accounts → its empty state's one CTA is "Add your first account."
2. **Later** — `/accounts` → "+ Add account," for any account opened after initial setup.

### 2.4 Empty states

- **Dashboard, zero accounts:** one primary CTA, "Add your first account."
- **`/accounts`, zero accounts:** same CTA and copy.
- **`/transactions`, zero accounts:** the entry form is not shown. Instead: *"You need an account before you can add transactions."* + `[+ Add account]`.

No screen shows an unusable form (an empty `<select>`, a placeholder-only field).

---

## 3. Setup journey — state model

### 3.1 Draft state is disposable

Before Confirm & Save, all wizard data (account name/custodian, the portfolio-as-of date, opening cash, the holdings list) lives in **client-side state only**. Cancelling, closing the tab, or navigating away at any point before Confirm & Save leaves no empty account, no partial rows, nothing to clean up. No draft persistence/recovery across a browser refresh is in scope for this pass.

### 3.2 Atomic commit

Confirm & Save is the single moment real data is written, and it is genuinely atomic. This matters because `transactions` is append-only (`UPDATE`/`DELETE` raise, per L4/AC-L5): a partial failure across separate auto-committing calls would leave irreversible committed rows with no delete path.

**Approved implementation approach (unchanged from revision 1):**

- `createAccount` (`lib/accounts.ts`), `applyTransaction` (`lib/ledger/applyTransaction.ts`), and `applyOpeningCashAdjustment` / `applyOpeningPositionAdjustment` (`lib/ledger/openingImport.ts`) each gain an **optional injected `client` parameter**.
  - **Omitted:** behaviour is unchanged — the function owns its own connection and its own `BEGIN`/`COMMIT`/`ROLLBACK`. Every existing caller and test is unaffected.
  - **Provided:** the function uses the given client and skips its own transaction control, letting a caller compose several calls into one transaction.
- A new orchestration function (e.g. `lib/ledger/setupAccount.ts`) owns the transaction: acquire one client, `BEGIN`, `createAccount`, `applyOpeningCashAdjustment` (only if a non-zero amount was entered), `applyOpeningPositionAdjustment` per holding, `COMMIT` on full success, `ROLLBACK` on any failure.
- No schema change. No new accounting rule. No change to what any existing function computes.

**Testing requirement (unchanged):** a test proving that a failure on a later holding (e.g. the 3rd of 3) rolls back the entire setup — no account row, no cash row, no earlier holdings rows remain.

### 3.3 The human broker-statement check happens before the commit, not after

Discovering a typo only after an append-only commit is a poor recovery path. The statement check therefore happens on the **Review** step, before Confirm & Save — see §4, Step 4. What happens *after* Confirm & Save is a fully automatic **read-back verification** (§4, "Saved-data verification") that confirms the database stored exactly what the user approved — it is a system-integrity check, not a second manual data-entry exercise, and it requires no broker-statement re-entry.

**Read-back verification implementation:** after the atomic commit succeeds, a small new read-only function re-fetches the just-created account, its `account_cash` row, and its `positions_current` rows (using the same query shapes already used in `lib/portfolio.ts` and `lib/accountReconciliation.ts`) and compares them to the exact draft the user approved on Review. This is additive and read-only — it writes nothing, and it does not call `recordAccountReconciliation` (that function is reserved for the optional periodic action in §7).

---

## 4. Setup wizard — step by step

Four numbered steps (down from six screens in revision 1 — see §11 for the simplification rationale), followed by an automatic post-save check and a Complete screen.

### Step 1 of 4 — Account & portfolio-as-of date

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

Portfolio as of (required)
[2026-08-26 ▾]
These balances and holdings are correct as of this date. From
the next day onward, record every real transaction in Calboard
under Transactions — don't also enter transactions from before
this date here.

[Cancel setup]                          [Next: Opening cash →]
```

- Validation: account name required, non-empty. Date required, cannot be in the future (checked at the orchestration/action layer — see §9, not inside `lib/ledger/openingImport.ts`, whose own validation is unchanged).
- **Asked once.** This single date applies to the opening-cash adjustment and every opening-position adjustment in this account's setup — no per-section or per-holding date fields anywhere else in the wizard.
- The internal term "cutover" never appears in this copy; the field is labelled "Portfolio as of."
- Soft, non-blocking duplicate-account-name check, unchanged from revision 1.
- Cancel: unchanged from revision 1 (confirm-discard only if content has been entered).

### Step 2 of 4 — Opening cash

```
How much cash does [Account name] currently hold?
This is a starting balance, not a transaction — the amount
sitting in this account as of [portfolio-as-of date]. Leave it
at $0 if there's no cash to declare.

Opening cash balance (USD)
[0.00]
Enter 0 if this account holds no cash right now.

[← Back]  [Cancel setup]              [Next: Current holdings →]
```

No date field here — it references the date set in Step 1. Validation and $0-is-a-no-op behaviour unchanged from revision 1.

### Step 3 of 4 — Current holdings (repeatable)

```
What does [Account name] currently hold?
Add each position you currently hold as of [portfolio-as-of
date]. If this account is cash-only, skip straight to Review.

For this account, you'll enter cost as:
  ( ) Average cost per unit   ( ) Total cost basis
Use whichever your broker/exchange statement shows — Calboard
computes the other figure for you. Chosen once for this
account; every holding below uses the same figure.

Ticker symbol            [AAPL___]        e.g. AAPL, VOO, BTC
  → checking...  /  ✓ Resolved — last price $228.50 (2026-08-25)
  → Couldn't find a price for "XYZQ". Check the symbol, or
    add it anyway if you're sure it's correct.  [Add anyway]

Asset type                ( ) Equity  ( ) ETF  ( ) Crypto
Quantity you hold         [______]
Average cost per unit (USD)   [______]
  (label follows the mode chosen above — "Total cost basis
  (USD)" if that mode is selected)

[+ Add holding]

Added so far:
| Ticker | Type    | Qty | Avg cost | Cost basis |            |
|--------|---------|-----|----------|------------|------------|
| AAPL   | Equity  | 10  | $180.00  | $1,800.00  | Edit/Remove|

(empty state: "No holdings added yet. Add one above, or
continue if this account is cash-only.")

[← Back]  [Cancel setup]                      [Next: Review →]
```

- **Cost-basis mode is chosen once per account setup**, not re-asked per holding. If Total cost basis is chosen, the wizard divides by quantity to derive average cost for internal use and storage — `applyOpeningPositionAdjustment` continues to receive only `avgCostUsd`, unchanged.
- **Ticker resolution:** on entering a ticker, the wizard calls the existing `upsertLatestPrice` (already used elsewhere in the app for ordinary Buy/Sell) as the resolution signal. A successful fetch shows a concrete confirmation (last price and date) before the holding can be added; a failed fetch shows a clear, non-silent "couldn't find a price" state with an explicit "Add anyway" override — an unresolved symbol never *silently* becomes a position. (This does not display a company/asset name — see §11 for why that's deferred rather than invented.)
- **Case-insensitive duplicate-ticker block within the draft**, unchanged from revision 1 — adding a ticker already present in this account's draft list is refused inline.
- "Next: Review" is enabled with zero holdings — cash-only accounts are valid.

### Step 4 of 4 — Review against your statement

*(This is the merged review-and-broker-check step — the one and only place a human compares Calboard's draft against the real statement, and it happens entirely before anything is written.)*

```
Review against your statement
Nothing has been saved yet. Compare everything below against
your broker/exchange statement, then confirm.

Account — Interactive Brokers                            [Edit]
Portfolio as of — 2026-08-26                              [Edit]
Opening cash — $5,000.00                                  [Edit]
Holdings                                                   [Edit]
| Ticker | Type   | Qty | Avg cost | Cost basis |
|--------|--------|-----|----------|------------|
| AAPL   | Equity | 10  | $180.00  | $1,800.00  |

Total starting value entered: $6,800.00
Based on your entered average cost, not live market prices.

☐ I have checked these figures against my broker/exchange
  statement.

[  Confirm & Save  ]   (disabled until the checkbox is ticked)
After saving, any corrections are recorded separately so your
portfolio history stays accurate.
```

- The user is **never asked to re-type** any quantity or cost a second time — the statement check is a read-and-compare against the already-entered draft, with Edit links back to the relevant step for a fix.
- One deliberate final checkbox gates Confirm & Save — the same "require one explicit sign-off" principle from revision 1, now positioned before the write instead of after it.
- On click: "Saving…", disabled (no double-submit).
- **Success:** advances to the automatic Saved-data verification below.
- **Failure (transaction rolled back):** stays on Review, all data intact. Red banner: *"Nothing was saved. Fix the issue below and try again."* — plain-language translation of the failure, with a "Take me to the problem" link where the error maps to a specific step/row.

### Saved-data verification *(automatic, no user input)*

```
✓ Interactive Brokers has been created and saved to your portfolio.
Verifying your saved data...
```

Near-instant in the common case. Two outcomes:

- **Match (expected outcome):** proceeds straight to Complete. No screen lingers here — this is a confirmation, not a task.
- **Mismatch (should not normally happen):** a clear **technical failure** state, distinct in tone from a data-entry problem —
  ```
  Your setup was saved, but Calboard couldn't automatically
  confirm the saved data matches what you approved. This is a
  system issue, not a sign your broker figures were wrong.
  Check the Accounts page, or try refreshing.
  ```
  This is not framed as "reconcile with your broker" language — it is an app-integrity signal.

### Complete

```
Setup complete for Interactive Brokers
Cash: $5,000.00 · Holdings: 1 position

[+ Add another account]              [Go to dashboard →]
```

Equal visual weight on both actions, unchanged from revision 1.

### Back/Cancel, summarized

Steps 1–4 preserve data on Back. Cancel — or closing the tab, or the browser back button — discards all client-side state, confirming only if something has been entered. Saved-data verification and Complete have no Back — the data is already committed.

---

## 5. Dashboard, Accounts, Transactions

### `/` Dashboard — empty / populated states

Unchanged from revision 1: one-CTA empty state; populated state shows portfolio value, holdings table, accounts summary, no entry forms. See §9 for the revised price/data-health treatment of the holdings table.

### `/accounts`

Unchanged structurally from revision 1 — list, "+ Add account", per-account "Reconcile." See §7 for what "Reconcile" now means on its own, now that it's fully decoupled from initial setup.

### `/transactions`

```
Transactions

Add a transaction
Account          [select ▾]
Type             ( ) Deposit  ( ) Withdrawal  ( ) Buy  ( ) Sell
Trade date       [2026-08-26 ▾]   (defaults to today; historical
                  dates allowed; future dates rejected)

  — Deposit/Withdrawal —
  Amount (USD)     [______]

  — Buy —
  Ticker           [______]
    → checking... / ✓ Resolved — last price $228.50 (2026-08-25)
      / Couldn't find a price — check the symbol, or add anyway
  Asset type       ( ) Equity  ( ) ETF  ( ) Crypto
  Quantity         [______]
  Price (USD)      [______]

  — Sell —
  Holding          [select: AAPL — 10 held ▾]   (populated from
                    this account's actual current holdings; no
                    separate/contradictable asset-type field)
  Quantity         [______]
  Price (USD)      [______]

Fees (USD)         [0.00]   (optional)
Note                [______]  (optional)

Interactive Brokers cash after this transaction: $3,182.00
  (currently $5,000.00, decreasing by $1,818.00)

[Add transaction]   (disabled while saving)

Recent transactions
(reverse-chronological: date, account, type, amount/qty×price,
note — read-only; no edit/reversal UI in this pass)
```

**Zero-account empty state**, unchanged from revision 1: form is not rendered; *"You need an account before you can add transactions."* + `[+ Add account]`.

---

## 6. Transaction number-entry, resolution, and preview

Applies to `/transactions` and, where noted, the wizard.

- **All amounts are entered positive.** Deposit vs. Withdrawal determines cash direction; Buy vs. Sell determines meaning. The user never enters or sees a signed number. Fees are zero or positive. Matches existing backend validation (`parseDecimalField` already enforces this) — a copy/layout requirement, not a new rule.
- **Trade date is a visible, required field** — never silently stamped. Defaults to today, allows historical dates, rejects future dates (enforced at the action/orchestration layer, same technique as amount/quantity validation — see §9). Preserved on validation failure, same as every other field (§9).
- **No raw ledger/implementation detail is exposed** — no "cash effect" field, no signed values, no `txn_type`/`cash_effect_usd` naming.
- **Corrected cash-preview semantics**, shown above the submit button as a plain-language resulting balance (per PRD L7's "cash effect is computed and validated... shown before commit," phrased as a balance rather than a signed figure):

  | Type | Effect on cash |
  |---|---|
  | Buy | decreases by `quantity × price + fees` |
  | Sell | increases by `quantity × price − fees` |
  | Deposit | increases by the entered amount |
  | Withdrawal | decreases by the entered amount |

  The preview shows the **resulting account cash balance**, with the current balance and the delta as supporting detail (using the account's already-loaded cash figure — no new backend call).
- **Ticker resolution on Buy** uses the same live-price-fetch confirmation as the wizard's holdings step (§4, Step 3) — consistent treatment in both places.
- **Sell selects from the account's actual current holdings** (a new small read-only query against `positions_current`, filtered by account, `quantity <> 0`) instead of free-text ticker + a separately chosen asset type that could contradict the real position. Quantity currently held is shown as context; no oversell block is added (not requested, and would be a new business rule).
- **Entered values are preserved if validation fails.** The current pattern (`<form action={serverAction}>` that throws on invalid input) does not guarantee this. Closing this gap — via controlled inputs and a server action that returns structured field errors instead of throwing — is required by this design; the exact mechanism is an implementation-plan decision.
- **Submit is disabled while the request is in flight**, on every form in this redesign.
- **Errors render inline, beside the relevant field, in plain language.**

---

## 7. Duplicate-transaction warning, and periodic reconciliation

### 7.1 Duplicate-transaction warning

Before submitting an ordinary transaction, a lightweight, non-blocking check looks for a likely duplicate — same account, asset, type, quantity, and price, within a nearby date window (a small new read-only query against `transactions`, no schema change). If found:

```
This looks similar to a transaction from 2026-08-24 (same
account, ticker, type, quantity and price). Add it anyway?

[Add anyway]   [Cancel]
```

It warns, never silently rejects — legitimate repeated transactions exist.

### 7.2 Periodic reconciliation (`/accounts` → "Reconcile")

Fully decoupled from initial setup (§3.3, §4). This optional, on-demand action reuses `recordAccountReconciliation` (`lib/accountReconciliation.ts`) — unchanged — for a human, evidence-based comparison against a statement at any later point in time: broker-reported cash and, per holding, broker-reported quantity and cost (average or total, same derivation as §4 Step 3) entered beside Calboard's current values, with computed Match/Difference and a final sign-off checkbox. This is the same mechanic revision 1 had proposed for the *mandatory* post-save step; it now lives exclusively here, as a genuinely optional, lightweight action — not built out further in this pass beyond confirming it's the right home for that mechanic.

---

## 8. Price / data-health states

The dashboard must not silently understate portfolio value when a current price is unavailable. Today, `getPortfolioView` (`lib/portfolio.ts`) treats a position with no fetched price as contributing **$0** to `totalMarketValueUsd` — a real, currently-existing gap, not a new concern introduced here (see §11 for how this is scoped as a small additive fix rather than an accounting change).

Three explicit states, none implying setup failed:

| State | Meaning | Holdings-table treatment |
|---|---|---|
| **Price unavailable** | No price row exists yet for this asset (e.g. a provider fetch never completed) | Price/market-value cells show "No price yet" instead of blank or $0 |
| **Stale price** | A price exists but is older than the freshness threshold | Price shown greyed with an age badge, e.g. "as of 2026-08-20 (4 days ago)" |
| **Fetch failure** | An active fetch attempt errored | "Price fetch failed" with the last-known price (if any) still shown, plus a retry affordance |

**Portfolio total:** when any position lacks a current price, the total is no longer silently short — a visible disclosure accompanies it, e.g. *"Portfolio total excludes 1 holding with no price yet — true value is higher."* This requires a small, additive change to `lib/portfolio.ts`: each `PositionView` gains a price-status classification, and `PortfolioView` gains a flag/list for positions excluded from the computed total. It does not change what the total computes for any priced position, and it does not touch ledger or cost-basis logic.

---

## 9. Where new validation and read logic lives

To keep the "no change to already-tested ledger/accounting code" promise precise, this section states explicitly where each new check is implemented:

- **"Portfolio as of" cannot be in the future** and **transaction trade date cannot be in the future** — enforced at the app/action layer (alongside the existing `parseDecimalField`-style validation in `app/actions.ts`/the wizard's orchestration), *not* inside `lib/ledger/openingImport.ts`'s `requireValidTradeDate` or `applyTransaction`. Those functions' own validation (calendar-date format only) is unchanged.
- **Read-back verification** (§3.3) — a new, read-only function, reusing existing query shapes from `lib/portfolio.ts`/`lib/accountReconciliation.ts`. Writes nothing.
- **Account holdings list for the Sell picker** (§6) — a new, small, read-only query against `positions_current`. No write, no new table.
- **Duplicate-transaction check** (§7.1) — a new, small, read-only query against `transactions`. No write, no new table.
- **Price-status classification and total-exclusion disclosure** (§8) — an additive change to the existing read/aggregation query in `lib/portfolio.ts`. No change to cost basis, cash effect, or any write path.
- **Ticker resolution** (§4 Step 3, §6) — reuses the existing `upsertLatestPrice`/`MarketDataProvider.fetchLatestEod` call, just invoked earlier (at draft-entry time) in addition to its existing use. No new provider capability.

---

## 10. Settled — do not reopen

- The M1 accounting model: USD-only, single-table transactions, append-only ledger, average-cost-only cost basis, derived cash, account-level position grain.
- The opening-import guardrails in `lib/ledger/openingImport.ts` (mandatory `OPENING IMPORT:` note prefix, refusal on an existing non-zero position) — unchanged, only reached through the wizard.
- Schema — no new tables, no new columns, no new constraints. Every backend touch in this document (§3.2, §3.3, §6, §7.1, §8) is additive plumbing or a new read query, changing no computation any existing caller relies on.
- M2/M3/M4 features: SGD display, attention queue, material moves, news/events, AI.
- Transaction reversal/correction UI.
- Draft persistence/recovery across a browser refresh.
- A full periodic-reconciliation workflow beyond the existing `recordAccountReconciliation` reused as-is in §7.2.
- Mixed cost-basis-mode-per-holding — one mode per account setup is sufficient; no evidence of a genuine need for more.
- Visual branding and styling polish.

---

## 11. Self-review against the independent critique

**Resolved:**

1. **One account-level "Portfolio as of" date** replaces separate/per-holding dates — folded into Step 1, applied uniformly, "cutover" avoided in UI copy. UI/orchestration-layer only; the ledger functions' own signatures and validation are unchanged.
2. **`/transactions` has a visible, required trade date** — defaults to today, allows historical dates, rejects future dates, preserved on validation failure.
3. **The broker-statement check moved before Confirm & Save** and no longer requires re-typing any figure — Step 4 ("Review against your statement") is now the single merged review-and-check step, with Edit links back and one sign-off checkbox.
4. **Post-save verification is now automatic read-back**, not manual re-entry — confirms the database stored what was approved; a mismatch is framed as a technical failure, not a broker discrepancy. `recordAccountReconciliation` is no longer called during setup at all.
5. **Ticker resolution before acceptance**, with a clear "couldn't find a price" state and an explicit override — resolved using the *existing* price-fetch capability. **Company/asset-name display is deferred** (see below) — no such lookup exists in the codebase today.
6. **Cost-basis mode (average vs. total) is chosen once per account setup**, not per row, with explicit "match your broker's reported basis" guidance.
7. **Cash-preview formulas corrected** (buy/sell/deposit/withdrawal, fees applied correctly) and the **resulting balance** is shown, not just the delta. **Sell now selects from the account's real holdings** instead of a free-text ticker plus a contradictable asset-type field.
8. **Non-blocking duplicate-transaction warning** added.
9. **Price-unavailable/stale/fetch-failure states defined**, and the **portfolio total no longer silently excludes unpriced positions without disclosure**.
10. **Step count reduced and renamed honestly** — four numbered steps (from six screens), Step 4 doing double duty as review-and-check, post-save reduced to a brief automatic transition rather than a fifth manual screen.

**Intentionally deferred, with reasons:**

- **Company/asset-name confirmation on ticker entry.** The codebase has no symbol-search or name-lookup capability — `MarketDataProvider` only exposes EOD price fetches. Building one would be a genuine new provider-adapter capability, not a presentation change, so it's out of scope for this UX pass. The resolution confirmation instead uses the existing price fetch (ticker + last price + date) — real, verifiable data, not invented.
- **Mixed cost-basis mode within a single account's holdings.** You asked for one simple choice unless a genuine mixed-mode need exists; none was identified.
- **A fuller periodic-reconciliation workflow.** `/accounts` → "Reconcile" reuses the existing, unmodified `recordAccountReconciliation` mechanic as-is; building it out further wasn't requested and would expand scope beyond this pass.
- **Oversell prevention on Sell.** Showing quantity-held as context was added; blocking a sale that exceeds current holdings would be a new business rule, not requested here.
- **Transaction reversal/correction UI**, draft persistence across refresh, M2+ features, visual polish — unchanged exclusions from revision 1.

**Did any approved v1.2 accounting/backend rule change? No.** Every backend-adjacent item in this revision is one of:

- the already-approved optional-injected-`client` parameter (unchanged from revision 1),
- a new, small, **read-only** query (read-back verification; the Sell-picker holdings list; the duplicate-transaction check) that writes nothing and changes no existing computation, or
- an **additive** change to the existing read/aggregation query in `lib/portfolio.ts` (§8) that adds a price-status classification and a total-exclusion disclosure — it changes what is *displayed*, not what any ledger function computes, and touches no accounting rule, cost-basis method, or cash-effect formula.

No schema changes anywhere. "No future date" validation lives at the action/orchestration layer, not inside `lib/ledger/openingImport.ts` or `lib/ledger/applyTransaction.ts` — those functions' own tested validation is untouched.
