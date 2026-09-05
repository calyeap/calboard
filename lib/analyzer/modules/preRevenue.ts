import Decimal from "decimal.js";
import { CLEAN_PROVENANCE } from "../provenance";
import { computedValue, suppressedValue } from "../figures";
import { roundProbability } from "../rounding";
import type { Figure, FundingRamp, FundingStackLine, SuccessDefinitionState } from "../types";

// M16 — the pre-revenue module (§7.2). Cash floor, funding stack, and
// implied probability of success. The funding stack is solved YEAR BY
// YEAR, never in aggregate (§7.2 M16) — solving in aggregate lets cash
// flow from later capacity pay for earlier capacity, which the spec names
// as a specific, material error (worth $27/share on OKLO's 8 GW case).

// --- unit economics -------------------------------------------------------

// Runs BEFORE the scale solve (§7.2 M16). A per-unit screening test: if a
// single unit's contribution margin, valued as of the SAME date its capex
// is spent, does not cover that capex, no scale fixes that — every
// additional unit destroys value the same way.
//
// PERPETUITY ASSUMPTION, kept explicit and unchanged: the unit's
// contribution margin is treated as constant and running forever once it
// starts — there is no finite asset-lifetime term here, and this
// correction does not add one. That is a deliberate simplification, not
// an oversight; §7.2 does not specify a per-unit lifetime, and inventing
// one is exactly what was asked NOT to be done.
//
// CONSTRUCTION-TIMING CORRECTION: capex is spent at the unit's
// capitalisation date (t=0 for this per-unit test); the first operating
// cash flow arrives `constructionLeadYears` later (t=constructionLeadYears),
// per the funding stack's own convention (`FundingStackYearParams.
// constructionLeadYears` — every unit is capitalised `constructionLeadYears`
// before it comes into service and its arrival year already carries a
// full year of contribution, §7.2 M16; verified directly against that
// function's cash-flow dates, not assumed). This function takes the same
// parameter rather than its own assumption, so the two halves of this
// module cannot silently disagree about the lag.
//
// EXPONENT, verified by independent term-by-term summation (not algebra
// alone) against those exact dates: the discount factor is
// (1+requiredReturn)^(−(constructionLeadYears−1)), NOT
// (1+requiredReturn)^(−constructionLeadYears). The reason for the "−1":
// `contribution ÷ requiredReturn` is the ORDINARY perpetuity formula,
// which is already valued one period BEFORE its first payment — that
// timing assumption is baked into the fraction itself. The first payment
// is at t=constructionLeadYears, so contribution÷requiredReturn is
// already sitting at t=(constructionLeadYears−1); only the remaining
// (constructionLeadYears−1) periods need to be bridged to reach the capex
// date at t=0. A first, uncorrected version of this fix used the full
// constructionLeadYears as the exponent, double-counting one period —
// confirmed wrong by direct summation (826.446 vs. the true 909.091 at
// contribution=100, requiredReturn=10%, lead=2) before being corrected
// here. Do NOT clamp this exponent at zero: at zero lead the unit's first
// cash flow lands AT the capex date itself (a perpetuity DUE), which is
// genuinely worth (1+requiredReturn) MORE than the ordinary-perpetuity
// figure — the exponent is legitimately +1 in that case, not 0.
//
// This is a NECESSARY, not sufficient, per-unit screen. Passing it does
// not prove the project is viable — it only means this one unit's
// economics are not destructive before construction-lead timing and
// perpetuity value are even considered against everything else the
// funding stack models (debt service, prepayments, dilution).
export function computeUnitEconomicsBreakeven(
  revenuePerUnit: Decimal,
  operatingCostPerUnit: Decimal,
  capexPerUnit: Decimal,
  requiredReturn: Decimal | null,
  constructionLeadYears: number
): Figure<Decimal> {
  if (requiredReturn === null) {
    return suppressedValue("INCOMPLETE", "missing REQUIRED input(s): requiredReturn");
  }

  const annualContribution = revenuePerUnit.minus(operatingCostPerUnit);
  const perpetuityValueOneYearBeforeFirstPayment = annualContribution.dividedBy(requiredReturn);
  const discountFactor = new Decimal(1).plus(requiredReturn).pow(-(constructionLeadYears - 1));
  const perpetuityValueAtCapexDate = perpetuityValueOneYearBeforeFirstPayment.mul(discountFactor);

  if (perpetuityValueAtCapexDate.lessThanOrEqualTo(capexPerUnit)) {
    return suppressedValue(
      "NOT ACHIEVABLE AT ANY SCALE",
      "unit economics negative before scale solve (construction-delay-adjusted)"
    );
  }

  // NPV at the capex date (a lump sum, not an annual figure — this is the
  // one deliberate change in meaning from the pre-correction version,
  // which returned an annual surplus).
  return computedValue(perpetuityValueAtCapexDate.minus(capexPerUnit), CLEAN_PROVENANCE);
}

