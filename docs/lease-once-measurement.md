# The lease-once measurement — and the stop it produces

**Status: STOPPED before the construction was written.** Stop condition 2 of the
RONIC work item fired: *lease liabilities cannot be included exactly once
without changing the existing debt mapping's meaning.*

No construction was written. `TAG_MAPPING_VERSION` was **not** bumped. No frozen
artefact was touched, no fixture was edited, no threshold or cut-point exists
anywhere in this pass, and the position renderer remains disabled.

Reproduce the measurement:

```bash
npx tsx scripts/analyzer/lease-nesting-measurement.ts
```

Output is written to `.evidence/lease-nesting/measurement.txt`. The harness is
`scripts/analyzer/lease-nesting-measurement.ts`; it resolves through the real
`selectTagged.resolveEntry` against the real `TAG_MAP`, so what it reports is
what acquisition actually does, not a reconstruction of it.

---

## 0. The contract gate, first

All eight frozen artefacts verified by SHA-256 before any work. Presence was
checked before hashing, so an absent artefact would have been reported as
absent and never as a mismatch.

| Artefact | Verdict |
|---|---|
| `calfinance-methodology-v2.md` | OK |
| `calboard-valuation-methodology.md` | OK |
| `calboard-stock-analyzer-v1-spec.md` | OK |
| `calboard-stock-analyzer-v1-design.md` | OK |
| `mock-screen1-entry.html` | OK |
| `mock-human-steps.html` | OK |
| `mock-report-msft.html` | OK |
| `mock-report-oklo.html` | OK |

`docs/frozen/` holds exactly those eight files, so the reverse-coverage
direction that `scripts/evidence/gates.ts` checks — nothing present but
unregistered — is clean as well.

---

## 1. Why this had to be measured before anything was built

The ruling requires operating and finance lease liabilities to be included
**exactly once**. Whether a lease term added on top of `total-debt` counts a
lease once or twice is not a property of the construction. It is a property of
**what each filer's winning tag already contains**, and the mapping cannot be
asked: the acquisition pass had already found Oklo's total debt resolving
through `LongTermDebtNoncurrent` rather than the obvious tag, so an entry's
name is not evidence of its contents.

The existing EV bridge (`lib/analyzer/modules/enterpriseValue.ts:55`) computes:

```
EV = marketCap + totalDebt + financeLeaseLiabilities − cash − nonOperatingInvestments
```

so the same question was already live in shipped code, independently of RONIC.

## 2. The measurement

Ten calibration companies, live EDGAR, 9 September 2026. Verdicts use exact
filed integers — no tolerance, because a tolerance here would be an invented
cut-point deciding a ruling question.

| Ticker | total-debt | won via | finance lease | Verdict |
|---|---:|---|---:|---|
| MSFT | 40,294M | `LongTermDebt` | 66,594M | EXCLUDED |
| OKLO | 0.7M | `LongTermDebtNoncurrent` | 0.187M | UNDETERMINED → resolved by note, EXCLUDED |
| NVDA | 33,366M | `LongTermDebt` | not tagged | NOTHING TO NEST |
| KO | 42,218M | `LongTermDebt` | not tagged | NOTHING TO NEST |
| **UNP** | **31,814M** | **`LongTermDebt`** | **105M** | **NESTED** |
| COST | 5,670M | `LongTermDebtNoncurrent` | not tagged | NOTHING TO NEST |
| XOM | not acquired | — | — | UNDETERMINED (separate defect, §5) |
| INTC | 46,585M | `LongTermDebt` | not tagged | NOTHING TO NEST |
| LLY | 42,503M | `DebtLongtermAndShorttermCombinedAmount` | not tagged | NOTHING TO NEST |
| RIVN | 4,444M | `LongTermDebtNoncurrent` | 99M | UNDETERMINED → resolved by note, EXCLUDED |

### The one that decides it — UNP

Union Pacific tags `LongTermDebt` = 31,814M, which is what `total-debt`
resolves. It also tags the lease-inclusive combined element:

```
LongTermDebtAndCapitalLeaseObligations         30,294M
LongTermDebtAndCapitalLeaseObligationsCurrent   1,520M
                                               -------
                                               31,814M   == LongTermDebt, exactly
```

The filing settles it in its own words. UNP's *Schedule of Total Debt*
(FY2025 10-K, accession `0000100885-26-000037`, R86) presents:

| | |
|---|---:|
| Notes and Debentures, total principal | 32,694M |
| Equipment Obligations, total principal | 693M |
| **Finance Lease, total principal** | **105M** |
| Total principal | 33,492M |
| Unamortized discount and deferred issuance costs | (1,678)M |
| **Total debt** | **31,814M** |

32,694 + 693 + 105 = 33,492. **UNP's finance lease is a component of the total
debt figure the mapping acquires.** Adding `finance-lease-liabilities` on top
of `total-debt` counts UNP's 105M twice.

### The two the tags could not settle, and how they were settled

Neither was settled by assumption. Both were read out of the filing's own
lease note — a mapping-review activity, which §3.8.1 explicitly rests the queue
exemption on ("the mapping's own version review"), and not acquisition. No
value below is acquired from these readings.

- **OKLO** (10-Q, accession `0001628280-26-054571`): *"Finance lease liability
  of $187 is included within **other liabilities** on the condensed
  consolidated balance sheets."* Not within long-term debt. The 187k sits in
  the 3,217k *Other liabilities* line, so it is **not** inside the 700k.
  EXCLUDED.
