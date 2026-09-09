import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as calibrationScenarios from "./scenarios";
import {
  AUTHORED_SCENARIOS,
  MSFT_SCENARIOS,
  NVDA_SCENARIOS,
  OKLO_SCENARIOS,
  authoredScenariosFor,
  type AuthoredScenario,
} from "./scenarios";

// These tests exist to lock Calvin's approved numbers to the digit. He wrote
// them once; a later session must not round, "correct" or tidy any of them,
// and two of the three carry a driver that looks like a mistake and is not.

function mature(scenario: AuthoredScenario) {
  if (scenario.drivers.kind !== "mature") throw new Error("expected mature drivers");
  return scenario.drivers;
}

function pathOf(scenario: AuthoredScenario): string[] {
  const path = mature(scenario).revenueGrowthOrPath;
  if (!Array.isArray(path)) throw new Error("expected an explicit path");
  return path.map((p) => p.mul(100).toDecimalPlaces(4).toString());
}

function scalarOf(scenario: AuthoredScenario): string {
  const rate = mature(scenario).revenueGrowthOrPath;
  if (Array.isArray(rate)) throw new Error("expected a scalar rate");
  return rate.mul(100).toDecimalPlaces(4).toString();
}

describe("NVDA — the authored ten-year paths", () => {
  it("carries all three revenue paths exactly as authored", () => {
    expect(pathOf(NVDA_SCENARIOS.bear)).toEqual(["75", "10", "-12", "5", "6", "5", "4", "4", "3.5", "3"]);
    expect(pathOf(NVDA_SCENARIOS.base)).toEqual(["85", "25", "15", "10", "8", "7", "6", "5", "4", "3"]);
    expect(pathOf(NVDA_SCENARIOS.bull)).toEqual(["90", "35", "25", "18", "15", "12", "9", "7", "5", "3"]);
  });

  it("gives every path exactly ten years, which the valuation model requires", () => {
    // computeScenarioEnterpriseValue throws on any other length.
    for (const s of [NVDA_SCENARIOS.bear, NVDA_SCENARIOS.base, NVDA_SCENARIOS.bull]) {
      expect(pathOf(s)).toHaveLength(10);
    }
  });

  it("keeps the bear's revenue-decline year negative", () => {
    // Year 3 is -12%. It is deliberate: the bear carries BOTH margin
    // reversion and a revenue-decline year, per Trigger A and B. A later
    // session reading this as a sign error would remove the only
    // revenue-decline observation in the whole set.
    const bear = mature(NVDA_SCENARIOS.bear).revenueGrowthOrPath as Decimal[];
    expect(bear[2].isNegative()).toBe(true);
    expect(bear.filter((y) => y.isNegative())).toHaveLength(1);
  });

  it("carries margins and reinvestment as authored, and the same share count on all three", () => {
    expect(mature(NVDA_SCENARIOS.bear).operatingMargin.mul(100).toString()).toBe("50");
    expect(mature(NVDA_SCENARIOS.base).operatingMargin.mul(100).toString()).toBe("60");
    expect(mature(NVDA_SCENARIOS.bull).operatingMargin.mul(100).toString()).toBe("64");

    expect(mature(NVDA_SCENARIOS.bear).reinvestmentCapitalIntensity.mul(100).toString()).toBe("12");
    expect(mature(NVDA_SCENARIOS.base).reinvestmentCapitalIntensity.mul(100).toString()).toBe("17");
    expect(mature(NVDA_SCENARIOS.bull).reinvestmentCapitalIntensity.mul(100).toString()).toBe("22");

    for (const s of [NVDA_SCENARIOS.bear, NVDA_SCENARIOS.base, NVDA_SCENARIOS.bull]) {
      expect(s.shareCount.toString()).toBe("24.1");
    }
    expect(NVDA_SCENARIOS.shareCountUnit).toBe("billions");
  });
});

describe("MSFT — the bear reinvestment that must not be 'corrected'", () => {
  it("carries growth, margin and reinvestment exactly as authored", () => {
    expect(scalarOf(MSFT_SCENARIOS.bear)).toBe("10");
    expect(scalarOf(MSFT_SCENARIOS.base)).toBe("13.7");
    expect(scalarOf(MSFT_SCENARIOS.bull)).toBe("18.5");

    expect(mature(MSFT_SCENARIOS.bear).operatingMargin.mul(100).toString()).toBe("41.8");
    expect(mature(MSFT_SCENARIOS.base).operatingMargin.mul(100).toString()).toBe("46.8");
    expect(mature(MSFT_SCENARIOS.bull).operatingMargin.mul(100).toString()).toBe("46.8");
  });

  it("does NOT let bear reinvestment fall with the weaker outcome", () => {
    // The guard this file exists for. Calvin's anchor is that AI and
    // infrastructure spend remains necessary, so the bear reinvests at the
    // SAME rate as the base rather than a lower one. It reads like an
    // oversight and is not.
    const bear = mature(MSFT_SCENARIOS.bear).reinvestmentCapitalIntensity;
    const base = mature(MSFT_SCENARIOS.base).reinvestmentCapitalIntensity;
    const bull = mature(MSFT_SCENARIOS.bull).reinvestmentCapitalIntensity;

    expect(bear.equals(base)).toBe(true);
    expect(bear.mul(100).toString()).toBe("15");
    expect(bull.mul(100).toString()).toBe("20");
  });

  it("keeps the bear's written anchor, which is the reason for the above", () => {
    expect(MSFT_SCENARIOS.bear.writtenAnchor).toBe("AI and infrastructure spend remains necessary.");
  });
});

