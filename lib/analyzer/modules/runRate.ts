import Decimal from "decimal.js";
import { POLICY } from "../policy";
import type { RunRateResult, SourcedValue } from "../types";

// M12 — run-rate comparison, with the seasonality test (§7.2, I4).
//
// The base-year rule fires (an annualised run-rate becomes worth showing
// at all) where the CURRENT quarter's sequential growth exceeds the
// policy trigger (~10%). Per I4, the seasonality test gates it: examine
// the same fiscal quarter's sequential growth in each of the prior two
// years. If both were below the threshold, the current growth is not a
// seasonal artefact and the run-rate is computed and shown alongside TTM.
// If EITHER prior year's same quarter also cleared the threshold, the
// growth looks structural (the same quarter always jumps), and the
// run-rate is SEASONAL — RUN-RATE SUPPRESSED: not computed at all, not
// even internally.
//
// Where the base-year rule does not fire (ordinary sequential growth),
// there is nothing for this test to gate — TTM alone was always going to
// be shown, and no run-rate is computed or needed.

export interface RunRateInput {
  currentQuarterRevenue: SourcedValue<Decimal> | null;
  priorQuarterRevenue: SourcedValue<Decimal> | null;
  sameQuarterYear1: SourcedValue<Decimal> | null;
  sameQuarterYear1Prior: SourcedValue<Decimal> | null;
  sameQuarterYear2: SourcedValue<Decimal> | null;
  sameQuarterYear2Prior: SourcedValue<Decimal> | null;
  ttm: SourcedValue<Decimal> | null;
}

function sequentialGrowth(current: Decimal, prior: Decimal): Decimal {
  return current.minus(prior).dividedBy(prior);
}

export function computeRunRate(input: RunRateInput): RunRateResult {
  const ttm = input.ttm?.value ?? null;

  const seasonalityInputs = [
    input.currentQuarterRevenue,
    input.priorQuarterRevenue,
    input.sameQuarterYear1,
    input.sameQuarterYear1Prior,
    input.sameQuarterYear2,
    input.sameQuarterYear2Prior,
  ];

  if (seasonalityInputs.some((v) => v === null)) {
    // Fail-closed (§5.3): absence of the history that would prove non-
    // seasonality is not evidence of non-seasonality. The run-rate is not
    // computed.
    return { seasonalityTestResult: "INCOMPLETE", ttm, runRate: null, triggeringQuarterGrowth: null };
  }

  const currentGrowth = sequentialGrowth(
    (input.currentQuarterRevenue as SourcedValue<Decimal>).value,
    (input.priorQuarterRevenue as SourcedValue<Decimal>).value
  );

  const baseYearRuleFires = currentGrowth.greaterThan(POLICY.runRateSequentialGrowthTrigger);

  if (!baseYearRuleFires) {
    // Nothing for the seasonality test to gate — ordinary growth, no
    // run-rate needed or computed.
    return { seasonalityTestResult: "PASS", ttm, runRate: null, triggeringQuarterGrowth: null };
  }

  const priorYear1Growth = sequentialGrowth(
    (input.sameQuarterYear1 as SourcedValue<Decimal>).value,
    (input.sameQuarterYear1Prior as SourcedValue<Decimal>).value
  );
  const priorYear2Growth = sequentialGrowth(
    (input.sameQuarterYear2 as SourcedValue<Decimal>).value,
    (input.sameQuarterYear2Prior as SourcedValue<Decimal>).value
  );

  const eitherPriorYearAlsoElevated =
    priorYear1Growth.greaterThanOrEqualTo(POLICY.seasonalityPriorYearThreshold) ||
    priorYear2Growth.greaterThanOrEqualTo(POLICY.seasonalityPriorYearThreshold);

  const triggeringQuarterGrowth = { thisYear: currentGrowth, priorYear1: priorYear1Growth, priorYear2: priorYear2Growth };

  if (eitherPriorYearAlsoElevated) {
    return {
      seasonalityTestResult: "SEASONAL — RUN-RATE SUPPRESSED",
      ttm,
      runRate: null,
      triggeringQuarterGrowth,
    };
  }

  const runRate = (input.currentQuarterRevenue as SourcedValue<Decimal>).value.mul(4);

  return { seasonalityTestResult: "PASS", ttm, runRate, triggeringQuarterGrowth };
}
