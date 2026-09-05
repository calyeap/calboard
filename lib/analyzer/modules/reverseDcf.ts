import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { resolveMarginLevels } from "../marginLevels";
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
// VALUATION CONVENTION — a modeling decision, not pinned down letter-by-
// letter in the frozen spec, so it is recorded here rather than left
// implicit. The spec fixes the *concept* precisely (value-driver
// reinvestment via RONIC, Gordon-growth terminal value using terminal FCF
// = terminal NOPAT × (1 − g ÷ terminal ROIC), §7.2 M8) but not every
// time-indexing choice. This implementation uses the standard convention:
// FCF_t = NOPAT_t × (1 − g_t ÷ RONIC), where g_t is the growth rate
// realised IN year t (this year's reinvestment funds this year's own
// growth, the common simplification in this style of model). Reproducing
// the exact Microsoft/OKLO mock figures against this convention is a
// dedicated calibration task, not yet performed — this module is verified
// here against the spec's STRUCTURAL requirements (all three of five-year
// growth/ten-year CAGR/year-10 revenue always together, the three
// degenerate solver states, the RONIC NOT MEANINGFUL cascade, the
// undefined stress-margin-level gap), not against literal reproduction of
// the mocks' numbers.

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
}

export function computeReverseDcfGrid(input: ReverseDcfInput): ReverseDcfCell[] {
  const missingBase = [
    input.baseYearRevenue === null ? "baseYearRevenue" : null,
    input.targetEnterpriseValue === null ? "targetEnterpriseValue" : null,
    input.currentMargin === null ? "currentMargin" : null,
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
          input.lagBiasDirection
        )
      );
    }
  }
  return cells;
}

function buildMarginLevelList(input: ReverseDcfInput): { level: MarginLevel; value: Figure<Decimal> }[] {
  const current = (input.currentMargin as SourcedValue<Decimal>).value;
  const median = input.medianMargin?.value ?? current;
  const resolved = resolveMarginLevels(current, median, input.gate1State);
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
  lagBiasDirection: "conservative" | "generous"
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
    targetEnterpriseValue.value
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
  baseRevenue: Decimal
): ReverseDcfProjection {
  const terminalGrowth = POLICY.terminalGrowth;
  const discountFactorBase = new Decimal(1).plus(rate);

  let revenue = baseRevenue;
  let pvSum = new Decimal(0);

  for (let t = 1; t <= 10; t++) {
    const growthT = t <= 5 ? growth : growth.minus(growth.minus(terminalGrowth).mul(t - 5).dividedBy(5));
    revenue = revenue.mul(new Decimal(1).plus(growthT));
    const nopat = revenue.mul(margin);
    // Value-driver formula: reinvestment rate = this year's growth / RONIC.
    const fcf = nopat.mul(new Decimal(1).minus(growthT.dividedBy(ronic)));
    pvSum = pvSum.plus(fcf.dividedBy(discountFactorBase.pow(t)));
  }

  const year10Revenue = revenue;
  const terminalNopat = year10Revenue.mul(new Decimal(1).plus(terminalGrowth)).mul(margin);
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
  targetEnterpriseValue: Decimal
): SolveResult {
  const samples: Decimal[] = [];
  for (let i = 0; i <= MONOTONICITY_SAMPLE_COUNT; i++) {
    const g = GROWTH_SEARCH_LO.plus(
      GROWTH_SEARCH_HI.minus(GROWTH_SEARCH_LO).mul(i).dividedBy(MONOTONICITY_SAMPLE_COUNT)
    );
    samples.push(projectReverseDcfValue(g, margin, ronic, rate, baseRevenue).ev);
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
    const midDiff = projectReverseDcfValue(mid, margin, ronic, rate, baseRevenue).ev.minus(targetEnterpriseValue);
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
  const finalProjection = projectReverseDcfValue(solvedGrowth, margin, ronic, rate, baseRevenue);
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
