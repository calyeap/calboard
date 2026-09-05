import Decimal from "decimal.js";
import { POLICY } from "./policy";
import { windowMax, windowRange, worstSingleYearDecline } from "./marginMath";
import type { Gate0Result, Gate1Result, LeverageResult, OverrideRecord, TriggerResult } from "./types";

// §6 — company classification and gates. Every function here is pure and
// deterministic [S] — no judgment, no AI involvement. Fail-closed throughout
// (§5.3): a missing input never reads as a pass.

// ---------------------------------------------------------------------------
// §6.1 — Gate 0, supported profile
// ---------------------------------------------------------------------------

const ASSET_BASED_SECTORS = new Set(["Financials", "Real Estate"]);
const RESERVE_BASED_INDUSTRIES = new Set([
  "Oil & Gas Exploration & Production",
  "Mining",
]);

export interface Gate0Input {
  sectorClassification: string | null;
  interestIncomeOverRevenue: Decimal | null;
  hasInsurancePremiumOrReserveLineItems: boolean | null;
  industryClassification: string | null;
  override: OverrideRecord | null;
}

// Evaluates the four §6.1 asset-based tests independently of whether every
// input is present — an interest-income, insurance/reserve, or industry-
// classification result can fire the refusal on its own even if another
// input is separately missing. Only when none of those tests fires does
// missing-input handling take over.
//
// §4.2 lists five REQUIRED inputs for the Gate 0 output: sector
// classification; interest income; revenue (interest income and revenue are
// collapsed into one ratio here, since neither alone lets the ratio be
// evaluated — Gate0Input has no way to distinguish "interest income
// missing" from "revenue missing," and nothing downstream needs to);
// primary statement line items (represented by
// hasInsurancePremiumOrReserveLineItems being null rather than a known
// boolean); and industry classification. §5.3 frames Gate 0's own
// designated fail-closed output as UNSUPPORTED PROFILE — CLASSIFICATION
// UNAVAILABLE (point 1), distinct from the generic missing-REQUIRED-input
// rule that returns INCOMPLETE (point 3) — that generic rule governs
// ordinary diagnostic outputs, not Gate 0 itself. No acceptance criterion
// (B1) or validation case (V7) ever expects Gate 0 to return INCOMPLETE;
// both describe it "failing closed," matching CLASSIFICATION UNAVAILABLE.
// So: any one of the five REQUIRED inputs being missing resolves to
// CLASSIFICATION UNAVAILABLE, never a silent PASS and never INCOMPLETE —
// unless an already-evaluable test has independently proven the asset-based
// row, in which case that concrete, stronger finding wins.
export function evaluateGate0(input: Gate0Input): Gate0Result {
  const {
    sectorClassification,
    interestIncomeOverRevenue,
    hasInsurancePremiumOrReserveLineItems,
    industryClassification,
    override,
  } = input;

  const failsAssetBased =
    (sectorClassification !== null && ASSET_BASED_SECTORS.has(sectorClassification)) ||
    (interestIncomeOverRevenue !== null &&
      interestIncomeOverRevenue.greaterThan(POLICY.gate0InterestIncomeOverRevenueThreshold)) ||
    hasInsurancePremiumOrReserveLineItems === true ||
    (industryClassification !== null && RESERVE_BASED_INDUSTRIES.has(industryClassification));

  const anyRequiredInputMissing =
    sectorClassification === null ||
    interestIncomeOverRevenue === null ||
    hasInsurancePremiumOrReserveLineItems === null ||
    industryClassification === null;

  let result: Gate0Result["result"];
  if (failsAssetBased) {
    result = "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1";
  } else if (anyRequiredInputMissing) {
    // Fails closed: an unclassifiable company is unsupported, never
    // mature-profitable by default (§5.3 point 1).
    result = "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE";
  } else {
    result = "PASS";
  }

  return {
    result,
    evaluatedTests: {
      sectorClassification,
      interestIncomeOverRevenue,
      hasInsurancePremiumOrReserveLineItems,
      industryClassification,
    },
    override,
  };
}

// ---------------------------------------------------------------------------
// §6.2 — Gate 1, history sufficiency
// ---------------------------------------------------------------------------

export interface Gate1Input {
  filedYearsCount: number;
}

// Gate 1 never refuses — it only suppresses and labels (§6.2). There is no
// FAIL branch here, deliberately: a caller that expects one has misread the
// gate.
export function evaluateGate1(input: Gate1Input): Gate1Result {
  const { filedYearsCount } = input;

  let state: Gate1Result["state"];
  if (filedYearsCount < POLICY.gate1HistoryInsufficientYears) {
    state = "HISTORY INSUFFICIENT";
  } else if (filedYearsCount <= POLICY.gate1ShortHistoryYears) {
    state = "SHORT HISTORY";
  } else {
    state = null;
  }

  return { filedYearsCount, state };
}

