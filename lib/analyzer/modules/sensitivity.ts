import Decimal from "decimal.js";
import { POLICY } from "../policy";
import type { SensitivityResult } from "../types";

// M14 — sensitivity (§7.2). §7.2 M14 SPECIFIES: a one-at-a-time tornado;
// two two-way tables, and their axes ARE named explicitly — growth ×
// margin, and discount rate × terminal growth; the "coherent path, not
// spliced" constraint on each table's rows and columns; the >10%
// display-suppression rule; and I10's removal of debt share from the
// table entirely. Only the last two of those five are implemented here:
//
// 1. The >10% display-suppression rule: "an input whose full plausible
//    range moves value by less than ~10% is not displayed."
// 2. Debt share is removed from the sensitivity table entirely (I10) —
//    value-neutral by construction (MM without taxes or distress); this
//    module's result always records that removal rather than silently
//    omitting the input with no explanation.
//
// NOT implemented, and this is the actual (smaller) gap — not "the whole
// construction is unspecified": the one-at-a-time tornado, and both named
// two-way tables. What is genuinely undefined is narrower than the axes
// themselves — the numeric bounds/step count for each axis, and which
// specific inputs populate the tornado's rows, are not given anywhere in
// the frozen spec. `tornado`, `twoWayGrowthMargin` and
// `twoWayRateTerminalGrowth` are typed `unknown` in the schema (types.ts)
// for exactly this reason and are left as empty placeholders until that
// narrower gap (bounds, not axes) is specified.

export function shouldDisplaySensitivityInput(fullRangeValueImpact: Decimal): boolean {
  return fullRangeValueImpact.abs().greaterThanOrEqualTo(POLICY.sensitivityDisplayThreshold);
}

export function buildSensitivityResult(): SensitivityResult {
  return {
    tornado: [],
    twoWayGrowthMargin: [],
    twoWayRateTerminalGrowth: [],
    debtShareRemoved: true,
  };
}

