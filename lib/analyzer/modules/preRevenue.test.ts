import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeUnitEconomicsBreakeven,
  computeFundingStackYearByYear,
  computeBothFundingRamps,
  computeImpliedProbability,
  type FundingStackYearParams,
} from "./preRevenue";

describe("computeUnitEconomicsBreakeven", () => {
  it("computes the per-unit NPV at the capex date when contribution exceeds the required capital charge, with zero construction lead", () => {
    // At leadYears=0, this reproduces the original (pre-timing-correction)
    // arithmetic exactly: discount factor = (1+0.1)^0 = 1.
    // perpetuity = 6/0.1 = 60; NPV = 60 - 20 = 40.
    const result = computeUnitEconomicsBreakeven(new Decimal(10), new Decimal(4), new Decimal(20), new Decimal("0.1"), 0);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) expect(result.value.toString()).toBe("40");
  });

  it("returns NOT ACHIEVABLE AT ANY SCALE when a single unit destroys value even with zero lead, never a very large number", () => {
    // contribution = 10-9=1; perpetuity = 1/0.1=10; capex=20; 10 <= 20, destructive.
    const result = computeUnitEconomicsBreakeven(new Decimal(10), new Decimal(9), new Decimal(20), new Decimal("0.1"), 0);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.state).toBe("NOT ACHIEVABLE AT ANY SCALE");
  });

  it("returns INCOMPLETE when the required return is unconfigured", () => {
    const result = computeUnitEconomicsBreakeven(new Decimal(10), new Decimal(4), new Decimal(20), null, 2);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.state).toBe("INCOMPLETE");
  });

  // REGRESSION — the construction-timing fix. Chosen so the pre-correction
  // (lead=0) arithmetic PASSES and only accounting for the same
  // construction lead the funding stack already uses (lead=2, matching
  // §7.1's PROVISIONAL 2-year constant) FLIPS it to NOT ACHIEVABLE.
  //
  // revenuePerUnit=20, operatingCostPerUnit=2 -> contribution=18.
  // requiredReturn=0.15, capexPerUnit=100.
  //   lead=0: perpetuity = 18/0.15 = 120; NPV = 120-100 = 20 > 0 -> passes.
  //   lead=2: discount factor = 1.15^-2 ≈ 0.756144;
  //           perpetuity-at-capex-date = 120 * 0.756144 ≈ 90.737 <= 100
  //           -> NOT ACHIEVABLE.
  it("flips from achievable to NOT ACHIEVABLE once the existing construction delay is accounted for — same inputs, lead=0 vs lead=2", () => {
    const revenuePerUnit = new Decimal(20);
    const operatingCostPerUnit = new Decimal(2);
    const capexPerUnit = new Decimal(100);
    const requiredReturn = new Decimal("0.15");

    const withoutLead = computeUnitEconomicsBreakeven(revenuePerUnit, operatingCostPerUnit, capexPerUnit, requiredReturn, 0);
    expect(withoutLead.suppressed).toBe(false);
    if (!withoutLead.suppressed) expect(withoutLead.value.toString()).toBe("20");

    const withLead = computeUnitEconomicsBreakeven(revenuePerUnit, operatingCostPerUnit, capexPerUnit, requiredReturn, 2);
    expect(withLead.suppressed).toBe(true);
    if (withLead.suppressed) expect(withLead.state).toBe("NOT ACHIEVABLE AT ANY SCALE");
  });

  it("passing this check is a necessary screen, not proof of project viability — it says nothing about debt service, prepayments or dilution", () => {
    // No behavioural assertion here beyond what the two tests above already
    // cover — this test exists so the constraint is checked into the suite
    // as a named expectation, not only as a code comment. A computed
    // (non-suppressed) result from this function must not be read, by any
    // future caller, as "the project is viable."
    const result = computeUnitEconomicsBreakeven(new Decimal(20), new Decimal(2), new Decimal(100), new Decimal("0.15"), 0);
    expect(result.suppressed).toBe(false);
    // The function's return type carries no viability verdict — only a
    // per-unit NPV figure or a suppressing state. There is no field here
    // that could be mistaken for "project approved."
  });
});

