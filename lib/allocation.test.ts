import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeAllocation, groupByAssetClass, type AllocationInput } from "./allocation";

const priced = (symbol: string, marketValueUsd: string): AllocationInput => ({
  symbol,
  marketValueUsd: new Decimal(marketValueUsd),
});
const unpriced = (symbol: string): AllocationInput => ({ symbol, marketValueUsd: null });

describe("computeAllocation", () => {
  it("two priced holdings — entries for both, percentages of the passed priced total, and no second total", () => {
    const total = new Decimal("400.00");
    const result = computeAllocation([priced("AAA", "300.00"), priced("BBB", "100.00")], total);

    expect(result.hasAllocation).toBe(true);
    expect(result.entries.map((e) => e.symbol)).toEqual(["AAA", "BBB"]);
    expect(result.entries[0]).toMatchObject({ symbol: "AAA", percent: "75.00", marketValueUsd: "300.00" });
    expect(result.entries[1]).toMatchObject({ symbol: "BBB", percent: "25.00", marketValueUsd: "100.00" });
    // The centre total is exactly the aggregate that was handed in — the
    // same value the Dashboard shows as "Portfolio Value".
    expect(result.totalUsd).toBe(total.toFixed(2));
  });

  it("partially unpriced — a holding with no usable market value is excluded from the entries", () => {
    // total reflects only the priced holdings (matches getPortfolioView.totalMarketValueUsd)
    const total = new Decimal("500.00");
    const result = computeAllocation(
      [priced("AAA", "300.00"), priced("BBB", "200.00"), unpriced("NOPX")],
      total
    );

    expect(result.hasAllocation).toBe(true);
    expect(result.entries.map((e) => e.symbol)).toEqual(["AAA", "BBB"]);
    expect(result.entries.find((e) => e.symbol === "NOPX")).toBeUndefined();
    expect(result.entries[0].percent).toBe("60.00");
    expect(result.entries[1].percent).toBe("40.00");
  });

  // Unit scope only: this proves a non-null market value is included. It does
  // NOT exercise priceStatus — the page-level test in app/page.test.tsx owns
  // the "stale prices still count for allocation" boundary.
  it("any holding with a non-null market value is included", () => {
    const total = new Decimal("250.00");
    const result = computeAllocation([priced("STALE", "250.00")], total);
    expect(result.hasAllocation).toBe(true);
    expect(result.entries.map((e) => e.symbol)).toEqual(["STALE"]);
  });

  it("fully unpriced — no allocation, empty entries, total still echoes the aggregate", () => {
    const total = new Decimal("0");
    const result = computeAllocation([unpriced("AAA"), unpriced("BBB")], total);
    expect(result.hasAllocation).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.totalUsd).toBe("0.00");
  });

  it("a zero priced total (no usable value) yields no allocation even if a row is technically 'priced'", () => {
    const result = computeAllocation([priced("ZERO", "0")], new Decimal("0"));
    expect(result.hasAllocation).toBe(false);
  });

  it("a single included holding is 100%", () => {
    const total = new Decimal("1234.56");
    const result = computeAllocation([priced("ONLY", "1234.56")], total);
    expect(result.hasAllocation).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ symbol: "ONLY", percent: "100.00", marketValueUsd: "1234.56" });
    expect(result.entries[0].percentNumber).toBe(100);
  });

  it("percentNumber is a plain Number for SVG geometry only; money stays Decimal-precise", () => {
    const result = computeAllocation(
      [priced("A", "100"), priced("B", "100"), priced("C", "100")],
      new Decimal("300")
    );
    // 100/300 = 33.333… — Decimal-exact to 2dp, and the Number form is finite.
    expect(result.entries[0].percent).toBe("33.33");
    expect(typeof result.entries[0].percentNumber).toBe("number");
    expect(Number.isFinite(result.entries[0].percentNumber)).toBe(true);
  });
});

describe("groupByAssetClass", () => {
  it("sums priced holdings of the same class into one entry labelled by class", () => {
    const grouped = groupByAssetClass([
      { symbol: "AAPL", assetClass: "equity", marketValueUsd: new Decimal("300") },
      { symbol: "NOW", assetClass: "equity", marketValueUsd: new Decimal("200") },
      { symbol: "VOO", assetClass: "etf", marketValueUsd: new Decimal("400") },
    ]);

    expect(grouped).toEqual([
      { symbol: "Equity", marketValueUsd: new Decimal("500") },
      { symbol: "ETF", marketValueUsd: new Decimal("400") },
    ]);
  });

  it("a class with one priced and one unpriced holding sums only the priced one", () => {
    const grouped = groupByAssetClass([
      { symbol: "AAPL", assetClass: "equity", marketValueUsd: new Decimal("300") },
      { symbol: "NOPX", assetClass: "equity", marketValueUsd: null },
    ]);

    expect(grouped).toEqual([{ symbol: "Equity", marketValueUsd: new Decimal("300") }]);
  });

  it("a class whose every holding is unpriced is omitted entirely, not passed through as null", () => {
    const grouped = groupByAssetClass([
      { symbol: "NOPX", assetClass: "crypto", marketValueUsd: null },
      { symbol: "AAPL", assetClass: "equity", marketValueUsd: new Decimal("100") },
    ]);

    expect(grouped.map((g) => g.symbol)).toEqual(["Equity"]);
  });

  it("preserves first-encounter order of asset classes", () => {
    const grouped = groupByAssetClass([
      { symbol: "BTC", assetClass: "crypto", marketValueUsd: new Decimal("1") },
      { symbol: "AAPL", assetClass: "equity", marketValueUsd: new Decimal("1") },
      { symbol: "VOO", assetClass: "etf", marketValueUsd: new Decimal("1") },
      { symbol: "ETH", assetClass: "crypto", marketValueUsd: new Decimal("1") },
    ]);

    expect(grouped.map((g) => g.symbol)).toEqual(["Crypto", "Equity", "ETF"]);
  });
});
