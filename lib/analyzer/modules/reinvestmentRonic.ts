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
// PROVENANCE OF THE GROWTH DEFINITION — established from the frozen text,
// not chosen to fit 20.9%:
//
// §5.4 states the reinvestment RATE (reinvestment ÷ NOPAT) for Microsoft
// FY26 as 66% excluding finance-lease ROU additions and 86% including
// them, "moving the implied return on new capital from 27.2% to 20.9%."
// Both 66%/27.2% and 86%/20.9% are in the hashed spec file (§5.4 line
// 332, §11.4 line 919). Back-solving growth = reinvestmentRate ×
// impliedReturn from EACH pair independently:
//   66%  × 27.2% = 17.952%
//   86%  × 20.9% = 17.974%
// These two INDEPENDENTLY back-solved figures agree to within 0.022
// points — consistent with a single underlying growth rate of
// approximately 18.0%, given the frozen text's own one-decimal rounding
// of all four inputs. This is a genuine cross-consistency check of the
// IDENTITY (using only numbers already in the hashed spec), not a fitted
// growth value — no external "18%" figure appears anywhere in the hashed
// artefacts, and none is assumed here. It also establishes the PERIOD:
// since reinvestment ÷ NOPAT is inherently a single-year ratio for one
// named fiscal year (FY26), the growth figure it is compared against
// must be that SAME fiscal year's NOPAT growth (year-over-year) — not a
// five-year trailing figure, and not M7's unrelated price-implied
// growth-rate solve (which happens to be numerically close for
// Microsoft's specific case, by coincidence, not by construction).
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
  // Current fiscal year NOPAT growth, year-over-year. NOT the five-year
  // trailing RONIC's ΔNOPAT measure, and NOT M7's reverse-DCF solved
  // growth rate — a different, price-implied quantity.
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

  const reinvestmentRate = reinvestment.value.dividedBy(input.currentNopat.value);
  const impliedReturn = input.currentYearNopatGrowth.value.dividedBy(reinvestmentRate);

  const provenance = combineProvenance(
    reinvestment.qualification.provenanceTokens,
    input.currentNopat.provenance,
    input.currentYearNopatGrowth.provenance
  );

  return { value: computedValue(impliedReturn, provenance), period };
}
