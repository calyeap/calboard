import { describe, it, expect } from "vitest";
import {
  SUPPRESSION_SCOPE_BY_STATE,
  SCOPE_REMOVES_FAIR_VALUE_RANGE,
  stateRemovingFairValueRange,
  type ActiveSuppression,
} from "./suppression";
import { ALL_SUPPRESSING_STATES } from "./stateCatalogue";
import type { SuppressingState } from "./types";

// ---------------------------------------------------------------------------
// §9.3 consumption — the rule, not a list of the states we can see today.
//
// Every test here is anchored to a frozen artefact, named in the test itself.
// The point of the module under test is that a suppressing state added later
// INHERITS this behaviour rather than needing to be caught: it cannot be
// recorded without a §9.3 scope, and no scope can exist without declaring
// whether it covers the fair-value range.
// ---------------------------------------------------------------------------

function active(state: SuppressingState, appliesTo: string): ActiveSuppression {
  return { state, appliesTo };
}

describe("§9.3 scope mapping — completeness", () => {
  it("maps every suppressing state in the frozen catalogue to a §9.3 scope", () => {
    // The rule's inheritance property, asserted at runtime as well as in the
    // type system: a fourteenth-plus state cannot arrive unmapped.
    for (const state of ALL_SUPPRESSING_STATES) {
      expect(SUPPRESSION_SCOPE_BY_STATE[state]).toBeDefined();
    }
    expect(Object.keys(SUPPRESSION_SCOPE_BY_STATE).sort()).toEqual(
      [...ALL_SUPPRESSING_STATES].sort()
    );
  });

  it("declares a fair-value-range effect for every scope it can map to", () => {
    for (const state of ALL_SUPPRESSING_STATES) {
      const scope = SUPPRESSION_SCOPE_BY_STATE[state];
      expect(typeof SCOPE_REMOVES_FAIR_VALUE_RANGE[scope]).toBe("boolean");
    }
  });
});

