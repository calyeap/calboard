import Decimal from "decimal.js";
import { combineProvenance } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import type { FcfResult, SourcedValue } from "../types";

// M4 — the three FCF definitions (§2.6, §3.5, §7.2). Each definition is
// suppressed independently — cash FCF needs only OCF and cash capex, so a
// missing finance-lease ROU figure (the input §5.4 names as most often
// absent from a structured feed) leaves it computable while
// fcfAfterLeaseFundedCapacity and unleveredFcf both become INCOMPLETE
// (§11.8's V8 case).
//
// Pairing rule for callers (§3.5): cash FCF is an equity-holder cash flow
// and pairs with market cap; a yield on EV must use unlevered FCF. Do not
// mix them — this module does not enforce that itself, since it has no
// opinion about what a caller divides its outputs by; M2's multiples
// module is where the rule actually has to be honoured.

export interface FcfInput {
  operatingCashFlow: SourcedValue<Decimal> | null;
  cashCapex: SourcedValue<Decimal> | null;
  financeLeaseRouAdditions: SourcedValue<Decimal> | null;
  nopat: SourcedValue<Decimal> | null;
  depreciationAndAmortization: SourcedValue<Decimal> | null;
  deltaNwc: SourcedValue<Decimal> | null;
  sbc: SourcedValue<Decimal> | null;
}

export function computeFcf(input: FcfInput): FcfResult {
  const cashFcf = computeCashFcf(input);
  const fcfAfterLeaseFundedCapacity = computeFcfAfterLeaseFundedCapacity(input, cashFcf);
  const unleveredFcf = computeUnleveredFcf(input);

  return {
    cashFcf,
    fcfAfterLeaseFundedCapacity,
    unleveredFcf,
    sbc: input.sbc?.value ?? null,
    workingCapitalSwing: input.deltaNwc?.value ?? null,
    fcfYield: {
      cashFcf,
      cashFcfLessSbc: computeCashFcfLessSbc(cashFcf, input.sbc),
    },
  };
}

function computeCashFcf(input: FcfInput): FcfResult["cashFcf"] {
  const { operatingCashFlow, cashCapex } = input;
  if (operatingCashFlow === null || cashCapex === null) {
    const missing = [
      operatingCashFlow === null ? "operatingCashFlow" : null,
      cashCapex === null ? "cashCapex" : null,
    ].filter((f): f is string => f !== null);
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }
  return computedValue(
    operatingCashFlow.value.minus(cashCapex.value),
    combineProvenance(operatingCashFlow.provenance, cashCapex.provenance)
  );
}

function computeFcfAfterLeaseFundedCapacity(
  input: FcfInput,
  cashFcf: FcfResult["cashFcf"]
): FcfResult["fcfAfterLeaseFundedCapacity"] {
  if (cashFcf.suppressed) {
    return cashFcf;
  }
  if (input.financeLeaseRouAdditions === null) {
    return suppressedValue("INCOMPLETE", "missing REQUIRED input(s): financeLeaseRouAdditions");
  }
  return computedValue(
    cashFcf.value.minus(input.financeLeaseRouAdditions.value),
    combineProvenance(cashFcf.qualification.provenanceTokens, input.financeLeaseRouAdditions.provenance)
  );
}

function computeUnleveredFcf(input: FcfInput): FcfResult["unleveredFcf"] {
  const { nopat, depreciationAndAmortization, cashCapex, financeLeaseRouAdditions, deltaNwc } = input;
  const requiredEntries = { nopat, depreciationAndAmortization, cashCapex, financeLeaseRouAdditions, deltaNwc };
  const missing = Object.entries(requiredEntries)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (missing.length > 0) {
    return suppressedValue("INCOMPLETE", `missing REQUIRED input(s): ${missing.join(", ")}`);
  }

  const value = nopat!.value
    .plus(depreciationAndAmortization!.value)
    .minus(cashCapex!.value)
    .minus(financeLeaseRouAdditions!.value)
    .minus(deltaNwc!.value);

  return computedValue(
    value,
    combineProvenance(
      nopat!.provenance,
      depreciationAndAmortization!.provenance,
      cashCapex!.provenance,
      financeLeaseRouAdditions!.provenance,
      deltaNwc!.provenance
    )
  );
}

function computeCashFcfLessSbc(
  cashFcf: FcfResult["cashFcf"],
  sbc: SourcedValue<Decimal> | null
): FcfResult["fcfYield"]["cashFcfLessSbc"] {
  if (cashFcf.suppressed) {
    return cashFcf;
  }
  if (sbc === null) {
    return suppressedValue("INCOMPLETE", "missing REQUIRED input(s): sbc");
  }
  return computedValue(
    cashFcf.value.minus(sbc.value),
    combineProvenance(cashFcf.qualification.provenanceTokens, sbc.provenance)
  );
}
