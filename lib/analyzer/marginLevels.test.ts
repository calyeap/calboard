import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolveMarginLevels } from "./marginLevels";

describe("resolveMarginLevels", () => {
  it("uses current and median as real figures, with stress INCOMPLETE, for a normal-history company", () => {
    const result = resolveMarginLevels(new Decimal("0.468"), new Decimal("0.418"), null);
    expect(result.current.toString()).toBe("0.468");
    expect(result.median.toString()).toBe("0.418");
    expect(result.stress.suppressed).toBe(true);
    if (result.stress.suppressed) {
      expect(result.stress.state).toBe("INCOMPLETE");
      expect(result.stress.cause).toContain("stress margin level");
    }
  });

  it("uses real current and median for SHORT HISTORY too — only HISTORY INSUFFICIENT gets the substitute triad", () => {
    const result = resolveMarginLevels(new Decimal("0.3"), new Decimal("0.25"), "SHORT HISTORY");
    expect(result.median.toString()).toBe("0.25");
    expect(result.stress.suppressed).toBe(true);
  });

  it("substitutes current, -25% and -50% relative for HISTORY INSUFFICIENT — no INCOMPLETE at all", () => {
    const result = resolveMarginLevels(new Decimal("0.2"), new Decimal("0.15"), "HISTORY INSUFFICIENT");
    expect(result.current.toString()).toBe("0.2");
    // median slot substituted with current * 0.75
    expect(result.median.toString()).toBe("0.15");
    expect(result.stress.suppressed).toBe(false);
    if (!result.stress.suppressed) {
      // stress slot substituted with current * 0.5
      expect(result.stress.value.toString()).toBe("0.1");
    }
  });

  it("ignores the passed-in median under HISTORY INSUFFICIENT — it is not trustworthy with <5 years", () => {
    const result = resolveMarginLevels(new Decimal("0.2"), new Decimal("0.199"), "HISTORY INSUFFICIENT");
    // The real (untrustworthy) median passed in is 0.199, but the resolved
    // "median" slot must be the policy substitute (0.15), not that value.
    expect(result.median.toString()).toBe("0.15");
  });

  it("uses an explicitly configured stress margin level instead of INCOMPLETE when one is supplied", () => {
    const result = resolveMarginLevels(new Decimal("0.468"), new Decimal("0.418"), null, new Decimal("0.38"));
    expect(result.stress.suppressed).toBe(false);
    if (!result.stress.suppressed) {
      expect(result.stress.value.toString()).toBe("0.38");
    }
  });

  it("an explicitly configured value has no effect under HISTORY INSUFFICIENT — the substitute triad still governs", () => {
    const result = resolveMarginLevels(new Decimal("0.2"), new Decimal("0.15"), "HISTORY INSUFFICIENT", new Decimal("0.38"));
    expect(result.stress.suppressed).toBe(false);
    if (!result.stress.suppressed) {
      expect(result.stress.value.toString()).toBe("0.1"); // still the policy substitute, not 0.38
    }
  });
});
