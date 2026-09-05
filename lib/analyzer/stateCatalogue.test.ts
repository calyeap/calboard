import { describe, it, expect } from "vitest";
import { ALL_SUPPRESSING_STATES } from "./stateCatalogue";

describe("ALL_SUPPRESSING_STATES", () => {
  it("has exactly the 14 states the frozen spec defines, in the reconciled order recorded in stateCatalogue.ts", () => {
    // A hardcoded expected list, not a derived count — so a state renamed,
    // reordered, duplicated or quietly dropped fails this test even though
    // the compile-time check in stateCatalogue.ts only catches a change to
    // the SuppressingState union itself, not a change to this array alone.
    expect(ALL_SUPPRESSING_STATES).toEqual([
      "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1",
      "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE",
      "HISTORY INSUFFICIENT",
      "LEVERAGE UNSUPPORTED IN v1",
      "RONIC NOT MEANINGFUL",
      "NOT COMPUTABLE",
      "NO SOLUTION IN RANGE",
      "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE",
      "PRECONDITION FAILED",
      "NOT ACHIEVABLE AT ANY SCALE",
      "SEASONAL — RUN-RATE SUPPRESSED",
      "INCOMPLETE",
      "THIS SUCCESS IS WORTH LESS THAN FAILURE",
      "PRICE NOT JUSTIFIABLE BY THIS OUTCOME",
    ]);
    expect(ALL_SUPPRESSING_STATES).toHaveLength(14);
  });

  it("has no duplicate state names", () => {
    expect(new Set(ALL_SUPPRESSING_STATES).size).toBe(ALL_SUPPRESSING_STATES.length);
  });

  it("names Gate 0's two outcomes concretely — §6.1 defines no bare 'UNSUPPORTED PROFILE' return and no third form", () => {
    const gate0States = ALL_SUPPRESSING_STATES.filter((s) => s.startsWith("UNSUPPORTED PROFILE"));
    expect(gate0States).toEqual([
      "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1",
      "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE",
    ]);
  });

  it("keeps the three degenerate reverse-DCF outcomes as distinct states sharing one §9.3 row", () => {
    expect(ALL_SUPPRESSING_STATES).toEqual(
      expect.arrayContaining(["NOT COMPUTABLE", "NO SOLUTION IN RANGE", "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE"])
    );
  });

  it("keeps the two pre-revenue probability outcomes as distinct states sharing one §9.3 row", () => {
    expect(ALL_SUPPRESSING_STATES).toEqual(
      expect.arrayContaining(["THIS SUCCESS IS WORTH LESS THAN FAILURE", "PRICE NOT JUSTIFIABLE BY THIS OUTCOME"])
    );
  });
});
