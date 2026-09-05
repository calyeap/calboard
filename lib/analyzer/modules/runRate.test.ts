import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeRunRate, type RunRateInput } from "./runRate";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function baseInput(overrides: Partial<RunRateInput> = {}): RunRateInput {
  return {
    // NVIDIA-inspired shape: current quarter growth is high, but neither
    // prior year's same quarter was — genuine growth, not seasonality.
    currentQuarterRevenue: sourced(130),
    priorQuarterRevenue: sourced(100), // 30% sequential growth
    sameQuarterYear1: sourced(80),
    sameQuarterYear1Prior: sourced(78), // ~2.6% — below threshold
    sameQuarterYear2: sourced(70),
    sameQuarterYear2Prior: sourced(69), // ~1.4% — below threshold
    ttm: sourced(400),
    ...overrides,
  };
}

describe("computeRunRate", () => {
  it("computes and shows the run-rate alongside TTM when growth is elevated but not seasonal (NVIDIA-inspired shape)", () => {
    const result = computeRunRate(baseInput());
    expect(result.seasonalityTestResult).toBe("PASS");
    expect(result.runRate?.toString()).toBe("520"); // 130 * 4
    expect(result.ttm?.toString()).toBe("400");
  });

  it("returns SEASONAL — RUN-RATE SUPPRESSED when the same quarter also jumped in a prior year (seasonal-retailer shape)", () => {
    const result = computeRunRate(
      baseInput({
        sameQuarterYear1: sourced(90),
        sameQuarterYear1Prior: sourced(70), // ~28.6% — also elevated, same quarter
      })
    );
    expect(result.seasonalityTestResult).toBe("SEASONAL — RUN-RATE SUPPRESSED");
    expect(result.runRate).toBeNull();
  });

  it("returns SEASONAL — RUN-RATE SUPPRESSED when EITHER prior year alone was elevated", () => {
    const result = computeRunRate(
      baseInput({
        sameQuarterYear2: sourced(95),
        sameQuarterYear2Prior: sourced(75), // ~26.7% — elevated, two years back
      })
    );
    expect(result.seasonalityTestResult).toBe("SEASONAL — RUN-RATE SUPPRESSED");
  });

  it("never computes a run-rate internally when suppressed — not just hides it from display", () => {
    const result = computeRunRate(baseInput({ sameQuarterYear1: sourced(90), sameQuarterYear1Prior: sourced(70) }));
    expect(result.runRate).toBeNull();
  });

  it("does nothing when the base-year rule does not fire — ordinary sequential growth, no run-rate needed", () => {
    const result = computeRunRate(baseInput({ currentQuarterRevenue: sourced(103), priorQuarterRevenue: sourced(100) }));
    expect(result.seasonalityTestResult).toBe("PASS");
    expect(result.runRate).toBeNull();
    expect(result.triggeringQuarterGrowth).toBeNull();
  });

  it("fails closed to INCOMPLETE when a required prior-year quarter is missing, even though the base rule would have fired (§11.3's fail-closed check)", () => {
    const result = computeRunRate(baseInput({ sameQuarterYear2Prior: null }));
    expect(result.seasonalityTestResult).toBe("INCOMPLETE");
    expect(result.runRate).toBeNull();
  });

  it("still reports TTM standing alone even when the seasonality test itself is INCOMPLETE", () => {
    const result = computeRunRate(baseInput({ sameQuarterYear2Prior: null }));
    expect(result.ttm?.toString()).toBe("400");
  });

  it("reports ttm as null only when TTM itself is unavailable — a separate gap from the seasonality inputs", () => {
    const result = computeRunRate(baseInput({ ttm: null }));
    expect(result.ttm).toBeNull();
    expect(result.seasonalityTestResult).toBe("PASS"); // seasonality inputs are all still present
  });

  it("records the triggering quarter growth figures when the test actually runs", () => {
    const result = computeRunRate(baseInput());
    expect(result.triggeringQuarterGrowth).not.toBeNull();
    expect(result.triggeringQuarterGrowth?.thisYear.toString()).toBe("0.3");
  });
});
