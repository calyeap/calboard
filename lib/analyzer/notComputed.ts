import type { AnalysisResult, SuppressingState } from "./types";
import type { ActiveSuppression } from "./suppression";

// ---------------------------------------------------------------------------
// A state for an output the schema types as a bare Decimal.
//
// Almost every report figure is a Figure<T> and carries its own state
// (types.ts). A few are not: the ±1% rate sensitivity, each scenario's
// drivers, and the rate at which the base case equals the price are a bare
// `Decimal` (or `Decimal | null`) in the schema, which gives them no way to
// say "not computed". Each found one anyway, and each said something false —
// "+0.0% / 0.0%" for a sensitivity nobody modelled, "0.0%" for drivers
// nobody authored, and "no solution in range" for a solver that never ran
// (CB-AUDIT-01 H2/H4).
//
// The schema does carry a member for exactly this: `states.suppressing`, each
// state "bound to the output it applies to" (§10.0.1). So where one of these
// outputs was not computed, assembly binds a §9.3 state to it there, by a
// fixed name, with its cause — and the renderer and the [C] slot catalogue
// look the state up by that name and show it in the value's place. The field
// itself holds NaN: never a zero, and never a number a consumer that forgot
// to look could print as though it were one.
//
// No new state and no schema change. The states are §9.3's own, and the
// member is the one the contract already has.
//
// The cause travels inside `appliesTo`, because the contract member carries
// only the state and what it is bound to (assemble.ts strips the rest). It is
// written `<binding> — <cause>`, and this module is the only place that
// writes or reads that form.
// ---------------------------------------------------------------------------

type ScenarioKey = "bear" | "base" | "bull";

export const NOT_COMPUTED_BINDING = {
  rateAtWhichBaseEqualsPrice: "the discount rate at which the base case equals the price",
  rateSensitivity: "±1% rate sensitivity",
  scenarioDrivers: (scenario: ScenarioKey) => `${scenario} scenario drivers`,
  // §7.2 M16 / CalFinance Methodology v2's acquired-run cash basis — see
  // PreRevenueModule in types.ts for what each binds.
  cashPerShare: "pre-revenue cash per share",
  quarterlyBurn: "pre-revenue quarterly burn",
  runway: "pre-revenue runway",
} as const;

const SEPARATOR = " — ";

/**
 * A suppressing state bound to one of the outputs above.
 *
 * No `scope`: the state's §9.3 default applies, and for both states used here
 * that default does not cover the fair-value range — correctly, since none of
 * these outputs is an input of it.
 */
export function notComputed(binding: string, state: SuppressingState, cause: string): ActiveSuppression {
  return { state, appliesTo: `${binding}${SEPARATOR}${cause}`, cause };
}

export interface BoundState {
  state: SuppressingState;
  cause: string;
}

/** Whether a `states.suppressing` entry's `appliesTo` binds it to `binding`. */
export function isBoundTo(appliesTo: string, binding: string): boolean {
  return appliesTo.startsWith(`${binding}${SEPARATOR}`);
}

/** The state bound to `binding` on this run, or null if the output was computed. */
export function boundState(states: AnalysisResult["states"], binding: string): BoundState | null {
  const entry = states.suppressing.find((s) => isBoundTo(s.appliesTo, binding));
  return entry === undefined
    ? null
    : { state: entry.state, cause: entry.appliesTo.slice(`${binding}${SEPARATOR}`.length) };
}
