import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { roundScenarioValue, roundProbability, roundGrowthOrMargin } from "./rounding";

describe("roundScenarioValue", () => {
  it("rounds to the nearest $5 when 1% of price is smaller than $5", () => {
    // price $100 -> 1% = $1, so the $5 floor governs.
    const value = new Decimal("42.6");
    const price = new Decimal("100");
    expect(roundScenarioValue(value, price).toString()).toBe("45");
  });

  it("rounds to the nearest 1% of price when that step is larger than $5", () => {
    // price $2000 -> 1% = $20, so the step is $20, not $5.
    const value = new Decimal("311");
    const price = new Decimal("2000");
    expect(roundScenarioValue(value, price).toString()).toBe("320");
  });

  it("rounds half up at a $5-step boundary", () => {
    const value = new Decimal("47.5");
    const price = new Decimal("100");
    expect(roundScenarioValue(value, price).toString()).toBe("50");
  });
});

describe("roundProbability", () => {
  it("rounds to the nearest 5%", () => {
    expect(roundProbability(new Decimal("0.472")).toString()).toBe("0.45");
    expect(roundProbability(new Decimal("0.26")).toString()).toBe("0.25");
  });

  it("rounds half up at a 5% boundary", () => {
    // 0.475 / 0.05 = 9.5 exactly -> rounds up to 10 -> 0.5
    expect(roundProbability(new Decimal("0.475")).toString()).toBe("0.5");
  });

  it("handles the OKLO worth-less-than-failure boundary — 0% is a valid rounded probability", () => {
    expect(roundProbability(new Decimal("0.019")).toString()).toBe("0");
  });
});

describe("roundGrowthOrMargin", () => {
  it("rounds to the nearest 0.1 point (0.001 as a fraction)", () => {
    // 18.54% -> nearest 0.1pt is 18.5%
    expect(roundGrowthOrMargin(new Decimal("0.1854")).toString()).toBe("0.185");
  });

  it("rounds half up at a 0.1pt boundary", () => {
    // 13.75% is exactly halfway between 13.7% and 13.8% -> rounds up
    expect(roundGrowthOrMargin(new Decimal("0.1375")).toString()).toBe("0.138");
  });

  it("reproduces the Microsoft reference figures unchanged once already on-grid", () => {
    expect(roundGrowthOrMargin(new Decimal("0.185")).toString()).toBe("0.185");
    expect(roundGrowthOrMargin(new Decimal("0.137")).toString()).toBe("0.137");
    expect(roundGrowthOrMargin(new Decimal("0.209")).toString()).toBe("0.209");
  });
});
