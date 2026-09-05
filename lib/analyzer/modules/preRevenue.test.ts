import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeUnitEconomicsBreakeven,
  computeFundingStackYearByYear,
  computeBothFundingRamps,
  computeImpliedProbability,
  computeUnitExitBreakEvenPrice,
  evaluateUnitExitEconomics,
  computeUnitExitEconomicsGrid,
  type FundingStackYearParams,
  type UnitExitEconomicsInput,
} from "./preRevenue";

// Independently verified timing cases (contribution=100, requiredReturn=
// 10%, capex=0 to isolate the raw discounted-perpetuity figure) — see
// preRevenue.ts's module-level comment for the term-by-term summation
// these were checked against:
//   lead 0: PV = 1100            (perpetuity DUE — first payment at the capex date itself)
//   lead 1: PV = 1000            (contribution/r's own natural valuation date)
//   lead 2: PV ≈ 909.090909      (one period discounted back from that)
function closeTo(actual: Decimal, expected: number, tolerance = 0.000001) {
  expect(actual.minus(expected).abs().toNumber()).toBeLessThan(tolerance);
}

describe("computeUnitEconomicsBreakeven", () => {
  it("lead=0: PV = 1100 — a perpetuity due, first payment AT the capex date", () => {
    const result = computeUnitEconomicsBreakeven(new Decimal(100), new Decimal(0), new Decimal(0), new Decimal("0.1"), 0);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) closeTo(result.value, 1100);
  });

  it("lead=1: PV = 1000 — exactly contribution/requiredReturn, with no further discounting needed", () => {
    const result = computeUnitEconomicsBreakeven(new Decimal(100), new Decimal(0), new Decimal(0), new Decimal("0.1"), 1);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) closeTo(result.value, 1000);
  });

  it("lead=2: PV ≈ 909.090909 — one further period discounted back from contribution/requiredReturn", () => {
    const result = computeUnitEconomicsBreakeven(new Decimal(100), new Decimal(0), new Decimal(0), new Decimal("0.1"), 2);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) closeTo(result.value, 909.090909);
  });

  it("returns NOT ACHIEVABLE AT ANY SCALE when a single unit destroys value even with zero lead, never a very large number", () => {
    // contribution = 10-9=1; PV at lead=0 (perpetuity due) = (1/0.1)*(1.1)^1 = 11; capex=20; 11 <= 20, destructive.
    const result = computeUnitEconomicsBreakeven(new Decimal(10), new Decimal(9), new Decimal(20), new Decimal("0.1"), 0);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.state).toBe("NOT ACHIEVABLE AT ANY SCALE");
  });

  it("returns INCOMPLETE when the required return is unconfigured", () => {
    const result = computeUnitEconomicsBreakeven(new Decimal(10), new Decimal(4), new Decimal(20), null, 2);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.state).toBe("INCOMPLETE");
  });

  // REGRESSION — distinguishes the incorrect (pre-fix) formula from the
  // corrected one. contribution=100, requiredReturn=10%, lead=2, capex=850:
  //   incorrect formula (exponent -leadYears):     PV ≈ 826.446281 <= 850 -> WRONGLY rejects the unit
  //   corrected formula (exponent -(leadYears-1)): PV ≈ 909.090909 >  850 -> correctly clears this check
  // This is the exact case that first exposed the off-by-one error via
  // independent term-by-term summation (see preRevenue.ts).
  it("distinguishes the incorrect exponent from the corrected one: capex=850, lead=2 — the old formula wrongly rejects, the corrected formula clears", () => {
    const revenuePerUnit = new Decimal(100);
    const operatingCostPerUnit = new Decimal(0);
    const capexPerUnit = new Decimal(850);
    const requiredReturn = new Decimal("0.1");

    const result = computeUnitEconomicsBreakeven(revenuePerUnit, operatingCostPerUnit, capexPerUnit, requiredReturn, 2);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) closeTo(result.value, 909.090909 - 850);
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

// APPROVED PROVISIONAL CLARIFICATION (Command Center ruling, 2026-09-05) —
// see preRevenue.ts's own doc comment above computeUnitExitBreakEvenPrice
// for the full definition, dates, and worked-example derivation these
// tests check against.
function baseExitInput(overrides: Partial<UnitExitEconomicsInput> = {}): UnitExitEconomicsInput {
  return {
    annualOutputPerUnit: new Decimal(10),
    operatingCostPerUnit: new Decimal(20),
    capexPerUnit: new Decimal(1000),
    exitValueToAnnualContributionMultiple: new Decimal(5),
    requiredReturn: new Decimal("0.1"),
    constructionLeadYears: 2,
    ...overrides,
  };
}

describe("computeUnitExitBreakEvenPrice", () => {
  it("solves the worked example: capex=1000, multiple=5, opCost=20/yr, output=10/yr, r=10%, lead=2 -> $26.20", () => {
    const result = computeUnitExitBreakEvenPrice(baseExitInput());
    expect(result.available).toBe(true);
    if (result.available) expect(result.breakEvenOutputPrice.toString()).toBe("26.2");
  });

  it("substitutes the solved price back and confirms exit value discounts to exactly capex", () => {
    const result = computeUnitExitBreakEvenPrice(baseExitInput());
    expect(result.available).toBe(true);
    if (!result.available) return;

    const annualContribution = result.breakEvenOutputPrice.mul(10).minus(20); // outputPrice*annualOutputPerUnit - operatingCostPerUnit
    expect(annualContribution.toString()).toBe("242");
    const exitValue = annualContribution.mul(5); // * exitValueToAnnualContributionMultiple
    expect(exitValue.toString()).toBe("1210");
    const pvAtCapexDate = exitValue.dividedBy(new Decimal("1.1").pow(2)); // discount lump sum back (1+r)^-lead
    expect(pvAtCapexDate.toString()).toBe("1000");
  });

  it("at zero construction lead, the discount factor is exactly 1 — no clamping, no special case", () => {
    // outputPrice = (1000*1.1^0/5 + 20)/10 = (200+20)/10 = 22
    const result = computeUnitExitBreakEvenPrice(baseExitInput({ constructionLeadYears: 0 }));
    expect(result.available).toBe(true);
    if (result.available) expect(result.breakEvenOutputPrice.toString()).toBe("22");
  });

  it("at nonzero lead the price rises to compensate for time value — lead=2 requires a higher breakeven price than lead=0", () => {
    const lead0 = computeUnitExitBreakEvenPrice(baseExitInput({ constructionLeadYears: 0 }));
    const lead2 = computeUnitExitBreakEvenPrice(baseExitInput({ constructionLeadYears: 2 }));
    expect(lead0.available).toBe(true);
    expect(lead2.available).toBe(true);
    if (lead0.available && lead2.available) {
      expect(lead2.breakEvenOutputPrice.greaterThan(lead0.breakEvenOutputPrice)).toBe(true);
    }
  });

  it("does NOT use the perpetuity's (-(lead-1)) exponent — lead=1 must differ from the old formula's zero-discount case", () => {
    // Old (superseded) formula treats lead=1 as needing no further discount
    // at all (exponent 0). The new lump-sum formula still discounts a
    // full period at lead=1: factor = 1.1^1, not 1.1^0.
    const lead1 = computeUnitExitBreakEvenPrice(baseExitInput({ constructionLeadYears: 1 }));
    expect(lead1.available).toBe(true);
    if (lead1.available) {
      // (1000*1.1^1/5 + 20)/10 = (220+20)/10 = 24
      expect(lead1.breakEvenOutputPrice.toString()).toBe("24");
    }
  });

  it("is unavailable (never a value) when any required input is missing", () => {
    for (const field of [
      "annualOutputPerUnit",
      "operatingCostPerUnit",
      "capexPerUnit",
      "exitValueToAnnualContributionMultiple",
      "requiredReturn",
    ] as const) {
      const result = computeUnitExitBreakEvenPrice(baseExitInput({ [field]: null }));
      expect(result.available).toBe(false);
      if (!result.available) expect(result.cause).toContain(field);
    }
  });

  it("is unavailable, not economically impossible, when annualOutputPerUnit is zero or negative", () => {
    const zero = computeUnitExitBreakEvenPrice(baseExitInput({ annualOutputPerUnit: new Decimal(0) }));
    const negative = computeUnitExitBreakEvenPrice(baseExitInput({ annualOutputPerUnit: new Decimal(-5) }));
    expect(zero.available).toBe(false);
    expect(negative.available).toBe(false);
    if (!zero.available) expect(zero.cause).toContain("annualOutputPerUnit");
    if (!negative.available) expect(negative.cause).toContain("annualOutputPerUnit");
  });

  it("is unavailable, not economically impossible, when the exit multiple is zero or negative", () => {
    const zero = computeUnitExitBreakEvenPrice(
      baseExitInput({ exitValueToAnnualContributionMultiple: new Decimal(0) })
    );
    const negative = computeUnitExitBreakEvenPrice(
      baseExitInput({ exitValueToAnnualContributionMultiple: new Decimal(-2) })
    );
    expect(zero.available).toBe(false);
    expect(negative.available).toBe(false);
    if (!zero.available) expect(zero.cause).toContain("exitValueToAnnualContributionMultiple");
    if (!negative.available) expect(negative.cause).toContain("exitValueToAnnualContributionMultiple");
  });
});

describe("evaluateUnitExitEconomics", () => {
  // Break-even at these inputs is $26.20 (verified above).
  it("returns BELOW BREAK-EVEN — GATE FAILS when the assumed price is below breakeven", () => {
    const result = evaluateUnitExitEconomics(baseExitInput(), new Decimal("26.19"));
    expect(result.kind).toBe("BELOW BREAK-EVEN — GATE FAILS");
  });

  it("returns AT BREAK-EVEN, not a failure, when the assumed price exactly equals breakeven", () => {
    const result = evaluateUnitExitEconomics(baseExitInput(), new Decimal("26.2"));
    expect(result.kind).toBe("AT BREAK-EVEN");
  });

  it("returns ABOVE BREAK-EVEN — GATE PASSES when the assumed price exceeds breakeven", () => {
    const result = evaluateUnitExitEconomics(baseExitInput(), new Decimal("26.21"));
    expect(result.kind).toBe("ABOVE BREAK-EVEN — GATE PASSES");
  });

  it("always exposes the solved breakeven price on every verdict, separately from the verdict itself", () => {
    const result = evaluateUnitExitEconomics(baseExitInput(), new Decimal("30"));
    expect(result.kind).toBe("ABOVE BREAK-EVEN — GATE PASSES");
    if (result.kind !== "UNAVAILABLE") expect(result.breakEvenOutputPrice.toString()).toBe("26.2");
  });

  it("is UNAVAILABLE, never a verdict, when the assumed output price itself is missing", () => {
    const result = evaluateUnitExitEconomics(baseExitInput(), null);
    expect(result.kind).toBe("UNAVAILABLE");
  });

  it("is UNAVAILABLE when the underlying breakeven solve is unavailable (missing input propagates)", () => {
    const result = evaluateUnitExitEconomics(baseExitInput({ requiredReturn: null }), new Decimal("30"));
    expect(result.kind).toBe("UNAVAILABLE");
    if (result.kind === "UNAVAILABLE") expect(result.cause).toContain("requiredReturn");
  });
});

describe("computeUnitExitEconomicsGrid", () => {
  it("produces mixed outcomes across cells, and a failing cell never suppresses a passing one", () => {
    // Cheap capex / rich multiple clears $28 easily; expensive capex / thin
    // multiple does not — both cells computed from the SAME assumed price.
    const cells = computeUnitExitEconomicsGrid({
      capexPerUnitGrid: [new Decimal(500), new Decimal(2000)],
      exitMultipleGrid: [new Decimal(8), new Decimal(2)],
      annualOutputPerUnit: new Decimal(10),
      operatingCostPerUnit: new Decimal(20),
      requiredReturn: new Decimal("0.1"),
      constructionLeadYears: 2,
      assumedOutputPrice: new Decimal(28),
    });

    expect(cells).toHaveLength(4);
    const cheapRich = cells.find((c) => c.capexPerUnit.equals(500) && c.exitValueToAnnualContributionMultiple.equals(8));
    const expensiveThin = cells.find(
      (c) => c.capexPerUnit.equals(2000) && c.exitValueToAnnualContributionMultiple.equals(2)
    );
    expect(cheapRich?.verdict.kind).toBe("ABOVE BREAK-EVEN — GATE PASSES");
    expect(expensiveThin?.verdict.kind).toBe("BELOW BREAK-EVEN — GATE FAILS");
    // The failing cell's presence has no bearing on the passing cell's kind.
    expect(cheapRich?.verdict.kind).not.toBe(expensiveThin?.verdict.kind);
  });

  it("each cell reports UNAVAILABLE independently when shared inputs are missing, never an impossibility verdict", () => {
    const cells = computeUnitExitEconomicsGrid({
      capexPerUnitGrid: [new Decimal(500)],
      exitMultipleGrid: [new Decimal(8)],
      annualOutputPerUnit: null,
      operatingCostPerUnit: new Decimal(20),
      requiredReturn: new Decimal("0.1"),
      constructionLeadYears: 2,
      assumedOutputPrice: new Decimal(28),
    });
    expect(cells).toHaveLength(1);
    expect(cells[0].verdict.kind).toBe("UNAVAILABLE");
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
