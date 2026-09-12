import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { assembleAnalysisResult } from "./assemble";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import { computeUnitExitBreakEvenPrice } from "./modules/preRevenue";
import { windowMedian, windowRange, worstSingleYearDecline } from "./marginMath";
import { boundState, NOT_COMPUTED_BINDING } from "./notComputed";

function closeTo(actual: Decimal, expected: number, tolerance = 0.002) {
  expect(actual.minus(expected).abs().toNumber()).toBeLessThan(tolerance);
}

// ---------------------------------------------------------------------------
// Milestone 5 — Analysis Result assembly + MSFT/OKLO fixture validation.
//
// Validates the ASSEMBLY WIRING (gates -> M1-M16 -> AnalysisResult), reusing
// only already-accepted module functions, against the frozen, hash-verified
// design mocks (design2/mock-report-msft.html, mock-report-oklo.html — SHA-256
// 88b04457.../041c9935... per the "Foolproof" Notion record). See each
// fixture file's own header for exactly which figures are taken directly
// from the mocks vs. synthetically reconstructed to reproduce them, and
// where reproduction was not attempted (funding-stack dollar amounts).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CB-AUDIT-FIX-01B — outputs the schema types as a bare Decimal, and what
// assembly records when one was not computed. Each binds a §9.3 state to the
// output in `states.suppressing` (notComputed.ts) and carries no figure.
// ---------------------------------------------------------------------------

describe("assembleAnalysisResult — the rate at which the base case equals the price (G)", () => {
  it("binds INCOMPLETE, naming the missing revaluation, when no revaluation function was supplied — never 'no solution'", () => {
    expect(MSFT_FIXTURE.revalueBaseCaseAtRate).toBeNull();
    const result = assembleAnalysisResult(MSFT_FIXTURE);

    expect(result.scenarioOutputs.rateAtWhichBaseEqualsPrice).toBeNull();
    const bound = boundState(result.states, NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice);
    expect(bound?.state).toBe("INCOMPLETE");
    expect(bound?.cause).toMatch(/revaluation of the base case/);
  });

  it("binds NO SOLUTION IN RANGE, with the bracket searched, when a solver ran and found no root — distinguishable from not computed", () => {
    // The fixture's revaluation is a constant $31 against a $14.50 price, so
    // the bracket genuinely contains no root.
    const result = assembleAnalysisResult(OKLO_FIXTURE);

    expect(result.scenarioOutputs.rateAtWhichBaseEqualsPrice).toBeNull();
    const bound = boundState(result.states, NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice);
    expect(bound?.state).toBe("NO SOLUTION IN RANGE");
    expect(bound?.cause).toContain("1% to 50%");
  });

  it("writes no valuation figure into a bound cause — states reach the blind challenger (§8.5.1/§8.5.2)", () => {
    for (const fixture of [MSFT_FIXTURE, OKLO_FIXTURE]) {
      const result = assembleAnalysisResult(fixture);
      for (const binding of [NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice, NOT_COMPUTED_BINDING.rateSensitivity]) {
        expect(boundState(result.states, binding)?.cause).not.toMatch(/\$/);
      }
    }
  });

  it("binds nothing when the rate was solved", () => {
    const result = assembleAnalysisResult({
      ...MSFT_FIXTURE,
      revalueBaseCaseAtRate: (rate: Decimal) => MSFT_FIXTURE.price.value.mul(new Decimal("0.1").dividedBy(rate)),
    });
    expect(result.scenarioOutputs.rateAtWhichBaseEqualsPrice).not.toBeNull();
    expect(boundState(result.states, NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice)).toBeNull();
  });
});

