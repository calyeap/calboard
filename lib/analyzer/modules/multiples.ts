import Decimal from "decimal.js";
import { POLICY } from "../policy";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { AnalyticFlagInstance, Figure, Gate1Result, SourcedValue } from "../types";

// M2 — multiples (§7.2). Each multiple is its own Figure, independently
// suppressible — a missing EBIT does not block P/E, and so on.

function simpleMultiple(numerator: SourcedValue<Decimal> | null, denominator: SourcedValue<Decimal> | null, label: string): Figure<Decimal> {
  if (numerator === null || denominator === null) {
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s) for ${label}`);
  }
  return computedValue(numerator.value.dividedBy(denominator.value), combineProvenance(numerator.provenance, denominator.provenance));
}

// §7.2 M2 P/E basis rule (I5): trigger on |non-operating items| > 5% of
// pre-tax income — symmetric, correcting the methodology's gains-only
// asymmetry. Where it fires, compute on GAAP EPS with the item removed
// after tax, or show EV/NOPAT instead — price is an equity number and
// NOPAT is a firm number. The GAAP version is shown only with the item
// quantified beside it.
export interface PeBasisInput {
  gaapEps: SourcedValue<Decimal> | null;
  nonOperatingItemPretax: SourcedValue<Decimal> | null; // null = no material item recorded
  preTaxIncome: SourcedValue<Decimal> | null;
  taxRate: SourcedValue<Decimal> | null;
}

export function computePeBasis(input: PeBasisInput): {
  gaapEps: Decimal;
  nonOperatingItemAfterTax: Decimal | null;
  nopatBasisShown: boolean;
} {
  const gaapEps = input.gaapEps?.value ?? new Decimal(0);

  if (input.nonOperatingItemPretax === null || input.preTaxIncome === null) {
    return { gaapEps, nonOperatingItemAfterTax: null, nopatBasisShown: false };
  }

  const ratio = input.nonOperatingItemPretax.value.abs().dividedBy(input.preTaxIncome.value.abs());
  const fires = ratio.greaterThan(POLICY.peBasisNonOperatingThresholdOfPretaxIncome);

  if (!fires) {
    return { gaapEps, nonOperatingItemAfterTax: null, nopatBasisShown: false };
  }

  const taxRate = input.taxRate?.value ?? new Decimal(0);
  const nonOperatingItemAfterTax = input.nonOperatingItemPretax.value.mul(new Decimal(1).minus(taxRate));

  return { gaapEps, nonOperatingItemAfterTax, nopatBasisShown: true };
}

// Own-history percentile: what fraction of the historical window's values
// are at or below the current value.
//
// Suppressed entirely under HISTORY INSUFFICIENT (§6.2 — fewer than 5
// filed years, no trustworthy own-history to rank against).
//
// §7.2 M2's text reads "PEAK-EARNINGS-warned or suppressed where trigger B
// has fired." PEAK EARNINGS is one of the nine ANALYTIC QUALIFYING FLAGS
// (§9.4) — a flag qualifies a real, displayed number; it does not suppress
// one. Since the percentile is still a genuinely computable number when
// trigger B fires (nothing about a historical margin decline makes the
// current value's rank against its own history uncomputable), the
// qualifying-flag treatment is what §9.4's own classification commits to,
// and is what this function implements: PEAK EARNINGS is attached to the
// computed percentile, never used to suppress it. The "or suppressed"
// alternative is not built here — it would require inventing a
// suppressing state outside the frozen fourteen-state catalogue, which
// this module does not do.
export function computeOwnHistoryPercentile(
  currentValue: SourcedValue<Decimal> | null,
  historicalValues: Decimal[] | null,
  gate1State: Gate1Result["state"],
  triggerBFired: boolean
): Figure<Decimal> {
  if (gate1State === "HISTORY INSUFFICIENT") {
    return suppressedValue("HISTORY INSUFFICIENT", "fewer than 5 filed years — own-history percentile suppressed (§6.2)");
  }

  if (currentValue === null || historicalValues === null || historicalValues.length === 0) {
    return suppressedValue("INCOMPLETE", "missing REQUIRED input(s): current value or historical window");
  }

  const countAtOrBelow = historicalValues.filter((v) => v.lessThanOrEqualTo(currentValue.value)).length;
  const percentile = new Decimal(countAtOrBelow).dividedBy(historicalValues.length);

  const flags: AnalyticFlagInstance[] = [];
  if (gate1State === "SHORT HISTORY") {
    flags.push({ flag: "SHORT HISTORY", detail: `${historicalValues.length}-year window` });
  }
  if (triggerBFired) {
    flags.push({ flag: "PEAK EARNINGS" });
  }

  return computedValue(percentile, currentValue.provenance, flags);
}

export interface MultiplesInput {
  price: SourcedValue<Decimal> | null;
  epsTrailing: SourcedValue<Decimal> | null;
  epsForward: SourcedValue<Decimal> | null;
  enterpriseValue: SourcedValue<Decimal> | null;
  ebit: SourcedValue<Decimal> | null;
  ebitda: SourcedValue<Decimal> | null;
  cashFcf: SourcedValue<Decimal> | null;
  marketCap: SourcedValue<Decimal> | null;
  bookValue: SourcedValue<Decimal> | null;
  revenue: SourcedValue<Decimal> | null;
  impliedMarginForNormalMultiple: Decimal;
  peBasis: PeBasisInput;
  ownHistoryCurrentValue: SourcedValue<Decimal> | null;
  ownHistoryValues: Decimal[] | null;
  gate1State: Gate1Result["state"];
  triggerBFired: boolean;
}

export function computeMultiples(input: MultiplesInput) {
  return {
    peTrailing: simpleMultiple(input.price, input.epsTrailing, "P/E trailing"),
    peForward: simpleMultiple(input.price, input.epsForward, "P/E forward"),
    evToEbit: simpleMultiple(input.enterpriseValue, input.ebit, "EV/EBIT"),
    evToEbitda: simpleMultiple(input.enterpriseValue, input.ebitda, "EV/EBITDA"),
    fcfYieldOnMarketCap: simpleMultiple(input.cashFcf, input.marketCap, "FCF yield on market cap"),
    priceToBook: simpleMultiple(input.price, input.bookValue, "P/B"),
    evToRevenue: {
      value: simpleMultiple(input.enterpriseValue, input.revenue, "EV/Revenue"),
      impliedMarginForNormalMultiple: input.impliedMarginForNormalMultiple,
    },
    peBasis: computePeBasis(input.peBasis),
    ownHistoryPercentile: computeOwnHistoryPercentile(
      input.ownHistoryCurrentValue,
      input.ownHistoryValues,
      input.gate1State,
      input.triggerBFired
    ),
  };
}
