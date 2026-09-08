import {
  type CrossCheckFact,
  type CrossCheckResult,
  footingTolerance,
  formatNumber,
  withinTolerance,
} from "./types";

// ---------------------------------------------------------------------------
// §3.8.2 family 2 — RECONCILIATION AGAINST RELATED FACTS.
//
// "That a figure is consistent with the facts it must agree with: the equity
// bridge reversing exactly (§3.5), cash FCF against its components, the
// leverage ratio against the debt and cash lines it is built from, and
// period-over-period continuity where a balance carries forward."
//
// Unlike footing, every rule here needs MORE THAN ONE fact. The rules are
// declared as data so the set is readable in one place and so a rule whose
// inputs are absent reports NOT APPLICABLE by construction rather than by
// each rule remembering to.
// ---------------------------------------------------------------------------

export interface ReconciliationRule {
  /** The fact this rule's outcome is recorded against — the one queued on failure. */
  subjectFactId: string;
  check: string;
  /** Every fact id the rule needs. Absent any of them, the rule is NOT APPLICABLE. */
  requires: string[];
  /**
   * Returns the two sides to compare and how to describe them. Called only
   * when every `requires` id has a non-null value.
   */
  evaluate: (v: Record<string, number>) => { left: number; right: number; describe: string };
}

export const RECONCILIATION_RULES: readonly ReconciliationRule[] = [
  {
    // The exact check §3.5 makes available: the incremental shares in the
    // diluted-EPS denominator ARE diluted minus basic, by construction. If the
    // mapping has taken the wrong tag for treasury-method dilution, this fails.
    subjectFactId: "treasury-method-dilution",
    check: "treasury-method dilution equals diluted less basic weighted-average shares",
    requires: [
      "treasury-method-dilution",
      "weighted-average-diluted-shares",
      "weighted-average-basic-shares",
    ],
    evaluate: (v) => ({
      left: v["treasury-method-dilution"],
      right: v["weighted-average-diluted-shares"] - v["weighted-average-basic-shares"],
      describe: `diluted ${formatNumber(v["weighted-average-diluted-shares"])} - basic ${formatNumber(
        v["weighted-average-basic-shares"]
      )}`,
    }),
  },
  {
    // §3.5: "Cash FCF = operating cash flow - cash capex." Recomputing it from
    // its own acquired components is what makes the derived figure admissible
    // under §3.1 rather than a number that merely looks right.
    subjectFactId: "cash-fcf",
    check: "cash FCF equals operating cash flow less cash capex",
    requires: ["cash-fcf", "operating-cash-flow", "capex"],
    evaluate: (v) => ({
      left: v["cash-fcf"],
      right: v["operating-cash-flow"] - v["capex"],
      describe: `OCF ${formatNumber(v["operating-cash-flow"])} - capex ${formatNumber(v["capex"])}`,
    }),
  },
  {
    // §6.5 / §3.4 safeguard 4: net debt = total debt + finance leases - cash.
    // The leverage precondition is built from these three lines, and this
    // asserts the numerator against them.
    subjectFactId: "net-debt",
    check: "net debt equals total debt plus finance leases less cash and marketable debt securities",
    requires: [
      "net-debt",
      "total-debt",
      "finance-lease-liabilities",
      "cash-and-marketable-debt-securities",
    ],
    evaluate: (v) => ({
      left: v["net-debt"],
      right:
        v["total-debt"] +
        v["finance-lease-liabilities"] -
        v["cash-and-marketable-debt-securities"],
      describe:
        `debt ${formatNumber(v["total-debt"])} + finance leases ` +
        `${formatNumber(v["finance-lease-liabilities"])} - cash ` +
        `${formatNumber(v["cash-and-marketable-debt-securities"])}`,
    }),
  },
  {
    // §3.5's equity bridge, which "reverses this exactly". Running it in both
    // directions is the check the methodology's own wording asks for.
    subjectFactId: "enterprise-value",
    check: "the equity bridge reverses exactly: market cap = EV - debt - finance leases + cash + investments",
    requires: [
      "enterprise-value",
      "market-cap",
      "total-debt",
      "finance-lease-liabilities",
      "cash-and-marketable-debt-securities",
      "non-operating-equity-investments",
    ],
    evaluate: (v) => ({
      left: v["market-cap"],
      right:
        v["enterprise-value"] -
        v["total-debt"] -
        v["finance-lease-liabilities"] +
        v["cash-and-marketable-debt-securities"] +
        v["non-operating-equity-investments"],
      describe: "EV reversed through the bridge",
    }),
  },
  {
    subjectFactId: "current-operating-margin",
    check: "operating margin equals operating income over revenue",
    requires: ["current-operating-margin", "operating-income", "current-revenue"],
    evaluate: (v) => ({
      left: v["current-operating-margin"],
      right: v["operating-income"] / v["current-revenue"],
      describe: `operating income ${formatNumber(v["operating-income"])} / revenue ${formatNumber(
        v["current-revenue"]
      )}`,
    }),
  },
];

