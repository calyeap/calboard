import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeReinvestmentRonic,
  computeImpliedReturnOnNewCapital,
  type ReinvestmentInput,
  type RonicInput,
  type ImpliedReturnOnNewCapitalInput,
} from "./reinvestmentRonic";
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

function impliedReturnInput(overrides: Partial<ImpliedReturnOnNewCapitalInput> = {}): ImpliedReturnOnNewCapitalInput {
  return {
    reinvestmentInput: reinvestmentInput(),
    currentNopat: sourced(1000),
    currentYearNopatGrowth: sourced(0.2),
    ...overrides,
  };
}

describe("computeImpliedReturnOnNewCapital", () => {
  it("computes implied return = growth ÷ (reinvestment ÷ NOPAT) with clean synthetic inputs", () => {
    // reinvestmentInput() sums to 40+5+24.6-20+5 = 54.6; rate = 54.6/1000 = 0.0546.
    // implied return = 0.2 / 0.0546 = 3.663003663...
    const result = computeImpliedReturnOnNewCapital(impliedReturnInput());
    expect(result.value.suppressed).toBe(false);
    if (!result.value.suppressed) {
      expect(result.value.value.toDecimalPlaces(6).toString()).toBe("3.663004");
    }
  });

  it("always carries the explicit single-year period label, distinguishing it from the five-year trailing RONIC ladder", () => {
    const result = computeImpliedReturnOnNewCapital(impliedReturnInput());
    expect(result.period).toBe("current fiscal year (year-over-year)");
    // Same label even when suppressed.
    const suppressedResult = computeImpliedReturnOnNewCapital(impliedReturnInput({ currentNopat: null }));
    expect(suppressedResult.period).toBe("current fiscal year (year-over-year)");
  });

  it("returns INCOMPLETE when current-year NOPAT is missing", () => {
    const result = computeImpliedReturnOnNewCapital(impliedReturnInput({ currentNopat: null }));
    expect(result.value.suppressed).toBe(true);
    if (result.value.suppressed) expect(result.value.state).toBe("INCOMPLETE");
  });

  it("returns INCOMPLETE when current-year NOPAT growth is missing", () => {
    const result = computeImpliedReturnOnNewCapital(impliedReturnInput({ currentYearNopatGrowth: null }));
    expect(result.value.suppressed).toBe(true);
    if (result.value.suppressed) expect(result.value.state).toBe("INCOMPLETE");
  });

  it("cascades reinvestment's own INCOMPLETE when finance-lease ROU additions are missing — §5.4's own worked example, reproduced by construction since this reuses computeReinvestment verbatim", () => {
    const result = computeImpliedReturnOnNewCapital(
      impliedReturnInput({ reinvestmentInput: reinvestmentInput({ financeLeaseRouAdditions: null }) })
    );
    expect(result.value.suppressed).toBe(true);
    if (result.value.suppressed) {
      expect(result.value.state).toBe("INCOMPLETE");
      expect(result.value.cause).toContain("financeLeaseRouAdditions");
    }
  });

  // CROSS-CONSISTENCY CHECK using only the four numbers already in the
  // hashed spec (§5.4, §11.4): 66% / 27.2% (cash-capex-only) and 86% /
  // 20.9% (lease-inclusive). Growth is back-solved independently from
  // EACH pair (growth = reinvestmentRate × impliedReturn) rather than
  // taken from any external "18%" figure, which does not appear in any
  // hashed artefact. The two back-solved growth figures — 17.952% and
  // 17.974% — agree to within 0.022 points, consistent with a single
  // underlying growth rate given the spec's own one-decimal rounding of
  // all four inputs. This proves the IDENTITY is self-consistent against
  // hash-verified numbers; it is not an independent reproduction of
  // 20.9% from a separately-disclosed growth figure, which no hashed
  // artefact supplies.
  it("the two independently back-solved FY26 growth figures (from the 66%/27.2% pair and the 86%/20.9% pair) agree to within the spec's own rounding precision", () => {
    const cashCapexOnlyRate = new Decimal("0.66");
    const cashCapexOnlyReturn = new Decimal("0.272");
    const leaseInclusiveRate = new Decimal("0.86");
    const leaseInclusiveReturn = new Decimal("0.209");

    const growthFromCashCapexOnly = cashCapexOnlyRate.mul(cashCapexOnlyReturn);
    const growthFromLeaseInclusive = leaseInclusiveRate.mul(leaseInclusiveReturn);

    expect(growthFromCashCapexOnly.toDecimalPlaces(5).toString()).toBe("0.17952");
    expect(growthFromLeaseInclusive.toDecimalPlaces(5).toString()).toBe("0.17974");
    expect(growthFromLeaseInclusive.minus(growthFromCashCapexOnly).abs().toNumber()).toBeLessThan(0.00025);
  });

  it("feeding either back-solved growth into the OTHER reinvestment measure reproduces the spec's stated implied return to within its own rounding", () => {
    // capex=660, no lease -> reinvestment=660, rate=0.66 (cash-capex-only)
    const cashCapexOnlyInput = impliedReturnInput({
      reinvestmentInput: {
        capex: sourced(660),
        acquisitions: sourced(0),
        financeLeaseRouAdditions: sourced(0),
        depreciationAndAmortization: sourced(0),
        deltaNwc: sourced(0),
        deltaRevenue: sourced(0),
      },
      currentNopat: sourced(1000),
      currentYearNopatGrowth: sourced(0.17974), // back-solved from the OTHER (lease-inclusive) pair
    });
    const cashCapexOnlyResult = computeImpliedReturnOnNewCapital(cashCapexOnlyInput);
    expect(cashCapexOnlyResult.value.suppressed).toBe(false);
    if (!cashCapexOnlyResult.value.suppressed) {
      // 0.17974 / 0.66 = 0.27233...; spec states 27.2% — within 0.1pt.
      expect(cashCapexOnlyResult.value.value.minus("0.272").abs().toNumber()).toBeLessThan(0.001);
    }

    // capex=660, lease ROU additions=200 -> reinvestment=860, rate=0.86 (lease-inclusive)
    const leaseInclusiveInput = impliedReturnInput({
      reinvestmentInput: {
        capex: sourced(660),
        acquisitions: sourced(0),
        financeLeaseRouAdditions: sourced(200),
        depreciationAndAmortization: sourced(0),
        deltaNwc: sourced(0),
        deltaRevenue: sourced(0),
      },
      currentNopat: sourced(1000),
      currentYearNopatGrowth: sourced(0.17952), // back-solved from the OTHER (cash-capex-only) pair
    });
    const leaseInclusiveResult = computeImpliedReturnOnNewCapital(leaseInclusiveInput);
    expect(leaseInclusiveResult.value.suppressed).toBe(false);
    if (!leaseInclusiveResult.value.suppressed) {
      // 0.17952 / 0.86 = 0.20874...; spec states 20.9% — within 0.1pt.
      expect(leaseInclusiveResult.value.value.minus("0.209").abs().toNumber()).toBeLessThan(0.001);
    }
  });
});
