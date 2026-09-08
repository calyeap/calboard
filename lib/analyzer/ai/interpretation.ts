import Decimal from "decimal.js";
import {
  INTERPRETATION_RESPONSIBILITIES,
  type AnalysisResult,
  type InterpretationResponsibility,
  type InterpretationResult,
  type InterpretationStatement,
  type PageOneProse,
} from "../types";
import { buildSlotCatalogue } from "./slots";
import { renderText, slotIdsIn, traceText, UntraceableFigureError, type SlotCatalogue } from "./traceability";
import { scanProhibitedCopy, ProhibitedCopyError } from "./prohibitions";
import { MalformedAnalystResponseError, type AnalystCall } from "./analystCall";

export { INTERPRETATION_RESPONSIBILITIES };

// ---------------------------------------------------------------------------
// §8.2 — the interpretation layer, and §10.7 rule 2's page-one prose.
//
// One call. It sees the whole analysis, which is the difference between it and
// the challenger: the interpretation layer explains what was computed, so
// withholding the computation would be pointless. What it may not do is supply
// figures. Every number it prints is substituted from the Analysis Result by
// slot (§10.7 rule 3), and this file refuses the output outright if any figure
// fails to trace — "a numeral emitted by [C] is a defect rather than a value to
// be checked".
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the interpretation layer of the Calboard Stock Analyzer.

Deterministic software has already done every calculation, gate and state. Your job is to say in plain English what those computed values mean. You interpret; you do not compute, choose or decide.

HARD LIMITS. These are not style preferences.

1. You issue no verdict, no target and no recommendation — not softened, not implied, and not phrased as a question that carries one. You never write CHEAP, FAIR, EXPENSIVE or INCONCLUSIVE: the valuation position is computed by the deterministic layer, and you may not author, vary, soften, qualify or reason toward one of your own.
2. You may cite base rates ONLY from the supplied data. Never from memory. Where the supplied data contains no base rate for a comparison you would naturally make, say that none is available and stop. Do not substitute a remembered figure, a plausible range, or an unattributed general claim.
3. You supply no facts. You read the fact set you are given.
4. You do not choose assumptions. The discount band and terminal growth come from policy; the scenarios come from the analyst.
5. You do not override a state. Where a value is suppressed, report the state and say nothing in its place. Do not reason around it, estimate past it, or describe what the number would probably have been.
6. You do not aggregate or vote. No personas, no confidence tallies, no scores.

HOW YOU REFERENCE NUMBERS. You may not emit a numeral. Not one digit, anywhere, in any sentence you write. Every figure is referenced by its slot id from the catalogue you are given, written in double braces: {{slot.id}}. The renderer substitutes the value the deterministic layer computed. Quantities spelled out in words ("fifteen percent", "three billion") are numerals too, and are refused the same way. If you want to say something numeric and no slot carries it, say it qualitatively or do not say it.

The digit rule catches ordinary phrasing too, so write around it:

  "years 1-5"        ->  "the first five years"
  "at 8%, 10%, 12%"  ->  "at each of the three policy discount rates", or reference the rate slots
  "the 10-year CAGR" ->  "the ten-year CAGR"
  "M7's grid"        ->  "the reverse-DCF grid"

An output containing one digit outside a slot reference is refused ENTIRELY — every sentence in it, not just the offending one. There is no repair pass and no partial acceptance, so check each sentence before you finish.

Some catalogue entries hold TEXT rather than a figure — a success definition's own name, for instance. Where you want to name one, reference its slot rather than typing the name out: several of them contain digits, and typing one would fail the rule above for a reason that has nothing to do with what you meant to say.

A slot whose value is suppressed renders as its state name. Referencing one is the correct way to report a suppression, and it is the only thing you may say about it.

VOCABULARY. Where a pre-revenue interpolation between two outcome values appears, it is a "conditional price-implied break-even success weight". It is never an implied probability of success, and it is never presented as a real-world probability.

