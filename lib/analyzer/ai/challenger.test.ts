import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
import { formatFactValue } from "../factDisplay";
import { factUnit } from "../acquisition/factUnit";
import { MSFT_FIXTURE } from "../fixtures/msft";
import type { AnalystCall, AnalystCallRequest } from "./analystCall";
import { buildChallengerPayload, ChallengerBlindingError } from "./challengerPayload";
import { runChallenger } from "./challenger";
import { UntraceableFigureError } from "./traceability";
import { ProhibitedCopyError } from "./prohibitions";

const msft = assembleAnalysisResult(MSFT_FIXTURE);
const payload = buildChallengerPayload(msft);
const someFactId = msft.facts[0].id;

function fakeCall(response: unknown, seen?: AnalystCallRequest[]): AnalystCall {
  return async (request) => {
    seen?.push(request);
    return response;
  };
}

function findings(rows: { claimOrFactId?: string; evidence?: string; whatWouldHaveToBeTrue?: string }[]): unknown {
  return {
    findings: rows.map((r) => ({
      claimOrFactId: r.claimOrFactId ?? someFactId,
      evidence: r.evidence ?? "The record carries a secondary source class.",
      whatWouldHaveToBeTrue: r.whatWouldHaveToBeTrue ?? "The figure would have to be confirmed against the filing.",
    })),
  };
}

describe("runChallenger", () => {
  it("returns structured findings, each naming the record it bears on", async () => {
    const result = await runChallenger(payload, fakeCall(findings([{}])));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].claimOrFactReference).toContain(someFactId);
    expect(result.findings[0].evidence).toBe("The record carries a secondary source class.");
    expect(result.findings[0].whatWouldHaveToBeTrue).toBe("The figure would have to be confirmed against the filing.");
  });

  it("stamps completion, because the finding enters the report only after the call has completed (§8.5.4)", async () => {
    const result = await runChallenger(payload, fakeCall(findings([{}])));

    expect(Date.parse(result.completedAt)).not.toBeNaN();
  });

  it("substitutes a cited fact's value from the supplied fact set, in its displayed form", async () => {
    const fact = msft.facts.find((f) => f.value !== null)!;
    const call = fakeCall(findings([{ claimOrFactId: fact.id, evidence: `The record reads {{facts.${fact.id}}}.` }]));

    const result = await runChallenger(payload, call);

    // The displayed form, not the exact acquired Decimal — the 8 September
    // ruling separates the two, and a challenger finding is a report surface
    // like any other.
    expect(result.findings[0].evidence).toBe(
      `The record reads ${formatFactValue(fact.value, factUnit(fact.id))}.`
    );
  });

  it("sends the payload and nothing else — the prompt carries no analyst reasoning to disregard", async () => {
    const seen: AnalystCallRequest[] = [];
    await runChallenger(payload, fakeCall(findings([{}]), seen));

    const sent = `${seen[0].system}\n${seen[0].user}`;
    for (const scenario of [msft.scenarios.bear, msft.scenarios.base, msft.scenarios.bull]) {
      expect(sent).not.toContain(scenario.writtenAnchor);
    }
    expect(sent).not.toContain(msft.scenarioOutputs.values.base.toFixed(0));
    expect(sent).toContain(someFactId);
  });

  // --- the negative tests -------------------------------------------------

  it("REFUSES to call at all when the payload carries a valuation output", async () => {
    let called = false;
    const dirty = { ...payload, fairValueRange: msft.fairValueRange };
    const call: AnalystCall = async () => {
      called = true;
      return findings([{}]);
    };

    await expect(runChallenger(dirty, call)).rejects.toThrow(ChallengerBlindingError);
    expect(called).toBe(false);
  });

  it("REFUSES a finding that cites a record the challenger was not given", async () => {
    const call = fakeCall(findings([{ claimOrFactId: "a-fact-nobody-supplied" }]));

    await expect(runChallenger(payload, call)).rejects.toThrow(/a-fact-nobody-supplied/);
  });

  it("REFUSES evidence citing a valuation slot — the challenger's catalogue holds facts only", async () => {
    const call = fakeCall(findings([{ evidence: "It sits below {{fairValueRange.bear}}." }]));

    await expect(runChallenger(payload, call)).rejects.toThrow(UntraceableFigureError);
    await expect(runChallenger(payload, call)).rejects.toThrow(/UNKNOWN SLOT/);
  });

  it("REFUSES a figure the challenger wrote rather than referenced (§8.3 limit 3 applies to it in full)", async () => {
    const call = fakeCall(findings([{ evidence: "Capital expenditure rose 34% year on year." }]));

    await expect(runChallenger(payload, call)).rejects.toThrow(/NUMERAL FROM MODEL/);
  });

  it("REFUSES a base rate the challenger recalled rather than read (§8.3 limit 2)", async () => {
    const call = fakeCall(findings([{ whatWouldHaveToBeTrue: "Peers of this kind reinvest around twenty percent." }]));

    await expect(runChallenger(payload, call)).rejects.toThrow(/SPELLED-OUT QUANTITY/);
  });

  it("REFUSES a verdict from the challenger — it returns findings, not a conclusion (§8.5.3)", async () => {
    const call = fakeCall(findings([{ whatWouldHaveToBeTrue: "The shares are overvalued on this evidence." }]));

    await expect(runChallenger(payload, call)).rejects.toThrow(ProhibitedCopyError);
  });
});
