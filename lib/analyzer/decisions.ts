// The Step 2 and Step 6 decision vocabulary, with no server dependency.
//
// This is split out of runStore so client components can render the controls
// without importing the store — runStore reaches lib/db, and pulling `pg` into
// a client bundle fails the build. The vocabulary belongs to both sides of
// that boundary; the storage does not.
//
// The strings are the spec's own (§3.8.3, §3.8.4, §6.3), matching the CHECK
// constraints in 002_analyzer_runs.sql exactly, so no mapping layer exists
// between what the interface shows, what the server validates and what the
// database stores.

export type FactDecision = "CONFIRMED" | "NOT CONFIRMED";

export type ReasonCode = "CONTRADICTED BY SOURCE" | "NOT LOCATED";

/** §3.8.4 — a fixed two-option select. No free text, no third option, no "other". */
export const REASON_CODES: readonly ReasonCode[] = ["CONTRADICTED BY SOURCE", "NOT LOCATED"];

export type ProfileDecision = "CONFIRMED" | "OVERRIDDEN" | "CANNOT JUDGE";

export type JudgmentKey =
  | "ACCOUNTING-BASIS WINDOW"
  | "NON-OPERATING INVESTMENTS"
  | "MEDIAN-MARGIN NOPAT WINDOW";

/** §4.4 — three inputs labelled FACT that are judgments. R6 places them in Step 2. */
export const JUDGMENT_KEYS: readonly JudgmentKey[] = [
  "ACCOUNTING-BASIS WINDOW",
  "NON-OPERATING INVESTMENTS",
  "MEDIAN-MARGIN NOPAT WINDOW",
];

export interface StoredFactDecision {
  factId: string;
  decision: FactDecision;
  reasonCode: ReasonCode | null;
}

export interface StoredJudgment {
  judgmentKey: JudgmentKey;
  selection: string;
  reason: string | null;
}
