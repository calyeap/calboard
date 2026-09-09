# M8-c rerun — the reverse-DCF gate, and why Input B is unavailable

**Status: stopped at the gate. No threshold set is recommended, and none could be.**

Thresholds remain PROVISIONAL and unwritten. No policy constant was added, no
cut-point exists anywhere in the code, the position renderer is still disabled,
no frozen artefact was touched and `TAG_MAPPING_VERSION` is unchanged.

Run both checks yourself:

```bash
npx tsx scripts/analyzer/check-reverse-dcf.ts
```

```bash
npx tsx scripts/analyzer/calibrate-position.ts
```

Every figure below comes from those two runs, against live EDGAR on 2026-09-09,
tag mapping `calboard-secmap-2026-09-2`. The eight frozen artefacts were
SHA-256 verified before any work started; all eight match.

This document supersedes nothing in `m8c-calibration-findings.md` — it reports a
**second** run, after the acquisition/mapping pass and the M8-2 spec amendment,
and two of its findings are new.

---

## 1. The gate check, reported first

The dispatch asked one question before any scenario work: with §4.4's
non-operating-investments judgment supplied, do M7's nine reverse-DCF cells now
solve for MSFT and NVDA?

**No. Zero for both — and they fail for two different reasons, at two different
depths.**

`check-reverse-dcf.ts` stages the check so the answer and its cause are
separable, because "0 of 9" does not say what to fix. Stages 2–4 are
counterfactual and produce no observation.

| Stage | MSFT | NVDA |
|---|---|---|
| 1 — as the run stands today | 0/9 | 0/9 |
| 2 — + §4.4 resolved | EV = $3,649bn | **EV still INCOMPLETE** |
| 3 — + NOPAT tax rate 0.20 | **0/9** — RONIC NOT MEANINGFUL | **0/9** — no target EV |
| 4 — + a RONIC value supplied as a probe | 4/9 | 0/9 — no target EV |

**Stage 4 is the load-bearing one.** It is the reason this is a finding rather
than a guess: supplying a RONIC — any RONIC — takes MSFT from zero cells to
four immediately. Nothing else is hiding behind it. RONIC is the last missing
dependency for MSFT, measured rather than assumed.

Its value is an arbitrary probe, deliberately, and no growth rate from stage 4
is reported as a number anywhere in the harness output. The stage answers a
question about the dependency graph. A real RONIC would answer it no better,
and a reported figure would be mistaken for an observation within a week.

## 2. Why RONIC cannot be supplied

RONIC = trailing five-year ΔNOPAT ÷ trailing five-year Δinvested capital
(spec §7.2 M5; `calboard-valuation-methodology.md` §3.3). The two halves come
apart cleanly, and only one of them is a problem:

| Half | State |
|---|---|
| Five-year ΔNOPAT | **Computable.** MSFT $68.3bn, NVDA $100.7bn — `us-gaap:OperatingIncomeLoss`, FY2021→FY2026. Mechanical once a NOPAT tax rate exists. |
| Five-year Δinvested capital | **Undefined.** Not computed, and not computable without inventing a definition. |

**No frozen artefact defines invested capital.** Both documents that name it
treat it as a quantity already known, with exactly one qualifier and no
construction:

- spec §7.2 M5 (line 374): "five-year change in invested capital **including
  lease-funded assets**" — a REQUIRED input, listed as something supplied.
- `calboard-valuation-methodology.md` §3.3 (line 313): the same sentence.
- `calfinance-methodology-v2.md`: **does not mention invested capital at all**,
  and it was already frozen when the previous pass found this.

No component list, no balance-sheet construction, no formula. Producing one
here would be inventing methodology inside a calculation, which is precisely
what stopped the previous pass. It was not done.

**Therefore Input B — the required-versus-achieved gap — is UNAVAILABLE, and no
company can produce a valuation position, whatever scenarios an analyst
authors.** That is the dispatch's own stop condition, and it is met.

## 3. NVDA fails earlier than MSFT, and this is new

The previous findings document predicted that resolving §4.4 would give MSFT and
COST an enterprise value. It did not check NVDA. **NVDA does not get one.**

With §4.4 fully resolved, NVDA's enterprise value is still INCOMPLETE, missing
two acquired facts:

- `treasuryMethodDilution`
- `financeLeaseLiabilities`

So NVDA never reaches the RONIC question at all. **Even a defined invested
capital would leave NVDA blocked**, and the two gaps are independent of both the
§4.4 judgment and the invested-capital one. They are reported here, not fixed:
touching the mapping bumps `TAG_MAPPING_VERSION` and puts every previously
acquired fact under §3.8.1 review, which Command Center rules.

This also means the three-company calibration set the rerun was built around
cannot exist even in principle today — not for want of scenarios, but for want
of an enterprise value on one of its three members.

## 4. What DID improve: the comparator, on both horizons

The acquisition and mapping pass genuinely fixed defect D1, and this is worth
recording because it is the one part of §10.6.2 that now works well.

**Achieved revenue CAGR — reported by horizon, never pooled:**

| Ticker | Ten-year | Five-year | Tag |
|---|---|---|---|
| MSFT | **13.79%** (FY2016→FY2026) | **14.57%** (FY2021→FY2026) | `RevenueFromContractWithCustomerExcludingAssessedTax` |
| NVDA | **45.70%** (FY2016→FY2026) | **66.90%** (FY2021→FY2026) | `us-gaap:Revenues` |
| OKLO | — | — | no single-tag annual series |

NVDA previously returned 31.25% over a window ending FY2022 — four years before
the price it would have been read against — and said nothing. It now returns a
current window on the correct eighteen-year series, and both horizons resolve.
Two companies now produce a ten-year comparator where the first run's structural
finding suggested most large filers could not; MSFT and NVDA both can.

