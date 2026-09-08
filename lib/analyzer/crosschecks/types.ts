// ---------------------------------------------------------------------------
// §3.8.2 — deterministic input cross-checks.
//
// "The §3.8.1 exemption removes human attention from tagged facts, so the
// compensating control is deterministic and runs on EVERY input, exempt or
// queued. [S], never [C]. Three families, all reproducible, each producing a
// STATE rather than a correction."
//
// The load-bearing sentence for this module tree: "A failed cross-check never
// corrects the figure." Nothing in here writes a value. Every function returns
// outcomes; the queue and the propagation layer act on them.
// ---------------------------------------------------------------------------

export const CROSS_CHECK_FAMILIES = ["FOOTING", "RECONCILIATION", "RANGE SANITY"] as const;
export type CrossCheckFamily = (typeof CROSS_CHECK_FAMILIES)[number];

export type CrossCheckOutcome =
  | "PASS"
  /** The figure failed. Sets a state, forces the queue, never rewrites. */
  | "FAIL"
  /**
   * The check does not apply to this fact — it has no components to foot, no
   * related fact to reconcile against, no prior period to compare with.
   *
   * Reported rather than omitted. §3.8.2 wants an outcome for EVERY input, and
   * a silently skipped check is indistinguishable from a passing one, which is
   * how a suite that cannot fail comes to report success.
   */
  | "NOT APPLICABLE";

export interface CrossCheckResult {
  factId: string;
  family: CrossCheckFamily;
  /** What was tested, in words a reviewer can check against the source. */
  check: string;
  outcome: CrossCheckOutcome;
  /** The numbers. Always present, on a pass as well as a failure. */
  detail: string;
}

/**
 * One input as the cross-checks see it.
 *
 * Deliberately decoupled from FactRecord and from the SEC document shape: the
 * checks are pure functions over numbers and their stated relationships, which
 * is what makes them reproducible and what makes their negative tests
 * straightforward to write.
 */
export interface CrossCheckFact {
  factId: string;
  name: string;
  /** Null where the figure was not acquired at all. */
  value: number | null;
  unit: "USD" | "shares" | "pure";
  asOfDate: string;
  /**
   * Named parts that must sum to `value`. Footing family.
   * E.g. long-term debt current + noncurrent against the long-term debt total.
   */
  components?: { name: string; value: number }[];
  /**
   * The same quantity as it appears elsewhere in the same filing — a
   * statement, its note, the cover page (§3.8.2). Footing family.
   */
  alsoStatedAs?: { where: string; value: number; toleranceFraction?: number }[];
  /** The immediately prior period, for continuity and scale tests. */
  priorPeriod?: { value: number; asOfDate: string } | null;
}

/** A tolerance in absolute units, used where two statements round differently. */
export function withinTolerance(a: number, b: number, absolute: number): boolean {
  return Math.abs(a - b) <= absolute;
}

/**
 * The default footing tolerance: one part in a million of the larger figure,
 * floored at 1 unit.
 *
 * Not a calibrated threshold and not a judgment about materiality — it exists
 * only to absorb the rounding a filer applies when the same quantity is
 * presented at different scales in the same document. A real footing failure
 * is off by far more than this, and M8-c's calibration work has nothing to
 * take from here.
 */
export function footingTolerance(...values: number[]): number {
  const scale = Math.max(1, ...values.map((v) => Math.abs(v)));
  return Math.max(1, scale * 1e-6);
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
