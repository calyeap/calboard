import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { FcfYieldGrowthResult, ProvenanceTokens, SourcedValue } from "../types";
import { computeFcf } from "./fcf";
import type { FcfInput } from "./fcf";

// M11 — FCF yield + growth (§7.2). Precondition test: (capex + lease
// additions) ÷ D&A must fall within roughly 0.8x-1.5x, AND FCF conversion
// must be within its own ten-year normal range. On failure the output is
// PRECONDITION FAILED, never a number — this is a conditional output, not
// a standard one (§7.2).
//
// The "own ten-year normal range" half of the precondition needs a
// historical FCF-conversion distribution this module is not given directly
// — the caller supplies whether that half passes as
// `fcfConversionWithinNormalRange`, computed by `computeFcfConversionNormalRange`
// below (an approved clarification — see its own doc comment), rather than
// this function re-deriving "normal" from a time series it does not hold.

export interface FcfYieldGrowthInput {
  capex: SourcedValue<Decimal> | null;
  financeLeaseRouAdditions: SourcedValue<Decimal> | null;
  depreciationAndAmortization: SourcedValue<Decimal> | null;
  fcfConversionWithinNormalRange: boolean | null;
  fcfYieldValue: SourcedValue<Decimal> | null;
}

export function computeFcfYieldGrowth(input: FcfYieldGrowthInput): FcfYieldGrowthResult {
  const { capex, financeLeaseRouAdditions, depreciationAndAmortization, fcfConversionWithinNormalRange, fcfYieldValue } =
    input;

  const missing = [
    capex === null ? "capex" : null,
    financeLeaseRouAdditions === null ? "financeLeaseRouAdditions" : null,
    depreciationAndAmortization === null ? "depreciationAndAmortization" : null,
    fcfConversionWithinNormalRange === null ? "fcfConversionWithinNormalRange" : null,
  ].filter((f): f is string => f !== null);

  if (missing.length > 0) {
    return { precondition: "PRECONDITION FAILED", output: null };
  }

  const capexToDa = capex!.value.plus(financeLeaseRouAdditions!.value).dividedBy(depreciationAndAmortization!.value);
  const [bandLow, bandHigh] = POLICY.fcfYieldGrowthPreconditionBand;
  const withinBand = capexToDa.greaterThanOrEqualTo(bandLow) && capexToDa.lessThanOrEqualTo(bandHigh);

  if (!withinBand || !fcfConversionWithinNormalRange) {
    return { precondition: "PRECONDITION FAILED", output: null };
  }

  if (fcfYieldValue === null) {
    return { precondition: "PASS", output: suppressedValue("INCOMPLETE", "missing REQUIRED input(s): fcfYieldValue") };
  }

  return {
    precondition: "PASS",
    output: computedValue(
      fcfYieldValue.value,
      combineProvenance(capex!.provenance, financeLeaseRouAdditions!.provenance, depreciationAndAmortization!.provenance, fcfYieldValue.provenance)
    ),
  };
}

