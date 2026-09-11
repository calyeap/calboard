import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
import { MSFT_FIXTURE } from "../fixtures/msft";
import { OKLO_FIXTURE } from "../fixtures/oklo";
import type { AnalystCall, AnalystCallRequest } from "./analystCall";
import { runInterpretation, INTERPRETATION_RESPONSIBILITIES } from "./interpretation";
import { INTERPRETATION_RESPONSIBILITY_KEYS } from "../types";
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

/**
 * A well-formed response carrying the given texts.
 *
 * Always all five §8.2 responsibilities, because that is the contract: the
 * supplied texts take the first slots and the rest are filled with clean
 * prose, so a test about ONE sentence is not also a test about the set being
 * incomplete.
 */
function statementsOf(texts: string[]): unknown {
  return {
    statements: Object.fromEntries(
      INTERPRETATION_RESPONSIBILITY_KEYS.map((key, i) => [
        key,
        texts[i] ?? "Nothing further on this responsibility for this run.",
      ])
    ),
    pageOne: {
      mainFinding: "The price rests on growth the company has not yet delivered.",
      whatSupportsTheCase: "Returns on new capital sit above every discount rate in the policy grid.",
      whatWorriesCalboard: "The margin the grid is run from sits at the top of its own history.",
      biggestUncertainty: "Which margin level is the right base for the grid.",
    },
  };
}

describe("runInterpretation — scenario drivers nobody authored (CB-AUDIT-FIX-01B)", () => {
  it("tells the model the drivers were not authored — never a 0.0% or NaN standing in for them", async () => {
    const unauthored = { revenueGrowthOrPath: null, operatingMargin: null, reinvestmentCapitalIntensity: null };
    const result = assembleAnalysisResult({
      ...OKLO_FIXTURE,
      scenarios: {
        bear: { ...OKLO_FIXTURE.scenarios.bear, ...unauthored },
        base: { ...OKLO_FIXTURE.scenarios.base, ...unauthored },
        bull: { ...OKLO_FIXTURE.scenarios.bull, ...unauthored },
      },
    });
    const seen: AnalystCallRequest[] = [];
    // Only the request matters here; whatever the call returns is not under test.
    await runInterpretation(result, fakeCall(statementsOf([]), seen)).catch(() => undefined);

    const scenarioLines = seen[0].user.split("\n").filter((l) => /^\s+(bear|base|bull):/.test(l));
    expect(scenarioLines).toHaveLength(3);
    for (const line of scenarioLines) {
      expect(line).toMatch(/INCOMPLETE/);
      expect(line).not.toMatch(/NaN|0\.0%/);
    }
  });
});

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

  it("records a reference written with inner spaces, which the renderer substitutes either way", async () => {
    const call = fakeCall(statementsOf(["Today's price is {{ price }}."]));

    const interpretation = await runInterpretation(msft, call);

    expect(interpretation.statements[0].referencesValueIds).toEqual(["price"]);
    expect(interpretation.statements[0].statement).toContain(msft.price.value.toFixed(2));
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

  // --- one regeneration, never a repair --------------------------------

  describe("when the first output is refused", () => {
    function badThenGood(seen: AnalystCallRequest[]): AnalystCall {
      let n = 0;
      return async (request) => {
        seen.push(request);
        n += 1;
        return n === 1
          ? statementsOf(["Today's price implies growth of 14.2% a year."])
          : statementsOf([`Today's price implies {{${CLEAN_CAGR_SLOT}}} a year.`]);
      };
    }

    it("regenerates once and keeps the second output", async () => {
      const seen: AnalystCallRequest[] = [];

      const interpretation = await runInterpretation(msft, badThenGood(seen));

      expect(seen).toHaveLength(2);
      expect(interpretation.statements[0].referencesValueIds).toEqual([CLEAN_CAGR_SLOT]);
    });

    it("keeps nothing from the refused attempt — the output is regenerated whole, never patched", async () => {
      const interpretation = await runInterpretation(msft, badThenGood([]));

      expect(JSON.stringify(interpretation)).not.toContain("14.2");
    });

    it("tells the model what failed, so the second attempt is informed rather than a re-roll", async () => {
      const seen: AnalystCallRequest[] = [];

      await runInterpretation(msft, badThenGood(seen));

      expect(seen[0].user).not.toContain("NUMERAL FROM MODEL");
      expect(seen[1].user).toContain("NUMERAL FROM MODEL");
    });

    it("gives up after the second refusal rather than retrying until something passes", async () => {
      const seen: AnalystCallRequest[] = [];
      const alwaysBad: AnalystCall = async (request) => {
        seen.push(request);
        return statementsOf(["Growth of 14.2% is implied."]);
      };

      await expect(runInterpretation(msft, alwaysBad)).rejects.toThrow(UntraceableFigureError);
      expect(seen).toHaveLength(2);
    });
  });

  // --- the shape of §8.2's table ------------------------------------------
  //
  // A live OKLO run returned SIX statements, the sixth a restatement of the
  // fifth "for the reader who wants one line" — which is how a summary, and
  // then a verdict, arrives on a page that must carry neither. The old array
  // schema could not forbid it: the API rejects any `minItems` but 0 or 1, so
  // the contract could only be CHECKED, and a check costs a run every time it
  // fires.
  //
  // The response is now an object with five required keys, so "answered twice"
  // is not something to refuse — it is something that cannot be expressed. The
  // tests below cover what remains expressible, and the code that refuses it is
  // kept even though the schema should stop it first.

  it("cannot represent a responsibility answered twice — parsing collapses the key", () => {
    // Through JSON.parse, because that is how a response actually arrives.
    // TypeScript will not even compile a literal with a repeated key, which is
    // the same fact one layer earlier.
    const twice = JSON.parse(
      '{"growthPathAgainstBaseRatesAndHistory":"First answer.","growthPathAgainstBaseRatesAndHistory":"Restated plainly."}'
    ) as Record<string, string>;

    expect(Object.keys(twice)).toEqual(["growthPathAgainstBaseRatesAndHistory"]);
    expect(INTERPRETATION_RESPONSIBILITY_KEYS).toHaveLength(INTERPRETATION_RESPONSIBILITIES.length);
  });

  it("keeps the §8.2 table's own order, so Section I cannot silently reorder it", async () => {
    const interpretation = await runInterpretation(msft, fakeCall(statementsOf([])));

    expect(interpretation.statements.map((s) => s.responsibility)).toEqual([...INTERPRETATION_RESPONSIBILITIES]);
  });

  it("REFUSES a set that leaves one of §8.2's five undischarged", async () => {
    const partial = statementsOf([]) as { statements: Record<string, string> };
    delete partial.statements[INTERPRETATION_RESPONSIBILITY_KEYS[3]];

    await expect(runInterpretation(msft, fakeCall(partial))).rejects.toThrow(/went unanswered/i);
  });

  it("REFUSES a key outside §8.2's five, even though the schema should have stopped it", async () => {
    const extra = statementsOf([]) as { statements: Record<string, string> };
    extra.statements.overallVerdict = "Nothing numeric.";

    await expect(runInterpretation(msft, fakeCall(extra))).rejects.toThrow(/overallVerdict/);
  });
});
