import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeImpliedExitMultiple } from "./impliedExitMultiple";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

describe("computeImpliedExitMultiple", () => {
  it("divides terminal value by the named metric and labels it correctly", () => {
    const result = computeImpliedExitMultiple(sourced(500), sourced(100), "FY36 EBIT");
    expect(result.dividesMetric).toBe("FY36 EBIT");
    expect(result.value.suppressed).toBe(false);
    if (!result.value.suppressed) {
      expect(result.value.value.toString()).toBe("5");
    }
  });

  it("never mislabels the metric — the label always names what was actually passed as the denominator", () => {
    const asRevenue = computeImpliedExitMultiple(sourced(500), sourced(100), "FY36 revenue");
    const asEbit = computeImpliedExitMultiple(sourced(500), sourced(100), "FY36 EBIT");
    expect(asRevenue.dividesMetric).not.toBe(asEbit.dividesMetric);
  });

  it("returns INCOMPLETE when terminal value is missing, keeping the metric name for context", () => {
    const result = computeImpliedExitMultiple(null, sourced(100), "FY36 EBIT");
    expect(result.value.suppressed).toBe(true);
    expect(result.dividesMetric).toBe("FY36 EBIT");
  });

  it("returns INCOMPLETE when the metric itself is missing", () => {
    const result = computeImpliedExitMultiple(sourced(500), null, "FY36 EBIT");
    expect(result.value.suppressed).toBe(true);
    if (result.value.suppressed) {
      expect(result.value.cause).toContain("FY36 EBIT");
    }
  });
});
