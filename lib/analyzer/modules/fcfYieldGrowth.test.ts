import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeFcfYieldGrowth, type FcfYieldGrowthInput } from "./fcfYieldGrowth";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function baseInput(overrides: Partial<FcfYieldGrowthInput> = {}): FcfYieldGrowthInput {
  return {
    capex: sourced(80),
    financeLeaseRouAdditions: sourced(20),
    depreciationAndAmortization: sourced(100), // (80+20)/100 = 1.0, within [0.8, 1.5]
    fcfConversionWithinNormalRange: true,
    fcfYieldValue: sourced(0.04),
    ...overrides,
  };
}

describe("computeFcfYieldGrowth", () => {
  it("passes and returns the FCF yield when the precondition band and conversion range both hold", () => {
    const result = computeFcfYieldGrowth(baseInput());
    expect(result.precondition).toBe("PASS");
    expect(result.output?.suppressed).toBe(false);
  });

  it("fails the precondition when (capex + lease additions) / D&A is below the band", () => {
    const result = computeFcfYieldGrowth(baseInput({ capex: sourced(10), financeLeaseRouAdditions: sourced(5) }));
    expect(result.precondition).toBe("PRECONDITION FAILED");
    expect(result.output).toBeNull();
  });

  it("fails the precondition when (capex + lease additions) / D&A is above the band", () => {
    const result = computeFcfYieldGrowth(baseInput({ capex: sourced(120), financeLeaseRouAdditions: sourced(60) }));
    expect(result.precondition).toBe("PRECONDITION FAILED");
  });

  it("passes at the exact band boundaries (0.8x and 1.5x)", () => {
    const low = computeFcfYieldGrowth(baseInput({ capex: sourced(70), financeLeaseRouAdditions: sourced(10) })); // 0.8
    const high = computeFcfYieldGrowth(baseInput({ capex: sourced(130), financeLeaseRouAdditions: sourced(20) })); // 1.5
    expect(low.precondition).toBe("PASS");
    expect(high.precondition).toBe("PASS");
  });

  it("fails the precondition when FCF conversion is outside its own ten-year normal range, even with a band-compliant ratio", () => {
    const result = computeFcfYieldGrowth(baseInput({ fcfConversionWithinNormalRange: false }));
    expect(result.precondition).toBe("PRECONDITION FAILED");
  });

  it("fails closed (never PASS) when any required input is missing", () => {
    const result = computeFcfYieldGrowth(baseInput({ fcfConversionWithinNormalRange: null }));
    expect(result.precondition).toBe("PRECONDITION FAILED");
  });

  it("never returns a number on failure — output is null, not a suppressed Figure with a value", () => {
    const result = computeFcfYieldGrowth(baseInput({ capex: sourced(10), financeLeaseRouAdditions: sourced(5) }));
    expect(result.output).toBeNull();
  });
});