- **RIVN** (10-Q, accession `0001874178-26-000054`): the balance sheet carries
  *Long-term debt* 4,444M and *Non-current lease liabilities* 693M as two
  separate lines. The 99M finance lease is inside the lease line, not the debt
  line. EXCLUDED.

## 3. Why this is a stop and not a fix

`total-debt` does not carry one meaning across the set. It excludes lease
obligations for MSFT, OKLO and RIVN, and includes them for UNP. Every way of
making the ruling's "exactly once" hold runs into the stop condition:

1. **Subtract the nested lease from `total-debt`.** Changes what the existing
   mapping means — which is the stop condition verbatim. It would also move
   every consumer of `total-debt` at once: net debt, the EV bridge, the §3.4
   leverage precondition.
2. **Skip the lease term for nested filers.** Same change of meaning, applied
   conditionally, and it makes the mapping's output depend on a per-company
   nesting determination that is not in the mapping.
3. **Add the lease term unconditionally.** Double-counts UNP. The amount is
   small for UNP (105M against 31,814M) but the defect is structural, not
   material-when-small, and reasoning from its current size would be an
   invented threshold.
4. **Detect nesting deterministically and branch.** The combined-element test
   used above does settle UNP. It does **not** settle RIVN or OKLO, which tag
   no combined element — both needed a human to read the note. A construction
   that is correct only where the filer happens to tag a particular element is
   not a construction that includes leases exactly once.

There is no fifth option that leaves the existing mapping's meaning intact.

## 4. What this exposes in shipped code

**The EV bridge is double-counting UNP's finance leases today.** It is not a
consequence of the invested-capital work; the invested-capital work is what
found it. `EV = marketCap + totalDebt + financeLeaseLiabilities − …` adds 105M
that is already inside the 31,814M. §3.5's bridge takes total debt "separately
from finance leases", and for a filer whose total-debt tag is a
debt-and-leases total that separation does not exist.

For MSFT the bridge is correct, and the mapping's own basis note records the
check that made it look settled: 40.294 + 66.594 − 76.843 = 30.045, the frozen
mock's stated net debt. That check passes because MSFT's finance lease is
larger than its entire debt figure, which makes nesting impossible — a property
of Microsoft, not of the mapping.

Scale of the exposure depends on the filer, not on this set: any filer
presenting finance leases inside a debt total is affected, and the three
verdicts of UNDETERMINED show the tags alone cannot say which filers those are.

## 5. Two further findings, parked

Neither was acted on, both were measured.

**NVDA's two gaps are not the same kind of thing.**

- `treasury-method-dilution` **is** recoverable: NVDA tags no
  `IncrementalCommonSharesAttributableToShareBasedPaymentArrangements`, but
  diluted minus basic weighted-average shares is exactly that quantity
  (FY2026: 24,514M − 24,359M = 155M). For MSFT, where the tagged element does
  exist, the identity holds exactly in all six measured years — so the
  derivation is sound. Recovering it puts the fact on the **queued** side, per
  §3.8.1 guard 1: a deterministic parse is not a tag mapping. It cannot earn
  the derived-fact exemption either, because that requires a §3.8.2 cross-check
  that covered the fact and passed, and the available cross-check *is*
  diluted-minus-basic — verifying the figure against its own definition, a
  check with no way to fail.
- `finance-lease-liabilities` **is not a mapping gap at all.** NVDA tags no
  finance-lease element in any form, and its FY2026 lease note (accession
  `0001045810-26-000021`, R26) is operating leases throughout — twelve
  occurrences of "operating lease", none of "finance lease" or "capital lease".
  There is nothing to map. The mapping already records this correctly as
  `NO_TAG_IN_FILINGS`, and `fallback.ts` records it as NO TAG EXISTS with
  `valueAcquired: false`, leaving EV INCOMPLETE per §5.2 — the fail-closed
  direction. Closing it would require reading the absence as nil, which §4.3
  forbids ("Absence is never rendered as zero"), or performing the §3.8.1 AI
  extraction fallback, which this milestone deliberately does not do.

**So NVDA's EV does not complete, and one of its two gaps is not closable by a
mapping change at all.**

**XOM resolves to the wrong registrant.** The SEC ticker directory now maps XOM
to `ExxonMobil Holdings Corp` (CIK 2115436), a new registrant whose companyfacts
document is 78KB and carries no debt tags — `total-debt` is NOT ACQUIRED. The
operating history is under `Exxon Mobil Corporation` (CIK 34088, 3.1MB). Any
calibration observation for XOM taken through the ticker directory is currently
an observation about a holding company with almost no filed history.

## 6. The decision this needs

The question is what `total-debt` is to mean, and it is a mapping-semantics
decision that moves the EV bridge, net debt and the leverage precondition for
every company at once — which is why it is not being taken here. Roughly:

- Does `total-debt` mean interest-bearing debt **excluding** lease obligations,
  with the nested filers' debt figure adjusted down to match? That is one
  meaning, applied uniformly, and it changes acquired values for nested filers.
- Or does it mean the filer's own debt total **as presented**, with the lease
  term made conditional on what that total already contains? That keeps
  acquired values and moves the complexity into the consumers.

Either way the per-filer nesting determination has to come from somewhere, and
for three of ten companies here it came from a human reading the lease note.
Whether that is a §4.4-style recorded judgment, a §3.8.1 fallback, or a new
mapping-level element test is the part I have no authority to choose.

Until it is chosen, invested capital cannot be constructed to the ruling as
written, and the batching argument holds in reverse: the version bump that
would carry the invested-capital entries is the same bump that would carry
NVDA's dilution derivation, so neither has been made.
