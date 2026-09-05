import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeEnterpriseValue, computeEquityValueFromEnterpriseValue, type EnterpriseValueInput } from "./enterpriseValue";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number, overrides: Partial<typeof CLEAN_PROVENANCE> = {}) {
  return { value: new Decimal(value), provenance: { ...CLEAN_PROVENANCE, ...overrides } };
}

function baseInput(overrides: Partial<EnterpriseValueInput> = {}): EnterpriseValueInput {
  return {
    sharesOutstanding: sourced(100),
    treasuryMethodDilution: sourced(10),
    price: sourced(50),
    totalDebt: sourced(200),
    financeLeaseLiabilities: sourced(50),
    cashAndMarketableDebtSecurities: sourced(300),
    nonOperatingEquityInvestmentsAtBook: sourced(20),
    nonOperatingInvestmentsErrorDirection: null,
    ...overrides,
  };
}

describe("computeEnterpriseValue", () => {
  it("computes market cap from diluted shares (outstanding + treasury-method dilution), never weighted-average diluted shares", () => {
    const result = computeEnterpriseValue(baseInput());
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      // (100 + 10) * 50 = 5500
      expect(result.value.marketCap.toString()).toBe("5500");
    }
  });

  it("computes EV = market cap + debt + finance leases - cash - non-operating investments (§2.1)", () => {
    const result = computeEnterpriseValue(baseInput());
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      // 5500 + 200 + 50 - 300 - 20 = 5430
      expect(result.value.enterpriseValue.toString()).toBe("5430");
    }
  });

  it("carries the error direction for non-operating investments through unchanged", () => {
    const result = computeEnterpriseValue(baseInput({ nonOperatingInvestmentsErrorDirection: "understates" }));
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.value.nonOperatingInvestmentsErrorDirection).toBe("understates");
    }
  });

  it("treats a genuinely zero non-operating-investments figure as present, not missing", () => {
    const result = computeEnterpriseValue(baseInput({ nonOperatingEquityInvestmentsAtBook: sourced(0) }));
    expect(result.suppressed).toBe(false);
  });

  it.each(["sharesOutstanding", "treasuryMethodDilution", "price", "totalDebt", "financeLeaseLiabilities", "cashAndMarketableDebtSecurities", "nonOperatingEquityInvestmentsAtBook"] as const)(
    "returns INCOMPLETE, never a computed value, when %s is missing",
    (field) => {
      const result = computeEnterpriseValue(baseInput({ [field]: null }));
      expect(result.suppressed).toBe(true);
      if (result.suppressed) {
        expect(result.state).toBe("INCOMPLETE");
        expect(result.cause).toContain(field);
      }
    }
  );

  it("combines provenance across all seven inputs — one SECONDARY input makes the whole EV SECONDARY", () => {
    const result = computeEnterpriseValue(baseInput({ totalDebt: sourced(200, { sourceClass: "SECONDARY" }) }));
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.qualification.provenanceTokens.sourceClass).toBe("SECONDARY");
    }
  });
});

describe("computeEquityValueFromEnterpriseValue", () => {
  it("reverses the EV bridge exactly, recovering market cap from EV", () => {
    // Using the same fixture: EV 5430 -> equity value should recover 5500.
    const equityValue = computeEquityValueFromEnterpriseValue(
      new Decimal(5430),
      new Decimal(300),
      new Decimal(20),
      new Decimal(200),
      new Decimal(50)
    );
    expect(equityValue.toString()).toBe("5500");
  });
});
