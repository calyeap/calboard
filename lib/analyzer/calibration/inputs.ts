import Decimal from "decimal.js";
import { annualSeries, type AnnualSeries } from "../acquisition/history";
import { TAG_MAP } from "../acquisition/tagMap";
import type { CompanyFactsDocument } from "../acquisition/secClient";
import type { ReverseDcfCell } from "../types";

// ---------------------------------------------------------------------------
// M8-c — the two deterministic inputs behind the valuation position, computed
// as RAW VALUES on a company, or reported as blocked.
//
// §10.6.2 names exactly two inputs and this module computes exactly those two:
//
//   A. Price location within the scenario range     (§10.2 section G)
//   B. The required-versus-achieved growth gap      (M7's implied growth read
//      against the company's own achieved history on a consistent accounting
//      basis, §3.7)
//
// IT CLASSIFIES NOTHING. There is no band, no cut-point and no CHEAP / FAIR /
// EXPENSIVE anywhere in this file, deliberately: the classification is what
// thresholds produce, and the thresholds are Calvin's to rule. A future
// session adding a comparison operator here has moved the decision out of the
// ruling and into the code, which is the Appendix B failure repeating.
//
// It also never fills a missing input. Every "blocked" path below records WHY
// and returns nothing — a calibration observation invented to keep a company
// in the set is worth less than an honest gap, because the gap can be fixed
// and a fabricated observation silently cannot.
// ---------------------------------------------------------------------------

/** One input's outcome: a raw value, or the reasons there is none. */
export interface RawInput<T> {
  value: T | null;
  /** Ordered, most upstream first. Empty exactly when `value` is non-null. */
  blockedBy: string[];
}

function blocked<T>(...reasons: string[]): RawInput<T> {
  return { value: null, blockedBy: reasons };
}

function present<T>(value: T): RawInput<T> {
  return { value, blockedBy: [] };
}

// --- Input A — price location within the scenario range --------------------

export interface PriceLocationInputs {
  /** Step 7's three scenario values, per share. Null where no analyst has authored them. */
  scenarioValues: { bear: Decimal; base: Decimal; bull: Decimal } | null;
  currentPrice: Decimal | null;
  /**
   * §10.6.3 — the position renders only where a range exists. A suppressed
   * range yields NO price-location input, however arithmetically computable
   * `(price - bear) / (bull - bear)` happens to be from the raw scenario
   * numbers. Carrying the arithmetic past a suppressed range is how a figure
   * the run refused to publish gets calibrated on anyway.
   */
  rangeSuppressedBy: string | null;
}

/**
 * Price's position between the bottom and the top of the scenario range, as a
 * fraction. 0 is the bear value, 1 is the bull value; below 0 and above 1 are
 * real answers, not errors — a price above the top of the range is the case
 * §10.6 has no fixture for.
 */
export function priceLocationWithinRange(input: PriceLocationInputs): RawInput<Decimal> {
  const reasons: string[] = [];
  if (input.rangeSuppressedBy !== null) {
    reasons.push(`range suppressed - ${input.rangeSuppressedBy} (§10.6.3: no range, no position)`);
  }
  if (input.scenarioValues === null) {
    reasons.push("no Step 7 scenarios - the three scenario values are analyst input and were never acquired");
  }
  if (input.currentPrice === null) {
    reasons.push("no price");
  }
  if (reasons.length > 0) return blocked(...reasons);

  const { bear, bull } = input.scenarioValues as { bear: Decimal; base: Decimal; bull: Decimal };
  const span = bull.minus(bear);
  if (span.isZero()) {
    return blocked("scenario range has zero width - bear equals bull, so there is no location to be in");
  }
  return present((input.currentPrice as Decimal).minus(bear).dividedBy(span));
}

// --- Input B — the required-versus-achieved growth gap ---------------------

/**
 * The achieved side. §10.6.2's comparator rule is strict and is enforced here
 * rather than described: the achieved figure must be on the SAME SERIES and
 * the SAME HORIZON as the implied-growth figure it is read against, on one
 * accounting basis (§3.7). `annualSeries` already guarantees the single tag;
 * this function enforces the horizon and refuses to shorten it.
 */
export interface AchievedGrowth {
  /** The single tag every observation came from. Never mixed (§3.7). */
  tag: string;
  horizonYears: number;
  fromFiscalYear: number;
  toFiscalYear: number;
  fromValue: Decimal;
  toValue: Decimal;
  cagr: Decimal;
}

