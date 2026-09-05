import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { suppressedValue, computedValue } from "./figures";
import { CLEAN_PROVENANCE } from "./provenance";

describe("suppressedValue", () => {
  it("always carries a cause — never optional", () => {
    const figure = suppressedValue("INCOMPLETE", "shares outstanding missing");
    expect(figure).toEqual({ suppressed: true, state: "INCOMPLETE", cause: "shares outstanding missing" });
  });
});

describe("computedValue", () => {
  it("defaults to no analytic flags when none are given", () => {
    const figure = computedValue(new Decimal("42"), CLEAN_PROVENANCE);
    expect(figure).toEqual({
      suppressed: false,
      value: new Decimal("42"),
      qualification: { provenanceTokens: CLEAN_PROVENANCE, analyticFlags: [] },
    });
  });

  it("carries explicit analytic flags", () => {
    const figure = computedValue(new Decimal("0.3"), CLEAN_PROVENANCE, [
      { flag: "CAPITAL-LIGHT" },
    ]);
    expect(figure.suppressed).toBe(false);
    if (!figure.suppressed) {
      expect(figure.qualification.analyticFlags).toEqual([{ flag: "CAPITAL-LIGHT" }]);
    }
  });
});
