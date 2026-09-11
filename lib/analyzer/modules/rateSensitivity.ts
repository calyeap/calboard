import Decimal from "decimal.js";
import type { RateSensitivity } from "../types";

// M10 — rate sensitivity (§7.2). ±1 percentage point on the discount rate,
// always shown, reported as the resulting percentage change in value —
// "close to a deterministic function of terminal share, not an
// independent signal," and never used as a standalone red flag (the
// interpretation layer's concern, not this module's; this module only
// computes the two percentages).
// This module's not-modelled state: what the diagnostic holds on a run that
// supplied nothing to compute it from. NaN, never zero — "+0.0% / 0.0%" is a
// statement that a point on the discount rate moves value by nothing, which
// is a finding, and nobody found it (CB-AUDIT-01 H4). The state the report
// shows in its place is bound separately (notComputed.ts); these fields only
// guarantee that nothing reading them can mistake them for a figure.
export function rateSensitivityNotModelled(): RateSensitivity {
  return {
    plusOnePoint: new Decimal(NaN),
    minusOnePoint: new Decimal(NaN),
    closeToDeterministicFunctionOfTerminalShare: true,
  };
}

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
