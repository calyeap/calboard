import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeReinvestmentRonic, type ReinvestmentInput, type RonicInput } from "./reinvestmentRonic";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function reinvestmentInput(overrides: Partial<ReinvestmentInput> = {}): ReinvestmentInput {
  return {
    capex: sourced(40),
    acquisitions: sourced(5),
    financeLeaseRouAdditions: sourced(24.6),
    depreciationAndAmortization: sourced(20),
    deltaNwc: sourced(5),
    deltaRevenue: sourced(50),
    ...overrides,
  };
}

function ronicInput(overrides: Partial<RonicInput> = {}): RonicInput {
  return {
    fiveYearDeltaNopat: sourced(9),
    fiveYearDeltaInvestedCapital: sourced(100),
    lagBiasDirection: "conservative",
    ...overrides,
  };
}

describe("computeReinvestmentRonic — reinvestment", () => {
  it("computes reinvestment = capex + acquisitions + lease ROU additions - D&A + deltaNWC", () => {
    const result = computeReinvestmentRonic(reinvestmentInput(), ronicInput());
    expect(result.reinvestment.suppressed).toBe(false);
    if (!result.reinvestment.suppressed) {
      // 40 + 5 + 24.6 - 20 + 5 = 54.6
      expect(result.reinvestment.value.toString()).toBe("54.6");
    }
  });

  it("returns INCOMPLETE when a reinvestment input is missing", () => {
    const result = computeReinvestmentRonic(reinvestmentInput({ capex: null }), ronicInput());
    expect(result.reinvestment.suppressed).toBe(true);
  });

  it("a missing reinvestment input never blocks RONIC, and vice versa", () => {
    const result = computeReinvestmentRonic(reinvestmentInput({ capex: null }), ronicInput());
    expect(result.ronic.suppressed).toBe(false);
  });
});

describe("computeReinvestmentRonic — RONIC ladder", () => {
  it("classifies a 9% RONIC as CLEAN at 8% and LOW RONIC at 10% and 12% — the spec's own worked example (§7.2 M5)", () => {
    const result = computeReinvestmentRonic(
      reinvestmentInput(),
      ronicInput({ fiveYearDeltaNopat: sourced(9), fiveYearDeltaInvestedCapital: sourced(100) })
    );
    expect(result.ronic.suppressed).toBe(false);
    if (!result.ronic.suppressed) {
      const byRate = Object.fromEntries(result.ronic.value.cells.map((c) => [c.rate, c.state]));
      expect(byRate[0.08]).toBe("CLEAN");
      expect(byRate[0.1]).toBe("LOW RONIC — VALUE-DESTROYING GROWTH");
      expect(byRate[0.12]).toBe("LOW RONIC — VALUE-DESTROYING GROWTH");
    }
  });

  it("returns RONIC NOT MEANINGFUL on every cell when invested capital did not grow", () => {
    const result = computeReinvestmentRonic(
      reinvestmentInput(),
      ronicInput({ fiveYearDeltaInvestedCapital: sourced(-10) })
    );
    expect(result.ronic.suppressed).toBe(false);
    if (!result.ronic.suppressed) {
      for (const cell of result.ronic.value.cells) {
        expect(cell.state).toBe("RONIC NOT MEANINGFUL");
        expect(cell.value).toBeNull();
      }
    }
  });

  it("returns RONIC NOT MEANINGFUL on every cell when NOPAT did not grow", () => {
    const result = computeReinvestmentRonic(reinvestmentInput(), ronicInput({ fiveYearDeltaNopat: sourced(-5) }));
    expect(result.ronic.suppressed).toBe(false);
    if (!result.ronic.suppressed) {
      expect(result.ronic.value.cells.every((c) => c.state === "RONIC NOT MEANINGFUL")).toBe(true);
    }
  });

  it("caps RONIC at 200% and labels it, on every cell, when the computed value exceeds the cap", () => {
    const result = computeReinvestmentRonic(
      reinvestmentInput(),
      ronicInput({ fiveYearDeltaNopat: sourced(250), fiveYearDeltaInvestedCapital: sourced(100) })
    );
    expect(result.ronic.suppressed).toBe(false);
    if (!result.ronic.suppressed) {
      for (const cell of result.ronic.value.cells) {
        expect(cell.state).toBe("RONIC CAPPED AT 200%");
        expect(cell.value?.toString()).toBe("2");
      }
    }
  });

  it("returns INCOMPLETE for the whole ladder when a RONIC input is missing", () => {
    const result = computeReinvestmentRonic(reinvestmentInput(), ronicInput({ fiveYearDeltaNopat: null }));
    expect(result.ronic.suppressed).toBe(true);
    if (result.ronic.suppressed) {
      expect(result.ronic.state).toBe("INCOMPLETE");
    }
  });

  it("carries the lag-bias direction through unchanged (I13)", () => {
    const result = computeReinvestmentRonic(reinvestmentInput(), ronicInput({ lagBiasDirection: "generous" }));
    expect(result.lagBiasDirection).toBe("generous");
  });
});

describe("computeReinvestmentRonic — CAPITAL-LIGHT", () => {
  it("fires CAPITAL-LIGHT and expresses working-capital intensity when RONIC exceeds 60%", () => {
    const result = computeReinvestmentRonic(
      reinvestmentInput({ deltaNwc: sourced(2), deltaRevenue: sourced(20) }),
      ronicInput({ fiveYearDeltaNopat: sourced(65), fiveYearDeltaInvestedCapital: sourced(100) })
    );
    expect(result.capitalLight).toBe(true);
    expect(result.workingCapitalIntensity?.toString()).toBe("0.1");
  });

  it("does not fire CAPITAL-LIGHT for an ordinary sub-60% RONIC", () => {
    const result = computeReinvestmentRonic(reinvestmentInput(), ronicInput());
    expect(result.capitalLight).toBe(false);
    expect(result.workingCapitalIntensity).toBeNull();
  });

  it("fires CAPITAL-LIGHT even when RONIC is also capped at 200% — independent of the ladder", () => {
    const result = computeReinvestmentRonic(
      reinvestmentInput(),
      ronicInput({ fiveYearDeltaNopat: sourced(250), fiveYearDeltaInvestedCapital: sourced(100) })
    );
    expect(result.capitalLight).toBe(true);
  });
});
