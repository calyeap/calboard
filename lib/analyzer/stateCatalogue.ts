import type { SuppressingState } from "./types";

// The complete, frozen catalogue of suppressing-state literals. Fourteen
// total — not the ten rows §9.3's table uses for its own bookkeeping,
// because that table groups distinct states into shared rows and keeps
// Gate 0 generic. Reconciled against the frozen spec, row by row:
//
//   §9.3 row                                                expands to
//   ───────────────────────────────────────────────────     ─────────
//   UNSUPPORTED PROFILE (generic)                            2 — §6.1
//     gives two concrete return values, ASSET-BASED ROW NOT
//     VALIDATED IN v1 and CLASSIFICATION UNAVAILABLE, and
//     never a bare "UNSUPPORTED PROFILE" return
//   HISTORY INSUFFICIENT                                     1
//   LEVERAGE UNSUPPORTED IN v1                               1
//   RONIC NOT MEANINGFUL                                     1
//   NOT COMPUTABLE / NO SOLUTION IN RANGE / DEGENERATE        3 — three
//     distinct named states sharing one §9.3 row (design §6's
//     footnote makes the same split)
//   PRECONDITION FAILED                                      1
//   NOT ACHIEVABLE AT ANY SCALE                               1
//   SUCCESS WORTH LESS THAN FAILURE / PRICE NOT JUSTIFIABLE   2 — two
//     distinct named states sharing one §9.3 row (§7.2 M16's
//     own three-state table gives both in full)
//   SEASONAL — RUN-RATE SUPPRESSED                            1
//   INCOMPLETE                                                1
//                                                            ────
//                                                             14
//
// Verified letter-for-letter against every occurrence of each name across
// the frozen spec (§6.1, §6.2, §6.5, §7.2 M5/M7/M11/M12/M16, §9.1, §9.3,
// §9.5, §10.3, §11.1–11.8) — no other suppressing-state name appears
// anywhere in the document.
//
// Any module that needs "every suppressing state" (the StateManifest
// legend, an exhaustiveness switch, a test fixture) should import this
// array rather than re-enumerate the literals, so there is exactly one
// place that can drift from the frozen contract.
export const ALL_SUPPRESSING_STATES = [
  "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1",
  "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE",
  "HISTORY INSUFFICIENT",
  "LEVERAGE UNSUPPORTED IN v1",
  "RONIC NOT MEANINGFUL",
  "NOT COMPUTABLE",
  "NO SOLUTION IN RANGE",
  "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE",
  "PRECONDITION FAILED",
  "NOT ACHIEVABLE AT ANY SCALE",
  "SEASONAL — RUN-RATE SUPPRESSED",
  "INCOMPLETE",
  "THIS SUCCESS IS WORTH LESS THAN FAILURE",
  "PRICE NOT JUSTIFIABLE BY THIS OUTCOME",
] as const satisfies readonly SuppressingState[];

type CatalogueMember = (typeof ALL_SUPPRESSING_STATES)[number];

// Tuple-wrapped to defeat conditional-type distribution over the union —
// without it, a missing member's branch resolves to `never` and then
// vanishes from the result union instead of failing the check.
type IsExactUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Two-way compile-time completeness check. The `satisfies` clause above
// already fails `tsc --noEmit` if the array contains a string that is not a
// SuppressingState (an invented or misspelled state). This assignment fails
// it the other direction: if SuppressingState ever gains or loses a literal
// without ALL_SUPPRESSING_STATES being updated to match, `_catalogueMatchesTypeExactly`'s
// inferred type becomes `false`, and assigning `true` to a `false`-typed
// variable is a type error. A state cannot silently disappear from, or be
// silently added to, either side of the contract.
const _catalogueMatchesTypeExactly: IsExactUnion<SuppressingState, CatalogueMember> = true;
export { _catalogueMatchesTypeExactly as __stateCatalogueContractCheck };
