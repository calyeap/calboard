import Decimal from "decimal.js";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { Figure, SourcedValue } from "../types";

// M9 — implied exit multiple (§7.2). "Labelled by the metric it actually
// divides" — the manual test's recorded failure was a row headed
// "terminal value / FY36 revenue" that was in fact terminal value ÷ FY36
// EBIT, with the cross-check never performed. `metricName` is therefore a
// required parameter, not a free-text label attached after the fact — the
// caller must state what it is passing as the denominator, and that is
// exactly what gets labelled.

export interface ImpliedExitMultipleResult {
  value: Figure<Decimal>;
  dividesMetric: string;
}

export function computeImpliedExitMultiple(
  terminalValue: SourcedValue<Decimal> | null,
  metric: SourcedValue<Decimal> | null,
  metricName: string
): ImpliedExitMultipleResult {
  if (terminalValue === null || metric === null) {
    const missing = [
      terminalValue === null ? "terminalValue" : null,
      metric === null ? metricName : null,
    ].filter((f): f is string => f !== null);
    return {
      value: suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`),
      dividesMetric: metricName,
    };
  }

  return {
    value: computedValue(
      terminalValue.value.dividedBy(metric.value),
      combineProvenance(terminalValue.provenance, metric.provenance)
    ),
    dividesMetric: metricName,
  };
}