describe("OKLO — a pre-revenue shape, not a growth-and-margin one", () => {
  it("records all three cases as pre-revenue rather than as 0% growth", () => {
    // The validation fixture writes 0 into growth, margin and reinvestment
    // for its own reasons. Repeating that here would state a 0% growth
    // assumption Calvin did not make: these are pre-revenue economic cases,
    // NOT mature-company growth and margin.
    for (const s of [OKLO_SCENARIOS.bear, OKLO_SCENARIOS.base, OKLO_SCENARIOS.bull]) {
      expect(s.drivers.kind).toBe("pre-revenue");
    }
  });

  it("keeps share counts rising with success, and does not flatten them", () => {
    // Stronger deployment needs more funding, so the share count rises with
    // the better outcome. A later session "fixing" this to one flat count
    // would erase the dilution the cases are about.
    expect(OKLO_SCENARIOS.bear.shareCount.toString()).toBe("205");
    expect(OKLO_SCENARIOS.base.shareCount.toString()).toBe("250");
    expect(OKLO_SCENARIOS.bull.shareCount.toString()).toBe("275");
    expect(OKLO_SCENARIOS.shareCountUnit).toBe("millions");

    expect(OKLO_SCENARIOS.base.shareCount.greaterThan(OKLO_SCENARIOS.bear.shareCount)).toBe(true);
    expect(OKLO_SCENARIOS.bull.shareCount.greaterThan(OKLO_SCENARIOS.base.shareCount)).toBe(true);
  });

  it("carries each case's description verbatim", () => {
    expect(OKLO_SCENARIOS.bear.writtenAnchor).toBe("wind-down / cash-return");
    expect(OKLO_SCENARIOS.base.writtenAnchor).toBe("8 GW back-loaded reference");
    expect(OKLO_SCENARIOS.bull.writtenAnchor).toBe("8 GW steady ramp");
  });
});

describe("what was authored, and what was not", () => {
  it("has no scenario values on any company, with a recorded reason", () => {
    // Input A reads scenarioValues. None of the three has any: a scenario
    // value is the OUTPUT of valuing the drivers, and deriving it needs
    // §4.4's bridge, §7.1's NOPAT tax rate and a chosen discount rate, none
    // of which is settled. The frozen mocks' values belong to the mocks' own
    // drivers, which these revise.
    for (const set of AUTHORED_SCENARIOS) {
      expect(set.scenarioValues).toBeNull();
      expect(set.scenarioValuesUnavailable).not.toBeNull();
      expect(set.scenarioValuesUnavailable!.length).toBeGreaterThan(0);
    }
  });

  it("leaves an unauthored anchor null rather than paraphrasing one in", () => {
    // Calvin anchored NVDA's bear and MSFT's bear, and all three OKLO cases.
    // He anchored neither base nor bull on the two mature companies. An
    // invented sentence there would read as his.
    expect(NVDA_SCENARIOS.base.writtenAnchor).toBeNull();
    expect(NVDA_SCENARIOS.bull.writtenAnchor).toBeNull();
    expect(MSFT_SCENARIOS.base.writtenAnchor).toBeNull();
    expect(MSFT_SCENARIOS.bull.writtenAnchor).toBeNull();
  });

  it("looks up by ticker, case-insensitively, and returns null for anyone else", () => {
    expect(authoredScenariosFor("msft")).toBe(MSFT_SCENARIOS);
    expect(authoredScenariosFor("NVDA")).toBe(NVDA_SCENARIOS);
    expect(authoredScenariosFor("KO")).toBeNull();
  });
});

describe("what this module deliberately does not do", () => {
  it("exports no threshold, no band and no classifier", () => {
    // The same guard `inputs.ts` carries. Authored scenarios are evidence a
    // threshold could one day be ruled from; they are not the ruling, and a
    // cut-point appearing in this file would be the Appendix B failure
    // repeating with Calvin's name on it.
    const names = Object.keys(calibrationScenarios);
    expect(names.some((n) => /threshold|band|cutpoint|cutPoint|classify|cheap|expensive/i.test(n))).toBe(false);
  });
});
