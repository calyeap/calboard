import type {
  AnalyticFlagInstance,
  ComputedValue,
  ProvenanceTokens,
  SuppressedValue,
  SuppressingState,
} from "./types";

// Small constructors for the two Figure<T> variants (§10.0.2 rule 1 — a
// value and its qualifications are never separated). Every M1–M16 module
// builds its output cells through these rather than the raw object literal,
// so the shape can't drift module to module.

export function suppressedValue(state: SuppressingState, cause: string): SuppressedValue {
  return { suppressed: true, state, cause };
}

export function computedValue<T>(
  value: T,
  provenanceTokens: ProvenanceTokens,
  analyticFlags: AnalyticFlagInstance[] = []
): ComputedValue<T> {
  return { suppressed: false, value, qualification: { provenanceTokens, analyticFlags } };
}
