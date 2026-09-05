import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { resolveMarginLevels } from "../marginLevels";
import { growthAt } from "../growthPath";
import { combineProvenance, CLEAN_PROVENANCE } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type {
  AnalyticFlagInstance,
  DiscountRate,
  Figure,
  Gate1Result,
  MarginLevel,
  ReverseDcfCell,
  RonicLadderState,
  SourcedValue,
} from "../types";

// M7 — the diagnostic reverse DCF (§7.2). The 8/10/12% grid × three margin
// levels, solving for the constant years-1–5 growth rate that makes the
// model's value equal today's actual enterprise value, under the fixed
// path shape (§7.1): constant growth 1–5, linear fade to 3% terminal
// growth by year 10, terminal thereafter.
//
// VALUATION CONVENTION — calibrated against the recovered frozen v1.0.1
// blocking-rerun reference grid (the Microsoft 3×3 case) and locked with
// golden tests in reverseDcf.test.ts. Two points that are NOT obvious from
// the spec's prose alone and must not be "corrected" back to the more
// common textbook form without re-breaking the calibration:
//
// 1. REINVESTMENT TIMING — next period's growth, not this period's own.
//    Reinvestment_t = NOPAT_t × g_(t+1) ÷ RONIC
//    FCFF_t         = NOPAT_t − Reinvestment_t
//    i.e. year t's cash flow funds year (t+1)'s growth. This is the
//    opposite of the more commonly seen "FCF_t = NOPAT_t × (1 − g_t ÷
//    RONIC)" convention (this year's own growth) — that version was tried
//    first here and did NOT reproduce the reference grid; the g_(t+1)
//    version reproduces all nine reference cells' growth rates, 10-year
//    CAGRs and terminal shares to the frozen rounding policy. For year 10
//    specifically, g_11 = terminal growth (3%) — the reinvestment that
//    funds the transition into the terminal period.
//
// 2. NOPAT TAX RATE — required, not optional, for this module specifically.
//    NOPAT_t = Revenue_t × margin × (1 − nopatTaxRate)
//    "margin" here is the same operating margin used throughout (Trigger
//    A/B, M3) — M7 is the one place that converts it to a forward NOPAT
//    projection, and that conversion needs §7.1's undefined "NOPAT tax
//    rate" policy constant. M5's and M6's NOPAT inputs are historical/
//    current facts supplied externally and never go through this
//    conversion, which is why they are unaffected by this constant. An
//    effective rate of 20% reproduces the reference grid (a plausible,
//    round figure — not confirmed as the frozen contract's literal
//    configured value, just what the recovered reference numbers are
//    consistent with). Terminal share is invariant to this rate (a
//    uniform NOPAT scaling cancels out of the terminal/explicit ratio),
//    but the *absolute* target EV a given growth rate reaches is not, so
//    getting the tax rate right matters for solving the correct growth
//    rate even though it would not matter for a terminal-share-only check.
//
// Terminal construction (unchanged from the original implementation, and
// was never the source of the earlier mismatch): terminal FCF = terminal
// NOPAT × (1 − terminal growth ÷ terminal ROIC), terminal ROIC = rate + 3pp
// (I16), discounted from year 10 (§7.2 M8).

// Calibration note: a wider bracket (explored up to +300%) crosses a real
// reinvestment-collapse region for ANY finite RONIC — once g exceeds RONIC
// by enough, reinvestment (g/RONIC × NOPAT) surpasses NOPAT itself and FCF
// goes deeply negative, eventually overwhelming any terminal value. That
// collapse is a genuine feature of the value-driver formula, not a bug,
// but checking monotonicity across the WHOLE bracket means a target
// solvable in a perfectly well-behaved region still gets flagged
// NOT COMPUTABLE if some far corner of a too-wide bracket happens to be
// unstable. Bounding the search to economically plausible five-year
// growth (-50% to +100%/year) keeps genuinely pathological
// RONIC-near-the-discount-rate cases correctly flagged while no longer
// penalising healthy companies for instability outside any realistic
// range. This bound is a calibration choice, revisited once real
// validation-case data is available to check it against.
const GROWTH_SEARCH_LO = new Decimal("-0.5");
const GROWTH_SEARCH_HI = new Decimal("1");
const MONOTONICITY_SAMPLE_COUNT = 20;
const BISECTION_ITERATIONS = 80;

