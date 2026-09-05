import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeFcfYieldGrowth,
  computeFcfConversionNormalRange,
  type FcfYieldGrowthInput,
  type FcfConversionNormalRangeInput,
} from "./fcfYieldGrowth";
import type { FcfInput } from "./fcf";
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

// APPROVED CLARIFICATION (Command Center ruling, 2026-09-05) — see
// fcfYieldGrowth.ts's own doc comment above computeFcfConversionNormalRange
// for the full citation and definition. Ratios below are engineered via
// yearWithRatio() so that unleveredFcf / nopat equals the requested ratio
// exactly, keeping every assertion a round number.
function yearWithRatio(ratio: number, overrides: Partial<FcfInput> = {}): FcfInput {
  return {
    operatingCashFlow: sourced(1000),
    cashCapex: sourced(100 - ratio * 100),
    financeLeaseRouAdditions: sourced(0),
    nopat: sourced(100),
    depreciationAndAmortization: sourced(0),
    deltaNwc: sourced(0),
    sbc: sourced(0),
    ...overrides,
  };
}

function tenPriorYears(ratios: number[]): FcfInput[] {
  return ratios.map((r) => yearWithRatio(r));
}

describe("computeFcfConversionNormalRange", () => {
  it("computes the tested year's ratio as unlevered FCF ÷ same-year NOPAT", () => {
    const result = computeFcfConversionNormalRange({
      testedYear: yearWithRatio(1.2),
      priorTenYears: tenPriorYears([1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45]),
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.testedRatio.toString()).toBe("1.2");
    }
  });

  it("EXCLUDES the tested year from the range — an extreme tested ratio does not widen rangeHigh", () => {
    const result = computeFcfConversionNormalRange({
      testedYear: yearWithRatio(5.0),
      priorTenYears: tenPriorYears([1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9]),
    });
    expect(result.available).toBe(true);
    if (result.available) {
      // If the tested year had been folded into the range, rangeHigh would
      // be 5.0, not 1.9 — this is the direct test of exclusion.
      expect(result.rangeHigh.toString()).toBe("1.9");
      expect(result.rangeLow.toString()).toBe("1");
      expect(result.withinNormalRange).toBe(false);
    }
  });

  it("requires exactly ten preceding fiscal years (eleven total observations)", () => {
    const nineYears = computeFcfConversionNormalRange({
      testedYear: yearWithRatio(1.2),
      priorTenYears: tenPriorYears([1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]),
    });
    expect(nineYears.available).toBe(false);
    if (!nineYears.available) {
      expect(nineYears.cause).toContain("eleven total observations");
      expect(nineYears.cause).toContain("9");
    }

    const elevenYears = computeFcfConversionNormalRange({
      testedYear: yearWithRatio(1.2),
      priorTenYears: tenPriorYears([1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0]),
    });
    expect(elevenYears.available).toBe(false);
  });

  describe("inclusive boundaries", () => {
    const priorRatios = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9];

    it("treats a tested ratio exactly at the prior-years' minimum as within range", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.0),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.withinNormalRange).toBe(true);
    });

    it("treats a tested ratio exactly at the prior-years' maximum as within range", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.9),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.withinNormalRange).toBe(true);
    });

    it("treats a tested ratio just below the prior-years' minimum as outside range", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(0.99),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.withinNormalRange).toBe(false);
    });

    it("treats a tested ratio just above the prior-years' maximum as outside range", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.91),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(true);
      if (result.available) expect(result.withinNormalRange).toBe(false);
    });
  });

  describe("unavailable inputs — fail closed, never discard/shorten/substitute", () => {
    const priorRatios = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9];

    it("is unavailable when the tested year is missing a required unlevered-FCF component", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.2, { depreciationAndAmortization: null }),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.cause).toContain("tested year");
        expect(result.cause).toContain("depreciationAndAmortization");
      }
    });

    it("is unavailable when the tested year's NOPAT is missing", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.2, { nopat: null }),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(false);
      if (!result.available) expect(result.cause).toContain("nopat");
    });

    it("is unavailable when the tested year's NOPAT is non-positive", () => {
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.2, { nopat: sourced(0) }),
        priorTenYears: tenPriorYears(priorRatios),
      });
      expect(result.available).toBe(false);
      if (!result.available) expect(result.cause).toContain("non-positive NOPAT");
    });

    it("is unavailable when a PRIOR year has non-positive NOPAT — one bad year fails the whole check, not silently discarded", () => {
      const priors = tenPriorYears(priorRatios);
      priors[3] = yearWithRatio(1.3, { nopat: sourced(-5) });
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.2),
        priorTenYears: priors,
      });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.cause).toContain("prior year 4");
        expect(result.cause).toContain("non-positive NOPAT");
      }
    });

    it("is unavailable when a PRIOR year is missing a required unlevered-FCF component", () => {
      const priors = tenPriorYears(priorRatios);
      priors[7] = yearWithRatio(1.7, { cashCapex: null });
      const result = computeFcfConversionNormalRange({
        testedYear: yearWithRatio(1.2),
        priorTenYears: priors,
      });
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.cause).toContain("prior year 8");
        expect(result.cause).toContain("cashCapex");
      }
    });
  });
});
