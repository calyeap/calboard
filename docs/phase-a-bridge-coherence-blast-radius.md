# Phase A — bridge-coherence blast radius, and the stop it produces

> **SUPERSEDED IN TWO PLACES, 2026-09-09.** CalFinance ruled that lease > debt
> does not establish non-nesting (it proves only that the lease is not FULLY
> nested), and that a missing XBRL fact is not zero. Under those rules:
>
> - **MSFT's non-nesting stands but on different evidence** — its own Note 13
>   places the whole $66,594M liability in other current and other long-term
>   liabilities. The lease > debt reasoning below is withdrawn.
> - **LLY is NESTED, not "nothing to nest"** — its 10-K states finance leases
>   are included in long-term debt, and never quantifies them. The table below
>   classified it from tag absence, which is exactly the inference the new rule
>   forbids. INTC and NVDA are likewise UNKNOWN rather than nil.
>
> Corrected classifications, the per-company ceiling this creates, and the three
> routes for filing-text evidence are in
> [`filing-text-evidence-routes.md`](./filing-text-evidence-routes.md). The
> structural findings below — I2 being a property of the resolution model, the
> absence of dimensional data in companyfacts, and the impact surface — are
> unaffected.

**Status: STOPPED at the Phase A gate. Phase B was not started.** Two of the
three named stop signals fire outright and the third fires conditionally on one
question the ruling leaves open. Nothing was fixed: no mapping change, no
version bump, no construction, no frozen artefact touched, no threshold.

Reproduce:

```bash
npx tsx scripts/analyzer/bridge-coherence-blast-radius.ts
```

Output: `.evidence/bridge-coherence/blast-radius.txt`.

## 0. Contract gate

All eight frozen artefacts verified by SHA-256, presence checked before
hashing. 8/8 OK.

---

## 1. What was measured

Every construction that combines balance-sheet stocks, not only the three
bridges the earlier pass happened to touch:

| Bridge | Where |
|---|---|
| EV bridge | `modules/enterpriseValue.ts:55` |
| net debt | `acquisition/acquire.ts:287` |
| leverage ratio | `gates.ts:178` |
| leverage operating-lease memo | `gates.ts:185` |
| invested capital (per the ruling) | not implemented |

against all six `instant` mapping entries — `total-debt`,
`finance-lease-liabilities`, `operating-lease-liabilities`,
`cash-and-marketable-debt-securities`, `cash-balance`, `shares-outstanding` —
plus the §4.4 non-operating investment candidates.

Market cap is treated as the ruling's exception: shares outstanding and price
are a market value at the valuation date, so they are excluded from the
same-date test over balance-sheet claims and reported with their own dates.
`treasury-method-dilution` is a duration fact by mapping and belongs to that
same market-equity side.

## 2. Union Pacific, re-derived on approved evidence

The earlier pass settled UNP partly on the combined element **summing** to the
debt total. That is arithmetic coincidence and is not relied on here.

The conclusion stands, on qualifying evidence, and all three approved kinds are
present:

- **Reliable issuer-filed XBRL relationship (E3).** UNP tags the *same instant*
  (2025-12-31) and the *same value* (31,814,000,000) under both
  `us-gaap:LongTermDebt` and
  `us-gaap:LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` —
  an element whose definition includes capital lease obligations. The issuer has
  itself asserted that its debt total is a debt-and-capital-lease total. This is
  in companyfacts and is machine-checkable; it is what the harness now uses.
- **Explicit issuer disclosure.** The FY2025 10-K *Schedule of Total Debt*
  presents `Finance Lease — total principal $105` as a component line.
- **Same-date component reconciliation.** In the filing's XBRL, that schedule is
  dimensionally tagged: `unp_FinanceLeaseMember` on
  `us-gaap_LongtermDebtTypeAxis`, carrying `DebtInstrumentCarryingAmount`, with
  total principal 33,492 less `DebtInstrumentUnamortizedDiscountPremium...` 1,678
  = 31,814.

**UNP is NESTED, established deterministically.** Its lease must be counted
once, which under the 2026-09-09 ruling means removing it from the debt term.

## 3. The evidence types are mostly outside acquisition's reach

`companyfacts` fact rows carry exactly these keys: `end, val, accn, fy, fp,
form, filed, frame`. **No axis, no member, no dimensional breakdown at all.**

| Approved evidence | Obtainable from companyfacts? |
|---|---|
| E1 explicit issuer disclosure | **No** — note text |
| E2 same-date issuer component reconciliation | **No** — needs dimensional members |
| E3 issuer-filed XBRL component/calculation relationship | **Partly** — element identity at one instant, yes; calculation linkbase, no |

