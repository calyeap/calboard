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

  it("propagates SPOT-CHECK PENDING when nothing worse is present", () => {
    const pending: ProvenanceTokens = { ...CLEAN_PROVENANCE, verificationState: "SPOT-CHECK PENDING" };
    const result = combineProvenance(CLEAN_PROVENANCE, pending);
    expect(result.verificationState).toBe("SPOT-CHECK PENDING");
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
  const withState = (verificationState: ProvenanceTokens["verificationState"]) => ({
    ...CLEAN_PROVENANCE,
    verificationState,
  });

  it("propagates NOT CONFIRMED over every other state, never upgrading it", () => {
    const notConfirmed = withState("NOT CONFIRMED");

    expect(combineProvenance(CLEAN_PROVENANCE, notConfirmed).verificationState).toBe(
      "NOT CONFIRMED"
    );
    expect(
      combineProvenance(withState("SPOT-CHECK PENDING"), notConfirmed).verificationState
    ).toBe("NOT CONFIRMED");
    expect(
      combineProvenance(withState("SPOT-CHECK NOT REQUIRED"), notConfirmed).verificationState
    ).toBe("NOT CONFIRMED");
    expect(
      combineProvenance(...Array(10).fill(CLEAN_PROVENANCE), notConfirmed).verificationState
    ).toBe("NOT CONFIRMED");
  });

  it("returns CONFIRMED only when every input is a confirmation", () => {
    expect(combineProvenance(CLEAN_PROVENANCE, withState("CONFIRMED")).verificationState).toBe(
      "CONFIRMED"
    );
  });

  // §3.2: the tag-mapping exemption is "not a human confirmation and must never
  // be displayed as one". So it ranks BELOW confirmed rather than counting as
  // clean — a combination containing an exempt input must not come out the
  // other side claiming a human confirmed it.
  it("does not let SPOT-CHECK NOT REQUIRED come out as a confirmation", () => {
    const exempt = withState("SPOT-CHECK NOT REQUIRED");
    expect(combineProvenance(CLEAN_PROVENANCE, exempt).verificationState).toBe(
      "SPOT-CHECK NOT REQUIRED"
    );
    expect(combineProvenance(exempt, withState("CONFIRMED")).verificationState).toBe(
      "SPOT-CHECK NOT REQUIRED"
    );
  });

  it("ranks SPOT-CHECK PENDING above the exemption and below a non-confirmation", () => {
    expect(
      combineProvenance(withState("SPOT-CHECK PENDING"), withState("SPOT-CHECK NOT REQUIRED"))
        .verificationState
    ).toBe("SPOT-CHECK PENDING");
  });

  // The full ordering in one place, weakest first, so a reordering of the
  // branches in combineProvenance cannot pass silently.
  it("orders the four values weakest-first, whatever order they arrive in", () => {
    const order: ProvenanceTokens["verificationState"][] = [
      "NOT CONFIRMED",
      "SPOT-CHECK PENDING",
      "SPOT-CHECK NOT REQUIRED",
      "CONFIRMED",
    ];
    for (let weak = 0; weak < order.length; weak++) {
      for (let strong = weak + 1; strong < order.length; strong++) {
        expect(
          combineProvenance(withState(order[weak]), withState(order[strong])).verificationState
        ).toBe(order[weak]);
        // ...and the same the other way round: order of arrival must not matter.
        expect(
          combineProvenance(withState(order[strong]), withState(order[weak])).verificationState
        ).toBe(order[weak]);
      }
    }
  });
});