Write for one reader who is intelligent and not a specialist. Short sentences. No hedging filler. Never claim more than the computed values support.`;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["statements", "pageOne"],
  properties: {
    statements: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["responsibility", "text"],
        properties: {
          responsibility: { type: "string", enum: [...INTERPRETATION_RESPONSIBILITIES] },
          text: { type: "string" },
        },
      },
    },
    pageOne: {
      type: "object",
      additionalProperties: false,
      required: ["mainFinding", "whatSupportsTheCase", "whatWorriesCalboard", "biggestUncertainty"],
      properties: {
        mainFinding: { type: "string" },
        whatSupportsTheCase: { type: "string" },
        whatWorriesCalboard: { type: "string" },
        biggestUncertainty: { type: "string" },
      },
    },
  },
};

const RESPONSIBILITY_BRIEF: Record<InterpretationResponsibility, string> = {
  "GROWTH PATH AGAINST BASE RATES AND HISTORY":
    "Check the analyst's chosen growth path against the base rates and history present in the supplied data, and say what would have to be true for it to hold. Do not choose the path.",
  "MODEL FRAGILITY":
    "Say whether this model is fragile — usually because the terminal period dominates, or because growth and the discount rate are close — and what that means for how much weight the output carries.",
  "PRICE-IMPLIED DIAGNOSTICS":
    "Translate the price-implied diagnostics into a sentence, and compare them with base rates and history where the supplied data contains them.",
  "SCENARIO CONSTRUCTION":
    "Say what the analyst's three scenarios rest on and where they are least anchored. The analyst authors them; you do not.",
  "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES":
    "Assess each assumption's plausibility against base rates and history, flag internal inconsistencies, and state plainly what the price requires.",
};

function catalogueBlock(catalogue: SlotCatalogue): string {
  return [...catalogue.values()]
    .map((s) => `  {{${s.id}}}  ${s.label} = ${s.formatted}${s.suppressed ? "   [SUPPRESSED — this is a state, not a number]" : ""}`)
    .join("\n");
}

function pct(v: Decimal): string {
  return `${v.mul(100).toFixed(1)}%`;
}

function scenarioBlock(result: AnalysisResult): string {
  return (["bear", "base", "bull"] as const)
    .map((k) => {
      const s = result.scenarios[k];
      const growth = Array.isArray(s.revenueGrowthOrPath)
        ? "an explicit year-by-year path"
        : pct(s.revenueGrowthOrPath);
      return `  ${k}: growth ${growth}, operating margin ${pct(s.operatingMargin)}, reinvestment ${pct(
        s.reinvestmentCapitalIntensity
      )} — anchor: ${s.writtenAnchor}`;
    })
    .join("\n");
}

function statesBlock(result: AnalysisResult): string {
  const suppressing = result.states.suppressing.map((s) => `  SUPPRESSED: ${s.state} — ${s.appliesTo}`);
  const qualifying = result.states.qualifying.map((q) => `  QUALIFIED: ${q.flag} — ${q.appliesTo}`);
  const all = [...suppressing, ...qualifying];
  return all.length === 0 ? "  Nothing suppressed and nothing qualified on this run." : all.join("\n");
}

function buildUserMessage(result: AnalysisResult, catalogue: SlotCatalogue): string {
  return `COMPANY
  ${result.companyName} (${result.ticker}), profile ${result.profile.confirmedOrOverridden}${
    result.profile.recommended !== result.profile.confirmedOrOverridden ? " — overridden by the analyst" : ""
  }.

GATES
  Gate 0: ${result.gates.gate0.result}
  Gate 1: ${result.gates.gate1.state ?? `${result.gates.gate1.filedYearsCount} filed years, no state`}
  Leverage precondition: ${result.gates.leverage.result}
  Trigger A fired: ${result.gates.triggerA.fired} — ${result.gates.triggerA.evidence}
  Trigger B fired: ${result.gates.triggerB.fired} — ${result.gates.triggerB.evidence}

ACTIVE STATES AND FLAGS
${statesBlock(result)}

