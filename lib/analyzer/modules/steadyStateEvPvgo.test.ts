import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeSteadyStateEvPvgo, type SteadyStateEvInput } from "./steadyStateEvPvgo";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function baseInput(overrides: Partial<SteadyStateEvInput> = {}): SteadyStateEvInput {
  return {
    currentEnterpriseValue: sourced(1200),
    medianMarginNopat: sourced(100),
    currentNopat: sourced(120),
    discountRate: sourced(0.1),
    leverageUnsupported: false,
    triggerAOrBFired: false,
    ...overrides,
  };
}

describe("computeSteadyStateEvPvgo", () => {
  it("computes steady-state EV = median-margin NOPAT / discount rate", () => {
    const result = computeSteadyStateEvPvgo(baseInput());
    expect(result.steadyStateEv.suppressed).toBe(false);
    if (!result.steadyStateEv.suppressed) {
      expect(result.steadyStateEv.value.toString()).toBe("1000");
    }
  });

  it("computes PVGO = current EV - steady-state EV, EV to EV", () => {
    const result = computeSteadyStateEvPvgo(baseInput());
    expect(result.pvgo.suppressed).toBe(false);
    if (!result.pvgo.suppressed) {
      expect(result.pvgo.value.toString()).toBe("200");
    }
  });

  it("computes PVGO share of EV", () => {
    const result = computeSteadyStateEvPvgo(baseInput());
    expect(result.pvgoShareOfEv.suppressed).toBe(false);
    if (!result.pvgoShareOfEv.suppressed) {
      // 200 / 1200
      expect(result.pvgoShareOfEv.value.toDecimalPlaces(4).toString()).toBe("0.1667");
    }
  });

  it("suppresses all three figures with LEVERAGE UNSUPPORTED IN v1 when leverage is unsupported", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ leverageUnsupported: true }));
    for (const figure of [result.steadyStateEv, result.pvgo, result.pvgoShareOfEv]) {
      expect(figure.suppressed).toBe(true);
      if (figure.suppressed) expect(figure.state).toBe("LEVERAGE UNSUPPORTED IN v1");
    }
    expect(result.nopatGap).toBeNull();
  });

  it("the leverage check takes priority even when other inputs are also missing", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ leverageUnsupported: true, medianMarginNopat: null }));
    expect(result.steadyStateEv.suppressed).toBe(true);
    if (result.steadyStateEv.suppressed) {
      expect(result.steadyStateEv.state).toBe("LEVERAGE UNSUPPORTED IN v1");
    }
  });

  it("returns INCOMPLETE when median-margin NOPAT is unavailable — 'no NOPAT to normalise' (§7.2 M6)", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ medianMarginNopat: null }));
    expect(result.steadyStateEv.suppressed).toBe(true);
    if (result.steadyStateEv.suppressed) {
      expect(result.steadyStateEv.state).toBe("INCOMPLETE");
    }
  });

  it("returns INCOMPLETE when the discount rate is missing", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ discountRate: null }));
    expect(result.steadyStateEv.suppressed).toBe(true);
  });

  it("returns INCOMPLETE when current EV is missing", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ currentEnterpriseValue: null }));
    expect(result.pvgo.suppressed).toBe(true);
  });

  it("shows no NOPAT gap when neither trigger has fired", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ triggerAOrBFired: false }));
    expect(result.nopatGap).toBeNull();
  });

  it("shows the current-vs-median-margin NOPAT gap when a trigger has fired", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ triggerAOrBFired: true }));
    expect(result.nopatGap).toEqual({ current: new Decimal(120), medianMargin: new Decimal(100) });
  });

  it("shows no gap when a trigger fired but current NOPAT is unavailable, without suppressing the primary figures", () => {
    const result = computeSteadyStateEvPvgo(baseInput({ triggerAOrBFired: true, currentNopat: null }));
    expect(result.nopatGap).toBeNull();
    expect(result.steadyStateEv.suppressed).toBe(false);
  });
});
