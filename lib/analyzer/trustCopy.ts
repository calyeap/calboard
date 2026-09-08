import type { TrustStatus } from "./types";

// ---------------------------------------------------------------------------
// The page-one trust sentences, DERIVED from the computed status.
//
// report/page.tsx printed "Profile not confirmed · trust status PARTIAL" as a
// literal. That was true of the only run the page had been looked at with, and
// after Fix 1 it is reachable on a run whose fair-value range was suppressed —
// which §9.6 rule 1 makes UNUSABLE. A page asserting PARTIAL about a run the
// Analysis Result calls UNUSABLE is the same class of defect as the verification
// state that travelled beside the fact instead of deriving from the decision.
//
// §10.0.2 rule 3 states the general rule: "The renderer adds formatting and
// prose; it adds no content."
//
// THE COPY CONSTRAINT, which is §9.6's and not a preference: "UNUSABLE is a
// statement about the analysis, not about the investment. It says this run
// cannot tell you what the company is worth. It does not say the company is
// bad, and no copy may let it be read that way."
// ---------------------------------------------------------------------------

/** The state-slot name line: what this run's trust status is, and why. */
export function trustStatusLine(status: TrustStatus, profileNotConfirmed: boolean): string {
  const statusPart = `Trust status ${status}`;
  return profileNotConfirmed ? `Profile not confirmed · ${statusPart}` : statusPart;
}

/** What follows from the status for the reader, in §9.6's own terms. */
export function trustConsequenceLine(status: TrustStatus): string {
  switch (status) {
    case "UNUSABLE":
      // The refusal IS the instruction (§9.6), so the sentence reports it
      // rather than advising anything.
      return (
        "There is no fair-value range on this run: a suppressing state removed it, and the " +
        "state is the output. This run cannot tell you what the company is worth. It says " +
        "nothing about the company itself."
      );
    case "PARTIAL":
      // §6.3's own words for this case.
      return (
        "The fair-value range below still renders. The named parts of the analysis above it " +
        "do not, and the states beside them say which."
      );
    case "CLEAN":
      return "Every output this run produces can be used as it stands.";
  }
}
