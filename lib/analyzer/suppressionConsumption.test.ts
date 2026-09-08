import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { assembleAnalysisResult, type CompanyFixture } from "./assemble";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";

// ---------------------------------------------------------------------------
// M8-d FIX 1 — the suppressing state stops the output it suppresses.
//
// Before this milestone `gate0.result` was pushed into `states.suppressing`
// and never read again, so a fair-value range rendered beside a state saying
// there is no fair-value range. These are the negative tests for that defect:
// each one fails if the consumption is removed, which is the only thing that
// makes them worth having.
//
// Every expectation is anchored to a frozen artefact named in the test.
// ---------------------------------------------------------------------------

/** MSFT, with its sector changed so Gate 0's asset-based row fires (V7). */
function msftAsAFinancial(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    gate0: { ...MSFT_FIXTURE.gate0, sectorClassification: "Financials" },
  };
}

/** MSFT, with its classification removed so Gate 0 fails closed (§6.1). */
function msftUnclassifiable(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    gate0: {
      ...MSFT_FIXTURE.gate0,
      sectorClassification: null,
      industryClassification: null,
    },
  };
}

/**
 * MSFT, levered past the 10% threshold and NOTHING else changed — Gate 0
 * still passes. §6.5's FAIL, V1's case.
 */
function msftLevered(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    leverage: { ...MSFT_FIXTURE.leverage, totalDebt: new Decimal(1200) },
  };
}

describe("Fix 1 — a suppressing state removes the fair-value range", () => {
  it("Gate 0's ASSET-BASED return leaves no fair-value range (V7 — a bank)", () => {
    // V7: "all valuation outputs suppressed". §10.3: "there is no fair-value
    // range. The state is the output."
    const result = assembleAnalysisResult(msftAsAFinancial());

    expect(result.gates.gate0.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
    expect(result.fairValueRange.kind).toBe("suppressed");
    if (result.fairValueRange.kind !== "suppressed") return;
    expect(result.fairValueRange.state).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("the suppressed range carries a cause, never a bare state (§9.5)", () => {
    // §9.5 forbids a suppressed output displayed "as blank, as zero, or as
    // 'n/a' without the reason", and design §6 makes the cause line mandatory.
    const result = assembleAnalysisResult(msftAsAFinancial());

    if (result.fairValueRange.kind !== "suppressed") throw new Error("expected suppression");
    expect(result.fairValueRange.cause.length).toBeGreaterThan(0);
  });

  it("names which Gate 0 test fired in the cause (design §6's cause-line table)", () => {
    // Design §6: UNSUPPORTED PROFILE's cause line is "which Gate 0 test fired".
    const result = assembleAnalysisResult(msftAsAFinancial());

    if (result.fairValueRange.kind !== "suppressed") throw new Error("expected suppression");
    expect(result.fairValueRange.cause).toMatch(/sector/i);
  });

  it("names the net debt ratio in the cause where leverage failed (design §6)", () => {
    // Design §6: LEVERAGE UNSUPPORTED IN v1's cause line is "net debt ratio
    // 34.2% — or `inputs missing` where fail-closed".
    const result = assembleAnalysisResult(msftLevered());

    if (result.fairValueRange.kind !== "suppressed") throw new Error("expected suppression");
    expect(result.fairValueRange.cause).toMatch(/net debt ratio/i);
  });

  it("Gate 0's fail-closed return leaves no fair-value range (§6.1 CLASSIFICATION UNAVAILABLE)", () => {
    const result = assembleAnalysisResult(msftUnclassifiable());

    expect(result.gates.gate0.result).toBe("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
    expect(result.fairValueRange.kind).toBe("suppressed");
  });

  it("LEVERAGE UNSUPPORTED IN v1 removes the range ON ITS OWN, with Gate 0 passing (V1)", () => {
    // The second of the dispatch's required negative tests. V1 is a run where
    // leverage is the ONLY failure, and it lists the fair-value range among
    // what that state suppresses — so this must not depend on UNSUPPORTED
    // PROFILE being active alongside it.
    const result = assembleAnalysisResult(msftLevered());

    expect(result.gates.gate0.result).toBe("PASS");
    expect(result.gates.leverage.result).toBe("LEVERAGE UNSUPPORTED IN v1");
    expect(result.fairValueRange.kind).toBe("suppressed");
    if (result.fairValueRange.kind !== "suppressed") return;
    expect(result.fairValueRange.state).toBe("LEVERAGE UNSUPPORTED IN v1");
  });

  it("records the suppression in states.suppressing bound to the range (§10.0.1)", () => {
    // §10.0.1: every active suppressing state is "bound to the output it
    // applies to". A range that vanished with nothing in `states` saying why
    // would be the same defect one layer down.
    const result = assembleAnalysisResult(msftLevered());

    const boundToRange = result.states.suppressing.filter((s) =>
      s.appliesTo.includes("fair-value range")
    );
    expect(boundToRange.length).toBeGreaterThan(0);
    expect(boundToRange[0].state).toBe("LEVERAGE UNSUPPORTED IN v1");
  });
});

describe("Fix 1 — states that suppress something else leave the range standing", () => {
  it("MSFT renders its range with four of nine reverse-DCF cells suppressed (V4)", () => {
    // mock-report-msft.html, section H: "Reverse-DCF cells returning a state:
    // 4 of 9" printed BESIDE the rendered range. Over-suppression would be as
    // wrong as the defect being fixed.
    const result = assembleAnalysisResult(MSFT_FIXTURE);

    const suppressedCells = result.priceImplied.reverseDcfGrid.filter(
      (c) => c.fiveYearGrowth.suppressed
    ).length;
    expect(suppressedCells).toBe(4);
    expect(result.fairValueRange.kind).toBe("range");
  });

  it("OKLO renders its distribution summary with every reverse-DCF cell suppressed (V6)", () => {
    // mock-report-oklo.html renders section H in full as the distribution
    // summary. Its nine cells are INCOMPLETE because a pre-revenue company
    // has no reverse DCF in its method set at all (§6.3).
    const result = assembleAnalysisResult(OKLO_FIXTURE);

    const suppressedCells = result.priceImplied.reverseDcfGrid.filter(
      (c) => c.fiveYearGrowth.suppressed
    ).length;
    expect(suppressedCells).toBe(9);
    expect(result.fairValueRange.kind).toBe("pre-revenue-distribution");
  });

  it("OKLO renders its distribution summary with HISTORY INSUFFICIENT active (V2, V6)", () => {
    // §6.2: "Gate 1 never refuses." V2 confirms exactly one suppression, the
    // own-history percentile.
    const result = assembleAnalysisResult(OKLO_FIXTURE);

    expect(result.gates.gate1.state).toBe("HISTORY INSUFFICIENT");
    expect(result.states.suppressing.some((s) => s.state === "HISTORY INSUFFICIENT")).toBe(true);
    expect(result.fairValueRange.kind).not.toBe("suppressed");
  });

  it("MSFT renders its range with PRECONDITION FAILED active (§9.3 — FCF yield + growth)", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);

    expect(result.states.suppressing.some((s) => s.state === "PRECONDITION FAILED")).toBe(true);
    expect(result.fairValueRange.kind).toBe("range");
  });
});
