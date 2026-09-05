import Decimal from "decimal.js";
import { windowMedian, windowRange, worstSingleYearDecline } from "../marginMath";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { MarginHistoryResult, SourcedValue } from "../types";

// M3 — margin and history diagnostics (§7.2). Runs regardless of Gate 1's
// state: "margin diagnostics still run" even under HISTORY INSUFFICIENT
// (§6.2) — the window length is simply reported honestly rather than
// claimed as ten-year. This module never carries a CYCLICAL or PEAK
// EARNINGS label itself; those are Trigger B and the M2 own-history
// percentile's concern respectively, evaluated elsewhere against the same
// window.

export interface MarginHistoryInput {
  // Chronological order, oldest first, current year last.
  yearlyOperatingMargins: SourcedValue<Decimal>[];
  fiftyTwoWeekLow: SourcedValue<Decimal> | null;
  fiftyTwoWeekHigh: SourcedValue<Decimal> | null;
}

export function computeMarginHistory(input: MarginHistoryInput): MarginHistoryResult {
  const missing: string[] = [];
  if (input.yearlyOperatingMargins.length === 0) missing.push("yearlyOperatingMargins");
  if (input.fiftyTwoWeekLow === null) missing.push("fiftyTwoWeekLow");
  if (input.fiftyTwoWeekHigh === null) missing.push("fiftyTwoWeekHigh");

  if (missing.length > 0) {
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }

  const margins = input.yearlyOperatingMargins;
  const marginValues = margins.map((m) => m.value);
  const currentMargin = marginValues[marginValues.length - 1];

  const fiftyTwoWeekLow = input.fiftyTwoWeekLow as SourcedValue<Decimal>;
  const fiftyTwoWeekHigh = input.fiftyTwoWeekHigh as SourcedValue<Decimal>;

  const provenance = combineProvenance(
    ...margins.map((m) => m.provenance),
    fiftyTwoWeekLow.provenance,
    fiftyTwoWeekHigh.provenance
  );

  return computedValue(
    {
      currentMargin,
      // The actual window used — honestly labelled, never claimed as
      // ten-year unless it is (§6.2).
      windowYears: marginValues.length,
      range: windowRange(marginValues),
      median: windowMedian(marginValues),
      worstSingleYearChange: worstSingleYearDecline(marginValues),
      fiftyTwoWeekRange: [fiftyTwoWeekLow.value, fiftyTwoWeekHigh.value],
    },
    provenance
  );
}
