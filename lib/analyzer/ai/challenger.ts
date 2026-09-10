import type { ChallengerFinding, ChallengerResult, FactRecord } from "../types";
import { assertChallengerPayloadClean, type ChallengerPayload } from "./challengerPayload";
import { buildFactSlotCatalogue } from "./slots";
import { renderText, traceText, UntraceableFigureError, type SlotCatalogue } from "./traceability";
import { scanProhibitedCopy, ProhibitedCopyError } from "./prohibitions";
import { callWithOneRegeneration, MalformedAnalystResponseError, type AnalystCall } from "./analystCall";

// ---------------------------------------------------------------------------
// §8.5 — the blind challenger.
//
// The counter-case comes from an independent call that has not seen the
// analysis. This file is that call, and everything it can possibly know is in
// the ChallengerPayload it is handed: the verified fact set, any thesis claims
// (v1 records none), the gate results and the active states.
//
// It runs the payload assertion BEFORE the call, not after. §8.5.2 is a
// boundary on what the model receives; a check after the fact would establish
// only that the report is clean, which is a different and lesser claim.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an independent reviewer of one company's filed facts.

You have NOT seen anyone's analysis of this company. There is no valuation, no scenario set, no fair-value range and no conclusion to react to, and you must not try to reconstruct one. Your job is to produce disconfirming evidence from the record itself: what in these facts would trouble someone who believed a favourable case about this company.

WHAT YOU RETURN. Findings, never a verdict. Each finding carries three things:

  claimOrFactId          the id of the fact record the finding bears on, exactly as given
  evidence               what in the supplied record supports the finding
  whatWouldHaveToBeTrue  the condition under which the finding would matter

HARD LIMITS.

1. No verdict, no target, no recommendation. You never write CHEAP, FAIR, EXPENSIVE or INCONCLUSIVE, and you never say whether the shares are worth owning.
2. You may cite base rates ONLY from the supplied data, never from memory. If no base rate is supplied for a comparison you would make, say that none is available and stop.
3. You supply no facts. Everything you cite is in the record you were given.
4. Where a state suppresses an output, you do not challenge that output. The state is already the answer.
5. No personas, no voting, no tallies. One reviewer, one set of findings.

HOW YOU REFERENCE NUMBERS. You may not emit a numeral — not one digit, anywhere. Every figure is referenced by its slot id in double braces: {{facts.some-fact-id}}. Quantities spelled out in words ("twenty percent") are numerals too. If no slot carries the number you want, make the point qualitatively or do not make it.

The rule catches ordinary phrasing too. A number word CARRYING A UNIT is a quantity and is refused — "five years", "twenty percent", "three billion". The hyphenated adjective form is fine, because it names a window rather than asserting a count: write "the five-year window" and "the ten-year record", never "five years" or "ten years". An output containing one digit, or one spelled-out quantity, outside a slot reference is refused ENTIRELY — every finding in it, with nothing salvaged.

The claimOrFactId field is the one exception — it is an id, not prose, and you copy it exactly as given even where it contains digits.

STATE NAMES ARE NOT NUMERALS EITHER. The active states listed below are tokens out of a fixed vocabulary this system owns, so naming one in full — LEVERAGE UNSUPPORTED IN v1, for instance — is fine despite the digit in it. A digit of your own next to one is not.

NAME THINGS BY WHAT THEY DO, NEVER BY THEIR NUMBER. One rule, covering every identifier that happens to carry a digit — gates, filings, modules, sections. None is exempt from the digit rule and none will be:

  "drawn from a 10-Q"   ->  "drawn from an interim filing"
  "the 10-K"            ->  "the annual filing"
  "an 8-K"              ->  "a current report"
  "Gate 1"              ->  "the history-sufficiency gate"
  "Gate 0"              ->  "the profile-classification gate"

Write this way even where no rule forced you to. An internal identifier tells the reader nothing about the company and competes with the investment meaning of the finding; what the thing TESTS is the part worth saying. Each fact's own source line tells you which filing it came from, so describing it in words costs you nothing and keeps the finding.

