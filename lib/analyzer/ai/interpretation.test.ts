import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
import { MSFT_FIXTURE } from "../fixtures/msft";
import type { AnalystCall, AnalystCallRequest } from "./analystCall";
import { runInterpretation, INTERPRETATION_RESPONSIBILITIES } from "./interpretation";
import { UntraceableFigureError } from "./traceability";
import { ProhibitedCopyError } from "./prohibitions";

const msft = assembleAnalysisResult(MSFT_FIXTURE);

// A cell MSFT resolves cleanly, and one it suppresses — the design was drawn
// around four of nine cells returning a state (design §11), so both exist.
const CLEAN_CAGR_SLOT = "priceImplied.reverseDcf.current@0.08.tenYearCagr";
const suppressedCell = msft.priceImplied.reverseDcfGrid.find((c) => c.fiveYearGrowth.suppressed)!;
const SUPPRESSED_SLOT = `priceImplied.reverseDcf.${suppressedCell.marginLevel}@${suppressedCell.rate}.fiveYearGrowth`;

function fakeCall(response: unknown, seen?: AnalystCallRequest[]): AnalystCall {
  return async (request) => {
    seen?.push(request);
    return response;
  };
}

function statementsOf(texts: string[]): unknown {
  return {
    statements: texts.map((text, i) => ({
      responsibility: INTERPRETATION_RESPONSIBILITIES[i % INTERPRETATION_RESPONSIBILITIES.length],
      text,
    })),
    pageOne: {
      mainFinding: "The price rests on growth the company has not yet delivered.",
      whatSupportsTheCase: "Returns on new capital sit above every discount rate in the policy grid.",
      whatWorriesCalboard: "The margin the grid is run from sits at the top of its own history.",
      biggestUncertainty: "Which margin level is the right base for the grid.",
    },
  };
}

describe("runInterpretation", () => {
  it("substitutes every figure from the Analysis Result rather than from the model", async () => {
    const call = fakeCall(statementsOf([`Today's price implies a ten-year CAGR of {{${CLEAN_CAGR_SLOT}}}.`]));

    const interpretation = await runInterpretation(msft, call);

    const cagr = msft.priceImplied.reverseDcfGrid.find((c) => c.marginLevel === "current" && c.rate === 0.08)!.tenYearCagr;
    expect(cagr.suppressed).toBe(false);
    expect(interpretation.statements[0].statement).toContain(
      `${(cagr as { value: { mul: (n: number) => { toFixed: (d: number) => string } } }).value.mul(100).toFixed(1)}%`
    );
  });

  it("records the values each statement rests on, derived from the slots it cites and not from the model's say-so", async () => {
    const call = fakeCall(statementsOf([`Implied growth is {{${CLEAN_CAGR_SLOT}}} against a price of {{price}}.`]));

    const interpretation = await runInterpretation(msft, call);

    expect(interpretation.statements[0].referencesValueIds.sort()).toEqual([CLEAN_CAGR_SLOT, "price"].sort());
  });

  it("gives [C] the catalogue of referenceable figures, so it chooses from this run rather than from memory", async () => {
    const seen: AnalystCallRequest[] = [];
    await runInterpretation(msft, fakeCall(statementsOf(["Nothing numeric here."]), seen));

    expect(seen).toHaveLength(1);
    expect(seen[0].user).toContain(CLEAN_CAGR_SLOT);
    expect(seen[0].system).toContain("may not emit a numeral");
  });

  it("prints a suppressed figure as its state, so [C] cannot describe a number that was never produced (§8.3 limit 5)", async () => {
    const call = fakeCall(statementsOf([`The stress cell returns {{${SUPPRESSED_SLOT}}}.`]));

    const interpretation = await runInterpretation(msft, call);

    expect(interpretation.statements[0].statement).toContain(
      suppressedCell.fiveYearGrowth.suppressed ? suppressedCell.fiveYearGrowth.state : ""
    );
    expect(interpretation.statements[0].statement).not.toMatch(/\d/);
  });

  it("populates page one's four variable sentences (§10.7 rule 2)", async () => {
    const interpretation = await runInterpretation(msft, fakeCall(statementsOf(["A statement."])));

    expect(interpretation.pageOne).not.toBeNull();
    expect(interpretation.pageOne!.mainFinding.statement).toContain("growth the company has not yet delivered");
    expect(interpretation.pageOne!.biggestUncertainty.statement).toContain("margin level");
  });

  // --- the negative tests -------------------------------------------------

  it("REFUSES a statement carrying a figure that is not in the Analysis Result", async () => {
    const call = fakeCall(statementsOf(["Today's price implies a ten-year CAGR of 14.2%."]));

    await expect(runInterpretation(msft, call)).rejects.toThrow(UntraceableFigureError);
    await expect(runInterpretation(msft, call)).rejects.toThrow(/NUMERAL FROM MODEL/);
  });

  it("REFUSES a base rate recalled from memory — it has no field behind it (§8.3 limit 2)", async () => {
    const call = fakeCall(statementsOf(["Software companies of this size typically grow at fifteen percent a year."]));

    await expect(runInterpretation(msft, call)).rejects.toThrow(/SPELLED-OUT QUANTITY/);
  });

  it("REFUSES a [C] output that describes a suppressed number (§8.3 limit 5)", async () => {
    // The stress cell produced no number at all. A sentence that says what it
    // "would have been" is the failure limit 5 names — reasoning around a
    // state, estimating past it, describing the number it did not produce.
    const call = fakeCall(
      statementsOf([`The stress cell returns {{${SUPPRESSED_SLOT}}}, but the implied growth would be about 18%.`])
    );

    await expect(runInterpretation(msft, call)).rejects.toThrow(UntraceableFigureError);
    await expect(runInterpretation(msft, call)).rejects.toThrow(/NUMERAL FROM MODEL/);
  });

  it("REFUSES the same description spelled out in words", async () => {
    const call = fakeCall(
      statementsOf([`The stress cell returns {{${SUPPRESSED_SLOT}}}; the answer would have been near eighteen percent.`])
    );

    await expect(runInterpretation(msft, call)).rejects.toThrow(/SPELLED-OUT QUANTITY/);
  });

  it("REFUSES a slot the Analysis Result does not hold", async () => {
    const call = fakeCall(statementsOf(["Implied growth is {{priceImplied.reverseDcf.invented@0.09.tenYearCagr}}."]));

    await expect(runInterpretation(msft, call)).rejects.toThrow(/UNKNOWN SLOT/);
  });

  it("REFUSES a [C]-authored position (§8.3 limit 1)", async () => {
    const call = fakeCall(statementsOf(["On the evidence here the shares look CHEAP."]));

    await expect(runInterpretation(msft, call)).rejects.toThrow(ProhibitedCopyError);
  });

  it("REFUSES a page-one sentence that fails the same checks — page one is read first and checked least", async () => {
    const response = statementsOf(["A clean statement."]) as {
      pageOne: { mainFinding: string };
    };
    response.pageOne.mainFinding = "The base case is worth $520 a share.";

    await expect(runInterpretation(msft, fakeCall(response))).rejects.toThrow(UntraceableFigureError);
  });

  it("REFUSES a responsibility outside §8.2's five", async () => {
    const call = fakeCall({
      statements: [{ responsibility: "OVERALL VERDICT", text: "Nothing numeric." }],
      pageOne: (statementsOf([]) as { pageOne: unknown }).pageOne,
    });

    await expect(runInterpretation(msft, call)).rejects.toThrow(/OVERALL VERDICT/);
  });
});
