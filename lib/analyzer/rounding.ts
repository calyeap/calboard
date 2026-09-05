import Decimal from "decimal.js";

// §7.3 — display rounding policy. Every deterministic module (M1–M16)
// computes on unrounded Decimal values throughout and rounds only at the
// point a figure is handed to the report, mirroring lib/money.ts's "round at
// one known point" rule. The spec itself records that rounding is tested on
// unrounded values and displayed rounded, and that the two can disagree at a
// boundary (§7.3) — that disagreement is accepted by the frozen contract,
// not a defect this module should paper over.
//
// ROUND_HALF_UP, matching lib/money.ts, so the tie-breaking direction is the
// same one decision recorded across the whole app rather than a second,
// silently different default.

const PROBABILITY_STEP = new Decimal("0.05");
// 0.1pt, where 1 point = 0.01 as a Decimal fraction (see types.ts's
// representation-convention note).
const GROWTH_MARGIN_STEP = new Decimal("0.001");
const SCENARIO_MIN_STEP = new Decimal(5);
const SCENARIO_PRICE_FRACTION = new Decimal("0.01");

function roundToStep(value: Decimal, step: Decimal): Decimal {
  return value.dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(step);
}

// Scenario and success values: nearest $5, or 1% of price, whichever step is
// larger.
export function roundScenarioValue(value: Decimal, price: Decimal): Decimal {
  const step = Decimal.max(SCENARIO_MIN_STEP, price.mul(SCENARIO_PRICE_FRACTION));
  return roundToStep(value, step);
}

// Probabilities: nearest 5%.
export function roundProbability(value: Decimal): Decimal {
  return roundToStep(value, PROBABILITY_STEP);
}

// Growth and margin: 0.1pt.
export function roundGrowthOrMargin(value: Decimal): Decimal {
  return roundToStep(value, GROWTH_MARGIN_STEP);
}
