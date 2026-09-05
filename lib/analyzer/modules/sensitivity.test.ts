import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { shouldDisplaySensitivityInput, buildSensitivityResult } from "./sensitivity";

describe("shouldDisplaySensitivityInput", () => {
  it("displays an input whose full-range impact is 10% or more", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("0.1"))).toBe(true);
    expect(shouldDisplaySensitivityInput(new Decimal("0.25"))).toBe(true);
  });

  it("suppresses an input whose full-range impact is below 10%", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("0.05"))).toBe(false);
  });

  it("uses the magnitude of impact regardless of direction", () => {
    expect(shouldDisplaySensitivityInput(new Decimal("-0.15"))).toBe(true);
    expect(shouldDisplaySensitivityInput(new Decimal("-0.05"))).toBe(false);
  });
});

describe("buildSensitivityResult", () => {
  it("always records that debt share was removed from the table (I10)", () => {
    expect(buildSensitivityResult().debtShareRemoved).toBe(true);
  });
});