// --- funding stack, solved year by year -----------------------------------

export interface FundingStackYearParams {
  // Capacity units added THIS year (coming into service this year, having
  // been capitalised `constructionLeadYears` earlier).
  capacityAddedByYear: Decimal[];
  capexPerUnit: Decimal;
  revenuePerUnitInService: Decimal;
  operatingCostPerUnitInService: Decimal;
  corporateOverheadPerYear: Decimal;
  // ASSUMPTION — share of each year's capex funded by project debt (line 1).
  projectDebtShareOfCapex: Decimal;
  // §7.1's undefined "project-debt cost" policy constant. Required to
  // compute interest on drawn debt; an unconfigured run cannot solve the
  // stack at all (every year would be missing a REQUIRED figure).
  projectDebtCost: Decimal | null;
  // FACT where contracted, ASSUMPTION otherwise (line 2) — one entry per
  // year, zero where none.
  customerPrepaymentByYear: Decimal[];
  // §7.1's undefined "NOPAT tax rate" — reused here for the retained
  // operating cash flow's own tax line (line 3), since it is the same
  // "convert projected profit to after-tax cash" step M7 needs, not a
  // second constant.
  nopatTaxRate: Decimal | null;
  constructionLeadYears: number;
}

export interface FundingStackYearResult {
  year: number;
  lines: FundingStackLine[];
  cashBalance: Decimal;
}

export interface FundingStackResult {
  // Present only when both undefined policy constants (project-debt cost,
  // NOPAT tax rate) are configured — otherwise the whole stack is
  // INCOMPLETE, named explicitly rather than solved on a guessed rate.
  years: FundingStackYearResult[] | null;
  incompleteCause: string | null;
  dilutionRequired: Decimal | null;
}