**This is the achieved side only.** It is half of one of the two inputs. It
produces no observation on its own, because §10.6.2 rule 2 requires positive
agreement from both inputs and the required side is dead.

## 5. Both inputs, per company

MSFT, NVDA and OKLO are the three companies the rerun was scoped to. The full
ten-company run is in `.evidence/m8c-calibration/calibration-report.txt`.

| | Input A — price location | Input B — required vs achieved |
|---|---|---|
| **MSFT** | BLOCKED — range suppressed, `LEVERAGE UNSUPPORTED IN v1` (§10.6.3) | BLOCKED — all 9 cells suppressed: no target EV, no NOPAT tax rate; and behind those, no RONIC |
| **NVDA** | BLOCKED — range suppressed; **and** no Step 7 scenario values | BLOCKED — same, plus EV unobtainable at all (§3 above) |
| **OKLO** | BLOCKED — range suppressed | BLOCKED — no single-tag annual revenue series; the required side is moot |

Input A's suppression traces to the same root as Input B's: the leverage
precondition (§6.5) needs an enterprise value, enterprise value is INCOMPLETE
because §4.4's judgment is unmade, and the gate fails closed. That is correct
behaviour, not a defect. §10.6.3 is explicit — no range, no position.

## 6. Observations, by horizon

CalFinance ruled that five- and ten-year comparators are related but not
semantically identical, and that whether common thresholds hold across them is a
testable question rather than an assumption. Pooling makes it unanswerable by
construction, so the two are reported separately and are never combined.

| Horizon | Usable observations |
|---|---|
| Ten-year | **0** |
| Five-year | **0** |

Zero in both. The horizon question the M8-2 amendment settled is not what is
blocking this milestone, and implementing the five-year fallback in
`isUsable` would not change either number — both sides must be the same
horizon, and the required side produces no figure at either.

## 7. No recommendation, and why that is the honest answer

**The evidence supports no threshold set. None is proposed.**

There are zero observations. Not few — none, in either horizon. Recommending
cut-points on this would be the Appendix B failure performed deliberately:
Appendix B set thresholds by judgment with no observations behind them, and they
were later read as measured.

The smaller, honest claim the dispatch offers as an alternative — whether a
proposed set would behave sensibly on three known cases — **is also unavailable
here**, and for a reason worth stating plainly. That claim needs the three
companies to produce inputs a proposed set could be applied to. None of the
three produces either input. There is nothing to check a candidate set against,
so even the weaker claim has no evidence under it.

## 8. What must be ruled, in dependency order

1. **Define invested capital**, or rule that RONIC is supplied per company as an
   analyst input rather than computed. This is the binding constraint and it is
   a methodology question, not an engineering one. Nothing downstream moves
   until it is answered.
2. **Define `nopatTaxRate`** — one policy-wide constant, nine cells per company
   depend on it. The 0.20 used in the counterfactual is what a recovered
   reference grid is *consistent with*, not a configured value.
3. **A way to record §4.4's non-operating-investments judgment per company.**
   The selection mechanism exists; a recorded answer per company does not.
4. **NVDA's two acquisition gaps** — `treasuryMethodDilution` and
   `financeLeaseLiabilities` — which are §3.8.1 business.
5. **Rule which of M7's nine cells supplies the position's required figure.**
   §10.6.2 names "M7's implied growth" without choosing among the nine, and the
   harness deliberately returns all nine rather than making that ruling
   silently.

With 1–3 done, Input B becomes computable and real calibration is possible.
Input A additionally needs 3, and NVDA additionally needs 4.

## 9. A note on the scenarios, which were not recorded

Calvin's three approved scenario sets were **not** written into the tree, and
the reason is not the gate above — it is that two of the three cannot be
recorded without inventing something or breaking something.

- **NVDA has no scenario values.** The dispatch supplies drivers — a ten-year
  revenue path, margin, reinvestment intensity, share count — but Input A reads
  `scenarioValues`, the three per-share figures. Deriving them from the drivers
  needs `computeScenarioEnterpriseValue` plus an equity bridge (§4.4, unmade), a
  NOPAT tax rate (undefined) and a chosen discount rate among 8/10/12% (not
  ruled). No frozen mock carries NVDA scenario values the way
  `mock-report-msft.html` and `mock-report-oklo.html` do for the other two.
  Writing three numbers in would be fabricating the exact figure Input A is
  computed from.
- **MSFT's revision would break the frozen-mock reproduction.**
  `lib/analyzer/fixtures/msft.ts` is a *validation* fixture whose golden tests
  reproduce `mock-report-msft.html`. Calvin's revised bull reinvestment (15% →
  20%) is a *calibration* input. Overwriting the validation fixture with it
  would silently change what those tests assert they reproduce.
- **OKLO's revision is expressible and harmless in isolation** — the existing
  fixture already carries all three of Calvin's cases verbatim ("Wind-down; cash
  returned to shareholders.", "8 GW back-loaded reference case.", "8 GW
  steady-ramp case.") and `shareCount` is already per-scenario, so 205M / 250M /
  275M is a pure data change. It was left alone only because recording one
  company's scenarios and not the other two produces no observation either way.

The destination for calibration scenarios is therefore a real design question —
a new calibration-scenario module, separate from the validation fixtures — and
it is Calvin's to settle. It is recorded here rather than decided.

## 10. What was built

- `scripts/analyzer/check-reverse-dcf.ts` — the staged gate check. Live EDGAR,
  re-runnable, no policy constant, no cut-point, and a header that states what
  it must never be extended to do.

Nothing else changed.