So OKLO, RIVN and COST have genuinely qualifying evidence — each filing's lease
note explicitly places the lease outside the debt total, and Costco's footnote 3
is the model — but **the software cannot obtain it.** A human read it. Under the
ruling those three are software-side UNRESOLVED, and therefore INCOMPLETE.

### The asymmetry in the rule, reported rather than filled

All three approved kinds establish what a debt total **contains** — they are
routes to proving *nesting*. Counting a lease exactly once needs the opposite
answer just as often: proof that a lease is **not** in the total. The only
deterministic route to that available here is **deductive impossibility** — a
lease larger than the entire debt figure cannot be a subset of it. That is a
proof, not a coincidence, but it is not one of the three named kinds.

It is also the only thing that rescues the reference company. See §6.

## 4. Results

| Ticker | I1 nesting | I2 dates | Verdict |
|---|---|---|---|
| MSFT | EXCLUDED (deductive impossibility) | coherent, all 2026-06-30 | **only company that can produce a coherent bridge** |
| OKLO | UNRESOLVED | coherent | INCOMPLETE (I1) |
| NVDA | no lease input | coherent | INCOMPLETE (pre-existing) |
| KO | no lease input | **MIXED** 2024-03-29 \| 2026-04-03 | INCOMPLETE (I1 pre-existing + I2) |
| UNP | **NESTED**, resolvable | **MIXED** 2025-12-31 \| 2026-06-30 | INCOMPLETE (I2) |
| COST | UNRESOLVED | **MIXED** 2026-05-10 \| 2025-08-31 | INCOMPLETE (I1 + I2) |
| XOM | no lease input; total-debt NOT ACQUIRED | n/a | INCOMPLETE (registrant, see below) |
| INTC | no lease input | **MIXED** 2025-12-27 \| 2026-06-27 \| 2021-12-25 | INCOMPLETE (I1 pre-existing + I2) |
| LLY | no lease input | **MIXED** 2025-12-31 \| 2026-06-30 \| 2024-12-31 | INCOMPLETE (I1 pre-existing + I2) |
| RIVN | UNRESOLVED | **MIXED** 2026-06-30 \| 2025-12-31 | INCOMPLETE (I1 + I2) |

**Nine of ten INCOMPLETE. One survivor.**

### What evidence each would have needed, and why it is absent

- **OKLO, RIVN, COST** — needed E1 or E2, both of which they *have* in their
  filings. Absent from acquisition because note text and dimensional members are
  not in companyfacts. COST's non-operating candidates additionally resolve to
  2011-08-28 and 2010-08-29.
- **NVDA, KO, INTC, LLY** — needed no nesting evidence at all; they report no
  finance lease. What they need is a way to record *genuinely nil*, which §4.3
  forbids the software to infer ("Absence is never rendered as zero") while §4.2
  makes finance lease liabilities REQUIRED for EV. See §7.
- **UNP** — nesting is settled. It needs a coherent statement date, which it
  does not have because its debt and leases come from the 10-K and its cash from
  the later 10-Q.
- **MSFT** — needs nothing if deductive impossibility is approved evidence; needs
  E1/E2 if it is not.
- **XOM** — needs the right registrant before either invariant can be applied.
  The ticker directory maps XOM to `ExxonMobil Holdings Corp` (CIK 2115436),
  where `total-debt` is NOT ACQUIRED; the history is under CIK 34088, where
  `total-debt` resolves to a **2017-12-31** figure.

## 5. I2 is structural, not per-bridge — the first stop signal

The date incoherence is not a property of the bridges. It is a property of the
resolution model: `resolveEntry` resolves each entry independently to *its own*
latest eligible row, and a bridge inherits whatever combination that produces.

**Union Pacific is the clean demonstration.** UNP is a healthy annual filer with
nothing wrong with its filings. Its debt and leases come from the FY2025 10-K
(2025-12-31); its cash comes from the later 10-Q (2026-06-30). Every entry did
exactly what the mapping says. The bridge is still incoherent.

Others show how far the same mechanism reaches: KO's `total-debt` resolves to
2024-03-29 because KO stopped tagging `LongTermDebt` after that quarter; INTC's
operating leases to 2021-12-25; LLY's to 2024-12-31 and its treasury-method
dilution to **2011-12-31**; COST's non-operating candidates to 2010–2011.