export function computeFundingStackYearByYear(params: FundingStackYearParams): FundingStackResult {
  const missing = [
    params.projectDebtCost === null ? "projectDebtCost (§7.1, unconfigured policy constant)" : null,
    params.nopatTaxRate === null ? "nopatTaxRate (§7.1, unconfigured policy constant)" : null,
  ].filter((f): f is string => f !== null);

  if (missing.length > 0) {
    return { years: null, incompleteCause: `missing REQUIRED input(s): ${missing.join(", ")}`, dilutionRequired: null };
  }

  const projectDebtCost = params.projectDebtCost as Decimal;
  const nopatTaxRate = params.nopatTaxRate as Decimal;
  const afterTax = new Decimal(1).minus(nopatTaxRate);

  const yearCount = params.capacityAddedByYear.length;
  const years: FundingStackYearResult[] = [];

  let cashBalance = new Decimal(0);
  let cumulativeUnitsInService = new Decimal(0);
  let cumulativeDrawnDebt = new Decimal(0);
  let totalEquityRaised = new Decimal(0);

  for (let year = 1; year <= yearCount; year++) {
    // Capacity SCHEDULED TO ARRIVE (come into service) this year — the
    // caller's capacityAddedByYear is indexed by arrival year.
    const unitsArrivingThisYear = params.capacityAddedByYear[year - 1] ?? new Decimal(0);
    // Capex spent THIS year funds capacity arriving `constructionLeadYears`
    // later — construction cash spend LEADS capacity in service. This is a
    // DIFFERENT lookup from the arrivals above; conflating the two was the
    // exact bug this comment now guards against.
    const capitalizedIndex = year - 1 + params.constructionLeadYears;
    const unitsBeingCapitalizedThisYear =
      capitalizedIndex < yearCount ? params.capacityAddedByYear[capitalizedIndex] : new Decimal(0);
    const capexThisYear = unitsBeingCapitalizedThisYear.mul(params.capexPerUnit);

    const projectDebtDraw = capexThisYear.mul(params.projectDebtShareOfCapex);
    const customerPrepayment = params.customerPrepaymentByYear[year - 1] ?? new Decimal(0);

    // Capacity arriving this year is treated as in service for the whole
    // of this year (a modelling simplification the spec does not pin down
    // to sub-year timing).
    cumulativeUnitsInService = cumulativeUnitsInService.plus(unitsArrivingThisYear);

    // Line 3 — retained operating cash flow from assets already in
    // service, after cash operating costs, corporate overhead, interest on
    // drawn project debt, and tax. Mandatory (§7.2 M16) — was missing from
    // the OKLO manual test.
    const operatingContribution = cumulativeUnitsInService.mul(
      params.revenuePerUnitInService.minus(params.operatingCostPerUnitInService)
    );
    const interestOnDrawnDebt = cumulativeDrawnDebt.mul(projectDebtCost);
    const retainedOperatingCashFlow = operatingContribution
      .minus(params.corporateOverheadPerYear)
      .minus(interestOnDrawnDebt)
      .mul(afterTax);

    const netCashFlowBeforeEquity = retainedOperatingCashFlow
      .plus(customerPrepayment)
      .plus(projectDebtDraw)
      .minus(capexThisYear);

    let equityRaised = new Decimal(0);
    let newCashBalance = cashBalance.plus(netCashFlowBeforeEquity);
    if (newCashBalance.lessThan(0)) {
      // New equity is raised only in the years the cash balance would
      // otherwise go negative, and only in the amount needed (§7.2 M16) —
      // the residual, not the first resort.
      equityRaised = newCashBalance.neg();
      newCashBalance = new Decimal(0);
    }

    cashBalance = newCashBalance;
    cumulativeDrawnDebt = cumulativeDrawnDebt.plus(projectDebtDraw);
    totalEquityRaised = totalEquityRaised.plus(equityRaised);

    const lines: FundingStackLine[] = [
      { line: "project_debt", type: "ASSUMPTION", shareOfCapex: params.projectDebtShareOfCapex, cost: projectDebtCost },
      { line: "customer_prepayments", type: customerPrepayment.isZero() ? "ASSUMPTION" : "FACT", amount: customerPrepayment },
      { line: "retained_operating_cash_flow", type: "INFERENCE", amount: retainedOperatingCashFlow },
      { line: "new_equity", type: "INFERENCE", amount: equityRaised },
    ];

    years.push({ year, lines, cashBalance });
  }

  return { years, incompleteCause: null, dilutionRequired: totalEquityRaised };
}

// Both ramps always shown (§7.2 M16) — back-loaded and steady, run through
// the identical year-by-year solver above with two different capacity
// schedules. The spread between them is the honest uncertainty; back-
// loaded is the reference.
export function computeBothFundingRamps(
  backLoadedCapacityByYear: Decimal[],
  steadyCapacityByYear: Decimal[],
  sharedParams: Omit<FundingStackYearParams, "capacityAddedByYear">
): Record<FundingRamp, FundingStackResult> {
  return {
    back_loaded: computeFundingStackYearByYear({ ...sharedParams, capacityAddedByYear: backLoadedCapacityByYear }),
    steady: computeFundingStackYearByYear({ ...sharedParams, capacityAddedByYear: steadyCapacityByYear }),
  };
}

// --- implied probability of success ---------------------------------------

// Three defined states (§7.2 M16). The spec's table literally covers
// V_success <= V_fail, price >= V_success > V_fail, and V_fail < price <
// V_success — it does not separately name price <= V_fail (with
// V_success > V_fail). Rather than inventing a fourth named state, this
// extends the same linear-interpolation formula from the probability case
// to that boundary and clamps at 0%, which is what the formula naturally
// produces there.
export function computeImpliedProbability(vSuccess: Decimal, vFail: Decimal, price: Decimal): SuccessDefinitionState {
  if (vSuccess.lessThanOrEqualTo(vFail)) {
    return { kind: "THIS SUCCESS IS WORTH LESS THAN FAILURE" };
  }

  if (price.greaterThanOrEqualTo(vSuccess)) {
    return { kind: "PRICE NOT JUSTIFIABLE BY THIS OUTCOME" };
  }

  // Standard two-outcome pricing identity: price = p*V_success +
  // (1-p)*V_fail, solved for p.
  const rawProbability = price.minus(vFail).dividedBy(vSuccess.minus(vFail));
  const probability = Decimal.max(0, rawProbability);
  return { kind: "probability", probability: roundProbability(probability) };
}