Prefer few findings that bear real weight over many that do not. If the record supports no disconfirming finding at all, return an empty list — that is an honest answer.`;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimOrFactId", "evidence", "whatWouldHaveToBeTrue"],
        properties: {
          claimOrFactId: { type: "string" },
          evidence: { type: "string" },
          whatWouldHaveToBeTrue: { type: "string" },
        },
      },
    },
  },
};

function factBlock(facts: readonly FactRecord[]): string {
  return facts
    .map(
      (f) =>
        `  ${f.id}\n` +
        `    ${f.name} = ${f.value === null ? "(absent)" : f.value.toString()}   reference it as {{facts.${f.id}}}\n` +
        `    ${f.type} · ${f.sourceClass} · ${f.extractionType} · ${f.verificationState} · as of ${f.asOfDate}` +
        `${f.retrievalTimestamp === null ? "" : ` · retrieved ${f.retrievalTimestamp}`}\n` +
        `    source: ${f.source}`
    )
    .join("\n");
}

function buildUserMessage(payload: ChallengerPayload): string {
  const suppressed = payload.activeStates.suppressing;
  const qualifying = payload.activeStates.qualifying;

  return `COMPANY
  ${payload.companyName} (${payload.ticker})

THESIS CLAIMS ON RECORD
${payload.thesisClaims.length === 0 ? "  None recorded for this company." : payload.thesisClaims.map((c) => `  ${c}`).join("\n")}

GATE RESULTS
  Gate 0: ${payload.gates.gate0.result}
  Gate 1: ${payload.gates.gate1.state ?? `${payload.gates.gate1.filedYearsCount} filed years, no state`}
  Leverage precondition: ${payload.gates.leverage.result}

ACTIVE STATES — do not raise a finding against an output already suppressed here
${
  suppressed.length === 0 && qualifying.length === 0
    ? "  Nothing suppressed and nothing qualified on this run."
    : [
        ...suppressed.map((s) => `  SUPPRESSED: ${s.state} — ${s.appliesTo}`),
        ...qualifying.map((q) => `  QUALIFIED: ${q.flag} — ${q.appliesTo}`),
      ].join("\n")
}

THE FACT RECORD. This is everything you have, and the complete set of figures
you may reference.

${factBlock(payload.facts)}`;
}

interface RawFinding {
  claimOrFactId: string;
  evidence: string;
  whatWouldHaveToBeTrue: string;
}

function readResponse(raw: unknown): RawFinding[] {
  const value = raw as { findings?: unknown } | null;
  if (value === null || typeof value !== "object" || !Array.isArray(value.findings)) {
    throw new MalformedAnalystResponseError("challenger", "no findings array");
  }
  return value.findings as RawFinding[];
}

function checked(where: string, text: string, catalogue: SlotCatalogue): string {
  const traceDefects = traceText(text, catalogue);
  if (traceDefects.length > 0) throw new UntraceableFigureError(where, traceDefects);

  const prohibited = scanProhibitedCopy(text);
  if (prohibited.length > 0) throw new ProhibitedCopyError(where, prohibited);

  return renderText(text, catalogue);
}

export async function runChallenger(payload: ChallengerPayload, call: AnalystCall): Promise<ChallengerResult> {
  // Before the call, not after. The boundary is on what the model receives.
  assertChallengerPayloadClean(payload);

  const catalogue = buildFactSlotCatalogue(
    payload.facts,
    payload.activeStates.suppressing.map((s) => s.state)
  );
  const factsById = new Map(payload.facts.map((f) => [f.id, f]));

  return callWithOneRegeneration(
    call,
    {
      label: "challenger",
      system: SYSTEM_PROMPT,
      user: buildUserMessage(payload),
      responseSchema: RESPONSE_SCHEMA,
    },
    (raw) => interpretResponse(raw, catalogue, factsById, payload.factSection)
  );
}

function interpretResponse(
  raw: unknown,
  catalogue: SlotCatalogue,
  factsById: Map<string, FactRecord>,
  factSection: ChallengerPayload["factSection"]
): ChallengerResult {
  const findings: ChallengerFinding[] = readResponse(raw).map((finding, i) => {
    const where = `challenger finding ${i + 1}`;
    const fact = factsById.get(finding.claimOrFactId);
    if (fact === undefined) {
      // §8.5.3: the finding names "the claim or fact it bears on, referenced by
      // its record". A record the challenger was not given is a fact it
      // supplied itself, which §8.3 limit 3 forbids it in full.
      throw new MalformedAnalystResponseError(
        "challenger",
        `${where} cites "${finding.claimOrFactId}", which is not a record in the supplied fact set`
      );
    }
    return {
      claimOrFactReference: `${fact.name} (${fact.id})`,
      // §17.7.1 — bound from the payload's own factSection, not from `fact`
      // or from anything in the model's response. Every finding here bears
      // on a fact (never a thesis claim; see the field's own doc comment on
      // ChallengerPayload), so this is unconditional.
      boundSection: factSection,
      evidence: checked(`${where} evidence`, finding.evidence, catalogue),
      whatWouldHaveToBeTrue: checked(`${where} what would have to be true`, finding.whatWouldHaveToBeTrue, catalogue),
    };
  });

  return { findings, completedAt: new Date().toISOString() };
}
