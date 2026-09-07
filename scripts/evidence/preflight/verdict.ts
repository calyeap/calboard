import type { CheckResult, CheckStatus } from "./types";

export interface Verdict {
  status: CheckStatus;
  /** The step named in the report. Null only when everything passed. */
  failingStep: string | null;
  results: CheckResult[];
}

/**
 * Rolls the individual checks into one verdict.
 *
 * FAIL outranks UNKNOWN deliberately. They are different outcomes — a state
 * that could not be reached is not a state that rendered wrongly — but when
 * both are present the wrong render is the one that needs acting on, so it is
 * the one named. An empty result set is UNKNOWN rather than PASS: a preflight
 * that checked nothing has not passed.
 */
export function aggregate(results: CheckResult[]): Verdict {
  if (results.length === 0) {
    return { status: "UNKNOWN", failingStep: "preflight ran no checks", results };
  }
  const firstFail = results.find((x) => x.status === "FAIL");
  if (firstFail) return { status: "FAIL", failingStep: firstFail.step, results };

  const firstUnknown = results.find((x) => x.status === "UNKNOWN");
  if (firstUnknown) return { status: "UNKNOWN", failingStep: firstUnknown.step, results };

  return { status: "PASS", failingStep: null, results };
}
