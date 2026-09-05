import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  shouldDisplaySensitivityInput,
  buildSensitivityResult,
  computeTornadoRow,
  computeTornado,
  computeGrowthMarginTable,
  computeRateTerminalGrowthTable,
  TORNADO_DRIVERS,
  type AnalystSuppliedRange,
  type TornadoDriverConfig,
} from "./sensitivity";
import { computeScenarioEnterpriseValue } from "./scenarioOutputs";
import { projectReverseDcfValue } from "./reverseDcf";
import { buildFixedShapeGrowthPath } from "../growthPath";

describe("shouldDisplaySensitivityInput", () => {
  it("displays an input whose full-range impact is 10% or more", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("0.1"))).toBe(true);
    expect(shouldDisplaySensitivityInput(new Decimal("0.25"))).toBe(true);
  });

  it("suppresses an input whose full-range impact is below 10%", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("0.05"))).toBe(false);
  });

  it("uses the magnitude of impact regardless of direction", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("-0.15"))).toBe(true);
    expect(shouldDisplaySensitivityInput(new Decimal("-0.05"))).toBe(false);
  });
});

describe("buildSensitivityResult", () => {
  it("always records that debt share was removed from the table (I10)", () => {
    expect(buildSensitivityResult().debtShareRemoved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M14 — tornado and two-way tables. SYNTHETIC TEST FIXTURES throughout,
// clearly labelled as such (per the approved clarification's own
// instruction) — none of these numbers are real analyst assumptions.
// ---------------------------------------------------------------------------

// A clean, round base case for computeScenarioEnterpriseValue: base
// revenue 1000, flat 20% growth for all ten years, flat 30% margin, flat
// 10% capital intensity, 10% discount rate, 0% tax, 3% terminal growth
// (the policy default, passed explicitly here for clarity).
const BASE_REVENUE = new Decimal(1000);
const BASE_GROWTH = new Decimal("0.2");
const BASE_MARGIN = new Decimal("0.3");
const BASE_CAPITAL_INTENSITY = new Decimal("0.1");
const BASE_RATE = new Decimal("0.1");
const BASE_TAX = new Decimal(0);
const BASE_TERMINAL_GROWTH = new Decimal("0.03");
const BASE_RONIC = new Decimal("0.25");

function scenarioValueAt(growth: Decimal, margin: Decimal, rate: Decimal, terminalGrowth: Decimal): Decimal {
  const path = buildFixedShapeGrowthPath(growth);
  return computeScenarioEnterpriseValue(BASE_REVENUE, path, margin, BASE_CAPITAL_INTENSITY, rate, BASE_TAX, terminalGrowth);
}

const BASE_CASE_VALUE = scenarioValueAt(BASE_GROWTH, BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH);

function range(values: readonly [number, number, number], rationale: string): AnalystSuppliedRange {
  return { values: values.map((v) => new Decimal(v)) as unknown as readonly [Decimal, Decimal, Decimal], rationale };
}

describe("computeTornadoRow", () => {
  it("computes the growth row through computeScenarioEnterpriseValue with a coherent path per value", () => {
    const wideGrowthRange = range([0, 0.2, 0.6], "SYNTHETIC test fixture — wide growth swing");
    const result = computeTornadoRow(
      "growth",
      wideGrowthRange,
      BASE_CASE_VALUE,
      (g) => scenarioValueAt(g, BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH)
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    // Spot-check against a direct call — proves genuine reuse of the
    // existing model, not a reimplementation inside sensitivity.ts.
    expect(result.values[0].toString()).toBe(scenarioValueAt(new Decimal(0), BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH).toString());
    expect(result.values[2].toString()).toBe(scenarioValueAt(new Decimal("0.6"), BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH).toString());
    // A 0%-60% growth swing on a ten-year DCF is large — must display.
    expect(result.displayed).toBe(true);
  });

  it("computes the RONIC row through projectReverseDcfValue's given-growth (not solved-growth) mode", () => {
    const ronicRange = range([0.1, 0.25, 0.5], "SYNTHETIC test fixture — wide RONIC swing");
    const result = computeTornadoRow("ronic", ronicRange, BASE_CASE_VALUE, (r) =>
      projectReverseDcfValue(BASE_GROWTH, BASE_MARGIN, r, BASE_RATE, BASE_REVENUE, BASE_TAX).ev
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.values[0].toString()).toBe(
      projectReverseDcfValue(BASE_GROWTH, BASE_MARGIN, new Decimal("0.1"), BASE_RATE, BASE_REVENUE, BASE_TAX).ev.toString()
    );
  });

  it("is UNAVAILABLE, never 'immaterial', when no range is supplied", () => {
    const result = computeTornadoRow("operatingMargin", null, BASE_CASE_VALUE, (m) =>
      scenarioValueAt(BASE_GROWTH, m, BASE_RATE, BASE_TERMINAL_GROWTH)
    );
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.cause).toContain("operatingMargin");
    // Confirms these are structurally distinct outcomes, not overlapping
    // representations of the same thing.
    expect(result).not.toHaveProperty("displayed");
  });

  it("is UNAVAILABLE when a range is supplied without a recorded rationale", () => {
    const noRationale: AnalystSuppliedRange = { values: [new Decimal(0), new Decimal("0.1"), new Decimal("0.2")], rationale: "  " };
    const result = computeTornadoRow("growth", noRationale, BASE_CASE_VALUE, (g) =>
      scenarioValueAt(g, BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH)
    );
    expect(result.available).toBe(false);
    if (!result.available) expect(result.cause).toContain("rationale");
  });

  it("suppresses display (available, not shown) for a driver whose full-range swing is below 10%, distinct from UNAVAILABLE", () => {
    // A tiny, tight discount-rate range around the base case moves value
    // very little relative to a 10%+10bp-ish swing.
    const narrowRateRange = range([0.099, 0.1, 0.101], "SYNTHETIC test fixture — deliberately negligible swing");
    const result = computeTornadoRow("discountRate", narrowRateRange, BASE_CASE_VALUE, (r) =>
      scenarioValueAt(BASE_GROWTH, BASE_MARGIN, r, BASE_TERMINAL_GROWTH)
    );
    expect(result.available).toBe(true);
    if (result.available) expect(result.displayed).toBe(false);
  });
});

describe("computeTornado", () => {
  it("evaluates all five drivers in the fixed TORNADO_DRIVERS order, one row failing independently of the others", () => {
    const drivers: Record<(typeof TORNADO_DRIVERS)[number], TornadoDriverConfig> = {
      growth: {
        range: range([0, 0.2, 0.4], "SYNTHETIC fixture"),
        valuationFunction: (g) => scenarioValueAt(g, BASE_MARGIN, BASE_RATE, BASE_TERMINAL_GROWTH),
      },
      operatingMargin: {
        range: null, // deliberately missing
        valuationFunction: (m) => scenarioValueAt(BASE_GROWTH, m, BASE_RATE, BASE_TERMINAL_GROWTH),
      },
      discountRate: {
        range: range([0.08, 0.1, 0.12], "SYNTHETIC fixture"),
        valuationFunction: (r) => scenarioValueAt(BASE_GROWTH, BASE_MARGIN, r, BASE_TERMINAL_GROWTH),
      },
      terminalGrowth: {
        range: range([0.02, 0.03, 0.04], "SYNTHETIC fixture"),
        valuationFunction: (tg) => scenarioValueAt(BASE_GROWTH, BASE_MARGIN, BASE_RATE, tg),
      },
      ronic: {
        range: range([0.15, 0.25, 0.35], "SYNTHETIC fixture"),
        valuationFunction: (r) => projectReverseDcfValue(BASE_GROWTH, BASE_MARGIN, r, BASE_RATE, BASE_REVENUE, BASE_TAX).ev,
      },
    };

    const rows = computeTornado(BASE_CASE_VALUE, drivers);
    expect(rows.map((r) => r.driver)).toEqual(["growth", "operatingMargin", "discountRate", "terminalGrowth", "ronic"]);
    expect(rows[1].available).toBe(false); // operatingMargin, missing range
    expect(rows[0].available).toBe(true); // growth, unaffected by margin's gap
    expect(rows[4].available).toBe(true); // ronic, unaffected by margin's gap
  });
});

describe("computeGrowthMarginTable", () => {
  it("builds a 3x3 table by calling the existing forward-valuation model per cell, using a coherent path for each growth value", () => {
    const growthRange = range([0, 0.2, 0.4], "SYNTHETIC fixture — three growth points");
    const marginRange = range([0.2, 0.3, 0.4], "SYNTHETIC fixture — three margin points");

    const result = computeGrowthMarginTable(growthRange, marginRange, (g, m) =>
      scenarioValueAt(g, m, BASE_RATE, BASE_TERMINAL_GROWTH)
    );
    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.cells).toHaveLength(3);
    expect(result.cells[0]).toHaveLength(3);
    // Cell [1][1] (growth=0.2, margin=0.3) must equal the base case exactly.
    expect(result.cells[1][1].toString()).toBe(BASE_CASE_VALUE.toString());
    // Higher growth AND higher margin, holding rate/terminal growth fixed,
    // must produce a strictly higher value than the base cell.
    expect(result.cells[2][2].greaterThan(result.cells[1][1])).toBe(true);
  });

  it("is UNAVAILABLE when either axis's range is missing, never silently substituting a default", () => {
    const growthRange = range([0, 0.2, 0.4], "SYNTHETIC fixture");
    const missingMargin = computeGrowthMarginTable(growthRange, null, (g, m) => scenarioValueAt(g, m, BASE_RATE, BASE_TERMINAL_GROWTH));
    expect(missingMargin.available).toBe(false);
    if (!missingMargin.available) expect(missingMargin.cause).toContain("operatingMargin");

    const missingGrowth = computeGrowthMarginTable(null, range([0.2, 0.3, 0.4], "SYNTHETIC fixture"), (g, m) =>
      scenarioValueAt(g, m, BASE_RATE, BASE_TERMINAL_GROWTH)
    );
    expect(missingGrowth.available).toBe(false);
    if (!missingGrowth.available) expect(missingGrowth.cause).toContain("growth");
  });
});

describe("computeRateTerminalGrowthTable", () => {
  it("varies terminal growth through the existing model's new optional parameter, holding growth and margin fixed", () => {
    const rateRange = range([0.08, 0.1, 0.12], "SYNTHETIC fixture — three rate points");
    const terminalGrowthRange = range([0.02, 0.03, 0.04], "SYNTHETIC fixture — three terminal-growth points");

    const result = computeRateTerminalGrowthTable(rateRange, terminalGrowthRange, (r, tg) =>
      scenarioValueAt(BASE_GROWTH, BASE_MARGIN, r, tg)
    );
    expect(result.available).toBe(true);
    if (!result.available) return;

    // Middle cell (rate=0.1, terminalGrowth=0.03) is exactly the base case.
    expect(result.cells[1][1].toString()).toBe(BASE_CASE_VALUE.toString());
    // Holding rate fixed at the base 10%, a higher terminal growth (4%)
    // must be worth strictly more than a lower one (2%) — proves the new
    // parameter genuinely reaches the terminal-value formula, not just a
    // no-op default.
    const lowTerminal = scenarioValueAt(BASE_GROWTH, BASE_MARGIN, BASE_RATE, new Decimal("0.02"));
    const highTerminal = scenarioValueAt(BASE_GROWTH, BASE_MARGIN, BASE_RATE, new Decimal("0.04"));
    expect(highTerminal.greaterThan(lowTerminal)).toBe(true);
    expect(result.cells[1][0].toString()).toBe(lowTerminal.toString());
    expect(result.cells[1][2].toString()).toBe(highTerminal.toString());
  });

  it("passes an invalid rate <= terminal growth combination straight through, unclamped (per the frozen formula's own behaviour)", () => {
    // rate (3%) <= terminalGrowth (4%) makes the existing formula's
    // (rate - terminalGrowth) denominator non-positive, producing a
    // nonsensical (deeply negative) terminal value. This module adds no
    // guard for that — it is not this file's formula to alter — so the
    // cell must equal EXACTLY what a direct, unmediated call to the
    // underlying model produces, proving nothing here intercepts or
    // clamps it.
    const rateRange = range([0.03, 0.1, 0.12], "SYNTHETIC fixture — deliberately includes an invalid combination");
    const terminalGrowthRange = range([0.04, 0.03, 0.02], "SYNTHETIC fixture");

    const result = computeRateTerminalGrowthTable(rateRange, terminalGrowthRange, (r, tg) =>
      scenarioValueAt(BASE_GROWTH, BASE_MARGIN, r, tg)
    );
    expect(result.available).toBe(true);
    if (!result.available) return;

    const directCallSameInvalidCombination = scenarioValueAt(BASE_GROWTH, BASE_MARGIN, new Decimal("0.03"), new Decimal("0.04"));
    expect(result.cells[0][0].toString()).toBe(directCallSameInvalidCombination.toString());
    // Confirms this really is the pathological case, not an accidental
    // benign one — the terminal-value denominator is negative.
    expect(new Decimal("0.03").minus("0.04").isNegative()).toBe(true);
  });
});
