import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { assembleAnalysisResult } from "./assemble";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import { computeUnitExitBreakEvenPrice } from "./modules/preRevenue";
import { windowMedian, windowRange, worstSingleYearDecline } from "./marginMath";

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
});