function baseFundingParams(overrides: Partial<FundingStackYearParams> = {}): FundingStackYearParams {
  return {
    capacityAddedByYear: [new Decimal(0), new Decimal(10)],
    capexPerUnit: new Decimal(5),
    revenuePerUnitInService: new Decimal(2),
    operatingCostPerUnitInService: new Decimal("0.5"),
    corporateOverheadPerYear: new Decimal(1),
    projectDebtShareOfCapex: new Decimal("0.5"),
    projectDebtCost: new Decimal("0.1"),
    customerPrepaymentByYear: [new Decimal(0), new Decimal(0)],
    nopatTaxRate: new Decimal(0),
    constructionLeadYears: 1,
    ...overrides,
  };
}

describe("computeFundingStackYearByYear", () => {
  it("returns INCOMPLETE (no years) when the project-debt cost is unconfigured", () => {
    const result = computeFundingStackYearByYear(baseFundingParams({ projectDebtCost: null }));
    expect(result.years).toBeNull();
    expect(result.incompleteCause).toContain("projectDebtCost");
  });

  it("returns INCOMPLETE when the NOPAT tax rate is unconfigured", () => {
    const result = computeFundingStackYearByYear(baseFundingParams({ nopatTaxRate: null }));
    expect(result.years).toBeNull();
    expect(result.incompleteCause).toContain("nopatTaxRate");
  });

  it("solves a two-year stack by hand: capex leads capacity by the construction lead, equity fills the gap, debt draws proportionally", () => {
    const result = computeFundingStackYearByYear(baseFundingParams());
    expect(result.years).not.toBeNull();
    const years = result.years!;
    expect(years).toHaveLength(2);

    // Year 1: no capacity in service yet, but capex of 50 (10 units x $5)
    // is spent to fund year 2's arrival. Project debt draws 25 (50% of
    // capex). Retained OCF = (0 - overhead 1 - interest 0) = -1. Net =
    // -1 + 0 (prepayment) + 25 (debt) - 50 (capex) = -26 -> equity raises
    // exactly 26, cash balance ends at 0.
    const year1 = years[0];
    expect(year1.cashBalance.toString()).toBe("0");
    const year1Equity = year1.lines.find((l) => l.line === "new_equity");
    expect(year1Equity?.type).toBe("INFERENCE");
    if (year1Equity?.line === "new_equity") expect(year1Equity.amount.toString()).toBe("26");
    const year1Ocf = year1.lines.find((l) => l.line === "retained_operating_cash_flow");
    if (year1Ocf?.line === "retained_operating_cash_flow") expect(year1Ocf.amount.toString()).toBe("-1");

    // Year 2: 10 units now in service, contribution = 10*(2-0.5) = 15.
    // Interest on the $25 drawn debt = 2.5. Retained OCF = 15 - 1 - 2.5 =
    // 11.5. No capex this year (nothing scheduled 1 year further out), no
    // debt draw, no equity needed — cash balance ends at 11.5.
    const year2 = years[1];
    expect(year2.cashBalance.toString()).toBe("11.5");
    const year2Equity = year2.lines.find((l) => l.line === "new_equity");
    if (year2Equity?.line === "new_equity") expect(year2Equity.amount.toString()).toBe("0");
  });

  it("always includes the mandatory retained-operating-cash-flow line, every year (§7.2 M16 — was missing from the OKLO manual test)", () => {
    const result = computeFundingStackYearByYear(baseFundingParams());
    for (const year of result.years!) {
      expect(year.lines.some((l) => l.line === "retained_operating_cash_flow")).toBe(true);
    }
  });

  it("reports total dilution required as the sum of equity raised across all years", () => {
    const result = computeFundingStackYearByYear(baseFundingParams());
    expect(result.dilutionRequired?.toString()).toBe("26");
  });

  it("never raises equity in a year where cash balance stays non-negative without it", () => {
    // No capex at all -> nothing but positive operating contribution once
    // units are in service, no need for equity in year 2.
    const result = computeFundingStackYearByYear(
      baseFundingParams({ capacityAddedByYear: [new Decimal(10), new Decimal(0)], constructionLeadYears: 0 })
    );
    const year2 = result.years![1];
    const year2Equity = year2.lines.find((l) => l.line === "new_equity");
    if (year2Equity?.line === "new_equity") expect(year2Equity.amount.toString()).toBe("0");
  });
});

