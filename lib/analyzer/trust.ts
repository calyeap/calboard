import type {
  AnalysisResult,
  DiagnosticsResult,
  FactRecord,
  FairValueRange,
  SuppressingState,
  TrustResult,
  TrustStatus,
} from "./types";

// ---------------------------------------------------------------------------
// §9.6 — TRUST STATUS. How much of this analysis can be used.
//
// "One status per run, computed by [S], displayed on page one." Three values,
// derived in order, FIRST MATCH WINS:
//
//   1. UNUSABLE — a §9.3 suppressing state removes the fair-value range under
//                 §10.3, or a REQUIRED input of the range is INCOMPLETE
//   2. PARTIAL  — the range renders, and any of: a §9.4 qualifying flag is
//                 active on the valuation path; a material fact is NOT
//                 CONFIRMED; a §3.8.2 cross-check failed; a REQUIRED input of
//                 any other output is INCOMPLETE
//   3. CLEAN    — the range renders and none of the above holds
//
// "Every input is a state this document already computes; nothing new is
// measured." That sentence is the design constraint this module obeys: it
// reads states, facts and diagnostics, and computes no finding of its own.
//
// ONE SOURCE WITH §10.3, AND WHY IT MATTERS. Rule 1's condition is the
// condition suppression.ts already decided, so this module reads the OUTCOME of
// that decision — a suppressed `fairValueRange` — rather than re-deriving the
// §9.3 scope rule. Two implementations of one predicate would be free to
// disagree, and the disagreement would be a report that refuses to show a range
// while calling itself CLEAN, or shows one while calling itself UNUSABLE.
// §9.6's own framing forbids exactly that: "Under UNUSABLE the page refuses to
// render the range — which is the instruction, enforced rather than requested."
// The refusal and the status must therefore be the same fact, stated once.
//
// UNUSABLE IS A STATEMENT ABOUT THE ANALYSIS, NOT THE INVESTMENT. §9.6 is
// explicit, and it constrains copy rather than this function: "It says this run
// cannot tell you what the company is worth. It does not say the company is
// bad, and no copy may let it be read that way."
// ---------------------------------------------------------------------------

export interface TrustInput {
  /** The §10.3 outcome. Suppressed here IS rule 1. */
  fairValueRange: FairValueRange;
  states: AnalysisResult["states"];
  facts: readonly FactRecord[];
  diagnostics: DiagnosticsResult;
  /**
   * §6.3. False after *Cannot judge*, which raises PROFILE NOT CONFIRMED on the
   * valuation path. That flag is a §9.4 qualifier the `QualifyingFlag` union
   * does not carry, so it arrives as its own input rather than being invented
   * into `states.qualifying`.
   */
  profileHumanConfirmed: boolean;
  /** §3.8.2. Fact ids whose deterministic cross-check failed. */
  crossCheckFailedFactIds: readonly string[];
}

/**
 * Walks a diagnostics tree collecting the suppressing state of every suppressed
 * figure in it.
 *
 * A walk rather than a list of module names, for the same reason Fix 1 is a
 * rule rather than a list: a module added to `DiagnosticsResult` later is
 * counted without this function changing. Decimals are skipped — they are
 * objects with their own properties and nothing inside one is a Figure.
 */
function suppressedStatesIn(node: unknown, found: SuppressingState[] = []): SuppressingState[] {
  if (node === null || typeof node !== "object") return found;
  // decimal.js instances carry `s`, `e`, `d` — recursing into them is pure
  // waste and their digit arrays are large.
  if (typeof (node as { toFixed?: unknown }).toFixed === "function") return found;

  const record = node as Record<string, unknown>;
  if (record.suppressed === true && typeof record.state === "string") {
    found.push(record.state as SuppressingState);
    return found;
  }

  for (const value of Object.values(record)) suppressedStatesIn(value, found);
  return found;
}

export function computeTrustStatus(input: TrustInput): TrustResult {
  const determinedBy: TrustResult["determinedBy"] = [];

  // --- Rule 1 — UNUSABLE ---------------------------------------------------
  //
  // Read, not re-derived. `fairValueRange.kind === "suppressed"` covers BOTH of
  // rule 1's clauses: suppression.ts removes the range for a §9.3 state whose
  // scope covers it, and the INCOMPLETE-REQUIRED-input-of-the-range case is
  // recorded with that same scope, so it arrives here the same way.
  if (input.fairValueRange.kind === "suppressed") {
    determinedBy.push({
      kind: "suppressing state",
      detail: `${input.fairValueRange.state} — ${input.fairValueRange.cause}`,
    });
    return { status: "UNUSABLE", determinedBy };
  }

  // --- Rule 2 — PARTIAL ----------------------------------------------------
  //
  // Every condition is collected rather than short-circuited: PARTIAL "names
  // which" parts of the analysis do not stand, so a status carrying only the
  // first reason it found would be a worse answer than the one §9.6 asks for.
  for (const flag of input.states.qualifying) {
    determinedBy.push({
      kind: "qualifying flag",
      detail: `${flag.flag} on ${flag.appliesTo}`,
    });
  }

  if (!input.profileHumanConfirmed) {
    determinedBy.push({
      kind: "qualifying flag",
      detail: "PROFILE NOT CONFIRMED on the valuation path",
    });
  }

  for (const fact of input.facts) {
    if (fact.verificationState === "NOT CONFIRMED") {
      determinedBy.push({ kind: "fact", detail: `${fact.name} is NOT CONFIRMED` });
    }
  }

  for (const factId of input.crossCheckFailedFactIds) {
    determinedBy.push({ kind: "cross-check", detail: `cross-check failed on ${factId}` });
  }

  // A REQUIRED input of any OTHER output is INCOMPLETE — "other" because the
  // range's own case is rule 1 and has already returned.
  const incompleteOutputs = suppressedStatesIn(input.diagnostics).filter((s) => s === "INCOMPLETE");
  if (incompleteOutputs.length > 0) {
    determinedBy.push({
      kind: "incomplete input",
      detail: `${incompleteOutputs.length} diagnostic(s) INCOMPLETE on a missing REQUIRED input`,
    });
  }
  for (const suppressed of input.states.suppressing) {
    if (suppressed.state === "INCOMPLETE") {
      determinedBy.push({
        kind: "incomplete input",
        detail: `INCOMPLETE on ${suppressed.appliesTo}`,
      });
    }
  }

  if (determinedBy.length > 0) return { status: "PARTIAL", determinedBy };

  // --- Rule 3 — CLEAN -------------------------------------------------------
  return { status: "CLEAN", determinedBy: [] };
}

export type { TrustResult, TrustStatus };