describe("assembleAnalysisResult — ±1% rate sensitivity (M10) when it is not modelled", () => {
  it("binds INCOMPLETE naming the missing revaluation when no rate-sensitivity cells were supplied, and carries no number — not a zero", () => {
    expect(MSFT_FIXTURE.rateSensitivityCells).toBeNull();
    const result = assembleAnalysisResult(MSFT_FIXTURE);

    const bound = boundState(result.states, NOT_COMPUTED_BINDING.rateSensitivity);
    expect(bound?.state).toBe("INCOMPLETE");
    expect(bound?.cause).toMatch(/one point higher and one point lower/);
    expect(result.diagnostics.rateSensitivity.plusOnePoint.isFinite()).toBe(false);
    expect(result.diagnostics.rateSensitivity.minusOnePoint.isFinite()).toBe(false);
  });

  it("binds INCOMPLETE naming enterprise value when cells are supplied but enterprise value is INCOMPLETE — zero is never substituted for it", () => {
    const result = assembleAnalysisResult({
      ...MSFT_FIXTURE,
      enterpriseValue: { ...MSFT_FIXTURE.enterpriseValue, nonOperatingEquityInvestmentsAtBook: null },
      rateSensitivityCells: { plusOnePoint: new Decimal("0.05"), minusOnePoint: new Decimal("-0.05") },
    });

    expect(result.diagnostics.enterpriseValue.suppressed).toBe(true);
    const bound = boundState(result.states, NOT_COMPUTED_BINDING.rateSensitivity);
    expect(bound?.state).toBe("INCOMPLETE");
    expect(bound?.cause).toMatch(/enterprise value/);
    expect(result.diagnostics.rateSensitivity.plusOnePoint.isFinite()).toBe(false);
  });

  it("binds nothing when cells and enterprise value are both present", () => {
    const result = assembleAnalysisResult({
      ...MSFT_FIXTURE,
      rateSensitivityCells: { plusOnePoint: new Decimal("0.05"), minusOnePoint: new Decimal("-0.05") },
    });
    expect(boundState(result.states, NOT_COMPUTED_BINDING.rateSensitivity)).toBeNull();
    closeTo(result.diagnostics.rateSensitivity.plusOnePoint, 0.05, 1e-9);
  });
});

describe("assembleAnalysisResult — scenario drivers (F) nobody authored", () => {
  const unauthored = { revenueGrowthOrPath: null, operatingMargin: null, reinvestmentCapitalIntensity: null };
  const withoutDrivers = {
    ...OKLO_FIXTURE,
    scenarios: {
      bear: { ...OKLO_FIXTURE.scenarios.bear, ...unauthored },
      base: { ...OKLO_FIXTURE.scenarios.base, ...unauthored },
      bull: { ...OKLO_FIXTURE.scenarios.bull, ...unauthored },
    },
  };

  it("binds INCOMPLETE to each scenario whose drivers were not supplied, naming them, and carries no number for any", () => {
    const result = assembleAnalysisResult(withoutDrivers);
    for (const s of ["bear", "base", "bull"] as const) {
      const bound = boundState(result.states, NOT_COMPUTED_BINDING.scenarioDrivers(s));
      expect(bound?.state).toBe("INCOMPLETE");
      expect(bound?.cause).toMatch(/revenue growth, operating margin, reinvestment/);
      const d = result.scenarios[s];
      expect((d.revenueGrowthOrPath as Decimal).isFinite()).toBe(false);
      expect(d.operatingMargin.isFinite()).toBe(false);
      expect(d.reinvestmentCapitalIntensity.isFinite()).toBe(false);
      // The analyst's own written anchor still stands.
      expect(d.writtenAnchor).toBe(OKLO_FIXTURE.scenarios[s].writtenAnchor);
    }
  });

  it("binds nothing to a scenario whose drivers were all supplied", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    for (const s of ["bear", "base", "bull"] as const) {
      expect(boundState(result.states, NOT_COMPUTED_BINDING.scenarioDrivers(s))).toBeNull();
    }
  });
});

