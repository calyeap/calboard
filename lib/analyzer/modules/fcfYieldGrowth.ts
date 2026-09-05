import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { FcfYieldGrowthResult, SourcedValue } from "../types";

// M11 — FCF yield + growth (§7.2). Precondition test: (capex + lease
// additions) ÷ D&A must fall within roughly 0.8x-1.5x, AND FCF conversion
// must be within its own ten-year normal range. On failure the output is
// PRECONDITION FAILED, never a number — this is a conditional output, not
// a standard one (§7.2).
//
// The "own ten-year normal range" half of the precondition needs a
// historical FCF-conversion distribution this module is not given directly
// — the caller (which has the full history) supplies whether that half
// passes as `fcfConversionWithinNormalRange`, rather than this module
// re-deriving "normal" from a time series it does not hold.

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
