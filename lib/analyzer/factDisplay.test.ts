import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { formatFactValue } from "./factDisplay";
import { factUnit } from "./acquisition/factUnit";

// ---------------------------------------------------------------------------
// Display formatting. Ruled by Calvin, 8 September 2026.
//
// The three figures the ruling named, and the unit they are formatted under —
// which comes from acquisition, never from this layer guessing.
// ---------------------------------------------------------------------------

describe("the three figures the ruling named", () => {
  it("renders an operating margin as a percentage, not a twenty-place quotient", () => {
    expect(
      formatFactValue(
        new Decimal("0.46780818408927220731"),
        factUnit("current-operating-margin")
      )
    ).toBe("46.8%");
  });

  it("renders net debt in billions", () => {
    expect(formatFactValue(new Decimal("30045000000"), factUnit("net-debt"))).toBe("$30.0B");
  });

  it("renders cash FCF in billions", () => {
    expect(formatFactValue(new Decimal("66987000000"), factUnit("cash-fcf"))).toBe("$67.0B");
  });
});

describe("the unit comes from acquisition", () => {
  it("takes a tag-mapped fact's unit from the mapping that acquired it", () => {
    expect(factUnit("current-revenue")).toBe("USD");
    expect(factUnit("shares-outstanding")).toBe("shares");
    expect(factUnit("treasury-method-dilution")).toBe("shares");
  });

  it("knows the units of the facts this layer computes", () => {
    expect(factUnit("current-operating-margin")).toBe("pure");
    expect(factUnit("net-debt")).toBe("USD");
    expect(factUnit("cash-fcf")).toBe("USD");
    expect(factUnit("price")).toBe("USD");
  });

  it("returns null for a fact it does not know, rather than guessing", () => {
    // The load-bearing one. A wrong unit formats a figure into something that
    // looks entirely plausible and is wrong by a factor of a hundred.
    expect(factUnit("not-a-fact")).toBeNull();
  });

  it("renders an unknown unit exactly as acquired", () => {
    expect(formatFactValue(new Decimal("30045000000"), null)).toBe("30045000000");
  });
});

describe("magnitudes and signs", () => {
  it("scales millions", () => {
    expect(formatFactValue(new Decimal("33205000"), "USD")).toBe("$33.2M");
  });

  it("keeps a sign on a negative figure", () => {
    // OKLO's real cash FCF.
    expect(formatFactValue(new Decimal("-115379000"), "USD")).toBe("-$115.4M");
  });

  it("groups a figure below a million rather than scaling it", () => {
    expect(formatFactValue(new Decimal("187000"), "USD")).toBe("$187,000");
  });

  it("keeps a price at its quoted precision", () => {
    expect(formatFactValue(new Decimal("499.7"), "USD")).toBe("$499.7");
  });

  it("does NOT scale a share count", () => {
    // §3.5 turns on the exact count and the cover page states every digit, so
    // "7.4B" would be the one form the analyst cannot compare against it.
    expect(formatFactValue(new Decimal("7425545491"), "shares")).toBe("7,425,545,491 shares");
  });

  it("renders a negative margin as a percentage, sign intact", () => {
    expect(formatFactValue(new Decimal("-1.015"), "pure")).toBe("-101.5%");
  });
});

describe("absence", () => {
  it("shows a dash, never a zero", () => {
    // §4.3 — absence is displayed, never rendered as zero.
    expect(formatFactValue(null, "USD")).toBe("—");
    expect(formatFactValue(null, "pure")).toBe("—");
    expect(formatFactValue(null, null)).toBe("—");
  });

  it("passes a non-numeric value through untouched", () => {
    expect(formatFactValue("Information Technology", "USD")).toBe("Information Technology");
  });
});

describe("the exact value is never recomputed from the formatted string", () => {
  it("formats without mutating or rounding the source Decimal", () => {
    const exact = new Decimal("0.46780818408927220731");
    formatFactValue(exact, "pure");
    expect(exact.toString()).toBe("0.46780818408927220731");
  });
});
