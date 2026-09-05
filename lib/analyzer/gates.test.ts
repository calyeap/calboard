import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  evaluateGate0,
  evaluateGate1,
  evaluateLeverage,
  evaluateTriggerA,
  evaluateTriggerB,
  type Gate0Input,
  type LeverageInput,
} from "./gates";

// Fixtures below marked "illustrative" are constructed to match the shape
// of a documented reference case (a threshold crossed, a described decline)
// without claiming to reproduce that company's exact reported figures — the
// full MSFT/OKLO acceptance fixtures (§11.4, §11.6) are built as their own
// dedicated fixture once enough modules exist to assemble a full
// AnalysisResult, not scattered ad hoc across every module's unit tests.

function gate0Input(overrides: Partial<Gate0Input> = {}): Gate0Input {
  return {
    sectorClassification: "Technology",
    interestIncomeOverRevenue: new Decimal("0.01"),
    hasInsurancePremiumOrReserveLineItems: false,
    industryClassification: "Software",
    override: null,
    ...overrides,
  };
}

describe("evaluateGate0", () => {
  it("passes a clean, classifiable, non-asset-based company", () => {
    expect(evaluateGate0(gate0Input()).result).toBe("PASS");
  });

  it("refuses on sector classification Financials", () => {
    const result = evaluateGate0(gate0Input({ sectorClassification: "Financials" }));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses on sector classification Real Estate (V7's bank case shape, §11.7)", () => {
    const result = evaluateGate0(gate0Input({ sectorClassification: "Real Estate" }));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses when interest income exceeds 50% of revenue", () => {
    const result = evaluateGate0(gate0Input({ interestIncomeOverRevenue: new Decimal("0.51") }));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("does not refuse at exactly 50% interest income — the test is 'exceeds'", () => {
    const result = evaluateGate0(gate0Input({ interestIncomeOverRevenue: new Decimal("0.5") }));
    expect(result.result).toBe("PASS");
  });

  it("refuses when insurance premium or policy-reserve line items appear", () => {
    const result = evaluateGate0(gate0Input({ hasInsurancePremiumOrReserveLineItems: true }));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses on reserve-based industry classification (mining)", () => {
    const result = evaluateGate0(gate0Input({ industryClassification: "Mining" }));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses on reserve-based industry classification (oil & gas E&P)", () => {
    const result = evaluateGate0(
      gate0Input({ industryClassification: "Oil & Gas Exploration & Production" })
    );
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("fails closed to CLASSIFICATION UNAVAILABLE when sector classification is missing and nothing else fires (B1's classification-stripped variant)", () => {
    const result = evaluateGate0(
      gate0Input({
        sectorClassification: null,
        interestIncomeOverRevenue: null,
        hasInsurancePremiumOrReserveLineItems: null,
        industryClassification: null,
      })
    );
    expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
  });

  // §4.2 lists five REQUIRED inputs for Gate 0: sector classification;
  // interest income; revenue; primary statement line items; industry
  // classification. Each is removed individually here, with every other
  // input present and non-disqualifying, to prove Gate 0 never falls
  // through to PASS on partial data — it fails closed to CLASSIFICATION
  // UNAVAILABLE regardless of which single required input is missing
  // (§5.3 point 1's own designated fail-closed output for this gate, not
  // the module-generic INCOMPLETE of §5.3 point 3).
  describe("fails closed to CLASSIFICATION UNAVAILABLE — never PASS — when any single §4.2 REQUIRED input is missing", () => {
    it("sector classification missing", () => {
      const result = evaluateGate0(gate0Input({ sectorClassification: null }));
      expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    });

    it("interest income missing (collapsed into the null interestIncomeOverRevenue ratio — the ratio cannot be evaluated without it)", () => {
      const result = evaluateGate0(gate0Input({ interestIncomeOverRevenue: null }));
      expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    });

    it("revenue missing (collapsed into the same null interestIncomeOverRevenue ratio as interest income — this data model has no way to distinguish the two, and nothing downstream needs it to)", () => {
      const result = evaluateGate0(gate0Input({ interestIncomeOverRevenue: null }));
      expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    });

    it("primary statement line items missing (represented by hasInsurancePremiumOrReserveLineItems being null, not a known false)", () => {
      const result = evaluateGate0(gate0Input({ hasInsurancePremiumOrReserveLineItems: null }));
      expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    });

    it("industry classification missing", () => {
      const result = evaluateGate0(gate0Input({ industryClassification: null }));
      expect(result.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    });

    it("no partial-input combination returns PASS — every non-empty subset of the five missing still fails closed", () => {
      const missingFieldSets: Partial<Gate0Input>[] = [
        { sectorClassification: null },
        { interestIncomeOverRevenue: null },
        { hasInsurancePremiumOrReserveLineItems: null },
        { industryClassification: null },
        { sectorClassification: null, industryClassification: null },
        {
          sectorClassification: null,
          interestIncomeOverRevenue: null,
          hasInsurancePremiumOrReserveLineItems: null,
          industryClassification: null,
        },
      ];
      for (const missing of missingFieldSets) {
        expect(evaluateGate0(gate0Input(missing)).result).not.toBe("PASS");
      }
    });
  });

  it("prefers the concrete asset-based refusal over CLASSIFICATION UNAVAILABLE when both could apply", () => {
    // Sector classification is missing, but industry classification alone
    // already proves the asset-based row — the more specific refusal wins.
    const result = evaluateGate0(
      gate0Input({ sectorClassification: null, industryClassification: "Mining" })
    );
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("carries the override record through unchanged", () => {
    const override = { reason: "manual review", acknowledgedNotValidated: true as const };
    const result = evaluateGate0(gate0Input({ sectorClassification: "Financials", override }));
    expect(result.override).toBe(override);
  });
});

describe("evaluateGate1", () => {
  it("returns HISTORY INSUFFICIENT below 5 filed years (V2's short-history IPO, §11.2)", () => {
    expect(evaluateGate1({ filedYearsCount: 3 }).state).toBe("HISTORY INSUFFICIENT");
    expect(evaluateGate1({ filedYearsCount: 4 }).state).toBe("HISTORY INSUFFICIENT");
  });

  it("returns SHORT HISTORY from 5 to 9 filed years", () => {
    expect(evaluateGate1({ filedYearsCount: 5 }).state).toBe("SHORT HISTORY");
    expect(evaluateGate1({ filedYearsCount: 9 }).state).toBe("SHORT HISTORY");
  });

  it("returns no state at 10 or more filed years", () => {
    expect(evaluateGate1({ filedYearsCount: 10 }).state).toBeNull();
    expect(evaluateGate1({ filedYearsCount: 20 }).state).toBeNull();
  });

  it("never refuses — every year count returns a result, not a FAIL", () => {
    for (const years of [0, 3, 5, 9, 10, 30]) {
      expect(() => evaluateGate1({ filedYearsCount: years })).not.toThrow();
    }
  });
});

function leverageInput(overrides: Partial<LeverageInput> = {}): LeverageInput {
  return {
    totalDebt: new Decimal("97"),
    financeLeaseLiabilities: new Decimal("66.6"),
    cashAndMarketableDebtSecurities: new Decimal("133.6"),
    enterpriseValue: new Decimal("3780"),
    operatingLeaseLiabilities: null,
    leveredResidualExceptionApplies: false,
    ...overrides,
  };
}

describe("evaluateLeverage", () => {
  it("passes at a low net-debt ratio (Microsoft-inspired shape: net debt ~$30B including finance leases against a ~$3.78T EV, §6.5)", () => {
    const result = evaluateLeverage(leverageInput());
    expect(result.result).toBe("PASS");
    // (97 + 66.6 - 133.6) / 3780 = 30 / 3780 ≈ 0.0079
    expect(result.netDebtRatio?.toDecimalPlaces(4).toString()).toBe("0.0079");
  });

  it("computes the operating-lease-inclusive memo independently of the main ratio", () => {
    const result = evaluateLeverage(
      leverageInput({ operatingLeaseLiabilities: new Decimal("20") })
    );
    // (97 + 66.6 + 20 - 133.6) / 3780 = 50 / 3780
    expect(result.operatingLeaseInclusiveMemo?.toDecimalPlaces(4).toString()).toBe("0.0132");
  });

  it("omits the memo when operating lease liabilities are not supplied", () => {
    const result = evaluateLeverage(leverageInput({ operatingLeaseLiabilities: null }));
    expect(result.operatingLeaseInclusiveMemo).toBeNull();
  });

  it("fails at or above a 10% net-debt ratio", () => {
    const result = evaluateLeverage(
      leverageInput({
        totalDebt: new Decimal("400"),
        financeLeaseLiabilities: new Decimal("0"),
        cashAndMarketableDebtSecurities: new Decimal("0"),
        enterpriseValue: new Decimal("3780"),
      })
    );
    expect(result.result).toBe("LEVERAGE UNSUPPORTED IN v1");
  });

  it("fails closed when a required input is missing, never defaulting to PASS (§5.3, V8)", () => {
    const result = evaluateLeverage(leverageInput({ financeLeaseLiabilities: null }));
    expect(result.result).toBe("LEVERAGE UNSUPPORTED IN v1");
    expect(result.netDebtRatio).toBeNull();
  });

  it("carries the levered-residual exception flag through without changing the PASS/FAIL result (OKLO-inspired shape: passes today at low leverage, §6.5)", () => {
    const withoutException = evaluateLeverage(leverageInput({ leveredResidualExceptionApplies: false }));
    const withException = evaluateLeverage(leverageInput({ leveredResidualExceptionApplies: true }));
    expect(withoutException.result).toBe(withException.result);
    expect(withoutException.netDebtRatio?.toString()).toBe(withException.netDebtRatio?.toString());
    expect(withoutException.leveredResidualExceptionApplies).toBe(false);
    expect(withException.leveredResidualExceptionApplies).toBe(true);
  });
});

function margins(values: number[]): Decimal[] {
  return values.map((v) => new Decimal(v));
}

describe("evaluateTriggerA", () => {
  it("fires when current margin is near the window max and the range exceeds 15 points (Microsoft-inspired shape: margin at historical high, no big single-year drop)", () => {
    const result = evaluateTriggerA({
      yearlyOperatingMargins: margins([0.3, 0.32, 0.34, 0.35, 0.37, 0.39, 0.41, 0.43, 0.45, 0.468]),
    });
    expect(result.fired).toBe(true);
  });

  it("does not fire when the range is 15 points or less even at the max", () => {
    const result = evaluateTriggerA({ yearlyOperatingMargins: margins([0.4, 0.42, 0.45, 0.48, 0.5]) });
    expect(result.fired).toBe(false);
  });

  it("does not fire when current margin is not near the max, even with a wide range", () => {
    const result = evaluateTriggerA({ yearlyOperatingMargins: margins([0.5, 0.3, 0.2]) });
    expect(result.fired).toBe(false);
  });

  it("fires exactly at the 2-point proximity boundary", () => {
    // max is 0.50 (first year); current 0.48 is exactly 2 points below it.
    const result = evaluateTriggerA({ yearlyOperatingMargins: margins([0.5, 0.2, 0.48]) });
    expect(result.fired).toBe(true);
  });
});

describe("evaluateTriggerB", () => {
  it("does not fire on a rising margin history with no decline", () => {
    const result = evaluateTriggerB({
      yearlyOperatingMargins: margins([0.3, 0.32, 0.34, 0.35, 0.37, 0.39, 0.41, 0.43, 0.45, 0.468]),
    });
    expect(result.fired).toBe(false);
  });

  it("fires on a single-year decline exceeding 10 points (NVIDIA-inspired shape: a 21-point single-year cut, §6.4)", () => {
    const result = evaluateTriggerB({ yearlyOperatingMargins: margins([0.3, 0.45, 0.55, 0.34, 0.552]) });
    expect(result.fired).toBe(true);
  });

  it("does not fire on a decline of exactly 10 points — the test is 'more than'", () => {
    const result = evaluateTriggerB({ yearlyOperatingMargins: margins([0.5, 0.4]) });
    expect(result.fired).toBe(false);
  });

  it("fires just above the 10-point boundary", () => {
    const result = evaluateTriggerB({ yearlyOperatingMargins: margins([0.501, 0.4]) });
    expect(result.fired).toBe(true);
  });
});

describe("triggers evaluated together — NVIDIA-inspired shape fires both, Microsoft-inspired shape fires A only (§6.4, §11.4, §11.5)", () => {
  it("fires A only when margin is at a historical high with no observed decline", () => {
    const input = {
      yearlyOperatingMargins: margins([0.3, 0.32, 0.34, 0.35, 0.37, 0.39, 0.41, 0.43, 0.45, 0.468]),
    };
    expect(evaluateTriggerA(input).fired).toBe(true);
    expect(evaluateTriggerB(input).fired).toBe(false);
  });

  it("fires both when margin is at a historical high AND a single-year decline exceeds 10 points", () => {
    const input = { yearlyOperatingMargins: margins([0.3, 0.45, 0.55, 0.34, 0.552]) };
    expect(evaluateTriggerA(input).fired).toBe(true);
    expect(evaluateTriggerB(input).fired).toBe(true);
  });
});
