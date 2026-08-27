import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { diffHoldings } from "./holdingsUpdate";

const h = (assetId: string, quantity: string, avgCostUsd: string) => ({
  assetId,
  quantity: new Decimal(quantity),
  avgCostUsd: new Decimal(avgCostUsd),
});

describe("diffHoldings", () => {
  it("emits no targets when every holding is unchanged in quantity AND avg cost", () => {
    const current = [h("1", "10", "100"), h("2", "5", "40")];
    const desired = [h("1", "10", "100"), h("2", "5", "40")];
    expect(diffHoldings(current, desired).targets).toEqual([]);
  });

  it("quantity up, avg cost unchanged -> one absolute target with the new quantity", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "15", "100")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].assetId).toBe("1");
    expect(targets[0].quantity.toString()).toBe("15");
    expect(targets[0].avgCostUsd.toString()).toBe("100");
  });

  it("quantity AND avg cost both change -> one target carrying both new values", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "12", "110")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].quantity.toString()).toBe("12");
    expect(targets[0].avgCostUsd.toString()).toBe("110");
  });

  it("quantity down, avg cost unchanged -> one absolute target", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "4", "100")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].quantity.toString()).toBe("4");
    expect(targets[0].avgCostUsd.toString()).toBe("100");
  });

  it("quantity down and avg cost change -> one target with both new values", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "4", "90")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].quantity.toString()).toBe("4");
    expect(targets[0].avgCostUsd.toString()).toBe("90");
  });

  it("avg-cost-only change -> one target whose quantity equals the prior quantity", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "10", "125")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].quantity.toString()).toBe("10");
    expect(targets[0].avgCostUsd.toString()).toBe("125");
  });

  it("holding removed (absent from desired) -> target quantity 0, prior avg cost kept as placeholder", () => {
    const { targets } = diffHoldings([h("1", "10", "100"), h("2", "5", "40")], [h("1", "10", "100")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].assetId).toBe("2");
    expect(targets[0].quantity.toString()).toBe("0");
    expect(targets[0].avgCostUsd.toString()).toBe("40");
  });

  it("holding added (present in desired, not in current) -> one target with the desired values", () => {
    const { targets } = diffHoldings([h("1", "10", "100")], [h("1", "10", "100"), h("3", "2", "3000")]);
    expect(targets).toHaveLength(1);
    expect(targets[0].assetId).toBe("3");
    expect(targets[0].quantity.toString()).toBe("2");
    expect(targets[0].avgCostUsd.toString()).toBe("3000");
  });

  it("compares by numeric value, not string form (10 == 10.0000000000)", () => {
    const { targets } = diffHoldings([h("1", "10.0000000000", "100.0000000000")], [h("1", "10", "100")]);
    expect(targets).toEqual([]);
  });
});
