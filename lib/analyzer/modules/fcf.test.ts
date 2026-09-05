import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeFcf, type FcfInput } from "./fcf";
import { CLEAN_PROVENANCE } from "../provenance";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function baseInput(overrides: Partial<FcfInput> = {}): FcfInput {
  return {
    operatingCashFlow: sourced(100),
    cashCapex: sourced(40),
    financeLeaseRouAdditions: sourced(24.6),
    nopat: sourced(70),
    depreciationAndAmortization: sourced(20),
    deltaNwc: sourced(5),
    sbc: sourced(8),
    ...overrides,
  };
}

function value(figure: { suppressed: boolean; value?: unknown }): Decimal {
  if (figure.suppressed) throw new Error("expected a computed value, got a suppressed state");
  return figure.value as Decimal;
}

describe("computeFcf", () => {
  it("computes cash FCF = OCF - cash capex", () => {
    const result = computeFcf(baseInput());
    expect(value(result.cashFcf).toString()).toBe("60");
  });

  it("computes FCF after lease-funded capacity = cash FCF - lease ROU additions", () => {
    const result = computeFcf(baseInput());
    expect(value(result.fcfAfterLeaseFundedCapacity).toString()).toBe("35.4");
  });

  it("computes unlevered FCF = NOPAT + D&A - cash capex - lease ROU additions - deltaNWC", () => {
    const result = computeFcf(baseInput());
    // 70 + 20 - 40 - 24.6 - 5 = 20.4
    expect(value(result.unleveredFcf).toString()).toBe("20.4");
  });

  it("shows SBC and the working-capital swing separately, not folded into any of the three figures", () => {
    const result = computeFcf(baseInput());
    expect(result.sbc?.toString()).toBe("8");
    expect(result.workingCapitalSwing?.toString()).toBe("5");
  });

  it("computes FCF yield showing both cash FCF and cash FCF less SBC (I6)", () => {
    const result = computeFcf(baseInput());
    expect(value(result.fcfYield.cashFcf).toString()).toBe("60");
    expect(value(result.fcfYield.cashFcfLessSbc).toString()).toBe("52");
  });

  it("V8: missing finance-lease ROU additions cascades to INCOMPLETE on unlevered FCF and FCF-after-lease, but NOT on cash FCF (§11.8)", () => {
    const result = computeFcf(baseInput({ financeLeaseRouAdditions: null }));
    expect(result.cashFcf.suppressed).toBe(false);
    expect(result.fcfAfterLeaseFundedCapacity.suppressed).toBe(true);
    expect(result.unleveredFcf.suppressed).toBe(true);
    if (result.fcfAfterLeaseFundedCapacity.suppressed) {
      expect(result.fcfAfterLeaseFundedCapacity.state).toBe("INCOMPLETE");
    }
  });

  it("missing SBC breaks only cashFcfLessSbc, leaving cash FCF itself unaffected", () => {
    const result = computeFcf(baseInput({ sbc: null }));
    expect(result.cashFcf.suppressed).toBe(false);
    expect(result.fcfYield.cashFcfLessSbc.suppressed).toBe(true);
    expect(result.sbc).toBeNull();
  });

  it("missing operating cash flow breaks cash FCF (and everything derived from it) but NOT unlevered FCF, which never uses OCF", () => {
    const result = computeFcf(baseInput({ operatingCashFlow: null }));
    expect(result.cashFcf.suppressed).toBe(true);
    expect(result.fcfAfterLeaseFundedCapacity.suppressed).toBe(true);
    expect(result.fcfYield.cashFcfLessSbc.suppressed).toBe(true);
    expect(result.unleveredFcf.suppressed).toBe(false);
  });

  it("combines provenance across cash FCF's two inputs", () => {
    const result = computeFcf(
      baseInput({ cashCapex: { value: new Decimal(40), provenance: { ...CLEAN_PROVENANCE, sourceClass: "SECONDARY" } } })
    );
    expect(result.cashFcf.suppressed).toBe(false);
    if (!result.cashFcf.suppressed) {
      expect(result.cashFcf.qualification.provenanceTokens.sourceClass).toBe("SECONDARY");
    }
  });
});
