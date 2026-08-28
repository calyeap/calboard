import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeAvgCostUsd, isDuplicateTickerInDraft } from "./draftHoldings";

describe("computeAvgCostUsd", () => {
  it("returns the cost input directly in average mode", () => {
    expect(computeAvgCostUsd(new Decimal(10), new Decimal(42.5), "average").toFixed(2)).toBe("42.50");
  });

  it("divides by quantity in total mode", () => {
    expect(computeAvgCostUsd(new Decimal(10), new Decimal(425), "total").toFixed(2)).toBe("42.50");
  });

  it("is exact (no floating-point drift) for a non-terminating decimal division", () => {
    // 100 / 3 = 33.333... — Decimal keeps this to its configured precision,
    // unlike a native float division.
    const result = computeAvgCostUsd(new Decimal(3), new Decimal(100), "total");
    expect(result.mul(3).toFixed(2)).toBe("100.00");
  });

  it("throws when deriving an average from a total cost basis at zero quantity", () => {
    expect(() => computeAvgCostUsd(new Decimal(0), new Decimal(100), "total")).toThrow(/quantity is zero/);
  });
});

describe("isDuplicateTickerInDraft", () => {
  it("is case-insensitive", () => {
    expect(isDuplicateTickerInDraft(["AAPL", "VOO"], "aapl")).toBe(true);
  });

  it("is false for a genuinely new ticker", () => {
    expect(isDuplicateTickerInDraft(["AAPL", "VOO"], "BTC")).toBe(false);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(isDuplicateTickerInDraft(["AAPL"], "  aapl  ")).toBe(true);
  });

  it("is false against an empty draft list", () => {
    expect(isDuplicateTickerInDraft([], "AAPL")).toBe(false);
  });
});