describe("computeBothFundingRamps", () => {
  it("returns both back-loaded and steady ramps, each independently solved", () => {
    const { back_loaded, steady } = computeBothFundingRamps(
      [new Decimal(0), new Decimal(10)],
      [new Decimal(5), new Decimal(5)],
      {
        capexPerUnit: new Decimal(5),
        revenuePerUnitInService: new Decimal(2),
        operatingCostPerUnitInService: new Decimal("0.5"),
        corporateOverheadPerYear: new Decimal(1),
        projectDebtShareOfCapex: new Decimal("0.5"),
        projectDebtCost: new Decimal("0.1"),
        customerPrepaymentByYear: [new Decimal(0), new Decimal(0)],
        nopatTaxRate: new Decimal(0),
        constructionLeadYears: 1,
      }
    );
    expect(back_loaded.years).not.toBeNull();
    expect(steady.years).not.toBeNull();
    // Different capacity schedules -> different dilution outcomes in general.
    expect(back_loaded.dilutionRequired?.toString()).not.toBe(steady.dilutionRequired?.toString());
  });
});

describe("computeImpliedProbability", () => {
  it("returns THIS SUCCESS IS WORTH LESS THAN FAILURE when V_success <= V_fail", () => {
    expect(computeImpliedProbability(new Decimal(1), new Decimal("3.1"), new Decimal(2))).toEqual({
      kind: "THIS SUCCESS IS WORTH LESS THAN FAILURE",
    });
    expect(computeImpliedProbability(new Decimal(0), new Decimal("3.1"), new Decimal(2))).toEqual({
      kind: "THIS SUCCESS IS WORTH LESS THAN FAILURE",
    });
  });

  it("returns PRICE NOT JUSTIFIABLE BY THIS OUTCOME when price >= V_success > V_fail", () => {
    const result = computeImpliedProbability(new Decimal(20), new Decimal(5), new Decimal(25));
    expect(result).toEqual({ kind: "PRICE NOT JUSTIFIABLE BY THIS OUTCOME" });
  });

  it("computes the implied probability, rounded to the nearest 5%, when V_fail < price < V_success", () => {
    // p = (15-5)/(20-5) = 10/15 = 0.6667 -> rounds to 0.65
    const result = computeImpliedProbability(new Decimal(20), new Decimal(5), new Decimal(15));
    expect(result.kind).toBe("probability");
    if (result.kind === "probability") expect(result.probability.toString()).toBe("0.65");
  });

  it("clamps to 0% at or below the V_fail boundary, rather than a negative probability", () => {
    const result = computeImpliedProbability(new Decimal(20), new Decimal(5), new Decimal(5));
    expect(result.kind).toBe("probability");
    if (result.kind === "probability") expect(result.probability.toString()).toBe("0");
  });

  it("reproduces the OKLO worth-less-than-failure shape: V_success $0 and $1 against V_fail $3.10", () => {
    const zeroCase = computeImpliedProbability(new Decimal(0), new Decimal("3.1"), new Decimal(2));
    const oneCase = computeImpliedProbability(new Decimal(1), new Decimal("3.1"), new Decimal(2));
    expect(zeroCase.kind).toBe("THIS SUCCESS IS WORTH LESS THAN FAILURE");
    expect(oneCase.kind).toBe("THIS SUCCESS IS WORTH LESS THAN FAILURE");
  });
});