// ---------------------------------------------------------------------------
// §6.5 — the leverage precondition
// ---------------------------------------------------------------------------

export interface LeverageInput {
  totalDebt: Decimal | null;
  financeLeaseLiabilities: Decimal | null;
  cashAndMarketableDebtSecurities: Decimal | null;
  enterpriseValue: Decimal | null;
  // Optional — memo only (§3.5); its absence never affects the result.
  operatingLeaseLiabilities: Decimal | null;
  // Explicit, caller-supplied — never inferred from the ratio itself
  // ("the engineer must implement it as an explicit branch, not as a
  // special case discovered at runtime," §6.5). True for a pre-revenue
  // success-case cash flow that is a residual after debt (project debt or
  // customer prepayments funding the asset). This flag never changes
  // netDebtRatio or the PASS/FAIL result below — those reflect the
  // company-level test exactly as defined, unconditionally. What the
  // exception actually does is let a DIFFERENT, later computation (the
  // pre-revenue module's per-success-case levered cost of equity, using
  // D/E measured at the exit year — not this function, and not this ratio)
  // proceed instead of being refused when the company-level test fails.
  // This field only carries that fact through to the result so the report
  // can state the exception is the reason a module was not refused, per
  // design §5.1: "not as a remedy."
  leveredResidualExceptionApplies: boolean;
}

export function evaluateLeverage(input: LeverageInput): LeverageResult {
  const {
    totalDebt,
    financeLeaseLiabilities,
    cashAndMarketableDebtSecurities,
    enterpriseValue,
    operatingLeaseLiabilities,
    leveredResidualExceptionApplies,
  } = input;

  const requiredInputsPresent =
    totalDebt !== null &&
    financeLeaseLiabilities !== null &&
    cashAndMarketableDebtSecurities !== null &&
    enterpriseValue !== null;

  if (!requiredInputsPresent) {
    // Fails closed: missing inputs are LEVERAGE UNSUPPORTED IN v1, never
    // PASS (§5.3 point 2, §6.5).
    return {
      netDebtRatio: null,
      operatingLeaseInclusiveMemo: null,
      result: "LEVERAGE UNSUPPORTED IN v1",
      leveredResidualExceptionApplies,
    };
  }

  const netDebtRatio = totalDebt
    .plus(financeLeaseLiabilities)
    .minus(cashAndMarketableDebtSecurities)
    .dividedBy(enterpriseValue);

  const operatingLeaseInclusiveMemo =
    operatingLeaseLiabilities !== null
      ? totalDebt
          .plus(financeLeaseLiabilities)
          .plus(operatingLeaseLiabilities)
          .minus(cashAndMarketableDebtSecurities)
          .dividedBy(enterpriseValue)
      : null;

  const result: LeverageResult["result"] = netDebtRatio.lessThan(POLICY.leverageThreshold)
    ? "PASS"
    : "LEVERAGE UNSUPPORTED IN v1";

  return { netDebtRatio, operatingLeaseInclusiveMemo, result, leveredResidualExceptionApplies };
}

// ---------------------------------------------------------------------------
// §6.4 — triggers A and B, evaluated separately
// ---------------------------------------------------------------------------

export interface TriggerMarginInput {
  // Chronological order, oldest first, current year last. Whether the
  // window is trusted at all (HISTORY INSUFFICIENT vs SHORT HISTORY vs
  // full) is Gate 1's concern, not this function's — it evaluates whatever
  // window it is given.
  yearlyOperatingMargins: Decimal[];
}

// Trigger A — MARGIN AT HISTORICAL HIGH: current margin at or within 2
// points of the window max, AND the window's range exceeds 15 points. A
// description, not a claim about the business (§6.4) — firing alone implies
// nothing about cyclicality.
export function evaluateTriggerA(input: TriggerMarginInput): TriggerResult {
  const margins = input.yearlyOperatingMargins;
  const current = margins[margins.length - 1];
  const max = windowMax(margins);
  const range = windowRange(margins);

  const nearMax = current.greaterThanOrEqualTo(max.minus(POLICY.triggerAMarginProximityPoints));
  const wideRange = range.greaterThan(POLICY.triggerAWindowRangePoints);
  const fired = nearMax && wideRange;

  return {
    fired,
    evidence: `current margin ${current.toString()}, window max ${max.toString()}, window range ${range.toString()}`,
  };
}

// Trigger B — CYCLICAL: a recorded single-year operating-margin decline of
// more than 10 points within the available window. A claim about the
// business, requiring an *observed* decline — a short window in which none
// was observed is absence of evidence, not evidence of absence (§6.2, §6.4).
export function evaluateTriggerB(input: TriggerMarginInput): TriggerResult {
  const worstDecline = worstSingleYearDecline(input.yearlyOperatingMargins);
  const fired = worstDecline.greaterThan(POLICY.triggerBDeclinePoints);

  return {
    fired,
    evidence: `worst single-year decline ${worstDecline.toString()}`,
  };
}
