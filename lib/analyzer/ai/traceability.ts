// ---------------------------------------------------------------------------
// The mechanical control on §8.3 limits 2 and 3, and on §10.7 rule 3.
//
// §10.7 rule 3 is the design this file implements: "Every figure on page one is
// substituted from the Analysis Result... A [C] call may reference a number by
// its result-object slot; it may not emit a numeral, and a numeral emitted by
// [C] is a defect rather than a value to be checked."
//
// So [C] never writes figures. It writes prose containing {{slot}} references,
// and the renderer substitutes each one from a catalogue built out of the
// Analysis Result. Two rules follow, and both are checked on every run rather
// than sampled:
//
//   1. Every {{slot}} resolves to a slot the catalogue holds. A figure with no
//      slot behind it cannot reach the page. This is limit 3.
//   2. No numeral appears outside a slot reference. This is the same limit
//      approached from the other side, and it is also the control on limit 2 —
//      a base rate recalled from memory has no field behind it, so the only
//      way for it to reach the page is as a figure [C] wrote itself.
//
// WHAT THIS CANNOT CHECK, stated here rather than left to be discovered: a
// quantity spelled out in words evades a digit rule. SPELLED_OUT_QUANTITY
// below closes the realistic form of that evasion — a number word carrying a
// unit ("fifteen percent", "three billion") — because that pairing is what a
// remembered base rate actually looks like. It does not, and cannot, catch a
// wrong claim made in words with no quantity in it at all. That is Calvin's
// read, not this file's.
// ---------------------------------------------------------------------------

import type { SuppressingState } from "../types";

/**
 * One figure [C] is allowed to reference, and the only way a number reaches
 * [C]-authored prose.
 *
 * `formatted` is the rendered string, produced by [S] from the Analysis
 * Result. A suppressed slot's `formatted` is its STATE NAME, which is what
 * makes §8.3 limit 5 structural rather than instructed: there is no number
 * behind a suppressed slot for [C] to describe, so referencing it prints the
 * state and nothing else.
 */
export interface FigureSlot {
  id: string;
  /** Plain-English name, given to [C] so it can choose a slot by meaning. */
  label: string;
  formatted: string;
  suppressed: boolean;
  state?: SuppressingState;
  /**
   * Why a suppressed slot has no figure, where one is available. NEVER read
   * by [C] and never substituted into rendered prose — only `formatted` is
   * (interpretation.ts's prompt, traceability.ts's substitution). Folding
   * this into `formatted` instead would feed free text (which can contain
   * real digits, e.g. a valuation date) into systemVocabularyOf's exempt
   * set, smuggling it past the figure-injection scan under the guise of a
   * closed-vocabulary state name — exactly what that scan exists to catch.
   * This field exists so the cause is still inspectable by a non-[C]
   * consumer, never silently dropped.
   */
  cause?: string;
}

export type SlotCatalogue = Map<string, FigureSlot>;

export type TraceDefectKind = "UNKNOWN SLOT" | "NUMERAL FROM MODEL" | "SPELLED-OUT QUANTITY";

export interface TraceDefect {
  kind: TraceDefectKind;
  detail: string;
  /**
   * The words around the offending text. Log and command line only — never the
   * screen, on the same rule as `detail` itself.
   *
   * A real run refused on NUMERAL FROM MODEL ("1"), which is true and useless:
   * a bare digit could be a footnote marker, a quarter, or a fabricated figure,
   * and only the last is the failure this check exists for. Without the
   * surrounding words the only way to tell is to run the call again and hope.
   */
  context?: string;
}

const CONTEXT_RADIUS = 45;

function contextAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(text.length, index + length + CONTEXT_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * A refusal, in two registers.
 *
 * `message` REACHES THE SCREEN — reportAnalysis carries it into Section I as
 * the reason there is no prose. So it names the failure and where it happened
 * and stops there. It must not quote the offending text: a message reading
 * "NUMERAL FROM MODEL (14.2%)" would put a figure with no field behind it onto
 * the report, smuggled in as the reason for refusing that very thing —
 * §10.0.2 rule 3, defeated by its own enforcement.
 *
 * `diagnostic` carries the values, for the server log and the command line.
 * Whoever is debugging this needs to see what the model actually wrote; the
 * reader of the report does not.
 */
export class UntraceableFigureError extends Error {
  readonly defects: TraceDefect[];
  readonly diagnostic: string;

  constructor(where: string, defects: TraceDefect[]) {
    const kinds = [...new Set(defects.map((d) => d.kind))].join(", ");
    super(
      `${where}: ${defects.length} figure(s) in [C] output do not trace to the Analysis Result (${kinds}). ` +
        `§8.3 limit 3: any figure in [C] output that is not traceable to the acquired fact set is a defect. ` +
        `The whole output was refused; no part of it was kept.`
    );
    this.name = "UntraceableFigureError";
    this.defects = defects;
    this.diagnostic =
      `${where}: ` +
      defects
        .map((d) => `${d.kind} ("${d.detail}")${d.context === undefined ? "" : ` in: ${d.context}`}`)
        .join("; ");
  }
}

// A slot id is dotted, and may carry the grid's own coordinates — the ids in
// slots.ts are built from field names, margin levels and rates, so `@`, `-`
// and digits all appear inside one.
const SLOT_REFERENCE = /\{\{\s*([A-Za-z0-9_.@\-/]+)\s*\}\}/g;

// Any run of digits, with the separators a figure carries. Checked only after
// slot references have been removed, so a rate inside a slot id is not a
// numeral the model emitted.
const NUMERAL = /\d+(?:[.,]\d+)*%?/g;

// Cardinals only. Ordinals are deliberately absent: "the third cell" is prose
// about which cell, not a quantity, and a rule that fires on it would be
// noise rather than a control.
const NUMBER_WORD =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" +
  "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|" +
  "hundred|thousand|million|billion|trillion|dozen|half";

// What turns a number word into a figure. A number word on its own ("one or
// more cells") is prose; a number word carrying one of these is a quantity.
const UNIT_WORD =
  "percent|per cent|percentage|points?|basis|times|x|million|billion|trillion|" +
  "years?|quarters?|months?|dollars?|cents?";

const SPELLED_OUT_QUANTITY = new RegExp(
  `\\b(?:${NUMBER_WORD})(?:[-\\s](?:${NUMBER_WORD}))*\\s+(?:${UNIT_WORD})\\b`,
  "gi"
);

function withoutSlotReferences(text: string): string {
  return text.replace(SLOT_REFERENCE, " ");
}

/**
 * The state names THIS RUN's catalogue carries, longest first.
 *
 * Derived from the Analysis Result, never maintained by hand. A suppressed
 * slot's only rendering is its state name (slots.ts), so this set is exactly
 * the state vocabulary the system itself would have substituted for this run —
 * and `slots.test.ts` asserts every member of it is one of the fourteen
 * literals in `stateCatalogue.ALL_SUPPRESSING_STATES`, which is checked against
 * the `SuppressingState` union at compile time in both directions.
 *
 * Longest first, so a state name containing a shorter one is removed whole.
 */
function systemVocabularyOf(catalogue: SlotCatalogue): string[] {
  const states = new Set<string>();
  for (const slot of catalogue.values()) {
    if (slot.suppressed) states.add(slot.formatted);
  }
  return [...states].sort((a, b) => b.length - a.length);
}

/**
 * Removes the run's own state names before the figure scan.
 *
 * THIS IS A NARROWING OF SCOPE, NOT A PERMITTED EXCEPTION, and the difference
 * is the whole reason it is written this way. A permit list would say "these
 * numerals are allowed" and would grow one argument at a time — the next
 * exception always argued from the last — and this guard is the entire control
 * on §8.3 limit 2, because a base rate recalled from memory reaches the page
 * only as a numeral the model typed.
 *
 * What happens instead is that a state name is not authored text at all. It is
 * a token out of a closed vocabulary the system owns, restated. So it is
 * removed before anyone asks what the model wrote, exactly as a slot reference
 * is — the same shape as the slot design itself, where the model cannot write a
 * figure rather than being told not to.
 *
 * Three properties make this safe to rely on, and each has a test:
 *
 *  - The set comes from this run's Analysis Result. A state this run did not
 *    produce is not exempt, and its digits are refused like anyone else's.
 *  - Every member is one of the fourteen frozen suppressing-state literals, so
 *    adding one means adding a state to the analyzer's own vocabulary — a
 *    spec-level act with a compile-time contract — not editing a list of
 *    exceptions sitting next to this guard.
 *  - Only the EXACT string is removed. A numeral beside a state name, or one
 *    appended to it, survives to be refused.
 */
function withoutSystemVocabulary(text: string, catalogue: SlotCatalogue): string {
  let remaining = text;
  for (const state of systemVocabularyOf(catalogue)) {
    remaining = remaining.split(state).join(" ");
  }
  return remaining;
}

/**
 * Edit distance, capped: anything past `limit` is reported as `limit + 1`,
 * since a far-off candidate is not worth measuring precisely.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    if (Math.min(...current) > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * The catalogue id an unknown reference most likely meant, or null.
 *
 * This does NOT soften the refusal — an unknown slot is still a defect and the
 * whole output is still discarded. It exists because the refusal is fed back to
 * the model for its one regeneration, and a live run refused on
 * "facts.operating-operating-cash-flow", a doubled token: naming the near miss
 * turns a guess into a correction. Null when nothing is close, because pointing
 * confidently at the wrong field is worse than saying nothing.
 */
function nearestSlotId(unknown: string, catalogue: SlotCatalogue): string | null {
  // A third of the id may differ, no more. Loose enough for a doubled token or
  // a dropped segment, tight enough that unrelated ids do not match.
  const limit = Math.max(2, Math.floor(unknown.length / 3));
  let best: string | null = null;
  let bestDistance = limit + 1;

  for (const id of catalogue.keys()) {
    const distance = editDistance(unknown, id, limit);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : null;
}

/**
 * Every way this text fails to trace, in one pass.
 *
 * Returns all defects rather than the first: a report-back that names one
 * problem invites a fix-and-resubmit loop that hides the others.
 */
export function traceText(text: string, catalogue: SlotCatalogue): TraceDefect[] {
  const defects: TraceDefect[] = [];

  for (const match of text.matchAll(SLOT_REFERENCE)) {
    const id = match[1];
    if (catalogue.has(id)) continue;
    const nearest = nearestSlotId(id, catalogue);
    defects.push({
      kind: "UNKNOWN SLOT",
      detail: id,
      ...(nearest === null ? {} : { context: `did you mean ${nearest}?` }),
    });
  }

  // Two removals before anything is scanned, and they are the same idea twice:
  // what the system substitutes, and what the system names, are not figures the
  // model wrote. What remains is the model's own prose, and the rules below
  // apply to that.
  const prose = withoutSystemVocabulary(withoutSlotReferences(text), catalogue);

  for (const match of prose.matchAll(NUMERAL)) {
    defects.push({
      kind: "NUMERAL FROM MODEL",
      detail: match[0],
      context: contextAround(prose, match.index ?? 0, match[0].length),
    });
  }

  for (const match of prose.matchAll(SPELLED_OUT_QUANTITY)) {
    defects.push({
      kind: "SPELLED-OUT QUANTITY",
      detail: match[0].toLowerCase(),
      context: contextAround(prose, match.index ?? 0, match[0].length),
    });
  }

  return defects;
}

/**
 * The slot ids a piece of copy cites, in citation order, each once.
 *
 * Read through the SAME pattern the validator and the renderer use, and not by
 * searching for a literal "{{id}}". The three must agree: a reference the
 * renderer substitutes but this list omits would leave a figure on the page
 * with no recorded field behind it, which is §10.0.1's "each statement
 * referencing the values it rests on" quietly incomplete — and it is exactly
 * the kind of gap that looks like nothing until someone audits a sentence.
 */
export function slotIdsIn(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT_REFERENCE)].map((m) => m[1]))];
}

/**
 * Substitutes each slot reference with the figure [S] computed for it.
 *
 * Throws rather than rendering an unresolved reference. §10.7's consequence
 * for the renderer is that "prose assembled by any other route does not
 * render" — a page showing `{{something}}` would be exactly that.
 */
export function renderText(text: string, catalogue: SlotCatalogue): string {
  return text.replace(SLOT_REFERENCE, (_whole, id: string) => {
    const found = catalogue.get(id);
    if (found === undefined) {
      throw new UntraceableFigureError("render", [{ kind: "UNKNOWN SLOT", detail: id }]);
    }
    return found.formatted;
  });
}
