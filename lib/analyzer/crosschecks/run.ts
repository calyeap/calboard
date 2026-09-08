import { footingChecks } from "./footing";
import { reconciliationChecks, type ReconciliationRule } from "./reconciliation";
import { rangeSanityChecks } from "./rangeSanity";
import {
  CROSS_CHECK_FAMILIES,
  type CrossCheckFact,
  type CrossCheckResult,
} from "./types";

// ---------------------------------------------------------------------------
// The §3.8.2 suite, and the report §3.8.2 requires of milestone M8.
//
// "Milestone M8 reports the cross-check outcome for every input, pass or fail,
// alongside the §3.8.1 fallback list. A cross-check suite whose results are
// not reported is not a control."
// ---------------------------------------------------------------------------

export interface CrossCheckReport {
  ticker: string;
  ranAt: string;
  results: CrossCheckResult[];
  /**
   * Facts with at least one FAIL. These are forced into the Step 2 queue
   * WHATEVER their acquisition path (§3.8.2), and their REQUIRED dependents
   * return INCOMPLETE until re-acquisition resolves them.
   */
  failedFactIds: string[];
  /** Every input the suite ran on — the denominator for "an outcome for every input". */
  inputFactIds: string[];
}

/**
 * Runs all three families on every input, exempt or queued.
 *
 * There is no filter on acquisition path here, and none may be added: the
 * whole reason this suite exists is that §3.8.1 removed human attention from
 * tag-mapped facts, so the compensating control has to cover exactly the facts
 * nobody is looking at.
 */
export function runCrossChecks(
  ticker: string,
  facts: readonly CrossCheckFact[],
  options: { ranAt?: string; rules?: readonly ReconciliationRule[] } = {}
): CrossCheckReport {
  const results: CrossCheckResult[] = [];

  for (const fact of facts) {
    results.push(...footingChecks(fact));
    results.push(...rangeSanityChecks(fact));
  }
  results.push(...reconciliationChecks(facts, options.rules));

  const failed = new Set(
    results.filter((r) => r.outcome === "FAIL").map((r) => r.factId)
  );

  return {
    ticker,
    ranAt: options.ranAt ?? new Date().toISOString(),
    results,
    failedFactIds: [...failed],
    inputFactIds: facts.map((f) => f.factId),
  };
}

/**
 * Asserts the report actually covers every input in every family.
 *
 * This exists because the failure mode being defended against is a suite that
 * silently skips a fact and reports success — "four instances in two days on
 * this project of a check that cannot fail reporting success". A missing row
 * is a defect in the suite, not an absence of findings, so it raises rather
 * than returning a shorter report.
 */
export function assertEveryInputReported(report: CrossCheckReport): void {
  const missing: string[] = [];
  for (const factId of report.inputFactIds) {
    for (const family of CROSS_CHECK_FAMILIES) {
      const covered = report.results.some((r) => r.factId === factId && r.family === family);
      if (!covered) missing.push(`${factId}/${family}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Cross-check report does not cover every input: ${missing.join(", ")}. ` +
        `§3.8.2 requires an outcome for every input in every family.`
    );
  }
}

export function formatCrossCheckReport(report: CrossCheckReport): string {
  const lines: string[] = [];
  const counts = { PASS: 0, FAIL: 0, "NOT APPLICABLE": 0 };
  for (const r of report.results) counts[r.outcome] += 1;

  lines.push(`CROSS-CHECK REPORT — ${report.ticker}  (§3.8.2)`);
  lines.push(`Ran at: ${report.ranAt}`);
  lines.push(
    `Inputs: ${report.inputFactIds.length}   Checks: ${report.results.length}   ` +
      `PASS ${counts.PASS} · FAIL ${counts.FAIL} · NOT APPLICABLE ${counts["NOT APPLICABLE"]}`
  );
  lines.push("");

  for (const factId of report.inputFactIds) {
    const rows = report.results.filter((r) => r.factId === factId);
    const anyFail = rows.some((r) => r.outcome === "FAIL");
    lines.push(`${anyFail ? "FAIL" : "ok  "}  ${factId}`);
    for (const family of CROSS_CHECK_FAMILIES) {
      for (const r of rows.filter((x) => x.family === family)) {
        lines.push(`        [${r.outcome}] ${r.family} — ${r.check}`);
        lines.push(`            ${r.detail}`);
      }
    }
  }

  if (report.failedFactIds.length > 0) {
    lines.push("");
    lines.push(
      `Forced into the Step 2 queue by a failed cross-check (§3.8.2), whatever ` +
        `their acquisition path: ${report.failedFactIds.join(", ")}`
    );
    lines.push(
      "No figure was rewritten. A failed cross-check sets a state and returns " +
        "INCOMPLETE for REQUIRED dependents until re-acquisition resolves it."
    );
  }

  return lines.join("\n");
}
