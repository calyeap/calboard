import Decimal from "decimal.js";
import type { PolicyConstants, UndefinedPolicyConstants } from "./types";

// §7.1 — policy constants, identical for every company. Every deterministic
// module (M1–M16) reads its constants from here rather than embedding a
// literal, so a later configuration surface (the spec requires these be
// "explicit configuration... not buried as literals in code") has one place
// to change.

export const POLICY: PolicyConstants = {
  terminalGrowth: new Decimal("0.03"),
  // r + 3 percentage points — PROVISIONAL, must carry the I16 label wherever
  // it drives a figure (§7.1, §10.4).
  terminalRoicPremium: new Decimal("0.03"),
  rateGrid: [new Decimal("0.08"), new Decimal("0.1"), new Decimal("0.12")],
  // PROVISIONAL — first-order, worth $27/share on OKLO's 8 GW case (§7.1).
  preRevenueConstructionLeadYears: 2,
  // PROVISIONAL — capped cells labelled RATE CAPPED (I12).
  leveredCostOfEquityCap: new Decimal("0.3"),
  // < 10% PASS, >= 10% FAIL (§6.5).
  leverageThreshold: new Decimal("0.1"),
  // PROVISIONAL, no observations behind it (§6.1).
  gate0InterestIncomeOverRevenueThreshold: new Decimal("0.5"),
  gate1HistoryInsufficientYears: 5,
  gate1ShortHistoryYears: 9,
  // Trigger A: current margin at or within 2 points of the window max, AND
  // the window range exceeds 15 points (§6.4).
  triggerAMarginProximityPoints: new Decimal("0.02"),
  triggerAWindowRangePoints: new Decimal("0.15"),
  // Trigger B: a single-year margin decline of more than 10 points (§6.4).
  triggerBDeclinePoints: new Decimal("0.1"),
  // Gate 1's own substitute triad when HISTORY INSUFFICIENT: current margin,
  // and that margin reduced by these two relative fractions (§6.2). This is
  // distinct from the single "stress margin level" used in the standard
  // current/median/stress diagnostic set, which is one of the four
  // UNDEFINED_POLICY_CONSTANTS below.
  historyInsufficientStressMarginRelativeReductions: [new Decimal("0.25"), new Decimal("0.5")],
  // Symmetric trigger correcting the methodology's gains-only asymmetry
  // (I5).
  peBasisNonOperatingThresholdOfPretaxIncome: new Decimal("0.05"),
  // PROVISIONAL, calibrated on NVIDIA only (Appendix B) — sequential growth
  // above this triggers the base-year rule before the seasonality gate (M12).
  runRateSequentialGrowthTrigger: new Decimal("0.1"),
  // PROVISIONAL, no observations behind it (I4) — same-quarter sequential
  // growth threshold in each of the prior two years.
  seasonalityPriorYearThreshold: new Decimal("0.1"),
  // RONIC > 60% fires CAPITAL-LIGHT (§7.2 M5).
  capitalLightRonicFloor: new Decimal("0.6"),
  // Display guard, not a valuation — RONIC computed above this is shown
  // capped, labelled RONIC CAPPED AT 200% (§7.2 M5).
  ronicCap: new Decimal("2"),
  // ~15 points difference between guided/known growth and the implied
  // constant triggers SHAPE MISMATCH (§7.2 M13).
  shapeMismatchGapPoints: new Decimal("0.15"),
  // An input whose full plausible range moves value by less than this is
  // not displayed in the sensitivity table (§7.2 M14).
  sensitivityDisplayThreshold: new Decimal("0.1"),
  // M11 precondition: (capex + lease additions) ÷ D&A must fall in this
  // band, or the output is PRECONDITION FAILED (§7.2).
  fcfYieldGrowthPreconditionBand: [new Decimal("0.8"), new Decimal("1.5")],
};

