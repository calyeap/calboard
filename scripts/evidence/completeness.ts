// scripts/evidence/completeness.ts
import type { CheckResult } from "./preflight/types";

export interface CompletenessDecision {
  complete: boolean;
  /** Artefacts the manifest claims that are not on disk. */
  missing: string[];
  reason: string;
}

export interface NotRunCheck {
  step: string;
  /** Why it was not run. Never optional — a bare "not run" is the gap. */
  reason: string;
}

export interface CheckInventory {
  required: string[];
  executed: string[];
  notRun: NotRunCheck[];
  /** Required checks neither executed nor declared not-run. */
  unaccountedFor: string[];
  complete: boolean;
}

/**
 * Whether the capture on disk is actually the capture the manifest describes.
 *
 * This is the EVIDENCE COMPLETE question and nothing else: it compares what
 * was claimed against what is there. A capture claiming nothing is incomplete
 * rather than trivially complete — an archive of no artefacts has not proven
 * anything, and letting an empty claim pass would make the check unable to
 * fail exactly when it matters most.
 */
export function decideEvidenceComplete(
  claimed: readonly string[],
  present: readonly string[]
): CompletenessDecision {
  if (claimed.length === 0) {
    return { complete: false, missing: [], reason: "the manifest claimed no artefacts" };
  }
  const there = new Set(present);
  const missing = claimed.filter((name) => !there.has(name));
  return {
    complete: missing.length === 0,
    missing,
    reason:
      missing.length === 0
        ? `all ${claimed.length} claimed artefacts are present`
        : `${missing.length} claimed artefact(s) are absent: ${missing.join(", ")}`,
  };
}

/**
 * Required, executed and deliberately-not-run checks, as three separate lists.
 *
 * `unaccountedFor` is the one that matters. A required check that was neither
 * executed nor declared not-run is not a pass and not an UNKNOWN — it is a
 * check nobody can account for, and before this it was invisible: the verdict
 * aggregated the results that existed and said nothing about the ones that
 * never ran.
 */
export function buildCheckInventory(
  required: readonly string[],
  executed: readonly CheckResult[],
  notRun: readonly NotRunCheck[]
): CheckInventory {
  // Deduped: the raw result list carries one entry per target per width, and
  // the question here is whether a check ran at all, not how often.
  const executedSteps = [...new Set(executed.map((r) => r.step))];
  const accounted = new Set([...executedSteps, ...notRun.map((n) => n.step)]);
  const unaccountedFor = required.filter((step) => !accounted.has(step));
  return {
    required: [...required],
    executed: executedSteps,
    notRun: [...notRun],
    unaccountedFor,
    complete: unaccountedFor.length === 0,
  };
}