export interface ReverseDcfInput {
  baseYearRevenue: SourcedValue<Decimal> | null;
  targetEnterpriseValue: SourcedValue<Decimal> | null;
  currentMargin: SourcedValue<Decimal> | null;
  medianMargin: SourcedValue<Decimal> | null;
  gate1State: Gate1Result["state"];
  // From M5 — one ladder cell per policy rate, shared across all three
  // margin-level rows at that rate (RONIC is a company-level figure, not
  // margin-level-dependent).
  ronicCells: { rate: DiscountRate; state: RonicLadderState; value: Decimal | null }[];
  lagBiasDirection: "conservative" | "generous";
  // §7.1's undefined "stress margin level" policy constant, threaded
  // through explicitly (UNDEFINED_POLICY_CONSTANTS.stressMarginLevel).
  // Defaults to null — an unconfigured run's "stress" cells stay
  // INCOMPLETE — but an acceptance fixture reproducing a validated
  // reference case (or a production run once Command Center configures
  // the constant) can supply a real value here.
  configuredStressMarginLevel?: Decimal | null;
  // §7.1's undefined "NOPAT tax rate" policy constant
  // (UNDEFINED_POLICY_CONSTANTS.nopatTaxRate). Required to convert this
  // module's projected operating margin into projected NOPAT — unlike the
  // stress margin level, this affects EVERY cell in the grid, not just one
  // row, so an unconfigured run (null, the default) returns INCOMPLETE on
  // all nine cells rather than a subset.
  configuredNopatTaxRate?: Decimal | null;
}

