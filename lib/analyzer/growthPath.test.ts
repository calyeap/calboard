import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { growthAt, buildFixedShapeGrowthPath } from "./growthPath";

describe("growthAt", () => {
  it("holds constant for years 1-5", () => {
    for (let t = 1; t <= 5; t++) {
      expect(growthAt(t, new Decimal("0.2"), new Decimal("0.03")).toString()).toBe("0.2");
    }
  });

  it("fades linearly from the constant rate to terminal growth over years 6-10", () => {
    expect(growthAt(6, new Decimal("0.2"), new Decimal("0.03")).toString()).toBe("0.166");
    expect(growthAt(10, new Decimal("0.2"), new Decimal("0.03")).toString()).toBe("0.03");
  });

  it("holds at terminal growth beyond year 10", () => {
    expect(growthAt(11, new Decimal("0.2"), new Decimal("0.03")).toString()).toBe("0.03");
    expect(growthAt(20, new Decimal("0.2"), new Decimal("0.03")).toString()).toBe("0.03");
  });
});

describe("buildFixedShapeGrowthPath", () => {
  it("returns exactly ten years, matching growthAt at each year", () => {
    const path = buildFixedShapeGrowthPath(new Decimal("0.2"));
    expect(path).toHaveLength(10);
    expect(path[0].toString()).toBe("0.2");
    expect(path[9].toString()).toBe("0.03");
  });
});
