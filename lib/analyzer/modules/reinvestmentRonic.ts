import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { DiscountRate, Figure, ReinvestmentRonicResult, RonicLadderState, SourcedValue } from "../types";

// M5 — reinvestment and RONIC (§7.2). Two genuinely separate figures
// sharing one module: reinvestment (a single period figure) and RONIC (a
// five-year trailing return, classified per policy-rate grid cell). A
// missing reinvestment input never blocks RONIC, and vice versa — they
// have disjoint REQUIRED-input sets per §4.2.
//
// A THIRD, structurally separate diagnostic lives in this file too:
// `computeImpliedReturnOnNewCapital` (§5.4, §11.4) — see its own doc
// comment below. It is NOT part of `ReinvestmentRonicResult`, is never
// fed into M7, and must not be conflated with the five-year trailing
// RONIC above.

export interface ReinvestmentInput {
  capex: SourcedValue<Decimal> | null;
  acquisitions: SourcedValue<Decimal> | null;
  financeLeaseRouAdditions: SourcedValue<Decimal> | null;
  depreciationAndAmortization: SourcedValue<Decimal> | null;
  deltaNwc: SourcedValue<Decimal> | null;
  // Needed only to express working-capital intensity when CAPITAL-LIGHT
  // fires; its absence does not block the reinvestment figure itself.
  deltaRevenue: SourcedValue<Decimal> | null;
}

export interface RonicInput {
  fiveYearDeltaNopat: SourcedValue<Decimal> | null;
  fiveYearDeltaInvestedCapital: SourcedValue<Decimal> | null;
  // I13 — the caller already has the full capex/margin history needed to
  // derive this; this module classifies the ladder, not the underlying
  // time series.
  lagBiasDirection: "conservative" | "generous";
}

export function computeReinvestmentRonic(
  reinvestmentInput: ReinvestmentInput,
  ronicInput: RonicInput
): ReinvestmentRonicResult {
  const reinvestment = computeReinvestment(reinvestmentInput);
  const ronic = computeRonicLadder(ronicInput);

  const capitalLight =
    !ronic.suppressed && ronic.value.cells.some((cell) => cell.value !== null && cell.value.greaterThan(POLICY.capitalLightRonicFloor));

  const workingCapitalIntensity =
    capitalLight && reinvestmentInput.deltaNwc !== null && reinvestmentInput.deltaRevenue !== null
      ? reinvestmentInput.deltaNwc.value.dividedBy(reinvestmentInput.deltaRevenue.value)
      : null;

  return {
    reinvestment,
    ronic,
    capitalLight,
    workingCapitalIntensity,
    lagBiasDirection: ronicInput.lagBiasDirection,
  };
}

function computeReinvestment(input: ReinvestmentInput): ReinvestmentRonicResult["reinvestment"] {
  const { capex, acquisitions, financeLeaseRouAdditions, depreciationAndAmortization, deltaNwc } = input;
  const requiredEntries = { capex, acquisitions, financeLeaseRouAdditions, depreciationAndAmortization, deltaNwc };
  const missing = Object.entries(requiredEntries)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (missing.length > 0) {
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }

  // Reinvestment = capex + acquisitions + finance-lease ROU assets
  // obtained − D&A + ΔNWC (§7.2 M5).
  const value = capex!.value
    .plus(acquisitions!.value)
    .plus(financeLeaseRouAdditions!.value)
    .minus(depreciationAndAmortization!.value)
    .plus(deltaNwc!.value);

  return computedValue(
    value,
    combineProvenance(
      capex!.provenance,
      acquisitions!.provenance,
      financeLeaseRouAdditions!.provenance,
      depreciationAndAmortization!.provenance,
      deltaNwc!.provenance
    )
  );
}

function computeRonicLadder(input: RonicInput): ReinvestmentRonicResult["ronic"] {
  const { fiveYearDeltaNopat, fiveYearDeltaInvestedCapital } = input;

  if (fiveYearDeltaNopat === null || fiveYearDeltaInvestedCapital === null) {
    const missing = [
      fiveYearDeltaNopat === null ? "fiveYearDeltaNopat" : null,
      fiveYearDeltaInvestedCapital === null ? "fiveYearDeltaInvestedCapital" : null,
    ].filter((f): f is string => f !== null);
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }

  const deltaNopat = fiveYearDeltaNopat.value;
  const deltaInvestedCapital = fiveYearDeltaInvestedCapital.value;
  const provenance = combineProvenance(fiveYearDeltaNopat.provenance, fiveYearDeltaInvestedCapital.provenance);

  // Rows 1–2 of the ladder (§7.2 M5) are rate-independent — they fire from
  // the deltas alone, so when they fire every cell shows the same state.
  const notMeaningful =
    deltaInvestedCapital.lessThanOrEqualTo(0) ||
    deltaNopat.lessThanOrEqualTo(0) ||
    deltaNopat.dividedBy(deltaInvestedCapital).lessThanOrEqualTo(0);

  if (notMeaningful) {
    const cells = POLICY.rateGrid.map((rate) => ({
      rate: rate.toNumber() as DiscountRate,
      state: "RONIC NOT MEANINGFUL" as RonicLadderState,
      value: null,
    }));
    return computedValue({ cells }, provenance);
  }

  const ronic = deltaNopat.dividedBy(deltaInvestedCapital);

  const cells = POLICY.rateGrid.map((rate) => classifyRonicCell(ronic, rate));

  return computedValue({ cells }, provenance);
}