describe("assembleAnalysisResult — MSFT fixture", () => {
  const result = assembleAnalysisResult(MSFT_FIXTURE);

  it("margin-history series reproduces all four disclosed summary statistics exactly", () => {
    // Independent re-check of the fixture's own hand-solved series, before
    // trusting anything downstream of it.
    const margins = MSFT_FIXTURE.triggerMargins.yearlyOperatingMargins;
    expect(margins[margins.length - 1].toString()).toBe("0.468"); // current = max
    closeTo(windowRange(margins), 0.214, 0.0005);
    closeTo(windowMedian(margins), 0.418, 0.0005);
    closeTo(worstSingleYearDecline(margins), 0.041, 0.0005);
  });

  it("Gate 0 passes, Gate 1 shows ten filed years with no state, leverage passes at ~0.8%", () => {
    expect(result.gates.gate0.result).toBe("PASS");
    expect(result.gates.gate1.state).toBeNull();
    expect(result.gates.gate1.filedYearsCount).toBe(10);
    expect(result.gates.leverage.result).toBe("PASS");
    expect(result.gates.leverage.netDebtRatio).not.toBeNull();
    closeTo(result.gates.leverage.netDebtRatio!, 0.008, 0.001);
    expect(result.gates.leverage.operatingLeaseInclusiveMemo).not.toBeNull();
    closeTo(result.gates.leverage.operatingLeaseInclusiveMemo!, 0.0137, 0.001);
  });

  it("Trigger A fires (margin at historical high); Trigger B does not", () => {
    expect(result.gates.triggerA.fired).toBe(true);
    expect(result.gates.triggerB.fired).toBe(false);
  });

  it("M3 margin history reproduces current/range/median/worst-change exactly, over a ten-year window", () => {
    const mh = result.diagnostics.marginHistory;
    expect(mh.suppressed).toBe(false);
    if (mh.suppressed) return;
    expect(mh.value.windowYears).toBe(10);
    expect(mh.value.currentMargin.toString()).toBe("0.468");
    closeTo(mh.value.range, 0.214, 0.0005);
    closeTo(mh.value.median, 0.418, 0.0005);
    closeTo(mh.value.worstSingleYearChange, 0.041, 0.0005);
  });

  it("M5 RONIC ladder computes 17.8% five-year, CLEAN at all three policy rates, not capital-light", () => {
    const ronic = result.diagnostics.reinvestmentRonic;
    expect(ronic.ronic.suppressed).toBe(false);
    if (ronic.ronic.suppressed) return;
    for (const cell of ronic.ronic.value.cells) {
      expect(cell.state).toBe("CLEAN");
      closeTo(cell.value!, 0.178, 0.001);
    }
    expect(ronic.capitalLight).toBe(false);
  });

  it("M5 reinvestment reproduces the mock's 86% (lease-inclusive) and 66% (cash-only) split via NOPAT=$123B", () => {
    const ronic = result.diagnostics.reinvestmentRonic;
    expect(ronic.reinvestment.suppressed).toBe(false);
    if (ronic.reinvestment.suppressed) return;
    const nopat = new Decimal(123);
    closeTo(ronic.reinvestment.value.dividedBy(nopat), 0.86, 0.001);
    const cashOnly = ronic.reinvestment.value.minus("24.6");
    closeTo(cashOnly.dividedBy(nopat), 0.66, 0.001);
  });

  it("the ASSEMBLED result's diagnostics.impliedReturnOnNewCapital reproduces the mock's 20.9% (V4) — not computed-and-discarded, present in the actual AnalysisResult", () => {
    const diagnostic = result.diagnostics.impliedReturnOnNewCapital;
    expect(diagnostic.period).toBe("current fiscal year (year-over-year)");
    expect(diagnostic.value.suppressed).toBe(false);
    if (diagnostic.value.suppressed) return;
    closeTo(diagnostic.value.value, 0.209, 0.001);
  });

  it("M7 reverse-DCF grid: exactly 4 of 9 cells DEGENERATE, the current-margin/8% cell reproduces 18.5% growth / 13.7% ten-year CAGR", () => {
    const cells = result.priceImplied.reverseDcfGrid;
    expect(cells).toHaveLength(9);
    const degenerate = cells.filter((c) => c.fiveYearGrowth.suppressed && c.fiveYearGrowth.state === "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE");
    expect(degenerate).toHaveLength(4);

    const currentAt8 = cells.find((c) => c.marginLevel === "current" && c.rate === 0.08);
    expect(currentAt8?.fiveYearGrowth.suppressed).toBe(false);
    if (currentAt8 && !currentAt8.fiveYearGrowth.suppressed) closeTo(currentAt8.fiveYearGrowth.value, 0.185, 0.0015);
    if (currentAt8 && !currentAt8.tenYearCagr.suppressed) closeTo(currentAt8.tenYearCagr.value, 0.137, 0.0015);
  });

  it("M11 FCF yield + growth: PRECONDITION FAILED, matching the mock", () => {
    expect(result.diagnostics.fcfYieldGrowth.precondition).toBe("PRECONDITION FAILED");
    expect(result.diagnostics.fcfYieldGrowth.output).toBeNull();
  });

  it("M12 run rate: seasonality test PASSES and a run-rate is computed (base-year rule fires, both prior years below threshold)", () => {
    expect(result.diagnostics.runRate.seasonalityTestResult).toBe("PASS");
    expect(result.diagnostics.runRate.runRate).not.toBeNull();
  });

  it("M13 shape mismatch does not fire (no guided growth supplied)", () => {
    expect(result.diagnostics.shapeMismatch.fired).toBe(false);
  });

  it("profile is confirmed mature/profitable/stable-FCF, matching the mock", () => {
    expect(result.profile.confirmedOrOverridden).toBe("MATURE_PROFITABLE_STABLE_FCF");
    expect(result.profile.override).toBeNull();
  });

  it("states summary records MARGIN AT HISTORICAL HIGH as qualifying, and nothing suppresses the whole company", () => {
    expect(result.states.qualifying.some((q) => q.flag === "MARGIN AT HISTORICAL HIGH")).toBe(true);
    expect(result.states.suppressing.some((s) => s.appliesTo === "all valuation outputs")).toBe(false);
  });

  it("fair-value range takes the bear/base/bull 'range' shape (not pre-revenue-distribution), with the scenario-labels warning set (trigger A fired)", () => {
    expect(result.fairValueRange.kind).toBe("range");
    if (result.fairValueRange.kind === "range") expect(result.fairValueRange.scenarioLabelsWarning).toBe(true);
  });

  it("preRevenue is null for the mature-profitable profile", () => {
    expect(result.preRevenue).toBeNull();
  });

  it("policy echoes the same undefined-constant configuration used to drive this run", () => {
    expect(result.policy.undefinedConstants.nopatTaxRate?.toString()).toBe("0.2");
    expect(result.policy.undefinedConstants.stressMarginLevel?.toString()).toBe("0.38");
  });

  it("REGRESSION (B1) — the probability-weighted value is the equal-weighted average ($475), not the plain sum ($1425) of bear/base/bull, and falls inside the range", () => {
    const { bear, base, bull } = result.scenarioOutputs.values;
    expect(bear.toString()).toBe("265");
    expect(base.toString()).toBe("510");
    expect(bull.toString()).toBe("650");
    const weighted = result.scenarioOutputs.weightedDistribution;
    expect(weighted.toNumber()).toBeCloseTo(475, 5);
    expect(weighted.greaterThanOrEqualTo(bear)).toBe(true);
    expect(weighted.lessThanOrEqualTo(bull)).toBe(true);
  });

  it("REGRESSION (B1) — priceLocationWithinRange is unaffected by the weighting fix (still derived from bear/bull/price alone)", () => {
    expect(result.scenarioOutputs.priceLocationWithinRange.mul(100).toFixed(0)).toBe("64");
  });
});

