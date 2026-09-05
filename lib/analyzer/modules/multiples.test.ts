import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeMultiples, computePeBasis, computeOwnHistoryPercentile, type MultiplesInput } from "./multiples";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function baseInput(overrides: Partial<MultiplesInput> = {}): MultiplesInput {
  return {
    price: sourced(50),
    epsTrailing: sourced(5),
    epsForward: sourced(6),
    enterpriseValue: sourced(1000),
    ebit: sourced(100),
    ebitda: sourced(120),
    cashFcf: sourced(60),
    marketCap: sourced(900),
    bookValue: sourced(20),
    revenue: sourced(500),
    impliedMarginForNormalMultiple: new Decimal("0.15"),
    peBasis: { gaapEps: sourced(5), nonOperatingItemPretax: null, preTaxIncome: sourced(150), taxRate: sourced(0.2) },
    ownHistoryCurrentValue: sourced(10),
    ownHistoryValues: [5, 6, 7, 8, 9, 11, 12, 13, 14, 15].map((v) => new Decimal(v)),
    gate1State: null,
    triggerBFired: false,
    ...overrides,
  };
}

describe("computeMultiples — simple ratios", () => {
  it("computes each multiple independently", () => {
    const result = computeMultiples(baseInput());
    expect(result.peTrailing.suppressed).toBe(false);
    if (!result.peTrailing.suppressed) expect(result.peTrailing.value.toString()).toBe("10");
    expect(result.evToEbit.suppressed).toBe(false);
    if (!result.evToEbit.suppressed) expect(result.evToEbit.value.toString()).toBe("10");
  });

  it("suppresses one multiple independently of the others when its own input is missing", () => {
    const result = computeMultiples(baseInput({ ebit: null }));
    expect(result.evToEbit.suppressed).toBe(true);
    expect(result.peTrailing.suppressed).toBe(false);
  });

  it("never surfaces EV/Revenue alone — always paired with the implied margin for a normal multiple", () => {
    const result = computeMultiples(baseInput());
    expect(result.evToRevenue.impliedMarginForNormalMultiple.toString()).toBe("0.15");
  });
});

describe("computePeBasis — I5 symmetric trigger", () => {
  it("does not fire when there is no material non-operating item", () => {
    const result = computePeBasis({ gaapEps: sourced(5), nonOperatingItemPretax: null, preTaxIncome: sourced(150), taxRate: sourced(0.2) });
    expect(result.nopatBasisShown).toBe(false);
    expect(result.nonOperatingItemAfterTax).toBeNull();
  });

  it("fires symmetrically on a large gain (not just a large loss)", () => {
    const result = computePeBasis({
      gaapEps: sourced(5),
      nonOperatingItemPretax: sourced(20), // 20/150 = 13.3% > 5%
      preTaxIncome: sourced(150),
      taxRate: sourced(0.2),
    });
    expect(result.nopatBasisShown).toBe(true);
    expect(result.nonOperatingItemAfterTax?.toString()).toBe("16"); // 20 * (1-0.2)
  });

  it("fires symmetrically on a large loss too — the corrected gains-only asymmetry", () => {
    const result = computePeBasis({
      gaapEps: sourced(5),
      nonOperatingItemPretax: sourced(-20),
      preTaxIncome: sourced(150),
      taxRate: sourced(0.2),
    });
    expect(result.nopatBasisShown).toBe(true);
  });

  it("does not fire at exactly the 5% threshold — the test is 'exceeds'", () => {
    const result = computePeBasis({ gaapEps: sourced(5), nonOperatingItemPretax: sourced(7.5), preTaxIncome: sourced(150), taxRate: sourced(0.2) });
    expect(result.nopatBasisShown).toBe(false);
  });
});

describe("computeOwnHistoryPercentile", () => {
  it("computes the fraction of historical values at or below the current one", () => {
    const result = computeOwnHistoryPercentile(
      sourced(10),
      [5, 6, 7, 8, 9, 11, 12, 13, 14, 15].map((v) => new Decimal(v)),
      null,
      false
    );
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) expect(result.value.toString()).toBe("0.5"); // 5 of 10 values <= 10
  });

  it("suppresses entirely under HISTORY INSUFFICIENT", () => {
    const result = computeOwnHistoryPercentile(sourced(10), [new Decimal(5)], "HISTORY INSUFFICIENT", false);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.state).toBe("HISTORY INSUFFICIENT");
  });

  it("attaches PEAK EARNINGS as a qualifying flag when trigger B fires — never suppresses", () => {
    const result = computeOwnHistoryPercentile(
      sourced(10),
      [5, 6, 7, 8, 9, 11, 12, 13, 14, 15].map((v) => new Decimal(v)),
      null,
      true
    );
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.qualification.analyticFlags).toContainEqual({ flag: "PEAK EARNINGS" });
    }
  });

  it("attaches SHORT HISTORY with the window length under SHORT HISTORY", () => {
    const result = computeOwnHistoryPercentile(sourced(10), [5, 6, 7].map((v) => new Decimal(v)), "SHORT HISTORY", false);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.qualification.analyticFlags).toContainEqual({ flag: "SHORT HISTORY", detail: "3-year window" });
    }
  });

  it("returns INCOMPLETE when the current value or historical window is missing", () => {
    expect(computeOwnHistoryPercentile(null, [new Decimal(5)], null, false).suppressed).toBe(true);
    expect(computeOwnHistoryPercentile(sourced(10), null, null, false).suppressed).toBe(true);
  });
});
