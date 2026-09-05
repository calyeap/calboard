import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { buildSensitivityResult } from "./sensitivity";
import type { ScenarioOutputs } from "../types";

// M15 — scenario valuation and outputs (§7.2, §10 F/G).
//
// Unlike M7's reverse DCF (which infers reinvestment from RONIC because
// RONIC is a historical, company-level constant), a scenario's
// reinvestment is DRIVEN DIRECTLY by the analyst's own capital-intensity
// assumption (§5.4's scenario matrix: "reinvestment / capital intensity"
// is itself one of the required driver rows) — there is no g/RONIC
// inference here. Terminal value construction is the same fixed formula
// as M7 (terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC), terminal
// ROIC = rate + 3pp) since that is a policy-wide constant, not specific to
// how the explicit period was reinvested.
//
// margin and capitalIntensity may be a single constant (broadcast across
// all ten years) or an explicit ten-entry path — the scenario matrix
// allows either (§5.4).

export function computeScenarioEnterpriseValue(
  baseRevenue: Decimal,
  growthPath: Decimal[],
  margin: Decimal | Decimal[],
  capitalIntensity: Decimal | Decimal[],
  rate: Decimal,
  nopatTaxRate: Decimal,
  // Optional, defaulting to the policy constant — every existing caller
  // omits this and gets EXACTLY the prior hardcoded behaviour. Added
  // solely so M14's sensitivity module can vary terminal growth through
  // this same existing model (its rate x terminal-growth table) without
  // duplicating this function's formula; the formula itself is unchanged.
  terminalGrowth: Decimal = POLICY.terminalGrowth
): Decimal {
  if (growthPath.length !== 10) {
    throw new Error("growthPath must have exactly ten entries (years 1-10)");
  }

  const afterTax = new Decimal(1).minus(nopatTaxRate);
  const marginAt = (t: number): Decimal => (Array.isArray(margin) ? margin[t - 1] : margin);
  const intensityAt = (t: number): Decimal => (Array.isArray(capitalIntensity) ? capitalIntensity[t - 1] : capitalIntensity);
  const discountFactorBase = new Decimal(1).plus(rate);

  const revenues: Decimal[] = [baseRevenue];
  let revenue = baseRevenue;
  for (let t = 1; t <= 10; t++) {
    revenue = revenue.mul(new Decimal(1).plus(growthPath[t - 1]));
    revenues.push(revenue);
  }

  let pvSum = new Decimal(0);
  for (let t = 1; t <= 10; t++) {
    const nopat = revenues[t].mul(marginAt(t)).mul(afterTax);
    const reinvestment = revenues[t].mul(intensityAt(t));
    const fcff = nopat.minus(reinvestment);
    pvSum = pvSum.plus(fcff.dividedBy(discountFactorBase.pow(t)));
  }

  const year10Revenue = revenues[10];
  const nopat10 = year10Revenue.mul(marginAt(10)).mul(afterTax);
  const terminalNopat = nopat10.mul(new Decimal(1).plus(terminalGrowth));
  const terminalRoic = rate.plus(POLICY.terminalRoicPremium);
  const terminalFcf = terminalNopat.mul(new Decimal(1).minus(terminalGrowth.dividedBy(terminalRoic)));
  const terminalValueAtYear10 = terminalFcf.dividedBy(rate.minus(terminalGrowth));
  const terminalValuePV = terminalValueAtYear10.dividedBy(discountFactorBase.pow(10));

  return pvSum.plus(terminalValuePV);
}

const RATE_SEARCH_LO = new Decimal("0.01");
const RATE_SEARCH_HI = new Decimal("0.5");
const RATE_BISECTION_ITERATIONS = 60;

// Solves for the discount rate at which a revaluation function (assumed
// monotonically decreasing in rate — a higher discount rate always means
// a lower value, true for any well-behaved DCF) equals the target price.
// Returns null, never a state, if no such rate exists in a plausible range
// (§10 G names no suppressing state for this figure — it is display-only
// context, not a gated output).
export function solveRateForTargetValue(revalueAtRate: (rate: Decimal) => Decimal, targetValue: Decimal): Decimal | null {
  const valueAtLo = revalueAtRate(RATE_SEARCH_LO);
  const valueAtHi = revalueAtRate(RATE_SEARCH_HI);

  // Decreasing in rate: valueAtLo should be >= target >= valueAtHi for a
  // root to exist in range.
  if (valueAtLo.lessThan(targetValue) || valueAtHi.greaterThan(targetValue)) {
    return null;
  }

  let lo = RATE_SEARCH_LO;
  let hi = RATE_SEARCH_HI;
  for (let i = 0; i < RATE_BISECTION_ITERATIONS; i++) {
    const mid = lo.plus(hi.minus(lo).dividedBy(2));
    const valueAtMid = revalueAtRate(mid);
    if (valueAtMid.greaterThan(targetValue)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo.plus(hi).dividedBy(2);
}

export interface ScenarioOutputsInput {
  bearValue: Decimal;
  baseValue: Decimal;
  bullValue: Decimal;
  weights: { bear: Decimal; base: Decimal; bull: Decimal };
  currentPrice: Decimal;
  // Recomputes the BASE case's value at a hypothetical discount rate —
  // used only to solve for the rate at which the base case equals price.
  revalueBaseCaseAtRate: (rate: Decimal) => Decimal;
}

export function computeScenarioOutputs(input: ScenarioOutputsInput): ScenarioOutputs {
  const { bearValue, baseValue, bullValue, weights, currentPrice } = input;

  // Display only, never a headline (§10.3, §10.5) — the caller is
  // responsible for never rendering this as the section's largest figure.
  const weightedDistribution = bearValue
    .mul(weights.bear)
    .plus(baseValue.mul(weights.base))
    .plus(bullValue.mul(weights.bull));

  const rangeSpan = bullValue.minus(bearValue);
  const priceLocationWithinRange = rangeSpan.isZero() ? new Decimal(0) : currentPrice.minus(bearValue).dividedBy(rangeSpan);

  const rateAtWhichBaseEqualsPrice = solveRateForTargetValue(input.revalueBaseCaseAtRate, currentPrice);

  return {
    values: { bear: bearValue, base: baseValue, bull: bullValue },
    weightedDistribution,
    priceLocationWithinRange,
    rateAtWhichBaseEqualsPrice,
    sensitivity: buildSensitivityResult(),
  };
}
