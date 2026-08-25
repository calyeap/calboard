import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeCashEffectUsd } from "./cashEffect";

describe("computeCashEffectUsd", () => {
  it("computes BUY as -(qty*price)-fees", () => {
    const result = computeCashEffectUsd({
      txnType: "BUY",
      quantity: new Decimal(50),
      priceUsd: new Decimal(200),
      feesUsd: new Decimal(2),
    });
    expect(result.toFixed(2)).toBe("-10002.00");
  });

  it("computes SELL as +(qty*price)-fees", () => {
    const result = computeCashEffectUsd({
      txnType: "SELL",
      quantity: new Decimal(10),
      priceUsd: new Decimal(150),
      feesUsd: new Decimal(1),
    });
    expect(result.toFixed(2)).toBe("1499.00");
  });

  it("computes DEPOSIT as +grossAmount", () => {
    const result = computeCashEffectUsd({
      txnType: "DEPOSIT",
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(5000),
    });
    expect(result.toFixed(2)).toBe("5000.00");
  });

  it("computes WITHDRAWAL as -grossAmount", () => {
    const result = computeCashEffectUsd({
      txnType: "WITHDRAWAL",
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(500),
    });
    expect(result.toFixed(2)).toBe("-500.00");
  });

  it("throws on BUY without quantity", () => {
    expect(() =>
      computeCashEffectUsd({ txnType: "BUY", feesUsd: new Decimal(0) })
    ).toThrow();
  });
});
