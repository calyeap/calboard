import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeMarginHistory } from "./marginHistory";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

describe("computeMarginHistory", () => {
  it("computes current margin, range, median and worst decline over the full window", () => {
    const result = computeMarginHistory({
      yearlyOperatingMargins: [0.3, 0.32, 0.34, 0.35, 0.37, 0.39, 0.41, 0.43, 0.45, 0.468].map(sourced),
      fiftyTwoWeekLow: sourced(300),
      fiftyTwoWeekHigh: sourced(470),
    });
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.value.currentMargin.toString()).toBe("0.468");
      expect(result.value.windowYears).toBe(10);
      expect(result.value.range.toString()).toBe("0.168");
      expect(result.value.worstSingleYearChange.toString()).toBe("0");
      expect(result.value.fiftyTwoWeekRange.map((d) => d.toString())).toEqual(["300", "470"]);
    }
  });

  it("labels a short window honestly rather than suppressing it (§6.2 — margin diagnostics still run under HISTORY INSUFFICIENT)", () => {
    const result = computeMarginHistory({
      yearlyOperatingMargins: [0.1, 0.12, 0.15].map(sourced),
      fiftyTwoWeekLow: sourced(10),
      fiftyTwoWeekHigh: sourced(20),
    });
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.value.windowYears).toBe(3);
    }
  });

  it("computes the median correctly for an even-length window", () => {
    const result = computeMarginHistory({
      yearlyOperatingMargins: [0.1, 0.3, 0.2, 0.4].map(sourced),
      fiftyTwoWeekLow: sourced(10),
      fiftyTwoWeekHigh: sourced(20),
    });
    expect(result.suppressed).toBe(false);
    // sorted: 0.1, 0.2, 0.3, 0.4 -> median (0.2+0.3)/2 = 0.25
    if (!result.suppressed) {
      expect(result.value.median.toString()).toBe("0.25");
    }
  });

  it("returns INCOMPLETE when there is no margin history at all", () => {
    const result = computeMarginHistory({
      yearlyOperatingMargins: [],
      fiftyTwoWeekLow: sourced(10),
      fiftyTwoWeekHigh: sourced(20),
    });
    expect(result.suppressed).toBe(true);
    if (result.suppressed) {
      expect(result.state).toBe("INCOMPLETE");
      expect(result.cause).toContain("yearlyOperatingMargins");
    }
  });

  it("returns INCOMPLETE when the 52-week range is missing, without exception (§7.2 M3)", () => {
    const result = computeMarginHistory({
      yearlyOperatingMargins: [sourced(0.3)],
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: sourced(20),
    });
    expect(result.suppressed).toBe(true);
    if (result.suppressed) {
      expect(result.cause).toContain("fiftyTwoWeekLow");
    }
  });
});
