import Decimal from "decimal.js";
import { POLICY } from "../policy";
import type { SensitivityResult } from "../types";

// M14 — sensitivity (§7.2). Two pieces are concretely specified and
// implemented here:
//
// 1. The >10% display-suppression rule: "an input whose full plausible
//    range moves value by less than ~10% is not displayed."
// 2. Debt share is removed from the sensitivity table entirely (I10) —
//    value-neutral by construction (MM without taxes or distress); this
//    module's result always records that removal rather than silently
//    omitting the input with no explanation.
//
// NOT implemented: the one-at-a-time tornado and the two two-way tables
// (growth × margin, discount rate × terminal growth) themselves. The spec
// names these as outputs but does not give their construction in enough
// detail to build without guessing — which inputs form the tornado's rows,
// what "full plausible range" means per input, and the two-way tables'
// exact axis bounds are all undefined here. `tornado`, `twoWayGrowthMargin`
// and `twoWayRateTerminalGrowth` are typed `unknown` in the schema
// (types.ts) for exactly this reason and are left as empty placeholders
// until that construction is specified.

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
