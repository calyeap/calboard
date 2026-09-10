import { describe, it, expect } from "vitest";
import type { ChallengerFinding, ReportSectionId } from "../types";
import { selectChallengerPoint } from "./challengerSelection";

// Fixtures are built directly against `ChallengerFinding`, independent of the
// payload/challenger-call pipeline — §17.7.1 is a rule over `boundSection`
// and array position, and these tests pin exactly that, nothing upstream of
// it.
function finding(boundSection: ReportSectionId, tag: string): ChallengerFinding {
  return {
    claimOrFactReference: `fact for ${tag}`,
    boundSection,
    evidence: `evidence for ${tag}`,
    whatWouldHaveToBeTrue: `condition for ${tag}`,
  };
}

describe("selectChallengerPoint", () => {
  it("returns null for no findings", () => {
    expect(selectChallengerPoint([])).toBeNull();
  });

  it("selects the one finding when there is only one", () => {
    const only = finding("D", "only");
    const result = selectChallengerPoint([only]);

    expect(result?.selected).toBe(only);
    expect(result?.selectedIndex).toBe(0);
    expect(result?.remainder).toEqual([]);
  });

  it("selects the finding bound to the earliest §10.2 section, regardless of return order", () => {
    const late = finding("H", "late");
    const early = finding("C", "early");
    const middle = finding("E", "middle");

    const result = selectChallengerPoint([late, early, middle]);

    expect(result?.selected).toBe(early);
    expect(result?.selectedIndex).toBe(1);
  });

  it("treats B as earlier than C, D, E, ... — the full §10.2 order, not just a two-way comparison", () => {
    const j = finding("J", "j");
    const i2 = finding("I2", "i2");
    const i = finding("I", "i");
    const b = finding("B", "b");

    expect(selectChallengerPoint([j, i2, i, b])?.selected).toBe(b);
    // I2 sorts after I, per REPORT_SECTION_ORDER — not alphabetically.
    expect(selectChallengerPoint([j, i2, i])?.selected).toBe(i);
  });

  it("breaks a tie between findings bound to the same section by challenger return order", () => {
    const firstReturned = finding("D", "first");
    const secondReturned = finding("D", "second");

    const result = selectChallengerPoint([firstReturned, secondReturned]);

    expect(result?.selected).toBe(firstReturned);
    expect(result?.selectedIndex).toBe(0);
  });

  it("never lets a later same-section finding displace the earlier-returned one, even with more findings around it", () => {
    const before = finding("F", "before");
    const tieA = finding("D", "tieA");
    const between = finding("G", "between");
    const tieB = finding("D", "tieB");

    const result = selectChallengerPoint([before, tieA, between, tieB]);

    expect(result?.selected).toBe(tieA);
  });

  it("keeps the remainder in original challenger order, selected one removed — never reordered by section", () => {
    const late = finding("H", "late");
    const early = finding("C", "early");
    const middle = finding("E", "middle");

    const result = selectChallengerPoint([late, early, middle]);

    expect(result?.remainder).toEqual([late, middle]);
  });

  // §17.7.1: "This is a proxy for reach, not for severity ... a late-bound
  // finding can still matter more." Pinned so a later change cannot quietly
  // turn this into a severity ranking: the finding that reads as the more
  // damaging one, by any human judgment of its prose, still loses to the
  // earlier-bound finding whose content is comparatively mild. That is this
  // rule working as specified.
  it("selects by earliest section even when a later-bound finding reads as far more damaging", () => {
    const mildButEarly: ChallengerFinding = {
      claimOrFactReference: "A minor disclosed timing note (timing-note)",
      boundSection: "C",
      evidence: "The filing discloses a routine change in reporting cadence, already flagged in the record.",
      whatWouldHaveToBeTrue: "Only relevant if the reader had assumed continuity that was never claimed.",
    };
    const severeButLate: ChallengerFinding = {
      claimOrFactReference: "Going-concern qualification (going-concern-note)",
      boundSection: "H",
      evidence: "The auditor's opinion carries a going-concern qualification for the period under review.",
      whatWouldHaveToBeTrue: "Would matter if the company could not refinance its near-term obligations.",
    };

    const result = selectChallengerPoint([severeButLate, mildButEarly]);

    expect(result?.selected).toBe(mildButEarly);
    expect(result?.remainder).toEqual([severeButLate]);
  });
});