ANALYST SCENARIOS (Step 7 — the analyst's own, not yours to revise)
${scenarioBlock(result)}

THE FIGURES YOU MAY REFERENCE. This catalogue is the complete set. A figure not
listed here does not exist for the purposes of anything you write, including any
base rate — if you cannot find a base rate here, say none is available.

${catalogueBlock(catalogue)}

WHAT TO WRITE

One statement for each of the five responsibilities below, in this order. Where
a responsibility has nothing to say on this run because its inputs are
suppressed, say that, name the state by referencing its slot, and stop.

${INTERPRETATION_RESPONSIBILITIES.map((r) => `  ${r}\n    ${RESPONSIBILITY_BRIEF[r]}`).join("\n")}

Then page one's four sentences. These are read first and quoted most, so they
carry the same limits and no latitude at all:

  mainFinding          What this analysis found. Not a verdict on the company.
  whatSupportsTheCase  What in the computed values supports the case.
  whatWorriesCalboard  What in the computed values counts against it.
  biggestUncertainty   The single assumption most capable of changing the answer.`;
}

function validate(where: string, text: string, catalogue: SlotCatalogue): void {
  const traceDefects = traceText(text, catalogue);
  if (traceDefects.length > 0) throw new UntraceableFigureError(where, traceDefects);

  const prohibited = scanProhibitedCopy(text);
  if (prohibited.length > 0) throw new ProhibitedCopyError(where, prohibited);
}

function toStatement(
  where: string,
  responsibility: InterpretationResponsibility,
  text: string,
  catalogue: SlotCatalogue
): InterpretationStatement {
  validate(where, text, catalogue);
  return {
    responsibility,
    statement: renderText(text, catalogue),
    referencesValueIds: slotIdsIn(text),
  };
}

interface RawStatement {
  responsibility: string;
  text: string;
}

interface RawResponse {
  statements: RawStatement[];
  pageOne: Record<string, string>;
}

function readResponse(raw: unknown): RawResponse {
  const value = raw as Partial<RawResponse> | null;
  if (value === null || typeof value !== "object" || !Array.isArray(value.statements)) {
    throw new MalformedAnalystResponseError("interpretation", "no statements array");
  }
  if (value.pageOne === undefined || typeof value.pageOne !== "object" || value.pageOne === null) {
    throw new MalformedAnalystResponseError("interpretation", "no pageOne object");
  }
  return { statements: value.statements, pageOne: value.pageOne };
}

const PAGE_ONE_KEYS = ["mainFinding", "whatSupportsTheCase", "whatWorriesCalboard", "biggestUncertainty"] as const;

export async function runInterpretation(result: AnalysisResult, call: AnalystCall): Promise<InterpretationResult> {
  const catalogue = buildSlotCatalogue(result);

  const raw = await call({
    label: "interpretation",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(result, catalogue),
    responseSchema: RESPONSE_SCHEMA,
  });

  const response = readResponse(raw);

  const statements = response.statements.map((s, i) => {
    if (!(INTERPRETATION_RESPONSIBILITIES as readonly string[]).includes(s.responsibility)) {
      throw new MalformedAnalystResponseError(
        "interpretation",
        `"${s.responsibility}" is not one of §8.2's five responsibilities`
      );
    }
    return toStatement(`interpretation statement ${i + 1}`, s.responsibility as InterpretationResponsibility, s.text, catalogue);
  });

  // Page one's four sentences carry the §8.2 responsibility they discharge so
  // that nothing in the result object is a sentence without a reason to exist.
  const pageOne = Object.fromEntries(
    PAGE_ONE_KEYS.map((key) => {
      const text = response.pageOne[key];
      if (typeof text !== "string") {
        throw new MalformedAnalystResponseError("interpretation", `page one is missing ${key}`);
      }
      return [key, toStatement(`page one — ${key}`, "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES", text, catalogue)];
    })
  ) as unknown as PageOneProse;

  return { statements, pageOne };
}