// ---------------------------------------------------------------------------
// §7.2 M14 — tornado and two-way tables
// ---------------------------------------------------------------------------
//
// APPROVED CLARIFICATION (Command Center ruling, 2026-09-05).
//
// FIVE TORNADO DRIVERS (source-established: growth and margin already
// name the two-way table's own axes; discount rate and terminal growth
// name the other table's axes; RONIC is added as the tornado's fifth,
// one-at-a-time-only row — it has no two-way table of its own).
//
// EVERY RANGE IS AN EXPLICIT ANALYST ASSUMPTION, never auto-derived. A
// range's rationale MAY cite an existing policy value or historical
// observation (e.g. "policy's 8/10/12% rate grid", "the ten-year margin
// range from M3") — citing one is fine — but this module never reaches
// into POLICY or a historical-range calculation itself to MANUFACTURE a
// range. In particular: `buildFixedShapeGrowthPath`'s constant-growth/
// terminal-fade MECHANICS and the RONIC ladder's classification
// THRESHOLDS (§7.2 M5's low-RONIC/cap boundaries) are never read as if
// they were plausible sensitivity ranges — they answer a different
// question (how a given value is projected forward / how a given RONIC
// is classified), not "what values are worth testing." A missing range
// is UNAVAILABLE, a distinct outcome from "tested and found immaterial"
// (`displayed: false`) — the two must never be conflated.
//
// EXACTLY THREE EXPLICITLY SUPPLIED VALUES PER AXIS. No intermediate
// point or production default is invented anywhere in this file — every
// value that reaches a valuation call is either one of a range's three
// supplied values or a fixed base-case assumption, both always supplied
// by the caller.
//
// THIS MODULE NEVER IMPORTS THE VALUATION MODEL ITSELF (avoiding a
// circular dependency — scenarioOutputs.ts already imports
// `buildSensitivityResult` from this file — and keeping this module a
// generic mechanism, not a copy of anyone's DCF math). Every valuation is
// performed by a `ValuationFunction`/`TwoWayValuationFunction` the CALLER
// supplies, closing over the existing forward-valuation model and
// whichever base-case assumptions are held fixed. NO valuation formula is
// altered or duplicated by this file; a rate at or below terminal growth
// (or any other input combination the underlying model does not itself
// guard) surfaces whatever that unmodified formula produces, uncaught and
// unclamped.
//
// ALL FIVE TORNADO ROWS MUST SHARE ONE MODEL, evaluated at ONE base case
// — this is why. `computeScenarioEnterpriseValue` (§7.2 M15,
// capital-intensity-driven reinvestment) and `projectReverseDcfValue`
// (§7.2 M7, RONIC-driven reinvestment, in its ordinary given-growth mode
// — the same mode M7's own bisection search already uses internally,
// never re-solving anything here) are VERIFIED to differ economically:
// their reinvestment formulas (capitalIntensity × revenue vs. NOPAT ×
// next-year-growth ÷ RONIC) do not coincide for an arbitrary
// capitalIntensity/RONIC pairing, confirmed by `sensitivity.test.ts`'s own
// "the two forward models diverge" check. An earlier version of this
// module mixed the two — four rows through `computeScenarioEnterpriseValue`,
// the RONIC row through `projectReverseDcfValue` — which silently gave
// each row a DIFFERENT base-case value, violating "vary only the named
// input, hold everything else — including which base case — fixed."
// Corrected: this file's own tests route ALL FIVE tornado rows through
// `projectReverseDcfValue` alone (the only one of the two existing models
// that accepts RONIC as a parameter at all), using coherent growth paths
// via that function's own internal `growthAt` fixed-shape mechanics for
// every growth value — never a flat/spliced substitute — and the same
// function's now-optional `terminalGrowth` parameter (threaded through
// for exactly this reason) so the terminal-growth row, and every OTHER
// row, honour the base case's own selected terminal growth rather than
// silently reverting to the policy default. The two-way tables are
// unaffected — neither table names RONIC as an axis, so
// `computeScenarioEnterpriseValue` alone is self-consistent for both.
export type TornadoDriver = "growth" | "operatingMargin" | "discountRate" | "terminalGrowth" | "ronic";

export const TORNADO_DRIVERS: readonly TornadoDriver[] = [
  "growth",
  "operatingMargin",
  "discountRate",
  "terminalGrowth",
  "ronic",
] as const;

export type TwoWayTableAxis = "growth" | "operatingMargin" | "discountRate" | "terminalGrowth";

export interface AnalystSuppliedRange {
  // Exactly three explicitly supplied values — order does not matter,
  // min/max are taken from whichever three are given.
  values: readonly [Decimal, Decimal, Decimal];
  // The recorded anchor (§7.2 M14) — required and non-empty. May cite an
  // existing policy value or historical observation; must not be blank.
  rationale: string;
}

// A pure function of the ONE input being varied — the caller closes over
// every other assumption (base-case values, which existing valuation
// model to call) when constructing it.
export type ValuationFunction = (variedValue: Decimal) => Decimal;

// A pure function of the TWO inputs a two-way table varies.
export type TwoWayValuationFunction = (rowValue: Decimal, columnValue: Decimal) => Decimal;

function validateRange(
  range: AnalystSuppliedRange | null,
  label: string
): { valid: true } | { valid: false; cause: string } {
  if (range === null) {
    return { valid: false, cause: `missing REQUIRED analyst-supplied range: ${label}` };
  }
  if (range.rationale.trim().length === 0) {
    return { valid: false, cause: `missing REQUIRED recorded rationale for range: ${label}` };
  }
  return { valid: true };
}

export type TornadoRowResult =
  | { driver: TornadoDriver; available: false; cause: string }
  | {
      driver: TornadoDriver;
      available: true;
      // The frozen >10% rule, unchanged (`shouldDisplaySensitivityInput`).
      // `available: true, displayed: false` ("tested, found immaterial")
      // is a DIFFERENT outcome from `available: false` ("no range was
      // supplied at all") — never conflate the two when rendering.
      displayed: boolean;
      fullRangeValueImpact: Decimal;
      values: readonly [Decimal, Decimal, Decimal];
    };