// ---------------------------------------------------------------------------
// §7.2 M11 / Appendix B — historical FCF-conversion bounds check
// ---------------------------------------------------------------------------
//
// APPROVED CLARIFICATION (Command Center ruling, 2026-09-05). Neither the
// frozen spec nor the methodology (§8) defines this half of the M11
// precondition beyond "FCF conversion within its own ten-year normal
// range" — no ratio, no computable range rule. Appendix B's
// provisional-thresholds table, which calibrates the OTHER half of this
// same precondition (capex/D&A 0.8x-1.5x), has no corresponding row for
// this one. What follows is the ruling's definition, recorded ALONGSIDE
// the frozen source — not a reading its wording established:
//
//   - FCF conversion = existing M4 unlevered FCF (`computeFcf`'s
//     `unleveredFcf`, unchanged) ÷ that SAME fiscal year's NOPAT — the
//     identical `nopat` input already powering that year's unlevered-FCF
//     figure inside `computeFcf`.
//   - Compare the latest completed fiscal year (the "tested year") against
//     the ten completed fiscal years immediately preceding it — eleven
//     annual observations total. The tested year is EXCLUDED from the
//     range itself: the range is the [min, max] of the ten PRIOR years'
//     ratios only, and the tested year's ratio is then checked for
//     membership in that range.
//   - Bounds are inclusive — a tested ratio exactly equal to the prior
//     ten-year min or max counts as within range.
//
// This is a PROVISIONAL HISTORICAL-BOUNDS check, not proof of normality or
// sustainability — a ratio sitting inside its own trailing range can still
// be unsustainable, and a single historical outlier year widens the range
// for every later year compared against it. It answers only "has this
// happened before," nothing stronger.
//
// Consistent accounting definitions across all eleven years are assumed,
// not verified here — the same restatement discipline §3.1 already
// requires for own-history growth figures applies identically; eleven
// bare ratios carry no way to detect an inconsistent basis on their own.
//
// Missing required data (an incomplete `FcfInput` for any of the eleven
// years) or non-positive NOPAT in any of them makes the check
// UNAVAILABLE — never discarding that year, shortening the window, or
// substituting zero. `available: false` with a `cause` is the only way
// this function represents that; there is no partial or best-effort
// result.
export interface FcfConversionNormalRangeInput {
  // The latest completed fiscal year being tested.
  testedYear: FcfInput;
  // The ten completed fiscal years immediately preceding `testedYear`.
  // Order does not matter — only membership in the [min, max] computed
  // from these ten. Must contain exactly ten entries.
  priorTenYears: FcfInput[];
}

export type FcfConversionNormalRangeResult =
  | {
      available: true;
      withinNormalRange: boolean;
      testedRatio: Decimal;
      rangeLow: Decimal;
      rangeHigh: Decimal;
      provenance: ProvenanceTokens;
    }
  | {
      available: false;
      cause: string;
    };

function evaluateFcfConversionYear(
  yearInput: FcfInput,
  yearLabel: string
): { ratio: Decimal; provenance: ProvenanceTokens } | { cause: string } {
  const { unleveredFcf } = computeFcf(yearInput);

  if (unleveredFcf.suppressed) {
    return { cause: `${yearLabel}: unlevered FCF unavailable — ${unleveredFcf.cause}` };
  }
  if (yearInput.nopat === null) {
    return { cause: `${yearLabel}: missing REQUIRED input(s): nopat` };
  }
  if (yearInput.nopat.value.lessThanOrEqualTo(0)) {
    return { cause: `${yearLabel}: non-positive NOPAT — FCF conversion is not meaningful` };
  }

  return {
    ratio: unleveredFcf.value.dividedBy(yearInput.nopat.value),
    provenance: combineProvenance(unleveredFcf.qualification.provenanceTokens, yearInput.nopat.provenance),
  };
}

export function computeFcfConversionNormalRange(
  input: FcfConversionNormalRangeInput
): FcfConversionNormalRangeResult {
  if (input.priorTenYears.length !== 10) {
    return {
      available: false,
      cause:
        `requires exactly ten preceding fiscal years plus the tested year ` +
        `(eleven total observations) — received ${input.priorTenYears.length} preceding year(s)`,
    };
  }

  const tested = evaluateFcfConversionYear(input.testedYear, "tested year");
  if ("cause" in tested) {
    return { available: false, cause: tested.cause };
  }

  const priorResults: { ratio: Decimal; provenance: ProvenanceTokens }[] = [];
  for (let i = 0; i < input.priorTenYears.length; i++) {
    const result = evaluateFcfConversionYear(input.priorTenYears[i], `prior year ${i + 1}`);
    if ("cause" in result) {
      return { available: false, cause: result.cause };
    }
    priorResults.push(result);
  }

  const priorRatios = priorResults.map((r) => r.ratio);
  const rangeLow = priorRatios.reduce((min, r) => (r.lessThan(min) ? r : min));
  const rangeHigh = priorRatios.reduce((max, r) => (r.greaterThan(max) ? r : max));
  const withinNormalRange = tested.ratio.greaterThanOrEqualTo(rangeLow) && tested.ratio.lessThanOrEqualTo(rangeHigh);

  return {
    available: true,
    withinNormalRange,
    testedRatio: tested.ratio,
    rangeLow,
    rangeHigh,
    provenance: combineProvenance(tested.provenance, ...priorResults.map((r) => r.provenance)),
  };
}