describe("§10.3 — the three states that remove the fair-value range", () => {
  // §10.3: "Where any suppressing state is active — UNSUPPORTED PROFILE,
  // LEVERAGE UNSUPPORTED IN v1, or a NOT COMPUTABLE reverse DCF — there is no
  // fair-value range. The state is the output."

  it("Gate 0's ASSET-BASED return removes the range (§6.1, V7 — a bank)", () => {
    const found = stateRemovingFairValueRange([
      active("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1", "all valuation outputs"),
    ]);
    expect(found?.state).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("Gate 0's CLASSIFICATION UNAVAILABLE return removes the range (§6.1 fail-closed)", () => {
    const found = stateRemovingFairValueRange([
      active("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE", "all valuation outputs"),
    ]);
    expect(found?.state).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
  });

  it("LEVERAGE UNSUPPORTED IN v1 removes the range on its own (§6.5, V1)", () => {
    // V1 lists the fair-value range among what this state suppresses, and it
    // is the ONLY state active in that case — so this must not depend on
    // UNSUPPORTED PROFILE being active alongside it.
    const found = stateRemovingFairValueRange([
      active("LEVERAGE UNSUPPORTED IN v1", "every rate-dependent output"),
    ]);
    expect(found?.state).toBe("LEVERAGE UNSUPPORTED IN v1");
  });

  it("RONIC NOT MEANINGFUL removes the range — §9.3 suppresses the reverse DCF AS NOT COMPUTABLE", () => {
    // §9.3's row reads "the diagnostic reverse DCF (NOT COMPUTABLE)", which is
    // what §10.3's third named state — "a NOT COMPUTABLE reverse DCF" — refers
    // to. The parenthetical is the link between the two sections.
    const found = stateRemovingFairValueRange([
      active("RONIC NOT MEANINGFUL", "the diagnostic reverse DCF"),
    ]);
    expect(found?.state).toBe("RONIC NOT MEANINGFUL");
  });
});

describe("§9.3 — states that suppress something OTHER than the range", () => {
  it("HISTORY INSUFFICIENT leaves the range standing (V2, §6.2 'Gate 1 never refuses')", () => {
    // V2 confirms exactly one suppression: the own-history multiple
    // percentile. The fair-value range is not in that list.
    expect(
      stateRemovingFairValueRange([
        active("HISTORY INSUFFICIENT", "own-history percentile and history-based normalisation"),
      ])
    ).toBeNull();
  });

  it("SEASONAL — RUN-RATE SUPPRESSED leaves the range standing (V3)", () => {
    // V3's suppression list is the annualised run-rate for revenue, NOPAT,
    // every multiple and the steady-state value. Not the range.
    expect(
      stateRemovingFairValueRange([
        active("SEASONAL — RUN-RATE SUPPRESSED", "the annualised run-rate"),
      ])
    ).toBeNull();
  });

  it("PRECONDITION FAILED leaves the range standing (§9.3 — FCF yield + growth)", () => {
    expect(
      stateRemovingFairValueRange([active("PRECONDITION FAILED", "FCF yield + growth")])
    ).toBeNull();
  });

  it("a single suppressed reverse-DCF cell leaves the range standing (V4 — MSFT, 4 of 9)", () => {
    // The frozen MSFT mock prints "Reverse-DCF cells returning a state: 4 of
    // 9" in section H BESIDE a rendered fair-value range. A per-cell state
    // removes "the affected reverse-DCF cell" (§9.3) and nothing wider.
    expect(
      stateRemovingFairValueRange([
        active("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE", "reverse-DCF cell current/0.12"),
        active("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE", "reverse-DCF cell median/0.12"),
        active("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE", "reverse-DCF cell stress/0.1"),
        active("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE", "reverse-DCF cell stress/0.12"),
      ])
    ).toBeNull();
  });

  it("every reverse-DCF cell suppressed still leaves the range standing (V6 — OKLO, 9 of 9)", () => {
    // OKLO's frozen mock renders section H as the distribution summary in
    // full, with no reverse DCF in its method set at all. A cell-scoped state
    // never widens into the range, however many cells carry it — which is why
    // the rule is keyed on the §9.3 scope and not on a count.
    const everyCell: ActiveSuppression[] = [];
    for (const margin of ["current", "median", "stress"]) {
      for (const rate of ["0.08", "0.1", "0.12"]) {
        everyCell.push(active("INCOMPLETE", `reverse-DCF cell ${margin}/${rate}`));
      }
    }
    expect(everyCell).toHaveLength(9);
    expect(stateRemovingFairValueRange(everyCell)).toBeNull();
  });
});

describe("§9.6 rule 1, second clause — an INCOMPLETE REQUIRED input of the range", () => {
  it("removes the range when the INCOMPLETE is bound to the range itself", () => {
    // §9.6 rule 1 reaches UNUSABLE on "a §9.3 suppressing state removes the
    // fair-value range under §10.3, OR a REQUIRED input of the range is
    // INCOMPLETE". INCOMPLETE's §9.3 row is "every dependent output", so what
    // it removes is whatever the instance is bound to — the call site says.
    const found = stateRemovingFairValueRange([
      { state: "INCOMPLETE", appliesTo: "the fair-value range", scope: "the fair-value range" },
    ]);
    expect(found?.state).toBe("INCOMPLETE");
  });
});

describe("the rule reports WHICH state removed the range, so the slot can name its cause", () => {
  it("returns the first range-removing state, not merely a boolean", () => {
    // §9.5 forbids a state without a cause, so the consumer needs the state
    // itself rather than a yes/no.
    const found = stateRemovingFairValueRange([
      active("HISTORY INSUFFICIENT", "own-history percentile"),
      active("LEVERAGE UNSUPPORTED IN v1", "every rate-dependent output"),
    ]);
    expect(found).not.toBeNull();
    expect(found?.state).toBe("LEVERAGE UNSUPPORTED IN v1");
    expect(found?.appliesTo).toBe("every rate-dependent output");
  });

  it("returns null when nothing is active", () => {
    expect(stateRemovingFairValueRange([])).toBeNull();
  });
});
