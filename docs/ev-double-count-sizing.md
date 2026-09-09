# Sizing the EV double-count

> **THE SIZING STANDS; TWO "NOT AFFECTED" REASONS ARE SUPERSEDED, 2026-09-09.**
> The $105M for UNP is unchanged — it rested on issuer element identity, not on
> either rejected inference. But later CalFinance rulings reject the reasons
> given below for MSFT and for the four filers with no lease tag:
>
> - **MSFT** was "nesting arithmetically impossible" because its lease exceeds
>   its debt. That proves only that the lease is not FULLY nested. MSFT is still
>   not affected, on its own Note 13 disclosure instead.
> - **NVDA, KO, INTC, LLY** were "the bridge adds no lease at all" from tag
>   absence. A missing tag is not zero. They are UNKNOWN — and **LLY is in fact
>   NESTED**, its 10-K placing its finance leases inside long-term debt without
>   ever quantifying them. Its bridge is INCOMPLETE rather than double-counting,
>   but its debt figure is contaminated by an amount no disclosure states.
>
> The harness now emits the corrected states. Table below updated in place.

**A report. No fix.** The §3.5 enterprise-value bridge double-counts finance
leases for any filer whose `total-debt` figure already contains them. This
document sizes that across the ten calibration companies. It changes no code,
bumps no version, and rules nothing about the filers it cannot settle — that
half is with CalFinance.

Reproduce:

```bash
npx tsx scripts/analyzer/ev-double-count-sizing.ts
```

Output is written to `.evidence/ev-double-count/sizing.txt`. Background and the
nesting evidence are in [`lease-once-measurement.md`](./lease-once-measurement.md).

---

## The answer

**One company of the ten is affected today: UNP, by exactly $105M.**

| | |
|---|---:|
| UNP total-debt (`LongTermDebt`, @2025-12-31) | $31,814M |
| finance-lease input added on top | $105M |
| **EV overstatement** | **$105M** |
| as a share of UNP's net-debt bridge ($30,305M) | 0.35% |
| as a share of EV | not computed — no price recorded for UNP |

The error is **exactly** the nested lease amount and needs no price to size:
both lease terms enter additively, so market cap cancels out of the difference.
A price would only express it as a percentage of EV, and none is recorded for
UNP. Supplying one to make that percentage look complete is not something this
pass will do.

## Why the other nine are not affected

Two conditions must both hold for the bridge to double-count: the lease must be
nested inside what `total-debt` resolved, **and** `finance-lease-liabilities`
must actually resolve so the bridge adds it a second time.

| Ticker | Why not affected |
|---|---|
| MSFT | ~~lease exceeds total debt~~ -> note: whole liability in other current/long-term liabilities |
| OKLO | note: finance lease is in *other liabilities*, not long-term debt |
| NVDA | ~~adds no lease at all~~ -> **UNKNOWN**; "primarily operating" is not REPORTED NIL |
| KO | ~~adds no lease at all~~ -> **UNKNOWN**; lease note never addresses the liability |
| COST | note: finance lease is in *other long-term liabilities* and *other current liabilities* |
| XOM | **undetermined** — see below |
| INTC | ~~adds no lease at all~~ -> **UNKNOWN**; liability never stated separately |
| LLY | ~~adds no lease at all~~ -> **NESTED-UNQUANTIFIED**; inside long-term debt, unquantified |
| RIVN | note: balance sheet presents long-term debt and lease liabilities as separate lines |

Where the finance-lease input does not resolve, that REQUIRED input is missing
and the bridge returns INCOMPLETE (§5.2) rather than a number — so there is no
EV for the defect to be wrong by, and no *measurable* overstatement.

That is a statement about the arithmetic only. It is **not** a finding that no
lease exists, and LLY is why the distinction matters: a filer whose debt total
includes leases while tagging no lease element adds nothing twice and is still
wrong, because its debt term carries a lease it cannot remove.

**COST was nearly a false negative, and the correction matters.** An earlier
pass of this measurement pinned the lease probe to the date `total-debt`
resolved and reported COST as filing no finance lease. It files $1,479M of
them — 26% of its total-debt figure — just not at that date. Had COST turned
out to be nested, the sized total would have been fourteen times larger. The
script now takes the bridge's own resolved inputs, and reports the full census
of every lease element each filer tags so that "no finance lease" is a measured
claim rather than the absence of the three elements the code happens to check.

**XOM is unmeasured, not unaffected.** Through the SEC ticker directory XOM now
resolves to `ExxonMobil Holdings Corp` (CIK 2115436), a new registrant whose
`total-debt` is NOT ACQUIRED — so there is no EV and nothing to overstate. The
operating history is under `Exxon Mobil Corporation` (CIK 34088), where
`total-debt` resolves to a **2017-12-31** figure, because XOM stopped tagging
those elements after 2017 and the -09-2 recency rule has nothing current to
switch to. Neither path yields a usable EV, for two different reasons.

## A second defect, found while sizing the first

**The bridge combines debt-side inputs struck on different balance sheets.**
Each mapping entry resolves independently to its own latest eligible row, and
nothing requires them to describe the same date:

| Ticker | total-debt | finance leases | apart |
|---|---|---|---|
| COST | @2026-05-10 (10-Q) | @2025-08-31 (10-K) | ~8 months |
| RIVN | @2026-06-30 (10-Q) | @2025-12-31 (10-K) | ~6 months |
| XOM (legacy CIK) | @2017-12-31 (10-K) | @2025-12-31 (10-K) | ~8 years |

This is not the double-count and ruling on nesting does not fix it. It is the
same family as the mixed-basis window §3.7 refuses, applied to one bridge
rather than to a history: a net-debt figure assembled from two balance sheets
belongs to neither. `selectTagged.componentAtSamePeriod` already enforces
exactly this discipline **within** an entry, requiring every summed component
to sit at the primary row's period — the requirement simply does not extend
**across** the entries that make up one bridge.

Reported, not fixed. It is a separate defect with a separate decision behind it.

## What "today" means

The $105M is the arithmetic the bridge performs whenever it runs. That is
reported separately from whether EV renders for any of these companies right
now — because it does not. The §4.4 non-operating-investments judgment is
unrecorded for every company in the calibration set, and prices are recorded
only for MSFT and OKLO, so **no calibration EV completes today regardless of
this defect.** UNP additionally lacks treasury-method dilution.

The distinction is worth keeping precise: the defect is live in accepted code
and will produce a wrong number the first time a UNP-shaped filer reaches a
completed bridge. It is not currently producing a wrong number on screen.
