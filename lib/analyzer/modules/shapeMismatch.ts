import Decimal from "decimal.js";
import { POLICY } from "../policy";
import type { ShapeMismatchResult } from "../types";

// M13 — SHAPE MISMATCH flag (§7.2). Fires where guided or known near-term
// growth differs from the fixed-shape implied constant by more than ~15
// points. On a mismatch the scenario-based answer leads and the fixed-
// shape number is shown as secondary (a report-layer ordering decision,
// not something this module does).
export function computeShapeMismatch(
  guidedNearTermGrowth: Decimal | null,
  impliedConstantGrowth: Decimal | null
): ShapeMismatchResult {
  if (guidedNearTermGrowth === null || impliedConstantGrowth === null) {
    return { fired: false, gapPoints: null };
  }

  const gap = guidedNearTermGrowth.minus(impliedConstantGrowth).abs();
  const fired = gap.greaterThan(POLICY.shapeMismatchGapPoints);

  // A flag without its number is a mood (design §7.2) — the gap is only
  // reported when the flag actually fires.
  return { fired, gapPoints: fired ? gap : null };
}
