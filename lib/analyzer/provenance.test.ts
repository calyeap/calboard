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

  // M7 — the three states Step 2 introduces (§3.8.1, §3.8.3). The first of
  // these is the one that matters: before M7 the function's final `else`
  // resolved anything it did not recognise to VERIFIED, so a NOT CONFIRMED
  // input would have been silently upgraded to clean. That is a fail-open on
  // exactly the fact the analyst said they could not verify, and §5.3 requires
  // fail-closed.
  it("propagates NOT CONFIRMED over every other state, never upgrading it to VERIFIED", () => {
    const notConfirmed: ProvenanceTokens = {
      ...CLEAN_PROVENANCE,
      verificationState: "NOT CONFIRMED",
    };
    const unverified: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "UNVERIFIED" };
    const pending: ProvenanceTokens = {
      ...CLEAN_PROVENANCE,
      verificationState: "SPOT-CHECK PENDING",
    };

    expect(combineProvenance(CLEAN_PROVENANCE, notConfirmed).verificationState).toBe(
      "NOT CONFIRMED"
    );
    expect(combineProvenance(notConfirmed, unverified).verificationState).toBe("NOT CONFIRMED");
    expect(combineProvenance(pending, notConfirmed).verificationState).toBe("NOT CONFIRMED");
    expect(
      combineProvenance(...Array(10).fill(CLEAN_PROVENANCE), notConfirmed).verificationState
    ).toBe("NOT CONFIRMED");
  });

  it("treats CONFIRMED as clean — it is the analyst having checked the figure", () => {
    const confirmed: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "CONFIRMED" };
    expect(combineProvenance(CLEAN_PROVENANCE, confirmed).verificationState).toBe("VERIFIED");
  });

  // §3.8.1: the tag-mapping exemption changes what is queued, not what is
  // carried. An exempt fact is not weaker than a verified one, so it does not
  // drag a combination down.
  it("treats SPOT-CHECK NOT REQUIRED as clean, per the §3.8.1 exemption", () => {
    const exempt: ProvenanceTokens = {
      ...CLEAN_PROVENANCE,
      verificationState: "SPOT-CHECK NOT REQUIRED",
    };
    expect(combineProvenance(CLEAN_PROVENANCE, exempt).verificationState).toBe("VERIFIED");
  });

  it("still ranks UNVERIFIED above SPOT-CHECK PENDING once the M7 states exist", () => {
    const unverified: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "UNVERIFIED" };
    const exempt: ProvenanceTokens = {
      ...CLEAN_PROVENANCE,
      verificationState: "SPOT-CHECK NOT REQUIRED",
    };
    expect(combineProvenance(unverified, exempt).verificationState).toBe("UNVERIFIED");
  });
});