export function reconciliationChecks(
  facts: readonly CrossCheckFact[],
  rules: readonly ReconciliationRule[] = RECONCILIATION_RULES
): CrossCheckResult[] {
  const values = new Map<string, number>();
  for (const f of facts) {
    if (f.value !== null) values.set(f.factId, f.value);
  }
  const present = new Set(facts.map((f) => f.factId));
  const results: CrossCheckResult[] = [];

  for (const rule of rules) {
    // Only rules whose SUBJECT is an input of this run are reported; a rule
    // about a fact this company does not have is not an outcome about this run.
    if (!present.has(rule.subjectFactId)) continue;

    const missing = rule.requires.filter((id) => !values.has(id));
    if (missing.length > 0) {
      results.push({
        factId: rule.subjectFactId,
        family: "RECONCILIATION",
        check: rule.check,
        outcome: "NOT APPLICABLE",
        detail: `Not evaluated — missing ${missing.join(", ")}.`,
      });
      continue;
    }

    const v: Record<string, number> = {};
    for (const id of rule.requires) v[id] = values.get(id) as number;

    const { left, right, describe } = rule.evaluate(v);
    // A ratio reconciles at ratio scale, not at dollar scale.
    const tol =
      Math.abs(left) <= 1 && Math.abs(right) <= 1 ? 1e-6 : footingTolerance(left, right);
    const ok = withinTolerance(left, right, tol);

    results.push({
      factId: rule.subjectFactId,
      family: "RECONCILIATION",
      check: rule.check,
      outcome: ok ? "PASS" : "FAIL",
      detail:
        `acquired ${formatNumber(left)} against ${describe} = ${formatNumber(right)} ` +
        `(difference ${formatNumber(left - right)}, tolerance ${formatNumber(tol)})`,
      // A rule that actually evaluated: every fact it needs was present and
      // the two sides were compared. This is the only place the flag is set.
      constrainsAgainstRelatedFacts: true,
    });
  }

  // §3.8.2 also names "period-over-period continuity where a balance carries
  // forward". A balance that has not moved at all between two different
  // periods is the signature of a stale read rather than a stable company.
  for (const fact of facts) {
    if (fact.value === null || !fact.priorPeriod) continue;
    if (fact.priorPeriod.asOfDate === fact.asOfDate) continue;
    const identical = fact.priorPeriod.value === fact.value && fact.value !== 0;
    results.push({
      factId: fact.factId,
      family: "RECONCILIATION",
      check: "period-over-period continuity: the balance moved between periods",
      outcome: identical ? "FAIL" : "PASS",
      detail:
        `${fact.priorPeriod.asOfDate} ${formatNumber(fact.priorPeriod.value)} -> ` +
        `${fact.asOfDate} ${formatNumber(fact.value)}` +
        (identical ? " — byte-identical across two periods, which reads as a stale acquisition" : ""),
    });
  }

  // Every input gets an outcome (§3.8.2), including the ones no rule touches.
  const covered = new Set(results.map((r) => r.factId));
  for (const fact of facts) {
    if (covered.has(fact.factId)) continue;
    results.push({
      factId: fact.factId,
      family: "RECONCILIATION",
      check: "consistency with related facts",
      outcome: "NOT APPLICABLE",
      detail: "No related fact in this run constrains this figure.",
    });
  }

  return results;
}