export function achievedRevenueCagr(
  series: AnnualSeries | null,
  horizonYears: number
): RawInput<AchievedGrowth> {
  if (series === null) {
    return blocked("no single-tag annual revenue series - §3.7 refuses a series assembled from more than one tag");
  }
  const observations = series.observations;
  // A CAGR over N years needs N+1 observations: the endpoints and the years
  // between them. Nine years of history does not produce a ten-year CAGR, and
  // silently returning the nine-year figure under a ten-year label is exactly
  // the horizon mismatch §10.6.2 refuses.
  if (observations.length < horizonYears + 1) {
    return blocked(
      `only ${observations.length} annual observations on ${series.tag}; a ${horizonYears}-year CAGR needs ${horizonYears + 1}`
    );
  }
  const to = observations[observations.length - 1];
  const from = observations[observations.length - 1 - horizonYears];

  const fromValue = new Decimal(from.value);
  const toValue = new Decimal(to.value);
  // A CAGR across a sign change or from a zero base is not a growth rate - it
  // is a number the formula still produces. Refused rather than reported.
  if (fromValue.lessThanOrEqualTo(0) || toValue.lessThanOrEqualTo(0)) {
    return blocked(
      `${series.tag} is non-positive at an endpoint (${from.fiscalYear}: ${from.value}, ${to.fiscalYear}: ${to.value}) - no CAGR exists`
    );
  }

  return present({
    tag: series.tag,
    horizonYears,
    fromFiscalYear: from.fiscalYear,
    toFiscalYear: to.fiscalYear,
    fromValue,
    toValue,
    cagr: toValue.dividedBy(fromValue).pow(new Decimal(1).dividedBy(horizonYears)).minus(1),
  });
}

/** One solved reverse-DCF cell's required growth, kept raw. */
export interface RequiredGrowthCell {
  marginLevel: string;
  rate: number;
  fiveYearGrowth: Decimal;
  tenYearCagr: Decimal;
}

/**
 * The required side, read off M7's grid.
 *
 * ALL NINE CELLS ARE RETURNED, unreduced. Which cell the position's "required"
 * figure comes from - which margin level, which discount rate - is NOT settled
 * by §10.6.2, which names "M7's implied growth" without choosing among the
 * nine. Picking one here would be making that ruling silently, so the harness
 * reports the whole grid and leaves the choice visible.
 */
export function requiredGrowthCells(grid: readonly ReverseDcfCell[]): RawInput<RequiredGrowthCell[]> {
  const solved: RequiredGrowthCell[] = [];
  const causes = new Set<string>();

  for (const cell of grid) {
    if (cell.fiveYearGrowth.suppressed) {
      causes.add(`${cell.fiveYearGrowth.state} - ${cell.fiveYearGrowth.cause}`);
      continue;
    }
    if (cell.tenYearCagr.suppressed) {
      causes.add(`${cell.tenYearCagr.state} - ${cell.tenYearCagr.cause}`);
      continue;
    }
    solved.push({
      marginLevel: cell.marginLevel,
      rate: cell.rate,
      fiveYearGrowth: cell.fiveYearGrowth.value,
      tenYearCagr: cell.tenYearCagr.value,
    });
  }

  if (solved.length === 0) {
    return blocked(...[...causes].map((c) => `all ${grid.length} reverse-DCF cells suppressed: ${c}`));
  }
  return present(solved);
}

/**
 * The gap itself, in growth points, on a matched horizon.
 *
 * Positive means the price requires MORE growth than the company has
 * delivered. Negative means it requires less. The sign convention is stated
 * because the action clause (§10.6.4) reads it aloud and a flipped sign would
 * invert the sentence without changing a number.
 */
export function gapPoints(requiredTenYearCagr: Decimal, achieved: AchievedGrowth): Decimal {
  return requiredTenYearCagr.minus(achieved.cagr);
}

// --- one company's whole observation ---------------------------------------

export interface CalibrationObservation {
  ticker: string;
  shape: string;
  priceLocation: RawInput<Decimal>;
  achievedTenYear: RawInput<AchievedGrowth>;
  achievedFiveYear: RawInput<AchievedGrowth>;
  required: RawInput<RequiredGrowthCell[]>;
  /** Usable only where BOTH §10.6.2 inputs are present. One is not enough. */
  usable: boolean;
}

export function isUsable(observation: Omit<CalibrationObservation, "usable">): boolean {
  return (
    observation.priceLocation.value !== null &&
    observation.required.value !== null &&
    observation.achievedTenYear.value !== null
  );
}

/** The revenue tag candidates the achieved series is read from - one place. */
export function revenueTagCandidates() {
  const entry = TAG_MAP.find((e) => e.factId === "current-revenue");
  if (entry === undefined) throw new Error("current-revenue is missing from the tag mapping");
  return entry.candidates;
}

export function revenueSeries(doc: CompanyFactsDocument): AnnualSeries | null {
  return annualSeries(doc, revenueTagCandidates());
}