function classifyRonicCell(
  ronic: Decimal,
  rate: Decimal
): { rate: DiscountRate; state: RonicLadderState; value: Decimal | null } {
  const rateAsLiteral = rate.toNumber() as DiscountRate;

  // Row 3 before row 4 (§7.2 M5's own order) — in practice mutually
  // exclusive at these grid rates (0.08–0.12), since a RONIC exceeding the
  // 200% cap is never also below a rate this low, but the order is kept
  // faithful to the table rather than relying on that never overlapping.
  if (ronic.lessThan(rate)) {
    // INVERTED — HIGHER GROWTH LOWERS VALUE is an additional sub-label
    // M7's own reverse-DCF solve applies when it detects the value
    // function actually falling as growth rises in this cell — a property
    // of that solve, not derivable from RONIC and the rate alone. This
    // ladder only ever returns the base LOW RONIC state; M7 is
    // responsible for upgrading a specific cell's rendering to the
    // INVERTED sub-label after running its own solve.
    return { rate: rateAsLiteral, state: "LOW RONIC — VALUE-DESTROYING GROWTH", value: ronic };
  }

  if (ronic.greaterThan(POLICY.ronicCap)) {
    return { rate: rateAsLiteral, state: "RONIC CAPPED AT 200%", value: POLICY.ronicCap };
  }

  return { rate: rateAsLiteral, state: "CLEAN", value: ronic };
}

