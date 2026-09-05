import type { ExtractionType, ProvenanceTokens, SourceClass, VerificationState } from "./types";

// §3.3 — the propagation rule. "A figure derived from a SECONDARY source is
// SECONDARY wherever it appears," and the same three rules apply to
// extraction type (§3.2.2): transitive, travels to the point of display,
// never upgraded by aggregation. combineProvenance implements the
// weakest-wins rule for a computed value's inputs.
//
// verificationState has a third case beyond the SECONDARY/PRIMARY,
// AI-EXTRACTED/DETERMINISTIC binary: VERIFIED, UNVERIFIED, SPOT-CHECK
// PENDING. §I14 states "UNVERIFIED propagates like SECONDARY," so UNVERIFIED
// wins over SPOT-CHECK PENDING here — the spec does not rank the two
// directly, but by the time Step 7 runs, the Step 2 gate has already forced
// every MATERIAL fact to VERIFIED or UNVERIFIED (§2's ordering rule); a
// SPOT-CHECK PENDING input reaching a module at all can only be a non-
// material fact that was never surfaced for confirmation. This ranking is a
// narrow implementation judgment on an edge case the spec does not exercise
// in any validation case, not a resolution of a genuine contract conflict.
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

  let verificationState: VerificationState;
  if (tokens.some((t) => t.verificationState === "UNVERIFIED")) {
    verificationState = "UNVERIFIED";
  } else if (tokens.some((t) => t.verificationState === "SPOT-CHECK PENDING")) {
    verificationState = "SPOT-CHECK PENDING";
  } else {
    verificationState = "VERIFIED";
  }

  return { sourceClass, extractionType, verificationState };
}

export const CLEAN_PROVENANCE: ProvenanceTokens = {
  sourceClass: "PRIMARY",
  extractionType: "DETERMINISTIC/STRUCTURED",
  verificationState: "VERIFIED",
};
