import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeRateSensitivity } from "./rateSensitivity";

describe("computeRateSensitivity", () => {
  it("reports the percentage change in value from a +1 point rate shift", () => {
    const result = computeRateSensitivity(new Decimal(1000), new Decimal(920), new Decimal(1000));
    expect(result.plusOnePoint.toString()).toBe("-0.08");
  });

  it("reports the percentage change in value from a -1 point rate shift", () => {
    const result = computeRateSensitivity(new Decimal(1000), new Decimal(1000), new Decimal(1100));
    expect(result.minusOnePoint.toString()).toBe("0.1");
  });

  it("always carries the caveat flag", () => {
    const result = computeRateSensitivity(new Decimal(1000), new Decimal(900), new Decimal(1100));
    expect(result.closeToDeterministicFunctionOfTerminalShare).toBe(true);
  });
});
