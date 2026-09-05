import { describe, it, expect } from "vitest";
import { POLICY, UNDEFINED_POLICY_CONSTANTS, POLICY_THRESHOLD_PROVENANCE, buildProvisionalLabels } from "./policy";

describe("POLICY", () => {
  it("fixes the rate grid at 8% / 10% / 12% for every company", () => {
    expect(POLICY.rateGrid.map((r) => r.toString())).toEqual(["0.08", "0.1", "0.12"]);
  });

  it("fixes the leverage threshold at 10%", () => {
    expect(POLICY.leverageThreshold.toString()).toBe("0.1");
  });

  it("fixes terminal growth at 3%, never above nominal GDP", () => {
    expect(POLICY.terminalGrowth.toString()).toBe("0.03");
  });

  it("fixes the levered cost-of-equity cap at 30%", () => {
    expect(POLICY.leveredCostOfEquityCap.toString()).toBe("0.3");
  });

  it("fixes Gate 1's history thresholds at <5 and 5-9 filed years", () => {
    expect(POLICY.gate1HistoryInsufficientYears).toBe(5);
    expect(POLICY.gate1ShortHistoryYears).toBe(9);
  });

  it("fixes Gate 0's interest-income test at 50% of revenue", () => {
    expect(POLICY.gate0InterestIncomeOverRevenueThreshold.toString()).toBe("0.5");
  });
});

describe("UNDEFINED_POLICY_CONSTANTS", () => {
  it("keeps all four LATER constants explicitly null rather than a guessed number", () => {
    // A regression here would mean someone quietly assigned a real value to
    // one of the four constants the register records as undefined (§7.1) —
    // exactly the silent invention the frozen contract forbids.
    expect(UNDEFINED_POLICY_CONSTANTS).toEqual({
      nopatTaxRate: null,
      stressMarginLevel: null,
      preRevenueUnleveredRate: null,
      projectDebtCost: null,
    });
  });
});

describe("POLICY_THRESHOLD_PROVENANCE / buildProvisionalLabels", () => {
  it("records exactly the nine constants the frozen spec labels PROVISIONAL or 'no observations behind it', and no others", () => {
    // A hardcoded expected key set — verified against every PROVISIONAL /
    // "no observations" occurrence in the spec (§6.1, §6.2, §7.1, §7.2 M12).
    // A constant added here without spec support, or a genuinely provisional
    // constant left out, both fail this test.
    expect(Object.keys(POLICY_THRESHOLD_PROVENANCE).sort()).toEqual(
      [
        "terminalRoicPremium",
        "preRevenueConstructionLeadYears",
        "leveredCostOfEquityCap",
        "gate0InterestIncomeOverRevenueThreshold",
        "gate1HistoryInsufficientYears",
        "gate1ShortHistoryYears",
        "historyInsufficientStressMarginRelativeReductions",
        "runRateSequentialGrowthTrigger",
        "seasonalityPriorYearThreshold",
      ].sort()
    );
  });

  it("gives every entry a non-empty calibration note, never a bare PROVISIONAL tag with no explanation", () => {
    for (const provenance of Object.values(POLICY_THRESHOLD_PROVENANCE)) {
      expect(provenance?.status).toBe("PROVISIONAL");
      expect(provenance?.calibration.length).toBeGreaterThan(0);
    }
  });

  it("carries the Gate 0 threshold's 'no observations' basis specifically, per this session's ruling", () => {
    expect(POLICY_THRESHOLD_PROVENANCE.gate0InterestIncomeOverRevenueThreshold?.calibration).toContain(
      "No observations"
    );
  });

  it("derives provisionalLabels mechanically — same key set, same text, never hand-retyped", () => {
    const labels = buildProvisionalLabels();
    expect(Object.keys(labels).sort()).toEqual(Object.keys(POLICY_THRESHOLD_PROVENANCE).sort());
    expect(labels.gate0InterestIncomeOverRevenueThreshold).toBe(
      POLICY_THRESHOLD_PROVENANCE.gate0InterestIncomeOverRevenueThreshold?.calibration
    );
  });

  it("does not label a fixed (non-provisional) constant, e.g. the leverage or rate-grid thresholds", () => {
    expect(POLICY_THRESHOLD_PROVENANCE.leverageThreshold).toBeUndefined();
    expect(POLICY_THRESHOLD_PROVENANCE.rateGrid).toBeUndefined();
    expect(POLICY_THRESHOLD_PROVENANCE.terminalGrowth).toBeUndefined();
  });
});
