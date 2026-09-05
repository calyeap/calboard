import Decimal from "decimal.js";
import { POLICY } from "./policy";
import { CLEAN_PROVENANCE } from "./provenance";
import { computedValue, suppressedValue } from "./figures";
import type { Figure, Gate1Result } from "./types";

// Shared "three margin levels" resolution — current / median / stress —
// used by both M2's P/E-at-three-levels diagnostic and M7's reverse-DCF
// grid (§6.4's mandatory diagnostic set; §7.2 M7's "8/10/12% grid × three
// margin levels").
//
// Under HISTORY INSUFFICIENT, §6.2 gives its own substitute triad — current
// margin, and that margin reduced by one quarter and by one half in
// relative terms — which replaces BOTH median and stress with concrete,
// always-computable values (there is no trustworthy median with fewer than
// five filed years).
//
// Otherwise, current and median are both real computed figures (M3's
// median is always computable regardless of window length), but the
// "stress" level itself is one of §7.1's four undefined LATER policy
// constants. This is not a contradiction in the frozen contract — §7.1
// explicitly defers this value and requires it be surfaced as
// configuration rather than guessed. Until Command Center configures it,
// any cell that specifically needs the stress margin level returns
// INCOMPLETE, naming the reason. Current and median levels are unaffected.
export function resolveMarginLevels(
  currentMargin: Decimal,
  median: Decimal,
  gate1State: Gate1Result["state"]
): { current: Decimal; median: Decimal; stress: Figure<Decimal> } {
  if (gate1State === "HISTORY INSUFFICIENT") {
    const [quarterReduction, halfReduction] = POLICY.historyInsufficientStressMarginRelativeReductions;
    return {
      current: currentMargin,
      median: currentMargin.mul(new Decimal(1).minus(quarterReduction)),
      stress: computedValue(currentMargin.mul(new Decimal(1).minus(halfReduction)), CLEAN_PROVENANCE),
    };
  }

  return {
    current: currentMargin,
    median,
    stress: suppressedValue(
      "INCOMPLETE",
      "stress margin level is an unconfigured policy constant (§7.1, recorded as LATER) — Command Center has not set a value"
    ),
  };
}
