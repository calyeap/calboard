import type { ChallengerFinding, ChallengerResult, FactRecord } from "../types";
import { assertChallengerPayloadClean, type ChallengerPayload } from "./challengerPayload";
import { buildFactSlotCatalogue } from "./slots";
import { renderText, traceText, UntraceableFigureError, type SlotCatalogue } from "./traceability";
import { scanProhibitedCopy, ProhibitedCopyError } from "./prohibitions";
import { MalformedAnalystResponseError, type AnalystCall } from "./analystCall";

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

The digit rule catches ordinary phrasing too: write "the last five years", not "the last 5 years"; "the ten-year window", not "the 10-year window". An output containing one digit outside a slot reference is refused ENTIRELY, every finding in it, with no repair pass.

The claimOrFactId field is the one exception — it is an id, not prose, and you copy it exactly as given even where it contains digits.

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

  const catalogue = buildFactSlotCatalogue(payload.facts);
  const factsById = new Map(payload.facts.map((f) => [f.id, f]));

  const raw = await call({
    label: "challenger",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(payload),
    responseSchema: RESPONSE_SCHEMA,
  });

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
      evidence: checked(`${where} evidence`, finding.evidence, catalogue),
      whatWouldHaveToBeTrue: checked(`${where} what would have to be true`, finding.whatWouldHaveToBeTrue, catalogue),
    };
  });

  return { findings, completedAt: new Date().toISOString() };
}
