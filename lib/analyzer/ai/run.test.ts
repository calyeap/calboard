import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
import { MSFT_FIXTURE } from "../fixtures/msft";
import type { AnalystCall, AnalystCallRequest } from "./analystCall";
import { runAiLayer, mergeAiLayer, MergeOrderingError } from "./run";
import { INTERPRETATION_RESPONSIBILITIES } from "../types";

// §8.5.4 — "The challenger's output is merged into the final report ONLY AFTER
// the independent call has completed. The merge is assembly, not synthesis —
// findings are placed alongside the analysis, not reconciled with it, and
// neither side is rewritten in light of the other."

const msft = assembleAnalysisResult(MSFT_FIXTURE);
const factId = msft.facts[0].id;

const INTERPRETATION_TEXT = "The price rests on growth this company has not yet delivered.";
const CHALLENGER_EVIDENCE = "The record is carried at book value in both directions.";

function scriptedCall(seen: AnalystCallRequest[]): AnalystCall {
  return async (request) => {
    seen.push(request);
    if (request.label === "interpretation") {
      return {
        // All five §8.2 responsibilities — Section I is that table, and an
        // incomplete set is refused.
        statements: INTERPRETATION_RESPONSIBILITIES.map((responsibility, i) => ({
          responsibility,
          text: i === 2 ? INTERPRETATION_TEXT : "Nothing further on this responsibility for this run.",
        })),
        pageOne: {
          mainFinding: INTERPRETATION_TEXT,
          whatSupportsTheCase: "Returns on new capital sit above the policy rates.",
          whatWorriesCalboard: "The margin sits at the top of its own history.",
          biggestUncertainty: "Which margin level is the right base.",
        },
      };
    }
    return {
      findings: [
        {
          claimOrFactId: factId,
          evidence: CHALLENGER_EVIDENCE,
          whatWouldHaveToBeTrue: "The classification would have to be wrong.",
        },
      ],
    };
  };
}

describe("runAiLayer", () => {
  it("makes exactly two calls — one interpretation, one challenger. No panel, no tally (§8.3 limit 6)", async () => {
    const seen: AnalystCallRequest[] = [];

    await runAiLayer(msft, scriptedCall(seen));

    expect(seen.map((r) => r.label).sort()).toEqual(["challenger", "interpretation"]);
  });

  it("shows neither call the other's output — the challenger is blind and stays blind", async () => {
    const seen: AnalystCallRequest[] = [];

    await runAiLayer(msft, scriptedCall(seen));

    const challengerRequest = seen.find((r) => r.label === "challenger")!;
    expect(`${challengerRequest.system}\n${challengerRequest.user}`).not.toContain(INTERPRETATION_TEXT);

    const interpretationRequest = seen.find((r) => r.label === "interpretation")!;
    expect(`${interpretationRequest.system}\n${interpretationRequest.user}`).not.toContain(CHALLENGER_EVIDENCE);
  });
});

describe("mergeAiLayer", () => {
  it("places both outputs verbatim — neither side is rewritten in light of the other", async () => {
    const outputs = await runAiLayer(msft, scriptedCall([]));

    const merged = mergeAiLayer(msft, outputs);

    expect(merged.interpretation).toEqual(outputs.interpretation);
    expect(merged.challenger).toEqual(outputs.challenger);
  });

  it("changes nothing else about the analysis — the numbers were settled before either call ran", async () => {
    const outputs = await runAiLayer(msft, scriptedCall([]));

    const merged = mergeAiLayer(msft, outputs);

    const { interpretation: _i, challenger: _c, ...restOfMerged } = merged;
    const { interpretation: _i2, challenger: _c2, ...restOfOriginal } = msft;
    expect(restOfMerged).toEqual(restOfOriginal);
  });

  it("keeps the two members separate — findings sit alongside the analysis, never inside it", async () => {
    const outputs = await runAiLayer(msft, scriptedCall([]));

    const merged = mergeAiLayer(msft, outputs);

    expect(JSON.stringify(merged.interpretation)).not.toContain(CHALLENGER_EVIDENCE);
    expect(JSON.stringify(merged.challenger)).not.toContain(INTERPRETATION_TEXT);
  });

  it("REFUSES to merge a challenger result that has not completed (§8.5.4)", async () => {
    const outputs = await runAiLayer(msft, scriptedCall([]));

    expect(() =>
      mergeAiLayer(msft, { ...outputs, challenger: { ...outputs.challenger, completedAt: "" } })
    ).toThrow(MergeOrderingError);
  });

  it("leaves challenger null on an analysis where the call has not run", () => {
    expect(msft.challenger).toBeNull();
    expect(msft.interpretation.statements).toEqual([]);
    expect(msft.interpretation.pageOne).toBeNull();
  });
});
