import { describe, it, expect } from "vitest";
import { boundState, notComputed, NOT_COMPUTED_BINDING } from "./notComputed";
import { SUPPRESSION_SCOPE_BY_STATE, stateRemovingFairValueRange } from "./suppression";

// CB-AUDIT-FIX-01B. A few report outputs are a bare Decimal in the schema and
// cannot carry their own state; this is the one place that binds a state to
// one of them and reads it back.

describe("notComputed / boundState", () => {
  it("round-trips a state and its cause through the contract's states.suppressing member", () => {
    const entry = notComputed(NOT_COMPUTED_BINDING.rateSensitivity, "INCOMPLETE", "missing REQUIRED input: something named");
    const states = { suppressing: [{ state: entry.state, appliesTo: entry.appliesTo }], qualifying: [] };

    expect(boundState(states, NOT_COMPUTED_BINDING.rateSensitivity)).toEqual({
      state: "INCOMPLETE",
      cause: "missing REQUIRED input: something named",
    });
  });

  it("returns null for an output nothing was bound to", () => {
    const states = { suppressing: [{ state: "HISTORY INSUFFICIENT" as const, appliesTo: "own-history percentile" }], qualifying: [] };
    expect(boundState(states, NOT_COMPUTED_BINDING.rateSensitivity)).toBeNull();
  });

  it("never matches one binding on another binding's entry", () => {
    const bear = notComputed(NOT_COMPUTED_BINDING.scenarioDrivers("bear"), "INCOMPLETE", "none authored");
    const states = { suppressing: [{ state: bear.state, appliesTo: bear.appliesTo }], qualifying: [] };
    expect(boundState(states, NOT_COMPUTED_BINDING.scenarioDrivers("base"))).toBeNull();
    expect(boundState(states, NOT_COMPUTED_BINDING.scenarioDrivers("bear"))).not.toBeNull();
  });

  it("never removes the fair-value range — these outputs are not inputs of it", () => {
    for (const state of ["INCOMPLETE", "NO SOLUTION IN RANGE"] as const) {
      const entry = notComputed(NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice, state, "cause");
      expect(stateRemovingFairValueRange([entry])).toBeNull();
      expect(entry.scope ?? SUPPRESSION_SCOPE_BY_STATE[state]).not.toBe("the fair-value range");
    }
  });
});
