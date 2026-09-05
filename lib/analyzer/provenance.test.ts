import { describe, it, expect } from "vitest";
import { combineProvenance, CLEAN_PROVENANCE } from "./provenance";
import type { ProvenanceTokens } from "./types";

describe("combineProvenance", () => {
  it("returns CLEAN_PROVENANCE when every input is clean", () => {
    expect(combineProvenance(CLEAN_PROVENANCE, CLEAN_PROVENANCE)).toEqual(CLEAN_PROVENANCE);
  });

  it("propagates SECONDARY when any single input is SECONDARY, no matter how many clean inputs are mixed in", () => {
    const secondary: ProvenanceTokens = { ...CLEAN_PROVENANCE, sourceClass: "SECONDARY" };
    const result = combineProvenance(CLEAN_PROVENANCE, CLEAN_PROVENANCE, secondary, CLEAN_PROVENANCE);
    expect(result.sourceClass).toBe("SECONDARY");
  });

  it("propagates AI-EXTRACTED when any single input is AI-EXTRACTED", () => {
    const aiExtracted: ProvenanceTokens = { ...CLEAN_PROVENANCE, extractionType: "AI-EXTRACTED" };
    const result = combineProvenance(CLEAN_PROVENANCE, aiExtracted);
    expect(result.extractionType).toBe("AI-EXTRACTED");
  });

  it("propagates UNVERIFIED like SECONDARY (I14)", () => {
    const unverified: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "UNVERIFIED" };
    const result = combineProvenance(CLEAN_PROVENANCE, unverified);
    expect(result.verificationState).toBe("UNVERIFIED");
  });

  it("propagates SPOT-CHECK PENDING when nothing worse is present", () => {
    const pending: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "SPOT-CHECK PENDING" };
    const result = combineProvenance(CLEAN_PROVENANCE, pending);
    expect(result.verificationState).toBe("SPOT-CHECK PENDING");
  });

  it("prefers UNVERIFIED over SPOT-CHECK PENDING when both are present", () => {
    const unverified: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "UNVERIFIED" };
    const pending: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "SPOT-CHECK PENDING" };
    const result = combineProvenance(unverified, pending);
    expect(result.verificationState).toBe("UNVERIFIED");
  });

  it("is never upgraded by aggregating many clean inputs alongside one weak one", () => {
    const secondary: ProvenanceTokens = { ...CLEAN_PROVENANCE, sourceClass: "SECONDARY" };
    const manyClean = Array(10).fill(CLEAN_PROVENANCE);
    const result = combineProvenance(...manyClean, secondary);
    expect(result.sourceClass).toBe("SECONDARY");
  });

  it("throws with no inputs, rather than silently defaulting to clean", () => {
    expect(() => combineProvenance()).toThrow();
  });
});