// The four constants the register records as LATER (§7.1). Left null rather
// than guessed so every consumer is forced to handle "unset" explicitly —
// an engineer defaulting one of these to a plausible-looking number would be
// reintroducing exactly the silently-invented behaviour the frozen contract
// forbids.
export const UNDEFINED_POLICY_CONSTANTS: UndefinedPolicyConstants = {
  nopatTaxRate: null,
  stressMarginLevel: null,
  preRevenueUnleveredRate: null,
  projectDebtCost: null,
};

// Fixed path shape (§7.1) — recorded as a labelled constant since it isn't a
// number a PolicyConstants field could hold, but a module still needs to
// name it (e.g. in section J's provisional register).
export const PATH_SHAPE_DESCRIPTION =
  "constant growth years 1–5, linear fade to terminal by year 10, terminal thereafter";

// ---------------------------------------------------------------------------
// PROVISIONAL threshold provenance (§10.0.1: "every PROVISIONAL threshold
// with what it was calibrated on"; §10.6 / section J: same requirement for
// the rendered report).
//
// A threshold marked PROVISIONAL in a code comment is exactly the failure
// this section exists to prevent — the calibration note lives here, next to
// the value, as data any consumer (AnalysisResult assembly, the report's
// section J) can read mechanically, rather than as prose an implementer has
// to remember to transcribe correctly. Only the constants the frozen spec
// itself labels PROVISIONAL, or explicitly says have "no observations
// behind" them, appear here — verified against every such occurrence in the
// spec (§6.1, §6.2, §7.1, §7.2 M12). Every other PolicyConstants field is
// "fixed by policy" and carries no entry.
// ---------------------------------------------------------------------------

export interface PolicyThresholdProvenance {
  status: "PROVISIONAL";
  calibration: string;
}

export const POLICY_THRESHOLD_PROVENANCE: Partial<Record<keyof PolicyConstants, PolicyThresholdProvenance>> = {
  terminalRoicPremium: {
    status: "PROVISIONAL",
    calibration:
      'Assumes a permanent 3-point return premium for every company (I16); must carry that label wherever it drives a figure (§7.1, §10.4).',
  },
  preRevenueConstructionLeadYears: {
    status: "PROVISIONAL",
    calibration: "First-order estimate; worth $27/share on OKLO's 8 GW case (§7.1).",
  },
  leveredCostOfEquityCap: {
    status: "PROVISIONAL",
    calibration:
      "No observations behind the 30% level itself; capped cells are labelled RATE CAPPED — VALUE IS AN UPPER BOUND (I12, §7.1).",
  },
  gate0InterestIncomeOverRevenueThreshold: {
    status: "PROVISIONAL",
    calibration:
      "No observations behind it (Appendix B); the other three Gate 0 tests are classification lookups, not thresholds (§6.1).",
  },
  gate1HistoryInsufficientYears: {
    status: "PROVISIONAL",
    calibration:
      "Red-team judgment with no observations (Appendix B). Direction of error is suppression, so a wrong threshold shows less rather than something false (§6.2).",
  },
  gate1ShortHistoryYears: {
    status: "PROVISIONAL",
    calibration: "Red-team judgment with no observations (Appendix B), same basis as the <5-year threshold (§6.2).",
  },
  historyInsufficientStressMarginRelativeReductions: {
    status: "PROVISIONAL",
    calibration:
      "No observations; substitutes for a median that does not exist under HISTORY INSUFFICIENT (§6.2).",
  },
  runRateSequentialGrowthTrigger: {
    status: "PROVISIONAL",
    calibration: "Calibrated on NVIDIA only (Appendix B) (§7.2 M12).",
  },
  seasonalityPriorYearThreshold: {
    status: "PROVISIONAL",
    calibration: "Comes from I4 and has no observations behind it (§7.2 M12).",
  },
};

// Derives the AnalysisResult.policy.provisionalLabels member (§10.0.1)
// mechanically from POLICY_THRESHOLD_PROVENANCE, so Step 9 assembly can
// never omit or hand-retype a calibration note — there is exactly one place
// that can drift from the frozen contract.
export function buildProvisionalLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, provenance] of Object.entries(POLICY_THRESHOLD_PROVENANCE)) {
    if (provenance !== undefined) {
      labels[key] = provenance.calibration;
    }
  }
  return labels;
}
