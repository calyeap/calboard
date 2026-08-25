import { describe, it, expect } from "vitest";
import { isPriceCacheFresh } from "./index";

describe("isPriceCacheFresh", () => {
  it("is fresh within the 12-hour window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const retrievedAt = new Date("2026-01-01T06:00:00Z");
    expect(isPriceCacheFresh(retrievedAt, now)).toBe(true);
  });

  it("is stale after the 12-hour window", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const retrievedAt = new Date("2026-01-01T06:00:00Z");
    expect(isPriceCacheFresh(retrievedAt, now)).toBe(false);
  });
});
