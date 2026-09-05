import Decimal from "decimal.js";
import type { RateSensitivity } from "../types";

// M10 — rate sensitivity (§7.2). ±1 percentage point on the discount rate,
// always shown, reported as the resulting percentage change in value —
// "close to a deterministic function of terminal share, not an
// independent signal," and never used as a standalone red flag (the
// interpretation layer's concern, not this module's; this module only
// computes the two percentages).
export function computeRateSensitivity(
  baseValue: Decimal,
  valueAtRatePlusOnePoint: Decimal,
  valueAtRateMinusOnePoint: Decimal
): RateSensitivity {
  return {
    plusOnePoint: valueAtRatePlusOnePoint.dividedBy(baseValue).minus(1),
    minusOnePoint: valueAtRateMinusOnePoint.dividedBy(baseValue).minus(1),
    closeToDeterministicFunctionOfTerminalShare: true,
  };
}
