import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { DiscountRate, ReinvestmentRonicResult, RonicLadderState, SourcedValue } from "../types";

// M5 — reinvestment and RONIC (§7.2). Two genuinely separate figures
// sharing one module: reinvestment (a single period figure) and RONIC (a
// five-year trailing return, classified per policy-rate grid cell). A
// missing reinvestment input never blocks RONIC, and vice versa — they
// have disjoint REQUIRED-input sets per §4.2.
//
// NOT IMPLEMENTED, recorded so it is not silently forgotten: §5.4 and
// §11.4's "implied return on new capital" diagnostic (20.9% lease-
// inclusive vs. 27.2% cash-capex-only, at Microsoft's FY26 growth) — a
// single-year, growth ÷ reinvestment-rate metric, algebraically distinct
// from the five-year trailing RONIC this module computes. No function
// here computes growth ÷ reinvestment-rate as its own output, and no
// field carries it. §11.4's acceptance case requires this figure be
// confirmed; that requirement is currently unmet by this module.

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