Satisfying the same-date rule therefore cannot be done per bridge. It requires
choosing an **anchor date first** and resolving every balance-sheet stock at that
anchor — the inverse of the present model, in which each entry picks its own date.

That is not extending `componentAtSamePeriod`. That helper pins a `plus`
component to *its primary row's* period, within one entry, after the primary has
already been chosen. Extending it across entries requires something it does not
have: a decision about which date the whole set is struck at, made before any
entry resolves. It is a replacement for the per-entry latest-row rule, not a
widening of it.

And `selectTagged.ts` states the consequence itself: *"THE SELECTION RULE IS
PART OF THE MAPPING... Changing anything here that decides WHICH candidate wins
therefore bumps TAG_MAPPING_VERSION exactly as adding a candidate does, and puts
every previously acquired fact under the §3.8.1 version review."* An anchor-date
model changes which **row** wins for essentially every balance-sheet fact at
most filers.

**It changes acquired values, not merely which bridges are refused.** Under an
anchor at 2025-12-31, UNP's cash becomes **$1,266M** instead of the **$1,614M**
acquired today — a 27% move in a REQUIRED input, for a company whose filings are
fine.

> **Stop signal 1 fires:** the same-date requirement cannot be satisfied without
> changing how facts are resolved generally, rather than per bridge.

## 6. One company can produce an EV, and only on unapproved evidence — the third signal

MSFT is the sole survivor, and it survives **only** by deductive impossibility:
its finance lease ($66,594M) exceeds its entire debt figure ($40,294M). That is
not one of the three approved evidence kinds.

- If deductive impossibility **is** approved: 1 of 10 companies can produce an
  EV.
- If it **is not**: MSFT is UNRESOLVED too, and **no company can produce an EV.**

> **Stop signal 3 fires** on the second reading, and is one company away from
> firing on the first. Either way this is the signal's own description: a product
> question rather than a fix.

The same question decides stop signal 2. `mock-report-msft.html` states net debt
of $30.0B (40.294 + 66.594 − 76.843, all at 2026-06-30). If impossibility is
approved, the frozen mock still reproduces exactly. If it is not, the system
cannot reproduce a figure a frozen artefact states — a direct conflict between
the ruling and the contract.

> **Stop signal 2 fires conditionally**, on the same open question.

## 7. The impact does not stay inside acquisition and mapping

The gate asked whether it does. It does not, in four places:

1. **Acquisition and mapping** — the resolution model changes (§5), which is a
   version bump plus a §3.8.1 review of every previously acquired fact.
2. **Assembly** — the ruling requires both dates preserved in provenance, the
   market date and the statement date, with the bridge saying which is which.
   `SourcedValue`/provenance and `assemble.ts` carry one date today.
3. **The report** — §3.5's bridge display must state which date is which, and
   nine of ten companies returning INCOMPLETE changes what is shown for almost
   every company.
4. **The spec** — and this is the part no fix reaches. §4.2 makes *finance lease
   liabilities* a REQUIRED input for "Enterprise value and every EV-based
   multiple". §4.3 forbids rendering absence as zero. A company with no finance
   leases therefore **can never produce an EV**, and four of the ten are in that
   state. The spec has no way to express "genuinely nil" for a REQUIRED input.
   That predates this ruling; the ruling makes it unavoidable rather than
   incidental.

## 8. Stop, and what is needed

Phase B is not started. The decisions, smallest first:

1. **Is deductive impossibility approved nesting evidence?** It decides whether
   the reference company survives and whether a frozen artefact conflicts with
   the ruling. It is the cheapest question and it unblocks the most.
2. **How does an issuer's note-text disclosure enter the system?** Three of ten
   companies have qualifying E1 evidence that acquisition structurally cannot
   read. Options are a §4.4-style recorded judgment, the §3.8.1 AI-extraction
   fallback, or fetching the filing's XBRL instance and calculation linkbase
   rather than the companyfacts API — the last being the only one that keeps the
   determination deterministic, and the largest.
3. **Does the same-date rule govern acquisition or only bridges?** As an
   acquisition rule it changes acquired values at most filers (UNP's cash by
   27%) and triggers a full §3.8.1 review. As a bridge-level rule it needs
   somewhere other than acquisition to live, and `componentAtSamePeriod` is not
   that place.
4. **Can a REQUIRED input be genuinely nil?** Four of ten companies report no
   finance lease. Until this is answerable, they cannot produce an EV no matter
   what happens to the other three questions. This is a spec question.

Until 1 and 3 are answered, building the one-bridge invariant means guessing how
facts are resolved and whether the contract's own reference figure remains
reproducible.