describe("assembleAnalysisResult — OKLO fixture", () => {
  const result = assembleAnalysisResult(OKLO_FIXTURE);

  it("Gate 1 returns HISTORY INSUFFICIENT at 3 filed years, matching the mock exactly", () => {
    expect(result.gates.gate1.state).toBe("HISTORY INSUFFICIENT");
    expect(result.gates.gate1.filedYearsCount).toBe(3);
  });

  it("company-level leverage precondition PASSES today, matching the mock", () => {
    expect(result.gates.leverage.result).toBe("PASS");
  });

  it("profile is confirmed pre-revenue/unprofitable, matching the mock", () => {
    expect(result.profile.confirmedOrOverridden).toBe("PRE_REVENUE_UNPROFITABLE");
  });

  it("multiples are all INCOMPLETE — none is meaningful pre-revenue, per §1's own 'do not use' list", () => {
    expect(result.diagnostics.multiples.peTrailing.suppressed).toBe(true);
    expect(result.diagnostics.multiples.evToEbit.suppressed).toBe(true);
    expect(result.diagnostics.multiples.priceToBook.suppressed).toBe(true);
  });

  it("diagnostics.impliedReturnOnNewCapital is present (never an absent field) and correctly INCOMPLETE — no per-unit NOPAT history pre-revenue", () => {
    const diagnostic = result.diagnostics.impliedReturnOnNewCapital;
    expect(diagnostic).toBeDefined();
    expect(diagnostic.period).toBe("current fiscal year (year-over-year)");
    expect(diagnostic.value.suppressed).toBe(true);
    if (diagnostic.value.suppressed) expect(diagnostic.value.state).toBe("INCOMPLETE");
  });

  it("the reverse-DCF grid is not run for this profile — all nine cells INCOMPLETE", () => {
    const cells = result.priceImplied.reverseDcfGrid;
    expect(cells).toHaveLength(9);
    expect(cells.every((c) => c.fiveYearGrowth.suppressed && c.fiveYearGrowth.state === "INCOMPLETE")).toBe(true);
  });

  it("preRevenue is populated, with all four funding-stack lines present on both ramps", () => {
    expect(result.preRevenue).not.toBeNull();
    if (!result.preRevenue) return;
    for (const ramp of ["back_loaded", "steady"] as const) {
      expect(result.preRevenue.fundingStackByYear[ramp].length).toBeGreaterThan(0);
      for (const year of result.preRevenue.fundingStackByYear[ramp]) {
        expect(year.lines.some((l) => l.line === "retained_operating_cash_flow")).toBe(true);
        expect(year.lines.some((l) => l.line === "project_debt")).toBe(true);
        expect(year.lines.some((l) => l.line === "customer_prepayments")).toBe(true);
        expect(year.lines.some((l) => l.line === "new_equity")).toBe(true);
      }
    }
  });

  it("implied probability: definitions 1 and 2 (V_success $0/$1 against $3.10) are THIS SUCCESS IS WORTH LESS THAN FAILURE, reproducing the mock exactly", () => {
    const rows = result.preRevenue!.successDefinitions;
    const def1 = rows.find((r) => r.definition.startsWith("Definition 1"));
    const def2 = rows.find((r) => r.definition.startsWith("Definition 2"));
    expect(def1?.state.kind).toBe("THIS SUCCESS IS WORTH LESS THAN FAILURE");
    expect(def2?.state.kind).toBe("THIS SUCCESS IS WORTH LESS THAN FAILURE");
  });

  it("implied probability: definitions 3 and 4 (V_success $31/$48 against $3.10, price $14.50) return real, distinct probabilities", () => {
    const rows = result.preRevenue!.successDefinitions;
    const def3 = rows.find((r) => r.definition.startsWith("Definition 3"));
    const def4 = rows.find((r) => r.definition.startsWith("Definition 4"));
    expect(def3?.state.kind).toBe("probability");
    expect(def4?.state.kind).toBe("probability");
    if (def3?.state.kind === "probability" && def4?.state.kind === "probability") {
      expect(def3.state.probability.toString()).not.toBe(def4.state.probability.toString());
    }
  });

  it("success-definition rows are sorted by V_success ascending (R5), not definition order", () => {
    const rows = result.preRevenue!.successDefinitions;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].vSuccess.greaterThanOrEqualTo(rows[i - 1].vSuccess)).toBe(true);
    }
  });

  it("fair-value range takes the pre-revenue-distribution shape, never compressed to bear/bull bounds", () => {
    expect(result.fairValueRange.kind).toBe("pre-revenue-distribution");
    if (result.fairValueRange.kind === "pre-revenue-distribution") {
      expect(result.fairValueRange.failure.toString()).toBe("3.1");
      expect(result.fairValueRange.cashFloor.toString()).toBe("3.1");
    }
  });

  it("REGRESSION — successAsCommonlyDescribed preserves BOTH $31 and $48 as a range, never silently collapsed to one value", () => {
    expect(result.fairValueRange.kind).toBe("pre-revenue-distribution");
    if (result.fairValueRange.kind !== "pre-revenue-distribution") return;
    expect(result.fairValueRange.successAsCommonlyDescribed.low.toString()).toBe("31");
    expect(result.fairValueRange.successAsCommonlyDescribed.high.toString()).toBe("48");
    // Definitions 1 and 2 ($0, $1) do not qualify (vSuccess <= vFail) and
    // must not pull either bound down.
    expect(result.fairValueRange.successAsCommonlyDescribed.low.toString()).not.toBe("0");
    expect(result.fairValueRange.successAsCommonlyDescribed.low.toString()).not.toBe("1");
  });

  it("unit-economics breakeven is computable at this fixture's illustrative capex/multiple assumptions, and sits above the methodology's own $110/MWh reference — reproducing its qualitative 'destroys value at this price' finding, not its exact number (see fixtures/oklo.ts's own header note)", () => {
    const result2 = computeUnitExitBreakEvenPrice(OKLO_FIXTURE.preRevenue!.unitEconomics);
    expect(result2.available).toBe(true);
    if (result2.available) {
      expect(result2.breakEvenOutputPrice.greaterThan(110)).toBe(true);
    }
  });

  it("REGRESSION (B1) — the probability-weighted value falls inside the bear-bull distribution, not their plain sum", () => {
    const { bear, base, bull } = result.scenarioOutputs.values;
    const weighted = result.scenarioOutputs.weightedDistribution;
    expect(weighted.greaterThanOrEqualTo(bear)).toBe(true);
    expect(weighted.lessThanOrEqualTo(bull)).toBe(true);
    expect(weighted.toString()).not.toBe(bear.plus(base).plus(bull).toString());
  });
});

