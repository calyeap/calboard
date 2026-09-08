import { POLICY } from "./policy";
// Imported rather than restated: there must be exactly one definition of what
// counts as an asset-based sector or a reserve-based industry, and it is the
// one Gate 0 itself tests against.
import { ASSET_BASED_SECTORS, RESERVE_BASED_INDUSTRIES } from "./gates";
import type { Gate0Result, LeverageResult, SuppressingState } from "./types";

// ---------------------------------------------------------------------------
// §9.3 CONSUMPTION — a suppressing state stops the output it suppresses.
//
// §9.5: "Where any suppressing state is active there is no fair-value range.
// The state is the output." §9.3's table says, row by row, WHICH output each
// state removes, and those two sentences are one rule: a state removes the
// range when the output it suppresses covers the range.
//
// THIS IS A RULE, NOT A LIST OF STATES. Two properties make it one, and both
// are enforced by the compiler rather than by review:
//
//   1. Every suppressing state maps to a §9.3 scope. `SUPPRESSION_SCOPE_BY_STATE`
//      is a total Record over `SuppressingState`, so a state added to that
//      union does not compile until it declares what it suppresses.
//   2. Every scope declares whether it covers the fair-value range.
//      `SCOPE_REMOVES_FAIR_VALUE_RANGE` is a total Record over
//      `SuppressionScope`, so a scope added here does not compile until it
//      answers that question.
//
// So a fifteenth state inherits this behaviour instead of needing to be
// caught — the same reasoning as the design's §0 cell rule, where fixing a
// list of state names left CONFIRMED wrong.
//
// WHY THE SCOPE AND NOT THE STATE NAME. §10.3 names three states that remove
// the range: "UNSUPPORTED PROFILE, LEVERAGE UNSUPPORTED IN v1, or a NOT
// COMPUTABLE reverse DCF". Those are exactly the three §9.3 rows whose scope
// covers the range, and the frozen artefacts rule out keying on the name:
//
//   - V2 (HISTORY INSUFFICIENT) confirms ONE suppression, the own-history
//     percentile. §6.2: "Gate 1 never refuses."
//   - V3 (SEASONAL) confirms the run-rate suppressions and not the range.
//   - V4 / mock-report-msft.html prints "Reverse-DCF cells returning a state:
//     4 of 9" in section H BESIDE a rendered range. A per-cell state removes
//     "the affected reverse-DCF cell" (§9.3) and nothing wider.
//   - V6 / mock-report-oklo.html renders section H's distribution summary in
//     full with every reverse-DCF cell suppressed, so a cell-scoped state
//     never widens into the range however many cells carry it.
//
// §10.3's third named state is therefore §9.3's RONIC NOT MEANINGFUL row,
// whose scope is "the diagnostic reverse DCF (NOT COMPUTABLE)" — the
// parenthetical in that row is the link between the two sections, and it is
// the whole reverse DCF, not one cell of it.
// ---------------------------------------------------------------------------

/**
 * §9.3's "What is suppressed" column, one member per row of that table, plus
 * the fair-value range itself.
 *
 * The range is a scope in its own right because INCOMPLETE's row is "every
 * dependent output" — what it removes is whatever the instance is bound to,
 * which only the call site knows. §9.6 rule 1's second clause ("a REQUIRED
 * input of the range is INCOMPLETE") is that case, and this is how it is said.
 */
export type SuppressionScope =
  | "all valuation outputs"
  | "history-based outputs"
  | "every rate-dependent output"
  | "the diagnostic reverse DCF"
  | "the affected reverse-DCF cell"
  | "FCF yield + growth"
  | "the what-has-to-be-true solve"
  | "one success definition"
  | "the annualised run-rate"
  | "the fair-value range";

/**
 * §9.3, as data. Each state's default scope is the row it appears in.
 *
 * Total over `SuppressingState` — a new state does not compile until it says
 * what it suppresses.
 */
export const SUPPRESSION_SCOPE_BY_STATE: Readonly<Record<SuppressingState, SuppressionScope>> = {
  // §9.3 row 1, Gate 0 — "all valuation outputs". §6.1 says the same in its
  // own words: "Under either state: all valuation outputs are suppressed."
  "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1": "all valuation outputs",
  "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE": "all valuation outputs",
  // §9.3 row 2 — own-history percentile, history-based normalisation, any
  // cyclicality label. Never the range: §6.2, V2.
  "HISTORY INSUFFICIENT": "history-based outputs",
  // §9.3 row 3 — "every rate-dependent output", which §6.5 enumerates and
  // ends with "the fair-value range".
  "LEVERAGE UNSUPPORTED IN v1": "every rate-dependent output",
  // §9.3 row 4 — "the diagnostic reverse DCF (NOT COMPUTABLE)".
  "RONIC NOT MEANINGFUL": "the diagnostic reverse DCF",
  // §9.3 row 5 — "the affected reverse-DCF cell". One cell, not the grid.
  "NOT COMPUTABLE": "the affected reverse-DCF cell",
  "NO SOLUTION IN RANGE": "the affected reverse-DCF cell",
  "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE": "the affected reverse-DCF cell",
  // §9.3 row 6.
  "PRECONDITION FAILED": "FCF yield + growth",
  // §9.3 row 7.
  "NOT ACHIEVABLE AT ANY SCALE": "the what-has-to-be-true solve",
  // §9.3 row 8 — "the conditional price-implied break-even success weight for
  // that definition". One row of the table, never the whole distribution.
  "THIS SUCCESS IS WORTH LESS THAN FAILURE": "one success definition",
  "PRICE NOT JUSTIFIABLE BY THIS OUTCOME": "one success definition",
  // §9.3 row 9.
  "SEASONAL — RUN-RATE SUPPRESSED": "the annualised run-rate",
  // §9.3 row 10 — "every dependent output". The dependent output is named by
  // the instance, so the DEFAULT is the narrowest honest reading: this
  // instance's own binding, which is not the range unless the call site says
  // so by passing `scope: "the fair-value range"`. Defaulting the other way
  // would delete OKLO's distribution summary, which its frozen mock renders
  // in full against nine INCOMPLETE reverse-DCF cells.
  INCOMPLETE: "the affected reverse-DCF cell",
};

