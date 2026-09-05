import Decimal from "decimal.js";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { Figure, SourcedValue } from "../types";

// M6 — steady-state EV and PVGO (§7.2). Suppressed by exactly two things,
// per the spec's own list: no NOPAT to normalise (read here as
// median-margin NOPAT being unavailable — a REQUIRED-input gap, so
// INCOMPLETE), and LEVERAGE UNSUPPORTED IN v1. Nothing else suppresses it.

export interface SteadyStateEvInput {
  currentEnterpriseValue: SourcedValue<Decimal> | null;
  medianMarginNopat: SourcedValue<Decimal> | null;
  // Needed only to display the current-vs-median-margin gap when a
  // trigger has fired (§7.2 M6); its absence never suppresses the primary
  // steady-state EV / PVGO figures.
  currentNopat: SourcedValue<Decimal> | null;
  discountRate: SourcedValue<Decimal> | null;
  leverageUnsupported: boolean;
  triggerAOrBFired: boolean;
}

export interface SteadyStateEvPvgoResult {
  steadyStateEv: Figure<Decimal>;
  pvgo: Figure<Decimal>;
  pvgoShareOfEv: Figure<Decimal>;
  nopatGap: { current: Decimal; medianMargin: Decimal } | null;
}

export function computeSteadyStateEvPvgo(input: SteadyStateEvInput): SteadyStateEvPvgoResult {
  if (input.leverageUnsupported) {
    const suppressed = suppressedValue("LEVERAGE UNSUPPORTED IN v1", "leverage precondition failed (§6.5)");
    return { steadyStateEv: suppressed, pvgo: suppressed, pvgoShareOfEv: suppressed, nopatGap: null };
  }

  const { currentEnterpriseValue, medianMarginNopat, currentNopat, discountRate } = input;

  const missing = [
    currentEnterpriseValue === null ? "currentEnterpriseValue" : null,
    medianMarginNopat === null ? "medianMarginNopat" : null,
    discountRate === null ? "discountRate" : null,
  ].filter((f): f is string => f !== null);

  if (missing.length > 0) {
    const suppressed = suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
    return { steadyStateEv: suppressed, pvgo: suppressed, pvgoShareOfEv: suppressed, nopatGap: null };
  }

  const ev = currentEnterpriseValue as SourcedValue<Decimal>;
  const nopat = medianMarginNopat as SourcedValue<Decimal>;
  const rate = discountRate as SourcedValue<Decimal>;

  const provenance = combineProvenance(ev.provenance, nopat.provenance, rate.provenance);

  // Steady-state EV = median-margin NOPAT ÷ discount rate.
  const steadyStateEvValue = nopat.value.dividedBy(rate.value);
  // PVGO = current EV − steady-state EV. The comparison is EV to EV.
  const pvgoValue = ev.value.minus(steadyStateEvValue);
  const pvgoShareValue = pvgoValue.dividedBy(ev.value);

  const nopatGap =
    input.triggerAOrBFired && currentNopat !== null
      ? { current: currentNopat.value, medianMargin: nopat.value }
      : null;

  return {
    steadyStateEv: computedValue(steadyStateEvValue, provenance),
    pvgo: computedValue(pvgoValue, provenance),
    pvgoShareOfEv: computedValue(pvgoShareValue, provenance),
    nopatGap,
  };
}
