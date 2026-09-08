# M8-a — SEC acquisition, tagged mapping, cross-checks

Branch `feat/m8a-acquisition`. Dispatch of 8 September 2026.

## Contract gate

All seven frozen artefacts present in `docs/frozen/`; all seven SHA-256
hashes verified byte-exact before any edit. Methodology v1.0.2 read in
full; no conflict found between it and the spec on the acquisition
contract (methodology §10 Step 1 uses UNVERIFIED in the §5.1 propagation
sense, which is what spec §5.1 says it now means).

## What this milestone builds

1. `lib/analyzer/acquisition/` — an EDGAR client (User-Agent required,
   rate-limited, fail-closed), a fixed versioned tag mapping, and an
   acquisition pass that produces `FactRecord[]` carrying all seven §3.2
   fields plus `tagMappingVersion`.
2. `lib/analyzer/crosschecks/` — the three §3.8.2 families (footing,
   reconciliation, range sanity) run on every input, exempt or queued.
3. Two reports: the §3.8.1 fallback list and the §3.8.2 cross-check
   outcomes. Both are acceptance artefacts.

## What it does not build

No [C] interpretation, no page-one prose, no blind challenger, no
threshold calibration, position renderer stays disabled, F1-F6 not
fixed, nothing on the §13.1 excluded list.

## The tagged-versus-AI boundary

Tagged acquisition is required wherever a tag exists (§3.8.1). The
mapping is a data table with a version string recorded on every fact it
produces. AI extraction is a *recorded fallback state* with one of the
three §3.8.1 reasons — see "AI extraction" below.

## Mapping resolution — recorded, not assumed

Two candidate readings of "cash and marketable debt securities" (§3.5)
were live: cash + short-term investments (the balance-sheet subtotal),
or cash + all available-for-sale debt securities (the note). They differ
by ~$15B for Microsoft, and a mis-mapped tag is wrong for every company
at once.

Resolved from the frozen contract rather than by preference. The frozen
`mock-report-msft.html` states net debt $30.0B and finance leases
$66.6B. Real FY2026 XBRL:

    LongTermDebt                          40.294
  + FinanceLeaseLiability                 66.594   (mock: $66.6B, exact)
  - CashAndCashEquivalents 20.935
    + ShortTermInvestments  55.908 =      76.843
  =                                       30.045   (mock: $30.0B)

The cash + AFS-debt-securities reading gives 92.019 and a net *cash*
position of -14.9B, which contradicts the frozen mock's own stated sign
("the sign of the net cash position flips to net debt"). The mapping is
therefore determined by the frozen artefact, not chosen.

`treasury-method-dilution` maps to
`IncrementalCommonSharesAttributableToShareBasedPaymentArrangements`,
cross-checkable as diluted minus basic weighted-average shares
(7,453 - 7,429 = 24 million, exact).

`non-operating equity investments` is NOT auto-mapped. §4.4 makes it a
judgment ("classification, not a reported line"). Acquisition supplies
the *candidate line items* for the human to confirm; it does not pick.

## AI extraction

M8-a builds the fallback *register* — the boundary, the three reasons,
the record on the fact and the report — and does not make a model call.
§3.8.1 permits AI extraction on the three conditions; it does not
require this milestone to perform it, and the dispatch's own scope bars
the [C] layer. A fact that falls back with no value is a missing
REQUIRED input and returns INCOMPLETE for its dependents, which is the
fail-closed direction (§5.3). This is stated in the returned report, not
buried.

## Cross-checks

Three families, [S], on every input. A failure sets a state, forces the
fact into the queue whatever its acquisition path, and returns
INCOMPLETE for REQUIRED dependents. Nothing writes a value.

Each family carries a negative test that watches it fail.

---

## What the runs found

Live EDGAR, 8 September 2026. Reproduce with `npm run acquire -- MSFT OKLO`.

### MSFT — 18 facts acquired, 0 fell back

Every mapped figure came through the tag mapping. Three figures reconcile
against the frozen `mock-report-msft.html` exactly:

| Figure | Acquired | Frozen mock |
|---|---|---|
| Finance lease liabilities | 66,594,000,000 | $66.6B |
| Net debt | 30,045,000,000 | $30.0B |
| Current operating margin | 46.78% | 46.8% |

The ten-year median operating margin computed from the filings is 41.7%
against the mock's 41.8% — independent corroboration that acquisition is
reading the right lines, since the mock's figure came from a hand-solved
reconstruction.

Queue: 3 without a price feed, 4 with one.

### OKLO — 12 facts acquired, 4 fell back

| Fact | Reason |
|---|---|
| treasury-method-dilution | NO TAG EXISTS |
| total-debt | NO TAG EXISTS |
| current-revenue | TAG PRESENT BUT UNMAPPED IN VERSION IN FORCE |
| finance-lease-rou-additions | TAG PRESENT BUT UNMAPPED IN VERSION IN FORCE |

All four are honest. Oklo is pre-revenue and carries no debt, and its
awards are antidilutive so diluted equals basic. Queue: 1 without a price
feed, 2 with one.

## Defects found and fixed while building

1. **EDGAR's `fy`/`fp` name the FILING, not the fact's own period.** A
   FY2026 10-K stamps `fy=2026, fp=FY` on its FY2024 and FY2025
   comparatives too, so grouping a series by `fy` collapsed eleven years
   into seven and put the wrong figure in the most recent year — the
   headline margin and the last year of its own history disagreed by two
   points. Series are now keyed on the fact's period end.

2. **`plus` components belonged to the entry, not the candidate.**
   Microsoft tags depreciation and amortisation separately; other filers
   tag one combined element. An entry-level `plus` would have added
   amortisation onto the combined tag as well, double-counting it for a
   whole class of companies.

3. **The order-of-magnitude range check was over-generalised.** The spec
   names it for share counts. Applied to money it failed Oklo's real
   capex step-up (\$0.35m to \$33.2m as construction starts) — and
   §3.8.2's remedy is INCOMPLETE until re-acquisition, so a correct
   figure would have blocked its outputs permanently with no way for the
   analyst to clear it. Narrowed to the spec's own scope; the 10^3/10^6
   scale test still covers every figure.

4. **`evaluateTriggerA` crashed on an empty margin window.** Reachable
   only with real acquisition: a pre-revenue filer tags no revenue, so
   there is no margin series. Guarded to not fire, which is what §6.4's
   "a description, not a claim" means with nothing to describe.

5. **Price carried float noise onto the fact card.** Yahoo returns
   Microsoft's 499.70 close as 499.70001220703125. Routed through
   `lib/money.ts`'s existing one-price policy, as the portfolio side
   already does.
