import type { AnalysisResult, FactRecord, GatesResult, QualifyingFlag, ReportSectionId, SuppressingState } from "../types";

// ---------------------------------------------------------------------------
// §8.5 — the blind challenger's input, assembled BY CONSTRUCTION.
//
// "A counter-case generated from the same reasoning context as the base case is
// not disconfirming evidence; it is the same conclusion wearing an opposing
// label" (§8.5). Blinding is the whole mechanism, so it is built rather than
// requested: this file names the members it reads, reads only those, and
// asserts on the object it produced.
//
// §8.5.2's closing line is the design rule: "An instruction to disregard is
// not a boundary." Nothing in this file, and nothing in the prompt built from
// it, asks a model to ignore anything. The excluded material is not present.
// ---------------------------------------------------------------------------

/**
 * The Analysis Result members §8.5.1 admits, and the complete list of what
 * `buildChallengerPayload` may read.
 *
 * A test walks the builder behind a recording Proxy and asserts the read set
 * equals this list, so adding a read of `fairValueRange` — or of anything else
 * §8.5.2 excludes — fails at the point it is written rather than at review.
 */
export const CHALLENGER_PAYLOAD_SOURCE_MEMBERS = [
  "ticker",
  "companyName",
  // §8.5.1 — "the verified fact set (§3), with all six per-fact fields intact"
  "facts",
  // §8.5.1 — "gate results and active states, so it does not challenge a
  // suppressed output"
  "gates",
  "states",
] as const;

export interface ChallengerPayload {
  ticker: string;
  companyName: string;
  facts: FactRecord[];
  /**
   * §8.5.1 — "the analyst's stated reasons for interest in the company, WHERE
   * PRESENT". v1 records none: there is no thesis field on a run, and §13.1
   * excludes Thesis Record. This is therefore always empty, and it is empty
   * rather than absent so the shape does not change when a thesis field
   * arrives. It is never filled with reasoning reconstructed from elsewhere in
   * the analysis — that would be the §8.5.2 exclusion under another name.
   */
  thesisClaims: string[];
  /**
   * §17.7.1 — the section every fact in `facts` was produced by, recorded
   * here at assembly rather than left for a finding to infer later.
   *
   * Not a per-fact lookup, because none is needed: §10.2 defines Section B
   * as "Fact set with provenance ... all six §3.2 fields" — the complete
   * fact ledger, not a subset of it — and `facts` above is exactly that
   * ledger (§8.5.1's own "verified fact set, with all six per-fact fields
   * intact"). Every fact this payload carries is therefore Section B's
   * content by construction, whether or not the individual record happens
   * to be derived (`FactRecord.derivedFrom`) — derivation changes how a
   * fact was produced, not which section discloses it.
   *
   * `thesisClaims` has no equivalent binding: v1 records none (§13.1
   * excludes Thesis Record from the report entirely, so there is no section
   * for one to bind to), and `runChallenger` cannot resolve a finding to a
   * thesis claim in the first place — findings are matched to `facts` by id
   * only. A future amendment that populates `thesisClaims` would need to
   * add its own binding at that same point; it does not fall out of this
   * one.
   */
  factSection: ReportSectionId;
  gates: GatesResult;
  activeStates: {
    suppressing: { state: SuppressingState; appliesTo: string }[];
    qualifying: { flag: QualifyingFlag; appliesTo: string }[];
  };
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "ticker",
  "companyName",
  "facts",
  "thesisClaims",
  "factSection",
  "gates",
  "activeStates",
]);

/**
 * Member names that carry — or lead to — the six things §8.5.2 excludes.
 *
 * Checked recursively, so a valuation output nested inside an allowed member
 * is caught too. This is a second line: the builder above cannot produce one,
 * and this refuses to send one that arrived any other way.
 */
const FORBIDDEN_KEYS = new Set([
  // any valuation output, the fair-value or scenario range
  "fairValueRange",
  "scenarioOutputs",
  "scenarios",
  "weightedDistribution",
  "priceLocationWithinRange",
  // the implied-growth conclusion
  "priceImplied",
  "reverseDcfGrid",
  "reverseDcf",
  "fiveYearGrowth",
  "tenYearCagr",
  "impliedGrowth",
  "steadyStateEv",
  "pvgo",
  "impliedExitMultiple",
  // analyst base-case reasoning, and the analyst's conclusion
  "writtenAnchor",
  "analystConclusion",
  "conclusion",
  "baseCase",
  "thesis",
  // any output of the §8.2 interpretation layer
  "interpretation",
  "statements",
  "pageOne",
  // the pre-revenue valuation module
  "preRevenue",
  "successDefinitions",
  "diagnostics",
]);

export class ChallengerBlindingError extends Error {
  readonly offendingPaths: string[];

  constructor(offendingPaths: string[]) {
    super(
      `Challenger payload carries material §8.5.2 excludes: ${offendingPaths.join(", ")}. ` +
        `The challenger's input is assembled by construction from the fact set and thesis claims; ` +
        `blinding is the whole mechanism and an instruction to disregard is not a boundary.`
    );
    this.name = "ChallengerBlindingError";
    this.offendingPaths = offendingPaths;
  }
}

/**
 * Builds the challenger's input from the fact set, thesis claims, gates and
 * states — and from nothing else.
 *
 * Written as explicit member reads rather than a destructure-and-omit, so the
 * recording-Proxy test above can see exactly what was touched.
 */
export function buildChallengerPayload(result: AnalysisResult): ChallengerPayload {
  return {
    ticker: result.ticker,
    companyName: result.companyName,
    facts: result.facts.map((fact) => ({ ...fact })),
    thesisClaims: [],
    // Not read off `result` — see the field's own doc comment. Every fact
    // this payload carries is Section B's content by definition, so there is
    // nothing here for the recording-Proxy test to see as an extra read.
    factSection: "B",
    gates: result.gates,
    activeStates: {
      suppressing: result.states.suppressing,
      qualifying: result.states.qualifying,
    },
  };
}

function walk(node: unknown, path: string, offending: string[], seen: WeakSet<object>): void {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${path}[${i}]`, offending, seen));
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path === "" ? key : `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) offending.push(here);
    walk(value, here, offending, seen);
  }
}

/**
 * Refuses to send a payload carrying anything §8.5.2 excludes.
 *
 * Two checks, and the first is the stricter one: the top level is an exact
 * allowlist, so a member §8.5.1 does not name is refused whether or not anyone
 * thought to ban it. Fail-closed is the same rule §5.3 applies to facts.
 */
export function assertChallengerPayloadClean(payload: ChallengerPayload): void {
  const offending: string[] = [];

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) offending.push(key);
  }

  walk(payload, "", offending, new WeakSet());

  if (offending.length > 0) {
    throw new ChallengerBlindingError([...new Set(offending)].sort());
  }
}