// ---------------------------------------------------------------------------
// §5.4 / §11.4 — implied return on new capital
// ---------------------------------------------------------------------------
//
// A SINGLE-PERIOD (current fiscal year, year-over-year) diagnostic —
// structurally and numerically distinct from the RONIC ladder above,
// which uses a five-year trailing window. Confirmed via the standard
// value-driver identity already relied on (and calibrated) in M7:
//   growth = RONIC_implied × reinvestmentRate
//   =>  RONIC_implied = growth ÷ reinvestmentRate = growth × NOPAT ÷ reinvestment
//
// PROVENANCE — CORRECTED (this section's earlier claim that "18%,"
// "17.8%," and "22.0%" appeared "nowhere in the hashed frozen artefacts"
// was wrong beyond the five original BUILD artefacts; see the source-methodology
// citation below) AND THEN CLARIFIED BY AN EXPLICIT COMMAND CENTER RULING
// (2026-09-05) — see "APPROVED DEFINITION" below. Read both parts: the
// citation establishes what the source says; the ruling establishes what
// this module computes where the source does not say it.
//
// SOURCE CITATION. calboard-valuation-methodology_2.md (SHA-256
// a4a39e33717993fe9558f263009cec3814555765ac69c69728d99354d4a5ec7c,
// matching the hash the spec itself cites for that file) — not supplied
// to BUILD until after the original five artefacts — §3.3
// ("Reinvestment") states, verbatim:
//   "The implied return on new capital at FY26's 18% growth is 20.9%,
//   not 27.2% — a six-point move on the definition alone. Read alongside
//   the computed anchors below (17.8% five-year, 22.0% excluding ~$69B of
//   Activision goodwill), it is the whole empirical basis for a
//   base-case RONIC assumption."
// and, immediately after:
//   "Return on new capital (RONIC) is computed, not chosen [S]: RONIC =
//   trailing five-year change in NOPAT ÷ trailing five-year change in
//   invested capital, invested capital including lease-funded assets."
// This confirms 17.8% is not back-solved — it is the direct output of
// the same five-year ΔNOPAT/ΔInvestedCapital formula `computeRonicLadder`
// above already implements — and that the FY26 single-year figure
// (20.9%/27.2%) and the five-year figure (17.8%) are read "alongside"
// each other as two DIFFERENT, independently-computed anchors, not one
// feeding the other. This corroborates the structural separation already
// built here (a distinct function, never fed into M7 or the RONIC
// ladder).
//
// What the citation does NOT settle: which growth metric "FY26's 18%
// growth" refers to in the source's OWN historical calculation. §3.3
// says only "growth," unqualified, and the methodology's own convention
// elsewhere (§3.1 is titled "Revenue growth" and uses unqualified
// "growth" to mean revenue growth) leaves that genuinely open. The
// Microsoft 20.9%/27.2%/18% historical reproduction therefore REMAINS
// UNRESOLVED as a reference-reproduction question — nothing below
// changes that, and no test in this file should be read as having
// settled it.
//
// APPROVED DEFINITION (Command Center ruling, 2026-09-05) — for THIS
// module's own prospective diagnostic, going forward, independent of
// what the source's historical calculation used:
//   implied return on new capital ≈ (year-over-year NOPAT growth) ÷
//     (same fiscal year's reinvestment ÷ NOPAT ratio)
// This is an EXPLICITLY APPROVED CLARIFICATION alongside the frozen
// source, not a claim that the original wording ("FY26's 18% growth")
// established NOPAT growth as the metric — it did not; see above. The
// result is an APPROXIMATE growth-implied return diagnostic: it is a
// rearrangement of the value-driver identity (g = RONIC × reinvestment
// rate), not an exact accounting identity, and not a measured or
// realised return on any actual capital outlay. It must not be conflated
// with the five-year trailing RONIC ladder above, and must never be fed
// into M7.
//
// What IS settled, independent of the metric question: the
// reinvestment-rate DENOMINATOR and its period — reinvestment ÷ NOPAT is
// inherently a single-fiscal-year ratio (FY26 in the worked example),
// computed via `computeReinvestment` verbatim, so the growth numerator is
// that SAME fiscal year's growth (year-over-year) — not a five-year
// trailing figure, and not M7's unrelated price-implied growth-rate
// solve.
//
// This function therefore takes both `currentNopat` and
// `currentYearNopatGrowth` as REQUIRED inputs — never a hardcoded value —
// and reuses `computeReinvestment` verbatim for the reinvestment figure,
// so the SAME REQUIRED-input gating on finance-lease ROU additions
// applies here as everywhere else in this module (§5.4's own worked
// example: omitting that one input cascades this diagnostic to
// INCOMPLETE too, exactly as it does for reinvestment and RONIC).
export interface ImpliedReturnOnNewCapitalInput {
  reinvestmentInput: ReinvestmentInput;
  // Current fiscal year NOPAT — a single-period figure, not the RONIC
  // ladder's five-year invested-capital base.
  currentNopat: SourcedValue<Decimal> | null;
  // Current fiscal year NOPAT growth, year-over-year — NOT the
  // five-year trailing RONIC's ΔNOPAT measure, and NOT M7's reverse-DCF
  // solved growth rate. This metric (NOPAT growth, not revenue growth)
  // is an APPROVED CLARIFICATION (Command Center ruling, 2026-09-05),
  // not a reading the frozen source methodology's own wording
  // establishes — §3.3 says only "FY26's 18% growth," unqualified, and
  // leaves NOPAT-vs-revenue genuinely open. See the doc comment above
  // this interface for the full citation and the ruling.
  currentYearNopatGrowth: SourcedValue<Decimal> | null;
}

export interface ImpliedReturnOnNewCapitalResult {
  value: Figure<Decimal>;
  // Explicit, self-documenting period — kept as data, not only a comment,
  // so this cannot be silently treated as the five-year RONIC figure.
  period: "current fiscal year (year-over-year)";
}

export function computeImpliedReturnOnNewCapital(
  input: ImpliedReturnOnNewCapitalInput
): ImpliedReturnOnNewCapitalResult {
  const period = "current fiscal year (year-over-year)" as const;
  const reinvestment = computeReinvestment(input.reinvestmentInput);

  if (reinvestment.suppressed) {
    // Cascades reinvestment's own suppression verbatim — most commonly
    // INCOMPLETE from a missing finance-lease ROU figure, §5.4's own
    // worked example.
    return { value: reinvestment, period };
  }

  if (input.currentNopat === null || input.currentYearNopatGrowth === null) {
    const missing = [
      input.currentNopat === null ? "currentNopat" : null,
      input.currentYearNopatGrowth === null ? "currentYearNopatGrowth" : null,
    ].filter((f): f is string => f !== null);
    return { value: suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`), period };
  }

  // Matches the approved definition verbatim (see doc comment above):
  // NOPAT growth ÷ (same fiscal year's reinvestment ÷ NOPAT).
  const reinvestmentRate = reinvestment.value.dividedBy(input.currentNopat.value);
  const impliedReturn = input.currentYearNopatGrowth.value.dividedBy(reinvestmentRate);

  const provenance = combineProvenance(
    reinvestment.qualification.provenanceTokens,
    input.currentNopat.provenance,
    input.currentYearNopatGrowth.provenance
  );

  return { value: computedValue(impliedReturn, provenance), period };
}