/**
 * Which §9.3 scopes cover the §10.3 fair-value range.
 *
 * Total over `SuppressionScope` — a new scope does not compile until it
 * answers this.
 */
export const SCOPE_REMOVES_FAIR_VALUE_RANGE: Readonly<Record<SuppressionScope, boolean>> = {
  // The range is a valuation output (§10.2 section H, §10.3).
  "all valuation outputs": true,
  // §6.5's enumeration of rate-dependent outputs ends with the range itself.
  "every rate-dependent output": true,
  // §10.3's "a NOT COMPUTABLE reverse DCF".
  "the diagnostic reverse DCF": true,
  // §9.6 rule 1, second clause.
  "the fair-value range": true,

  // V2: Gate 1 never refuses, and the range is not among what it suppresses.
  "history-based outputs": false,
  // V4 and mock-report-msft.html: 4 of 9 cells gone, range rendered.
  "the affected reverse-DCF cell": false,
  // V3: the run-rate figures go, the range stays.
  "the annualised run-rate": false,
  "FCF yield + growth": false,
  "the what-has-to-be-true solve": false,
  // V6: the two failed OKLO definitions are "displayed, not dropped", and the
  // distribution summary renders.
  "one success definition": false,
};

/**
 * One active suppressing state, bound to the output it applies to.
 *
 * `scope` is optional and defaults to the state's §9.3 row. A call site passes
 * it only to say something the table cannot: which dependent output an
 * INCOMPLETE removed.
 */
export interface ActiveSuppression {
  state: SuppressingState;
  appliesTo: string;
  scope?: SuppressionScope;
  /**
   * Why this state fired, in the reader's words. §9.5 forbids a suppressed
   * output shown without its reason, and design §6 makes the cause line
   * mandatory rather than optional — so whichever entry removes an output
   * must be able to hand that output its cause.
   */
  cause?: string;
}

/** The §9.3 scope this instance suppresses — its own, or its state's row. */
export function scopeOf(active: ActiveSuppression): SuppressionScope {
  return active.scope ?? SUPPRESSION_SCOPE_BY_STATE[active.state];
}

/**
 * The active state that removes the fair-value range, or null if none does.
 *
 * Returns the state rather than a boolean because §9.5 forbids a suppressed
 * output displayed without its reason — the slot has to name what removed it.
 */
export function stateRemovingFairValueRange(
  active: readonly ActiveSuppression[]
): ActiveSuppression | null {
  for (const entry of active) {
    if (SCOPE_REMOVES_FAIR_VALUE_RANGE[scopeOf(entry)]) return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cause lines — design §6's table, which gives one per state.
// ---------------------------------------------------------------------------

/**
 * Which Gate 0 test fired, or which REQUIRED input was missing.
 *
 * Design §6 gives UNSUPPORTED PROFILE the cause line "which Gate 0 test
 * fired", so this names the tests rather than restating the state. Every test
 * that fired is listed: more than one can, and reporting only the first would
 * understate why a company was refused.
 */
export function gate0Cause(gate0: Gate0Result): string {
  const t = gate0.evaluatedTests;

  if (gate0.result === "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1") {
    const fired: string[] = [];
    if (t.sectorClassification !== null && ASSET_BASED_SECTORS.has(t.sectorClassification)) {
      fired.push(`sector classification ${t.sectorClassification}`);
    }
    if (
      t.interestIncomeOverRevenue !== null &&
      t.interestIncomeOverRevenue.greaterThan(POLICY.gate0InterestIncomeOverRevenueThreshold)
    ) {
      fired.push(
        `interest income ${t.interestIncomeOverRevenue.mul(100).toFixed(1)}% of revenue, above ` +
          `${POLICY.gate0InterestIncomeOverRevenueThreshold.mul(100).toFixed(0)}%`
      );
    }
    if (t.hasInsurancePremiumOrReserveLineItems === true) {
      fired.push("insurance premium or policy-reserve line items in the primary statements");
    }
    if (t.industryClassification !== null && RESERVE_BASED_INDUSTRIES.has(t.industryClassification)) {
      fired.push(`reserve-based industry ${t.industryClassification}`);
    }
    return fired.join(" · ");
  }

  // Fail-closed: name what was missing, never a bare "unavailable" (§9.5).
  const missing: string[] = [];
  if (t.sectorClassification === null) missing.push("sector classification");
  if (t.interestIncomeOverRevenue === null) missing.push("interest income over revenue");
  if (t.hasInsurancePremiumOrReserveLineItems === null) {
    missing.push("insurance premium or policy-reserve line items");
  }
  if (t.industryClassification === null) missing.push("industry classification");
  return `missing REQUIRED input(s): ${missing.join(", ")}`;
}

/**
 * Design §6: "net debt ratio 34.2% — or `inputs missing` where fail-closed".
 */
export function leverageCause(leverage: LeverageResult): string {
  if (leverage.netDebtRatio === null) {
    return "inputs missing — the ratio could not be computed, so the precondition fails closed";
  }
  return (
    `net debt ratio ${leverage.netDebtRatio.mul(100).toFixed(1)}%, at or above the ` +
    `${POLICY.leverageThreshold.mul(100).toFixed(0)}% threshold`
  );
}
