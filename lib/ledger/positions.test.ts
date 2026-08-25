import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { EMPTY_POSITION, applyBuy, applySell, avgCostUsd } from "./positions";

describe("average-cost position derivation", () => {
  it("blends cost across two buys at different prices", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(100), new Decimal(10), new Decimal(0));
    state = applyBuy(state, new Decimal(100), new Decimal(20), new Decimal(0));

    expect(state.quantity.toFixed(2)).toBe("200.00");
    expect(state.costBasisUsd.toFixed(2)).toBe("3000.00");
    expect(avgCostUsd(state)!.toFixed(2)).toBe("15.00");
  });

  it("realises P&L against the blended average, not a first-in lot (discriminates from FIFO)", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(100), new Decimal(10), new Decimal(0));
    state = applyBuy(state, new Decimal(100), new Decimal(20), new Decimal(0));
    state = applySell(state, new Decimal(50), new Decimal(25), new Decimal(0));

    // Average cost: realised = 50 * (25 - 15) = 500
    // FIFO would realise: 50 * (25 - 10) = 750 -- different number, proves this isn't FIFO
    expect(state.realisedPlUsd.toFixed(2)).toBe("500.00");
    expect(state.quantity.toFixed(2)).toBe("150.00");
  });

  it("throws when selling more than the current position", () => {
    let state = EMPTY_POSITION;
    state = applyBuy(state, new Decimal(10), new Decimal(100), new Decimal(0));
    expect(() =>
      applySell(state, new Decimal(20), new Decimal(100), new Decimal(0))
    ).toThrow();
  });
});
