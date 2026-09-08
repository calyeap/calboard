import {
  type CrossCheckFact,
  type CrossCheckResult,
  footingTolerance,
  formatNumber,
  withinTolerance,
} from "./types";

// ---------------------------------------------------------------------------
// §3.8.2 family 1 — FOOTING.
//
// "That components sum to their stated total, and that a quantity agrees with
// itself where it appears more than once in one document — a statement, its
// note, and the cover page."
//
// Two tests, both on one fact at a time. Neither needs any other fact, which
// is what makes this the family that catches a mis-summed acquisition before
// anything downstream has a chance to look consistent.
// ---------------------------------------------------------------------------

export function footingChecks(fact: CrossCheckFact): CrossCheckResult[] {
  const results: CrossCheckResult[] = [];

  if (fact.value === null) {
    return [
      {
        factId: fact.factId,
        family: "FOOTING",
        check: "components sum to the stated total",
        outcome: "NOT APPLICABLE",
        detail: "The figure was not acquired, so there is nothing to foot.",
      },
    ];
  }

  const components = fact.components ?? [];
  if (components.length === 0) {
    results.push({
      factId: fact.factId,
      family: "FOOTING",
      check: "components sum to the stated total",
      outcome: "NOT APPLICABLE",
      detail: "No component breakdown is tagged for this figure.",
    });
  } else {
    const sum = components.reduce((acc, c) => acc + c.value, 0);
    const tol = footingTolerance(sum, fact.value);
    const ok = withinTolerance(sum, fact.value, tol);
    results.push({
      factId: fact.factId,
      family: "FOOTING",
      check: "components sum to the stated total",
      outcome: ok ? "PASS" : "FAIL",
      detail:
        `${components.map((c) => `${c.name} ${formatNumber(c.value)}`).join(" + ")} ` +
        `= ${formatNumber(sum)} against stated ${formatNumber(fact.value)} ` +
        `(difference ${formatNumber(sum - fact.value)}, tolerance ${formatNumber(tol)})`,
    });
  }

  const elsewhere = fact.alsoStatedAs ?? [];
  if (elsewhere.length === 0) {
    results.push({
      factId: fact.factId,
      family: "FOOTING",
      check: "the quantity agrees with itself where it appears more than once",
      outcome: "NOT APPLICABLE",
      detail: "This figure is stated in only one place in the filing.",
    });
  } else {
    for (const other of elsewhere) {
      // A fractional tolerance is allowed per-statement because the cover page
      // and the balance sheet are struck on DIFFERENT DATES — a share count
      // moves between period end and filing date by ordinary issuance. The
      // caller sets it; the default is exact agreement.
      const tol =
        other.toleranceFraction !== undefined
          ? Math.abs(fact.value) * other.toleranceFraction
          : footingTolerance(other.value, fact.value);
      const ok = withinTolerance(other.value, fact.value, tol);
      results.push({
        factId: fact.factId,
        family: "FOOTING",
        check: `the quantity agrees with itself: ${other.where}`,
        outcome: ok ? "PASS" : "FAIL",
        detail:
          `${other.where} states ${formatNumber(other.value)} against acquired ` +
          `${formatNumber(fact.value)} (difference ${formatNumber(other.value - fact.value)}, ` +
          `tolerance ${formatNumber(tol)})`,
      });
    }
  }

  return results;
}
