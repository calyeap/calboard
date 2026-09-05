import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeShapeMismatch } from "./shapeMismatch";

describe("computeShapeMismatch", () => {
  it("fires when the gap exceeds 15 points", () => {
    const result = computeShapeMismatch(new Decimal("0.4"), new Decimal("0.2"));
    expect(result.fired).toBe(true);
    expect(result.gapPoints?.toString()).toBe("0.2");
  });

  it("does not fire at exactly 15 points — the test is 'more than'", () => {
    const result = computeShapeMismatch(new Decimal("0.35"), new Decimal("0.2"));
    expect(result.fired).toBe(false);
    expect(result.gapPoints).toBeNull();
  });

  it("fires regardless of which growth figure is larger", () => {
    const result = computeShapeMismatch(new Decimal("0.1"), new Decimal("0.3"));
    expect(result.fired).toBe(true);
  });

  it("does not fire when either input is unavailable", () => {
    expect(computeShapeMismatch(null, new Decimal("0.2")).fired).toBe(false);
    expect(computeShapeMismatch(new Decimal("0.4"), null).fired).toBe(false);
  });
});