// ---------------------------------------------------------------------------
// CB-H3-IMPLEMENT-01 — CalFinance Methodology v2's acquired-run cash basis
// and success-weight date-consistency ruling. Synthetic variants of the
// OKLO fixture, isolating each acceptance case at the assembly layer —
// acquiredRun.test.ts covers the same rulings end to end against real
// EDGAR facts.
// ---------------------------------------------------------------------------

describe("assembleAnalysisResult — H3 acquired-run cash basis", () => {
  const basePreRevenue = OKLO_FIXTURE.preRevenue!;

  it("an acquired cash basis that differs from the analyst fixture, on a comparable date, still interpolates — the boundary logic is not rewritten", () => {
    // Deliberately NOT $3.10/8 quarters/the fixture's own numbers — a
    // different acquired cash balance, on the SAME date as V_success
    // (the run's own price timestamp), so the two endpoints are comparable.
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: new Decimal("6.25"),
        cashPerShareAsOfDate: OKLO_FIXTURE.price.timestamp,
        quarterlyBurn: new Decimal("12"),
        quarterlyBurnAsOfDate: OKLO_FIXTURE.price.timestamp,
        runway: new Decimal("6.25").dividedBy(12),
      },
    };
    const r = assembleAnalysisResult(fixture);
    expect(r.preRevenue).not.toBeNull();
    const pr = r.preRevenue!;
    expect(pr.cashPerShare.toString()).toBe("6.25");
    for (const row of pr.successDefinitions) {
      expect(row.vFail.toString()).toBe("6.25");
      // Definitions 3/4 ($31/$48) still clear this new, different floor —
      // real, distinct probabilities, not the suppressed state.
      if (row.vSuccess.greaterThan("6.25")) {
        expect(row.state.kind).toBe("probability");
      }
    }
    expect(r.fairValueRange.kind).toBe("pre-revenue-distribution");
    if (r.fairValueRange.kind === "pre-revenue-distribution") {
      expect(r.fairValueRange.cashFloor.toString()).toBe("6.25");
    }
  });

  // H3 conformance correction — the exact defect this outcome corrects.
  // Assembly used to default every V_success date to the run's OWN price
  // timestamp (assemble.ts:633 at the merged head), so a later, unrelated
  // price quote silently redated an unchanged success valuation. A run's
  // success weight must depend only on what the fixture actually authored.
  it("a later price timestamp does not silently redate an unchanged success valuation — the weight is identical whichever quote the run carries", () => {
    const asOfEarlierQuote = assembleAnalysisResult(OKLO_FIXTURE);
    const asOfLaterQuote = assembleAnalysisResult({
      ...OKLO_FIXTURE,
      price: { value: OKLO_FIXTURE.price.value, timestamp: "2027-01-01T00:00:00-04:00" },
    });
    expect(asOfLaterQuote.preRevenue!.successDefinitions).toEqual(asOfEarlierQuote.preRevenue!.successDefinitions);
  });

  // When no per-definition date has been authored at all, the weight is
  // unavailable with cause — never computed against a manufactured date.
  it("suppresses the success weight, naming V_success's own missing date, when no per-definition valuation date has been authored", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        successDefinitions: basePreRevenue.successDefinitions.map((d) => ({ ...d, vSuccessAsOfDate: null })),
      },
    };
    const r = assembleAnalysisResult(fixture);
    for (const row of r.preRevenue!.successDefinitions) {
      expect(row.state.kind).toBe("NOT COMPUTED / SUPPRESSED");
      if (row.state.kind === "NOT COMPUTED / SUPPRESSED") {
        expect(row.state.cause).toMatch(/V_success/);
        expect(row.state.cause).toMatch(/not established/);
      }
      expect(row.vSuccessAsOfDate).toBeNull();
    }
  });

  // CB-H3-ARCH-01's comparable-basis evidence: a matching date alone does not
  // establish a comparable share/dilution basis, so a mismatch there must
  // suppress the weight even though the dates themselves line up.
  it("suppresses the success weight on a share/dilution basis mismatch, even though V_fail and V_success share the same valuation date", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: new Decimal("6.25"),
        cashPerShareAsOfDate: OKLO_FIXTURE.price.timestamp,
        successDefinitions: basePreRevenue.successDefinitions.map((d) => ({
          ...d,
          vSuccessAsOfDate: OKLO_FIXTURE.price.timestamp,
          vSuccessBasis: "fully diluted, including unexercised options",
        })),
      },
    };
    const r = assembleAnalysisResult(fixture);
    for (const row of r.preRevenue!.successDefinitions) {
      expect(row.state.kind).toBe("NOT COMPUTED / SUPPRESSED");
      if (row.state.kind === "NOT COMPUTED / SUPPRESSED") {
        expect(row.state.cause).toMatch(/not a comparable/);
      }
    }
  });

  // Missing basis evidence entirely (no date problem at all) must also
  // suppress — a date match is necessary but never sufficient.
  it("suppresses the success weight when no comparable-basis evidence has been authored, even with matching dates", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: new Decimal("6.25"),
        cashPerShareAsOfDate: OKLO_FIXTURE.price.timestamp,
        successDefinitions: basePreRevenue.successDefinitions.map((d) => ({
          ...d,
          vSuccessAsOfDate: OKLO_FIXTURE.price.timestamp,
          vSuccessBasis: null,
        })),
      },
    };
    const r = assembleAnalysisResult(fixture);
    for (const row of r.preRevenue!.successDefinitions) {
      expect(row.state.kind).toBe("NOT COMPUTED / SUPPRESSED");
      if (row.state.kind === "NOT COMPUTED / SUPPRESSED") {
        expect(row.state.cause).toMatch(/basis is not established/);
      }
    }
  });

  it("a cash/burn date mismatch does not rewrite the cash balance to today — runway still computes from the raw acquired figures, and each figure discloses its own real date", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: new Decimal("6.25"),
        cashPerShareAsOfDate: "2026-06-30",
        quarterlyBurn: new Decimal("12"),
        // A DIFFERENT date than the cash balance — the exact mismatch this
        // ruling addresses. Runway is still computed (it's allowed to use
        // "the latest available burn rate only as a clearly dated
        // estimate" regardless of alignment); only the success weight's
        // comparability rule cares about this mismatch.
        quarterlyBurnAsOfDate: "2026-03-31 to 2026-06-30",
        runway: new Decimal("6.25").dividedBy(12),
      },
    };
    const r = assembleAnalysisResult(fixture);
    const pr = r.preRevenue!;
    expect(pr.cashPerShareAsOfDate).toBe("2026-06-30");
    expect(pr.quarterlyBurnAsOfDate).toBe("2026-03-31 to 2026-06-30");
    expect(pr.runway.toString()).toBe(new Decimal("6.25").dividedBy(12).toString());
    // The cash figure is never silently reattributed to the burn's date.
    expect(pr.cashPerShareAsOfDate).not.toBe(pr.quarterlyBurnAsOfDate);
  });

  it("missing acquired cash and shares: cash per share, runway and the fair-value range are all correctly INCOMPLETE — never zero, never NaN rendered as a number, never the analyst fixture's placeholder", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: null,
        cashPerShareAsOfDate: null,
        cashPerShareCause: "missing REQUIRED input: acquired cash balance, shares outstanding used by the acquired run",
        runway: null,
        runwayCause: "missing REQUIRED input: acquired cash balance",
      },
    };
    const r = assembleAnalysisResult(fixture);
    const pr = r.preRevenue!;

    expect(pr.cashPerShare.isNaN()).toBe(true);
    expect(pr.cashPerShareAsOfDate).toBeNull();
    const cashState = boundState(r.states, NOT_COMPUTED_BINDING.cashPerShare);
    expect(cashState?.state).toBe("INCOMPLETE");
    expect(cashState?.cause).toMatch(/cash balance/);

    expect(pr.runway.isNaN()).toBe(true);
    expect(boundState(r.states, NOT_COMPUTED_BINDING.runway)?.state).toBe("INCOMPLETE");

    // cashPerShare is a REQUIRED input of the fair-value range itself — its
    // absence removes the range (never a NaN-valued cash floor).
    expect(r.fairValueRange.kind).toBe("suppressed");

    // vFail follows cashPerShare — never the fixture's placeholder $3.10 —
    // and every success definition is suppressed for the same reason, never
    // a computed weight built on an invented basis.
    for (const row of pr.successDefinitions) {
      expect(row.vFail.isNaN()).toBe(true);
      expect(row.vFail.toString()).not.toBe("3.1");
      expect(row.state.kind).toBe("NOT COMPUTED / SUPPRESSED");
    }
  });

  it("missing acquired quarterly burn alone: quarterly burn and runway are INCOMPLETE, but cash per share (independently established) still computes and the success weight is unaffected by the burn gap", () => {
    const fixture = {
      ...OKLO_FIXTURE,
      preRevenue: {
        ...basePreRevenue,
        cashPerShare: new Decimal("6.25"),
        cashPerShareAsOfDate: OKLO_FIXTURE.price.timestamp,
        quarterlyBurn: null,
        quarterlyBurnAsOfDate: null,
        quarterlyBurnCause: "missing REQUIRED input: acquired quarterly operating cash flow (burn)",
        runway: null,
        runwayCause: "missing REQUIRED input: acquired quarterly burn",
      },
    };
    const r = assembleAnalysisResult(fixture);
    const pr = r.preRevenue!;

    expect(pr.cashPerShare.toString()).toBe("6.25");
    expect(boundState(r.states, NOT_COMPUTED_BINDING.cashPerShare)).toBeNull();

    expect(pr.quarterlyBurn.isNaN()).toBe(true);
    expect(boundState(r.states, NOT_COMPUTED_BINDING.quarterlyBurn)?.state).toBe("INCOMPLETE");
    expect(pr.runway.isNaN()).toBe(true);
    expect(boundState(r.states, NOT_COMPUTED_BINDING.runway)?.state).toBe("INCOMPLETE");

    // The fair-value range is NOT an input the burn feeds — it survives.
    expect(r.fairValueRange.kind).toBe("pre-revenue-distribution");
  });
});
