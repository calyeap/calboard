import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeReverseDcfGrid, type ReverseDcfInput } from "./reverseDcf";
import type { DiscountRate } from "../types";

// INDEPENDENT VERIFICATION — deliberately does not import
// projectReverseDcfValue, growthAt, or buildFixedShapeGrowthPath from the
// production module or growthPath.ts. Every equation below is re-typed
// from the written timing equations (this session's own reinvestment-
// timing correction) into fresh code, so that agreement with the
// production module's output is evidence the PRODUCTION CODE correctly
// implements those equations — not a tautology from calling the same
// function twice.
//
// This file answers ONE question: does `computeReverseDcfGrid` correctly
// realise the stated formulas, for the stated fixture inputs? It does NOT
// answer whether those formulas or fixture inputs describe the real
// Microsoft — that is reverseDcf.test.ts's GOLDEN block, which compares
// against the ORIGINAL (partially hash-verified, partially user-supplied)
// reference numbers with a wide, approximate tolerance. Conflating the two
// claims is exactly what this file exists to avoid.

const PROVENANCE = {
  sourceClass: "PRIMARY" as const,
  extractionType: "DETERMINISTIC/STRUCTURED" as const,
  verificationState: "VERIFIED" as const,
};

function sourced(value: number) {
  return { value: new Decimal(value), provenance: PROVENANCE };
}

// --- independent re-implementation of the timing equations ----------------

const TERMINAL_GROWTH = new Decimal("0.03"); // §7.1: terminal growth, fixed at 3.0%
const TERMINAL_ROIC_PREMIUM = new Decimal("0.03"); // §7.1 / I16: terminal ROIC = r + 3pp

function independentGrowthAt(t: number, constantGrowth: Decimal): Decimal {
  if (t <= 5) return constantGrowth;
  if (t <= 10) return constantGrowth.minus(constantGrowth.minus(TERMINAL_GROWTH).mul(t - 5).dividedBy(5));
  return TERMINAL_GROWTH;
}

interface IndependentProjection {
  ev: Decimal;
  year10Revenue: Decimal;
  tenYearCagr: Decimal;
  terminalSharePct: Decimal;
}

// Revenue_t = Revenue_(t-1) * (1 + g_t)
// NOPAT_t = Revenue_t * margin * (1 - tax)
// Reinvestment_t = NOPAT_t * g_(t+1) / RONIC   [g_11 = terminal growth]
// FCFF_t = NOPAT_t - Reinvestment_t
// NOPAT_11 = NOPAT_10 * (1 + g_terminal)
// Terminal FCFF_11 = NOPAT_11 * (1 - g_terminal / terminalROIC)
// terminalROIC = r + 3pp
// TV_10 = Terminal FCFF_11 / (r - g_terminal), discounted from year 10 normally
function independentProject(
  growth: Decimal,
  margin: Decimal,
  ronic: Decimal,
  rate: Decimal,
  baseRevenue: Decimal,
  taxRate: Decimal
): IndependentProjection {
  const afterTax = new Decimal(1).minus(taxRate);
  const discountBase = new Decimal(1).plus(rate);

  const revenues: Decimal[] = [baseRevenue];
  for (let t = 1; t <= 10; t++) {
    revenues.push(revenues[t - 1].mul(new Decimal(1).plus(independentGrowthAt(t, growth))));
  }

  let pv = new Decimal(0);
  for (let t = 1; t <= 10; t++) {
    const nopat = revenues[t].mul(margin).mul(afterTax);
    const nextGrowth = independentGrowthAt(t + 1, growth); // t=10 -> g_11 = terminal growth
    const reinvestment = nopat.mul(nextGrowth).dividedBy(ronic);
    const fcff = nopat.minus(reinvestment);
    pv = pv.plus(fcff.dividedBy(discountBase.pow(t)));
  }

  const year10Revenue = revenues[10];
  const nopat10 = year10Revenue.mul(margin).mul(afterTax);
  const nopat11 = nopat10.mul(new Decimal(1).plus(TERMINAL_GROWTH));
  const terminalRoic = rate.plus(TERMINAL_ROIC_PREMIUM);
  const terminalFcff11 = nopat11.mul(new Decimal(1).minus(TERMINAL_GROWTH.dividedBy(terminalRoic)));
  const tv10 = terminalFcff11.dividedBy(rate.minus(TERMINAL_GROWTH));
  const terminalPv = tv10.dividedBy(discountBase.pow(10));

  const ev = pv.plus(terminalPv);
  const tenYearCagr = year10Revenue.dividedBy(baseRevenue).pow(new Decimal(1).dividedBy(10)).minus(1);
  const terminalSharePct = terminalPv.dividedBy(ev).mul(100);

  return { ev, year10Revenue, tenYearCagr, terminalSharePct };
}

