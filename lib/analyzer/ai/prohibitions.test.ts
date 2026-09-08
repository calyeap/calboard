import { describe, it, expect } from "vitest";
import { scanProhibitedCopy } from "./prohibitions";

// §8.3 limit 1 — "[C] issues no verdict, no target and no recommendation. Not
// softened, not implied, not phrased as a question that carries one... [C] may
// RESTATE the position in prose under §10.7, and may not author one, vary one,
// soften one, qualify one, or reason toward one of its own."
//
// §10.5's prohibited output patterns, in the rows a [C] string could produce:
// a price target, any single-number fair value, any portfolio action, and a
// [C]-authored position.
//
// This is a phrase scan, not a word scan. "adds to the uncertainty" is prose;
// "add to the position" is a portfolio action. A rule that cannot tell them
// apart is noise, and noise gets switched off.

describe("scanProhibitedCopy", () => {
  it("passes ordinary interpretation prose", () => {
    expect(
      scanProhibitedCopy(
        "The price requires revenue growth to hold above the level the company has delivered, " +
          "and the margin it is run from sits at the top of its own history."
      )
    ).toEqual([]);
  });

  it("refuses a [C]-authored position — the position is [S] output, computed under §10.6", () => {
    expect(scanProhibitedCopy("On this evidence the shares look CHEAP.")).toEqual([
      { kind: "AUTHORED POSITION", detail: "CHEAP" },
    ]);
  });

  it("refuses INCONCLUSIVE too — a position is a position, including the one that reports no finding", () => {
    expect(scanProhibitedCopy("The evidence is INCONCLUSIVE.")).toEqual([
      { kind: "AUTHORED POSITION", detail: "INCONCLUSIVE" },
    ]);
  });

  it("refuses a price target", () => {
    expect(scanProhibitedCopy("A reasonable price target sits above today's quote.")).toEqual([
      { kind: "VERDICT OR TARGET", detail: "price target" },
    ]);
  });

  it("refuses a portfolio action — those need position size and cost basis §1.4 forbids", () => {
    const defects = scanProhibitedCopy("Investors could trim the position here.");

    expect(defects).toEqual([{ kind: "PORTFOLIO ACTION", detail: "trim the position" }]);
  });

  it("refuses a softened verdict, which limit 1 covers explicitly", () => {
    expect(scanProhibitedCopy("The shares appear undervalued on this basis.")).toEqual([
      { kind: "VERDICT OR TARGET", detail: "undervalued" },
    ]);
  });

  it("leaves the word 'add' alone where it is ordinary English", () => {
    expect(scanProhibitedCopy("Acquisitions add to the measurement noise in the RONIC ladder.")).toEqual([]);
  });

  it("leaves the word 'fair' alone in lower-case prose — only the position token is refused", () => {
    expect(scanProhibitedCopy("The fair-value range is an inference, not a measurement.")).toEqual([]);
  });
});
