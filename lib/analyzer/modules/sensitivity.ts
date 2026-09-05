import Decimal from "decimal.js";
import { POLICY } from "../policy";
import type { SensitivityResult } from "../types";

// M14 — sensitivity (§7.2). §7.2 M14 SPECIFIES: a one-at-a-time tornado;
// two two-way tables, and their axes ARE named explicitly — growth ×
// margin, and discount rate × terminal growth; the "coherent path, not
// spliced" constraint on each table's rows and columns; the >10%
// display-suppression rule; and I10's removal of debt share from the
// table entirely. Only the last two of those five are implemented here:
//
// 1. The >10% display-suppression rule: "an input whose full plausible
//    range moves value by less than ~10% is not displayed."
// 2. Debt share is removed from the sensitivity table entirely (I10) —
//    value-neutral by construction (MM without taxes or distress); this
//    module's result always records that removal rather than silently
//    omitting the input with no explanation.
//
// NOT implemented, and this is the actual (smaller) gap — not "the whole
// construction is unspecified": the one-at-a-time tornado, and both named
// two-way tables. What is genuinely undefined is narrower than the axes
// themselves — the numeric bounds/step count for each axis, and which
// specific inputs populate the tornado's rows, are not given anywhere in
// the frozen spec. `tornado`, `twoWayGrowthMargin` and
// `twoWayRateTerminalGrowth` are typed `unknown` in the schema (types.ts)
// for exactly this reason and are left as empty placeholders until that
// narrower gap (bounds, not axes) is specified.

export function shouldDisplaySensitivityInput(fullRangeValueImpact: Decimal): boolean {
  return fullRangeValueImpact.abs().greaterThanOrEqualTo(POLICY.sensitivityDisplayThreshold);
}

export function buildSensitivityResult(): SensitivityResult {
  return {
    tornado: [],
    twoWayGrowthMargin: [],
    twoWayRateTerminalGrowth: [],
    debtShareRemoved: true,
  };
}