export function computeReverseDcfGrid(input: ReverseDcfInput): ReverseDcfCell[] {
  const nopatTaxRate = input.configuredNopatTaxRate ?? null;

  const missingBase = [
    input.baseYearRevenue === null ? "baseYearRevenue" : null,
    input.targetEnterpriseValue === null ? "targetEnterpriseValue" : null,
    input.currentMargin === null ? "currentMargin" : null,
    nopatTaxRate === null ? "nopatTaxRate (§7.1, unconfigured policy constant)" : null,
  ].filter((f): f is string => f !== null);

  const marginLevels: { level: MarginLevel; value: Figure<Decimal> }[] =
    missingBase.length > 0
      ? (["current", "median", "stress"] as const).map((level) => ({
          level,
          value: suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missingBase.join(", ")}`),
        }))
      : buildMarginLevelList(input);

  const cells: ReverseDcfCell[] = [];
  for (const { level, value: marginFigure } of marginLevels) {
    for (const rate of POLICY.rateGrid) {
      const rateLiteral = rate.toNumber() as DiscountRate;
      const ronicCell = input.ronicCells.find((c) => c.rate === rateLiteral);
      cells.push(
        computeSingleCell(
          level,
          rateLiteral,
          marginFigure,
          ronicCell ?? { rate: rateLiteral, state: "RONIC NOT MEANINGFUL", value: null },
          missingBase.length > 0 ? null : (input.baseYearRevenue as SourcedValue<Decimal>),
          missingBase.length > 0 ? null : (input.targetEnterpriseValue as SourcedValue<Decimal>),
          input.lagBiasDirection,
          nopatTaxRate as Decimal // guaranteed non-null when missingBase is empty
        )
      );
    }
  }
  return cells;
}

function buildMarginLevelList(input: ReverseDcfInput): { level: MarginLevel; value: Figure<Decimal> }[] {
  const current = (input.currentMargin as SourcedValue<Decimal>).value;
  const median = input.medianMargin?.value ?? current;
  const resolved = resolveMarginLevels(current, median, input.gate1State, input.configuredStressMarginLevel ?? null);
  return [
    { level: "current", value: computedValue(resolved.current, CLEAN_PROVENANCE) },
    { level: "median", value: computedValue(resolved.median, CLEAN_PROVENANCE) },
    { level: "stress", value: resolved.stress },
  ];
}

function computeSingleCell(
  marginLevel: MarginLevel,
  rate: DiscountRate,
  marginFigure: Figure<Decimal>,
  ronicCell: { rate: DiscountRate; state: RonicLadderState; value: Decimal | null },
  baseYearRevenue: SourcedValue<Decimal> | null,
  targetEnterpriseValue: SourcedValue<Decimal> | null,
  lagBiasDirection: "conservative" | "generous",
  // Guaranteed non-null whenever this branch is actually reached — the
  // caller sets every marginFigure to a suppressed INCOMPLETE (short-
  // circuiting before this value is ever read) when the tax rate itself
  // is unconfigured.
  nopatTaxRate: Decimal | null
): ReverseDcfCell {
  if (marginFigure.suppressed) {
    return {
      marginLevel,
      rate,
      fiveYearGrowth: marginFigure,
      tenYearCagr: marginFigure,
      year10Revenue: marginFigure,
      ronic: marginFigure,
      lagBiasDirection,
    };
  }

  if (ronicCell.state === "RONIC NOT MEANINGFUL" || ronicCell.value === null) {
    // §7.2 M5's own cascade: RONIC NOT MEANINGFUL → diagnostic reverse DCF
    // → NOT COMPUTABLE.
    const suppressed = suppressedValue("NOT COMPUTABLE", "RONIC not meaningful for this company (§7.2 M5 ladder)");
    return {
      marginLevel,
      rate,
      fiveYearGrowth: suppressed,
      tenYearCagr: suppressed,
      year10Revenue: suppressed,
      ronic: suppressedValue("RONIC NOT MEANINGFUL", "trailing five-year invested-capital or NOPAT change is non-positive"),
      lagBiasDirection,
    };
  }

  if (baseYearRevenue === null || targetEnterpriseValue === null) {
    const suppressed = suppressedValue("INCOMPLETE", "missing REQUIRED input(s): baseYearRevenue or targetEnterpriseValue");
    return {
      marginLevel,
      rate,
      fiveYearGrowth: suppressed,
      tenYearCagr: suppressed,
      year10Revenue: suppressed,
      ronic: suppressed,
      lagBiasDirection,
    };
  }

  const ronicValue = ronicCell.value;
  const ronicFlags = ladderFlags(ronicCell.state);
  const provenance = combineProvenance(marginFigure.qualification.provenanceTokens, baseYearRevenue.provenance, targetEnterpriseValue.provenance);

  const solveResult = solveImpliedGrowth(
    marginFigure.value,
    new Decimal(rate),
    ronicValue,
    baseYearRevenue.value,
    targetEnterpriseValue.value,
    nopatTaxRate as Decimal
  );

  if (solveResult.kind === "no-solution") {
    const cause = `bracket [${solveResult.lo.toFixed(2)}, ${solveResult.hi.toFixed(2)}], value at bracket ends: ${solveResult.evAtLo.toFixed(0)}, ${solveResult.evAtHi.toFixed(0)}`;
    const suppressed = suppressedValue("NO SOLUTION IN RANGE", cause);
    return {
      marginLevel,
      rate,
      fiveYearGrowth: suppressed,
      tenYearCagr: suppressed,
      year10Revenue: suppressed,
      ronic: computedValue(ronicValue, provenance, ronicFlags),
      lagBiasDirection,
    };
  }

  if (solveResult.kind === "not-monotone") {
    const suppressed = suppressedValue("NOT COMPUTABLE", "value function not monotone in growth across the bracket");
    return {
      marginLevel,
      rate,
      fiveYearGrowth: suppressed,
      tenYearCagr: suppressed,
      year10Revenue: suppressed,
      ronic: computedValue(ronicValue, provenance, ronicFlags),
      lagBiasDirection,
    };
  }

  if (solveResult.kind === "degenerate-terminal") {
    const suppressed = suppressedValue(
      "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE",
      `terminal share ${solveResult.terminalSharePercent.toFixed(0)}%`
    );
    return {
      marginLevel,
      rate,
      fiveYearGrowth: suppressed,
      tenYearCagr: suppressed,
      year10Revenue: suppressed,
      ronic: computedValue(ronicValue, provenance, ronicFlags),
      lagBiasDirection,
    };
  }

  return {
    marginLevel,
    rate,
    fiveYearGrowth: computedValue(solveResult.growth, provenance, ronicFlags),
    tenYearCagr: computedValue(solveResult.tenYearCagr, provenance),
    year10Revenue: computedValue(solveResult.year10Revenue, provenance),
    ronic: computedValue(ronicValue, provenance, ronicFlags),
    lagBiasDirection,
  };
}

function ladderFlags(state: RonicLadderState): AnalyticFlagInstance[] {
  if (state === "LOW RONIC — VALUE-DESTROYING GROWTH") return [{ flag: "LOW RONIC — VALUE-DESTROYING GROWTH" }];
  if (state === "RONIC CAPPED AT 200%") return [{ flag: "RONIC CAPPED AT 200%" }];
  return [];
}

// --- valuation and solver -------------------------------------------------

export interface ReverseDcfProjection {
  ev: Decimal;
  terminalValuePV: Decimal;
  tenYearCagr: Decimal;
  year10Revenue: Decimal;
}


// Exported for testing (round-trip solver verification: project at a known
// growth rate, feed its EV back in as the solver's target, confirm the
// solver recovers the same growth rate) and for a later "show calculation"
// disclosure that needs the same intermediate figures this module computes
// internally.
export function projectReverseDcfValue(
  growth: Decimal,
  margin: Decimal,
  ronic: Decimal,
  rate: Decimal,
  baseRevenue: Decimal,
  nopatTaxRate: Decimal
): ReverseDcfProjection {
  const terminalGrowth = POLICY.terminalGrowth;
  const discountFactorBase = new Decimal(1).plus(rate);
  const afterTax = new Decimal(1).minus(nopatTaxRate);

  const revenues: Decimal[] = [baseRevenue];
  let revenue = baseRevenue;
  for (let t = 1; t <= 10; t++) {
    revenue = revenue.mul(new Decimal(1).plus(growthAt(t, growth, terminalGrowth)));
    revenues.push(revenue);
  }

  let pvSum = new Decimal(0);
  for (let t = 1; t <= 10; t++) {
    const nopat = revenues[t].mul(margin).mul(afterTax);
    // Calibrated convention (see the module-level note above): year t's
    // cash flow funds year (t+1)'s growth — reinvestment is keyed to NEXT
    // period's growth rate, not this period's own. For t=10, g_11 is
    // terminal growth (3%).
    const nextGrowth = growthAt(t + 1, growth, terminalGrowth);
    const reinvestment = nopat.mul(nextGrowth).dividedBy(ronic);
    const fcff = nopat.minus(reinvestment);
    pvSum = pvSum.plus(fcff.dividedBy(discountFactorBase.pow(t)));
  }

  const year10Revenue = revenues[10];
  const nopat10 = year10Revenue.mul(margin).mul(afterTax);
  const terminalNopat = nopat10.mul(new Decimal(1).plus(terminalGrowth));
  const terminalRoic = rate.plus(POLICY.terminalRoicPremium);
  // §7.2 M8: terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC), never
  // final-year FCF × (1+g).
  const terminalFcf = terminalNopat.mul(new Decimal(1).minus(terminalGrowth.dividedBy(terminalRoic)));
  const terminalValueAtYear10 = terminalFcf.dividedBy(rate.minus(terminalGrowth));
  const terminalValuePV = terminalValueAtYear10.dividedBy(discountFactorBase.pow(10));

  const tenYearCagr = year10Revenue.dividedBy(baseRevenue).pow(new Decimal(1).dividedBy(10)).minus(1);

  return { ev: pvSum.plus(terminalValuePV), terminalValuePV, tenYearCagr, year10Revenue };
}

type SolveResult =
  | { kind: "solved"; growth: Decimal; tenYearCagr: Decimal; year10Revenue: Decimal }
  | { kind: "no-solution"; lo: Decimal; hi: Decimal; evAtLo: Decimal; evAtHi: Decimal }
  | { kind: "not-monotone" }
  | { kind: "degenerate-terminal"; terminalSharePercent: Decimal };

function solveImpliedGrowth(
  margin: Decimal,
  rate: Decimal,
  ronic: Decimal,
  baseRevenue: Decimal,
  targetEnterpriseValue: Decimal,
  nopatTaxRate: Decimal
): SolveResult {
  const samples: Decimal[] = [];
  for (let i = 0; i <= MONOTONICITY_SAMPLE_COUNT; i++) {
    const g = GROWTH_SEARCH_LO.plus(
      GROWTH_SEARCH_HI.minus(GROWTH_SEARCH_LO).mul(i).dividedBy(MONOTONICITY_SAMPLE_COUNT)
    );
    samples.push(projectReverseDcfValue(g, margin, ronic, rate, baseRevenue, nopatTaxRate).ev);
  }

  let increasing = true;
  let decreasing = true;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].lessThan(samples[i - 1])) increasing = false;
    if (samples[i].greaterThan(samples[i - 1])) decreasing = false;
  }

  if (!increasing && !decreasing) {
    return { kind: "not-monotone" };
  }

  const evAtLo = samples[0];
  const evAtHi = samples[samples.length - 1];
  const loDiff = evAtLo.minus(targetEnterpriseValue);
  const hiDiff = evAtHi.minus(targetEnterpriseValue);

  if (loDiff.mul(hiDiff).greaterThan(0)) {
    return { kind: "no-solution", lo: GROWTH_SEARCH_LO, hi: GROWTH_SEARCH_HI, evAtLo, evAtHi };
  }

  let lo = GROWTH_SEARCH_LO;
  let hi = GROWTH_SEARCH_HI;
  for (let iter = 0; iter < BISECTION_ITERATIONS; iter++) {
    const mid = lo.plus(hi.minus(lo).dividedBy(2));
    const midDiff = projectReverseDcfValue(mid, margin, ronic, rate, baseRevenue, nopatTaxRate).ev.minus(targetEnterpriseValue);
    const loBranchIsPositive = increasing ? loDiff.greaterThan(0) : loDiff.lessThan(0);
    const midIsSameSignAsLo = increasing
      ? (midDiff.greaterThan(0)) === loBranchIsPositive
      : (midDiff.lessThan(0)) === loBranchIsPositive;
    if (midIsSameSignAsLo) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const solvedGrowth = lo.plus(hi).dividedBy(2);
  const finalProjection = projectReverseDcfValue(solvedGrowth, margin, ronic, rate, baseRevenue, nopatTaxRate);
  const terminalSharePercent = finalProjection.terminalValuePV.dividedBy(finalProjection.ev).mul(100);

  if (terminalSharePercent.greaterThan(100)) {
    return { kind: "degenerate-terminal", terminalSharePercent };
  }

  return {
    kind: "solved",
    growth: solvedGrowth,
    tenYearCagr: finalProjection.tenYearCagr,
    year10Revenue: finalProjection.year10Revenue,
  };
}