// Independent bisection — its own loop, its own bracket handling, not a
// call into reverseDcf.ts's solveImpliedGrowth.
function independentSolve(
  margin: Decimal,
  ronic: Decimal,
  rate: Decimal,
  baseRevenue: Decimal,
  taxRate: Decimal,
  targetEv: Decimal
): { growth: Decimal; projection: IndependentProjection } {
  let lo = new Decimal("-0.5");
  let hi = new Decimal("1");
  const evAtLo = independentProject(lo, margin, ronic, rate, baseRevenue, taxRate).ev;
  const increasing = evAtLo.lessThan(targetEv);

  for (let i = 0; i < 80; i++) {
    const mid = lo.plus(hi.minus(lo).dividedBy(2));
    const evAtMid = independentProject(mid, margin, ronic, rate, baseRevenue, taxRate).ev;
    const midBelowTarget = evAtMid.lessThan(targetEv);
    if (increasing ? midBelowTarget : !midBelowTarget) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const growth = lo.plus(hi).dividedBy(2);
  return { growth, projection: independentProject(growth, margin, ronic, rate, baseRevenue, taxRate) };
}

// --- fixture (user-supplied inputs, unchanged from the golden test) -------

const price = new Decimal("510.12");
const shares = new Decimal("7.4255");
const bridge = new Decimal("6.3");
const targetEnterpriseValue = shares.mul(price).plus(bridge);
const baseRevenue = new Decimal(332);
const ronic = new Decimal("0.178");
const taxRate = new Decimal("0.2");

const marginByLevel: Record<string, Decimal> = {
  current: new Decimal("0.468"),
  median: new Decimal("0.418"),
  stress: new Decimal("0.38"),
};

const msftInput: ReverseDcfInput = {
  baseYearRevenue: sourced(332),
  targetEnterpriseValue: { value: targetEnterpriseValue, provenance: PROVENANCE },
  currentMargin: sourced(0.468),
  medianMargin: sourced(0.418),
  gate1State: null,
  ronicCells: ([0.08, 0.1, 0.12] as DiscountRate[]).map((rate) => ({ rate, state: "CLEAN" as const, value: ronic })),
  lagBiasDirection: "conservative",
  configuredStressMarginLevel: new Decimal("0.38"),
  configuredNopatTaxRate: taxRate,
};

const productionCells = computeReverseDcfGrid(msftInput);

function productionCellFor(marginLevel: string, rate: number) {
  return productionCells.find((c) => c.marginLevel === marginLevel && c.rate === rate)!;
}

// Tight tolerance: this compares two independently-coded implementations
// of the SAME stated equations, both converged by 80-iteration bisection
// over the same bracket — any real disagreement beyond numerical noise
// indicates an actual implementation bug, not a modelling or reference-
// data question. This is NOT the ±0.15-point historical-reproduction
// tolerance in reverseDcf.test.ts's GOLDEN block.
const IMPLEMENTATION_TOLERANCE = 0.001; // 0.001 percentage points

function closeTo(actual: Decimal, expected: Decimal, tolerance: number) {
  expect(actual.minus(expected).abs().toNumber()).toBeLessThan(tolerance);
}

describe("M7 independent implementation-correctness check (not a historical-reproduction check)", () => {
  const solvableCells: [string, DiscountRate][] = [
    ["current", 0.08],
    ["current", 0.1],
    ["median", 0.08],
    ["median", 0.1],
    ["stress", 0.08],
  ];

  it.each(solvableCells)(
    "%s margin @ r=%s: production's solved growth independently reproduces target EV, CAGR and year-10 revenue",
    (marginLevel, rate) => {
      const margin = marginByLevel[marginLevel];
      const independent = independentSolve(margin, ronic, new Decimal(rate), baseRevenue, taxRate, targetEnterpriseValue);

      // The independent solver itself must actually hit the target — a
      // sanity check on the independent code, not on production.
      closeTo(independent.projection.ev, targetEnterpriseValue, 0.5);

      const productionCell = productionCellFor(marginLevel, rate);
      expect(productionCell.fiveYearGrowth.suppressed).toBe(false);
      if (productionCell.fiveYearGrowth.suppressed) return;

      // Production's own solved growth, fed through the INDEPENDENT
      // projection, must reproduce the INDEPENDENT target-EV solve and
      // the independently-computed CAGR/revenue at that growth rate.
      const atProductionsGrowth = independentProject(
        productionCell.fiveYearGrowth.value,
        margin,
        ronic,
        new Decimal(rate),
        baseRevenue,
        taxRate
      );
      closeTo(atProductionsGrowth.ev, targetEnterpriseValue, 0.5);

      closeTo(productionCell.fiveYearGrowth.value.mul(100), independent.growth.mul(100), IMPLEMENTATION_TOLERANCE);

      expect(productionCell.tenYearCagr.suppressed).toBe(false);
      if (productionCell.tenYearCagr.suppressed) return;
      closeTo(productionCell.tenYearCagr.value.mul(100), atProductionsGrowth.tenYearCagr.mul(100), IMPLEMENTATION_TOLERANCE);

      expect(productionCell.year10Revenue.suppressed).toBe(false);
      if (productionCell.year10Revenue.suppressed) return;
      closeTo(productionCell.year10Revenue.value, atProductionsGrowth.year10Revenue, 0.5);

      // Terminal share independently computed at production's growth must
      // be under 100% — consistent with production leaving this cell
      // unsuppressed.
      expect(atProductionsGrowth.terminalSharePct.lessThanOrEqualTo(100)).toBe(true);
    }
  );

  const degenerateCells: [string, DiscountRate][] = [
    ["current", 0.12],
    ["median", 0.12],
    ["stress", 0.1],
    ["stress", 0.12],
  ];

  it.each(degenerateCells)(
    "%s margin @ r=%s: production's DEGENERATE suppression is independently justified — solved growth implies terminal share over 100%%",
    (marginLevel, rate) => {
      const margin = marginByLevel[marginLevel];
      const independent = independentSolve(margin, ronic, new Decimal(rate), baseRevenue, taxRate, targetEnterpriseValue);

      // Independently confirm the target is actually reachable and the
      // resulting terminal share genuinely exceeds 100% — the suppression
      // is not merely trusted from production's own internal check.
      closeTo(independent.projection.ev, targetEnterpriseValue, 0.5);
      expect(independent.projection.terminalSharePct.greaterThan(100)).toBe(true);

      const productionCell = productionCellFor(marginLevel, rate);
      expect(productionCell.fiveYearGrowth.suppressed).toBe(true);
      if (!productionCell.fiveYearGrowth.suppressed) return;
      expect(productionCell.fiveYearGrowth.state).toBe("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE");

      // Cross-check the terminal-share percentage embedded in production's
      // cause string against the independently computed value.
      const match = productionCell.fiveYearGrowth.cause.match(/terminal share (\d+)%/);
      expect(match).not.toBeNull();
      const productionReportedPct = new Decimal(match![1]);
      closeTo(productionReportedPct, independent.projection.terminalSharePct, 1); // whole-percent formatting in the cause string
    }
  );

  it("confirms the full nine-cell suppression pattern independently: exactly five solved, four degenerate", () => {
    const solvedCount = solvableCells.filter(([m, r]) => !productionCellFor(m, r).fiveYearGrowth.suppressed).length;
    const degenerateCount = degenerateCells.filter(([m, r]) => {
      const cell = productionCellFor(m, r);
      return cell.fiveYearGrowth.suppressed && cell.fiveYearGrowth.state === "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE";
    }).length;
    expect(solvedCount).toBe(5);
    expect(degenerateCount).toBe(4);
  });
});
