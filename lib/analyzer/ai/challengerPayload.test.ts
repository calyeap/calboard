import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
import { MSFT_FIXTURE } from "../fixtures/msft";
import { OKLO_FIXTURE } from "../fixtures/oklo";
import type { AnalysisResult } from "../types";
import {
  buildChallengerPayload,
  assertChallengerPayloadClean,
  CHALLENGER_PAYLOAD_SOURCE_MEMBERS,
  ChallengerBlindingError,
} from "./challengerPayload";

// §8.5.2: "Enforced by the call boundary, not by instruction... the
// challenger's input is assembled from the fact set and thesis claims BY
// CONSTRUCTION — a filtered payload built for this call — not by passing the
// full analysis context with an instruction to ignore parts of it. An
// instruction to disregard is not a boundary."
//
// So these tests assert on the constructed OBJECT, never on prompt text.

const msft = assembleAnalysisResult(MSFT_FIXTURE);
const oklo = assembleAnalysisResult(OKLO_FIXTURE);

/**
 * Records which top-level members of the Analysis Result the builder actually
 * touches. This is the by-construction proof: not "the payload happens to
 * contain nothing forbidden", but "the builder never read anything forbidden
 * in the first place".
 */
function recordingProxy(result: AnalysisResult): { proxy: AnalysisResult; read: Set<string> } {
  const read = new Set<string>();
  const proxy = new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string") read.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  }) as AnalysisResult;
  return { proxy, read };
}

describe("buildChallengerPayload", () => {
  it("reads only the members §8.5.1 names, and never opens one §8.5.2 excludes", () => {
    const { proxy, read } = recordingProxy(msft);

    buildChallengerPayload(proxy);

    expect([...read].sort()).toEqual([...CHALLENGER_PAYLOAD_SOURCE_MEMBERS].sort());
    for (const excluded of ["fairValueRange", "scenarios", "scenarioOutputs", "priceImplied", "interpretation", "preRevenue"]) {
      expect(read.has(excluded)).toBe(false);
    }
  });

  it("carries the verified fact set with all six §3.2 fields intact", () => {
    const payload = buildChallengerPayload(msft);

    expect(payload.facts.length).toBe(msft.facts.length);
    for (const fact of payload.facts) {
      expect(fact).toHaveProperty("type");
      expect(fact).toHaveProperty("sourceClass");
      expect(fact).toHaveProperty("extractionType");
      expect(fact).toHaveProperty("verificationState");
      expect(fact).toHaveProperty("asOfDate");
      expect(fact).toHaveProperty("retrievalTimestamp");
    }
  });

  it("carries gate results and active states, so it does not challenge a suppressed output", () => {
    const payload = buildChallengerPayload(oklo);

    expect(payload.gates.gate0.result).toBe(oklo.gates.gate0.result);
    expect(payload.activeStates.suppressing).toEqual(oklo.states.suppressing);
    expect(payload.activeStates.qualifying).toEqual(oklo.states.qualifying);
  });

  it("carries no thesis claims, because v1 records none — an empty list, never invented text", () => {
    expect(buildChallengerPayload(msft).thesisClaims).toEqual([]);
  });

  it("carries no scenario written anchor — that is analyst base-case reasoning (§8.5.2)", () => {
    const serialised = JSON.stringify(buildChallengerPayload(msft));

    for (const scenario of [msft.scenarios.bear, msft.scenarios.base, msft.scenarios.bull]) {
      expect(serialised).not.toContain(scenario.writtenAnchor);
    }
  });
});

describe("assertChallengerPayloadClean", () => {
  it("passes the payload the builder produces", () => {
    expect(() => assertChallengerPayloadClean(buildChallengerPayload(msft))).not.toThrow();
    expect(() => assertChallengerPayloadClean(buildChallengerPayload(oklo))).not.toThrow();
  });

  // --- the negative tests. A check that has never failed is not a control. ---

  it("REFUSES a payload carrying a valuation output", () => {
    const smuggled = { ...buildChallengerPayload(msft), fairValueRange: msft.fairValueRange };

    expect(() => assertChallengerPayloadClean(smuggled)).toThrow(ChallengerBlindingError);
    expect(() => assertChallengerPayloadClean(smuggled)).toThrow(/fairValueRange/);
  });

  it("REFUSES a valuation output nested inside an otherwise-allowed member", () => {
    const payload = buildChallengerPayload(msft);
    const smuggled = {
      ...payload,
      thesisClaims: [...payload.thesisClaims],
      gates: { ...payload.gates, priceImplied: msft.priceImplied } as unknown as typeof payload.gates,
    };

    expect(() => assertChallengerPayloadClean(smuggled)).toThrow(/priceImplied/);
  });

  it("REFUSES a payload carrying the interpretation layer's own output (§8.5.2)", () => {
    const smuggled = {
      ...buildChallengerPayload(msft),
      interpretation: { statements: [{ statement: "x", referencesValueIds: [] }] },
    };

    expect(() => assertChallengerPayloadClean(smuggled)).toThrow(/interpretation/);
  });

  it("REFUSES a payload with a member §8.5.1 does not name, rather than allowing anything not explicitly banned", () => {
    const smuggled = { ...buildChallengerPayload(msft), analystConclusion: "the company is worth more than this" };

    expect(() => assertChallengerPayloadClean(smuggled)).toThrow(/analystConclusion/);
  });
});
