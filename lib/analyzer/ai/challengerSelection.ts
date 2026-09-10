import { REPORT_SECTION_ORDER, type ChallengerFinding } from "../types";

// ---------------------------------------------------------------------------
// §17.7.1 — selecting the challenger point deterministically. [S]: no model
// call, no scoring, no severity.
//
// "The finding bound to the earliest section is selected, ties broken by the
// order the challenger returned them." Earliest section wins outright; among
// findings bound to that same section, the one the challenger returned first
// wins. Nothing here reads `evidence` or `whatWouldHaveToBeTrue` — the rule
// is a fixed ordering rule over `boundSection` and array position only.
//
// "This is a proxy for reach, not for severity ... a late-bound finding can
// still matter more." That is this rule working as specified, not a defect a
// later change should "improve" into a ranking — see this module's own test
// file for the pinned case.
// ---------------------------------------------------------------------------

const SECTION_RANK: Record<string, number> = Object.fromEntries(
  REPORT_SECTION_ORDER.map((section, index) => [section, index])
);

export interface ChallengerSelection {
  selected: ChallengerFinding;
  selectedIndex: number;
  // The rest of the challenger's findings, in the order the challenger
  // returned them — never reordered by section (§17.7.1: "I2 carries the
  // full set, in the same order, never reconciled with the analysis").
  remainder: ChallengerFinding[];
}

export function selectChallengerPoint(findings: readonly ChallengerFinding[]): ChallengerSelection | null {
  if (findings.length === 0) return null;

  let selectedIndex = 0;
  for (let i = 1; i < findings.length; i++) {
    // Strict less-than only: a later finding bound to the SAME earliest
    // section found so far never displaces it, which is the tie-break —
    // "the order the challenger returned them" — falling out of the loop
    // itself rather than needing a separate rule.
    if (SECTION_RANK[findings[i].boundSection] < SECTION_RANK[findings[selectedIndex].boundSection]) {
      selectedIndex = i;
    }
  }

  return {
    selected: findings[selectedIndex],
    selectedIndex,
    remainder: findings.filter((_, i) => i !== selectedIndex),
  };
}
