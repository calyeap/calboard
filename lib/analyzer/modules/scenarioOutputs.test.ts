import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeScenarioEnterpriseValue,
  computeScenarioOutputs,
  solveRateForTargetValue,
} from "./scenarioOutputs";
import { buildFixedShapeGrowthPath } from "../growthPath";
import { projectReverseDcfValue } from "./reverseDcf";

describe("computeScenarioEnterpriseValue", () => {
  it("throws when the growth path is not exactly ten years", () => {
    expect(() => computeScenarioEnterpriseValue(new Decimal(100), [new Decimal(0)], new Decimal("0.3"), new Decimal("0.1"), new Decimal("0.1"), new Decimal(0))).toThrow();
  });

  it("computes a flat-revenue scenario by hand: zero explicit-period FCF, value entirely from the discounted terminal value", () => {
    const flatPath = Array(10).fill(new Decimal(0));
    const margin = new Decimal("0.3");
    const capitalIntensity = new Decimal("0.3"); // equals margin -> FCF = NOPAT - reinvestment = 0 at 0% tax
    const rate = new Decimal("0.1");

    const ev = computeScenarioEnterpriseValue(new Decimal(100), flatPath, margin, capitalIntensity, rate, new Decimal(0));

    // Hand-computed: terminal NOPAT = 100*0.3*1.03 = 30.9; terminal ROIC =
    // 0.13; terminal FCF = 30.9*(1-0.03/0.13); TV_10 = that /(0.1-0.03);
    // discounted by 1.1^10.
    const terminalNopat = new Decimal(100).mul("0.3").mul(new Decimal(1).plus("0.03"));
    const terminalRoic = rate.plus("0.03");
    const terminalFcf = terminalNopat.mul(new Decimal(1).minus(new Decimal("0.03").dividedBy(terminalRoic)));
    const tv10 = terminalFcf.dividedBy(rate.minus("0.03"));
    const expected = tv10.dividedBy(new Decimal(1).plus(rate).pow(10));

    expect(ev.toDecimalPlaces(6).toString()).toBe(expected.toDecimalPlaces(6).toString());
  });

  it("accepts a broadcast constant or an explicit per-year path for margin and capital intensity equivalently", () => {
    const path = buildFixedShapeGrowthPath(new Decimal("0.15"));
    const constantEv = computeScenarioEnterpriseValue(new Decimal(100), path, new Decimal("0.3"), new Decimal("0.1"), new Decimal("0.1"), new Decimal(0));
    const arrayEv = computeScenarioEnterpriseValue(
      new Decimal(100),
      path,
      Array(10).fill(new Decimal("0.3")),
      Array(10).fill(new Decimal("0.1")),
      new Decimal("0.1"),
      new Decimal(0)
    );
    expect(constantEv.toString()).toBe(arrayEv.toString());
  });

  it("cross-checks against M7's reverse-DCF formula when capital intensity is set to reproduce the same g/RONIC reinvestment convention", () => {
    // Reproduce M7's reinvestment convention exactly: reinvestment_t =
    // NOPAT_t * g_(t+1)/RONIC, i.e. capitalIntensity_t = margin * afterTax
    // * g_(t+1)/RONIC. With the SAME growth path, margin, rate and tax,
    // computeScenarioEnterpriseValue should reproduce
    // projectReverseDcfValue's EV exactly.
    const growth = new Decimal("0.185");
    const margin = new Decimal("0.4");
    const ronic = new Decimal("0.3");
    const rate = new Decimal("0.1");
    const taxRate = new Decimal("0.2");
    const baseRevenue = new Decimal(100);

    const path = buildFixedShapeGrowthPath(growth);
    const afterTax = new Decimal(1).minus(taxRate);
    const capitalIntensityPath = path.map((_, i) => {
      const nextGrowth = i + 1 < 10 ? path[i + 1] : new Decimal("0.03"); // year 11 = terminal growth
      return margin.mul(afterTax).mul(nextGrowth).dividedBy(ronic);
    });

    const scenarioEv = computeScenarioEnterpriseValue(baseRevenue, path, margin, capitalIntensityPath, rate, taxRate);
    const reverseDcfEv = projectReverseDcfValue(growth, margin, ronic, rate, baseRevenue, taxRate).ev;

    expect(scenarioEv.toDecimalPlaces(6).toString()).toBe(reverseDcfEv.toDecimalPlaces(6).toString());
  });
});

describe("solveRateForTargetValue", () => {
  it("solves for the rate at which a decreasing revaluation function hits the target", () => {
    // Simple synthetic decreasing function: value(rate) = 1000 - rate*5000
    const revalue = (rate: Decimal) => new Decimal(1000).minus(rate.mul(5000));
    const solved = solveRateForTargetValue(revalue, new Decimal(500));
    // 1000 - rate*5000 = 500 -> rate = 0.1
    expect(solved?.toDecimalPlaces(3).toString()).toBe("0.1");
  });

  it("returns null when the target is unreachable within the search range", () => {
    const revalue = (rate: Decimal) => new Decimal(1000).minus(rate.mul(100));
    const solved = solveRateForTargetValue(revalue, new Decimal(-5000));
    expect(solved).toBeNull();
  });
});

describe("computeScenarioOutputs", () => {
  it("computes the probability-weighted distribution", () => {
    const result = computeScenarioOutputs({
      bearValue: new Decimal(50),
      baseValue: new Decimal(100),
      bullValue: new Decimal(200),
      weights: { bear: new Decimal("0.25"), base: new Decimal("0.5"), bull: new Decimal("0.25") },
      currentPrice: new Decimal(90),
      revalueBaseCaseAtRate: () => new Decimal(100),
    });
    // 50*0.25 + 100*0.5 + 200*0.25 = 12.5 + 50 + 50 = 112.5
    expect(result.weightedDistribution.toString()).toBe("112.5");
  });

  it("locates the current price within the bear-bull range as a 0-1 fraction", () => {
    const result = computeScenarioOutputs({
      bearValue: new Decimal(50),
      baseValue: new Decimal(100),
      bullValue: new Decimal(150),
      weights: { bear: new Decimal("0.25"), base: new Decimal("0.5"), bull: new Decimal("0.25") },
      currentPrice: new Decimal(100), // exact midpoint
      revalueBaseCaseAtRate: () => new Decimal(100),
    });
    expect(result.priceLocationWithinRange.toString()).toBe("0.5");
  });

  it("carries the three scenario values through unchanged", () => {
    const result = computeScenarioOutputs({
      bearValue: new Decimal(50),
      baseValue: new Decimal(100),
      bullValue: new Decimal(150),
      weights: { bear: new Decimal("0.25"), base: new Decimal("0.5"), bull: new Decimal("0.25") },
      currentPrice: new Decimal(100),
      revalueBaseCaseAtRate: () => new Decimal(100),
    });
    expect(result.values).toEqual({ bear: new Decimal(50), base: new Decimal(100), bull: new Decimal(150) });
  });

  it("always removes debt share from the sensitivity table (I10)", () => {
    const result = computeScenarioOutputs({
      bearValue: new Decimal(50),
      baseValue: new Decimal(100),
      bullValue: new Decimal(150),
      weights: { bear: new Decimal("0.25"), base: new Decimal("0.5"), bull: new Decimal("0.25") },
      currentPrice: new Decimal(100),
      revalueBaseCaseAtRate: () => new Decimal(100),
    });
    expect(result.sensitivity.debtShareRemoved).toBe(true);
  });
});
