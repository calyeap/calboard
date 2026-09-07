import type { ExtractionType, ProvenanceTokens, SourceClass, VerificationState } from "./types";

// §3.3 — the propagation rule. "A figure derived from a SECONDARY source is
// SECONDARY wherever it appears," and the same three rules apply to
// extraction type (§3.2.2): transitive, travels to the point of display,
// never upgraded by aggregation. combineProvenance implements the
// weakest-wins rule for a computed value's inputs.
//
// verificationState is not a binary like the other two slots: §3.2 gives it
// four values, and they are ordered here weakest-first. NOT CONFIRMED and
// SPOT-CHECK PENDING are both weaker than a confirmation for obvious reasons;
// SPOT-CHECK NOT REQUIRED is ranked below CONFIRMED because §3.2 states the
// tag-mapping exemption is "not a human confirmation and must never be
// displayed as one".
//
// UNVERIFIED is deliberately absent. Since amendment M7 it names only the §5.1
// propagation state — a property of the figure and its source, which travels
// under §5.2 and propagates like SECONDARY — and no longer a value of this
// field, which is a property of the human review. A figure can be UNVERIFIED
// and CONFIRMED at once (§5.1), and that combination was unstatable while one
// word carried both jobs. The propagation state's carrier is
// ProvenanceQualifier, not this function.
export function combineProvenance(...tokens: ProvenanceTokens[]): ProvenanceTokens {
  if (tokens.length === 0) {
    throw new Error("combineProvenance requires at least one input");
  }

  const sourceClass: SourceClass = tokens.some((t) => t.sourceClass === "SECONDARY")
    ? "SECONDARY"
    : "PRIMARY";

  const extractionType: ExtractionType = tokens.some((t) => t.extractionType === "AI-EXTRACTED")
    ? "AI-EXTRACTED"
    : "DETERMINISTIC/STRUCTURED";

  // Weakest-wins over §3.2's four values, strictly ordered. Every branch is
  // explicit and the final one is a value rather than a catch-all: a catch-all
  // is what let NOT CONFIRMED resolve to VERIFIED before M7, which was a
  // fail-open on precisely the fact the analyst said they could not verify.
  let verificationState: VerificationState;
  if (tokens.some((t) => t.verificationState === "NOT CONFIRMED")) {
    // Weakest. In a correct run this is unreachable — §5 returns INCOMPLETE for
    // a non-confirmed fact's dependents, so the module never computes — but
    // "unreachable" is the assumption §5.3 exists to stop code resting on.
    verificationState = "NOT CONFIRMED";
  } else if (tokens.some((t) => t.verificationState === "SPOT-CHECK PENDING")) {
    // Queued and undecided: the Step 2 gate is not satisfied while any material
    // fact sits here (§3.2).
    verificationState = "SPOT-CHECK PENDING";
  } else if (tokens.some((t) => t.verificationState === "SPOT-CHECK NOT REQUIRED")) {
    // Ranked BELOW confirmed, not merged with it. §3.2: the exemption is "not a
    // human confirmation and must never be displayed as one" — so a combination
    // containing an exempt input must not come out the other side claiming a
    // human confirmed it.
    verificationState = "SPOT-CHECK NOT REQUIRED";
  } else {
    verificationState = "CONFIRMED";
  }

  return { sourceClass, extractionType, verificationState };
}

export const CLEAN_PROVENANCE: ProvenanceTokens = {
  sourceClass: "PRIMARY",
  extractionType: "DETERMINISTIC/STRUCTURED",
  // The M7 name for what this field used to call VERIFIED: a human checked the
  // figure against its source and it matched (§3.2). The rename is the whole
  // point of the amendment — the old word also named the §5.1 propagation
  // state, and those are different claims about a figure.
  verificationState: "CONFIRMED",
};