export function computeTornadoRow(
  driver: TornadoDriver,
  range: AnalystSuppliedRange | null,
  baseCaseValue: Decimal,
  valuationFunction: ValuationFunction
): TornadoRowResult {
  const validation = validateRange(range, driver);
  if (!validation.valid) {
    return { driver, available: false, cause: validation.cause };
  }

  const [rangeLo, rangeMid, rangeHi] = range!.values;
  const values: readonly [Decimal, Decimal, Decimal] = [
    valuationFunction(rangeLo),
    valuationFunction(rangeMid),
    valuationFunction(rangeHi),
  ];
  const maxValue = values.reduce((m, v) => (v.greaterThan(m) ? v : m));
  const minValue = values.reduce((m, v) => (v.lessThan(m) ? v : m));
  const fullRangeValueImpact = maxValue.minus(minValue).dividedBy(baseCaseValue).abs();

  return {
    driver,
    available: true,
    displayed: shouldDisplaySensitivityInput(fullRangeValueImpact),
    fullRangeValueImpact,
    values,
  };
}

export interface TornadoDriverConfig {
  range: AnalystSuppliedRange | null;
  valuationFunction: ValuationFunction;
}

// Fixed row order (`TORNADO_DRIVERS`) — one row per named driver, each
// independently unavailable/computed; a missing range on one row never
// affects another row's result.
export function computeTornado(
  baseCaseValue: Decimal,
  drivers: Record<TornadoDriver, TornadoDriverConfig>
): TornadoRowResult[] {
  return TORNADO_DRIVERS.map((driver) =>
    computeTornadoRow(driver, drivers[driver].range, baseCaseValue, drivers[driver].valuationFunction)
  );
}

export type TwoWayTableResult =
  | { available: false; cause: string }
  | {
      available: true;
      rowValues: readonly [Decimal, Decimal, Decimal];
      columnValues: readonly [Decimal, Decimal, Decimal];
      // cells[i][j] = valuationFunction(rowValues[i], columnValues[j]).
      cells: Decimal[][];
    };

function computeTwoWayTable(
  rowRange: AnalystSuppliedRange | null,
  rowLabel: string,
  columnRange: AnalystSuppliedRange | null,
  columnLabel: string,
  valuationFunction: TwoWayValuationFunction
): TwoWayTableResult {
  const rowValidation = validateRange(rowRange, rowLabel);
  if (!rowValidation.valid) {
    return { available: false, cause: rowValidation.cause };
  }
  const columnValidation = validateRange(columnRange, columnLabel);
  if (!columnValidation.valid) {
    return { available: false, cause: columnValidation.cause };
  }

  const rowValues = rowRange!.values;
  const columnValues = columnRange!.values;
  const cells = rowValues.map((r) => columnValues.map((c) => valuationFunction(r, c)));

  return { available: true, rowValues, columnValues, cells };
}

// The two named two-way tables (§7.2 M14) — growth x margin, holding
// discount rate and terminal growth fixed at whatever the caller's
// valuationFunction closes over.
export function computeGrowthMarginTable(
  growthRange: AnalystSuppliedRange | null,
  marginRange: AnalystSuppliedRange | null,
  valuationFunction: TwoWayValuationFunction
): TwoWayTableResult {
  return computeTwoWayTable(growthRange, "growth", marginRange, "operatingMargin", valuationFunction);
}

// Discount rate x terminal growth, holding growth and margin fixed at
// whatever the caller's valuationFunction closes over.
export function computeRateTerminalGrowthTable(
  rateRange: AnalystSuppliedRange | null,
  terminalGrowthRange: AnalystSuppliedRange | null,
  valuationFunction: TwoWayValuationFunction
): TwoWayTableResult {
  return computeTwoWayTable(rateRange, "discountRate", terminalGrowthRange, "terminalGrowth", valuationFunction);
}
