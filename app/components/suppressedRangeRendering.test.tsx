// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import Decimal from "decimal.js";
import { AnalyzerReport } from "./AnalyzerReport";
import { assembleAnalysisResult, type CompanyFixture } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// THE FIRST OF THE DISPATCH'S REQUIRED NEGATIVE TESTS, at the layer that
// actually shows the reader a number: a run with a suppressing state active
// renders NO fair-value range.
//
// The renderer's `fairValueRange.kind === "suppressed"` branch existed before
// this milestone and had no test at all — nothing asserted §10.3's "there is no
// fair-value range. The state is the output" anywhere in the rendering layer.
// It could not have failed, because the assembler never produced a suppressed
// range for it to render.
//
// Design §10.3 adds the requirement that section H "still renders, in the same
// two-column frame... never collapsed, never hidden, and never replaced with an
// empty state illustration."
// ---------------------------------------------------------------------------

/** MSFT levered past §6.5's threshold. Gate 0 still passes; V1's case. */
function leveredMsft(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    leverage: { ...MSFT_FIXTURE.leverage, totalDebt: new Decimal(1200) },
  };
}

/** MSFT reclassified into §6.1's asset-based row. V7's case. */
function bankMsft(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    gate0: { ...MSFT_FIXTURE.gate0, sectorClassification: "Financials" },
  };
}

function sectionH(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "H — Fair-value range" });
  const section = heading.closest("section");
  if (section === null) throw new Error("section H not found");
  return section;
}

describe("§10.3 — section H under a suppressing state", () => {
  it("renders the state instead of a range where leverage failed (V1)", () => {
    render(<AnalyzerReport result={assembleAnalysisResult(leveredMsft())} />);

    expect(within(sectionH()).getByText("LEVERAGE UNSUPPORTED IN v1")).not.toBeNull();
  });

  it("renders NO bear or bull bound in section H — the range is gone, not decorated", () => {
    // §9.5's prohibition, at the rendering layer: a suppressed output is never
    // "a number with a warning glyph". If the bounds still appeared beside the
    // state, the state would be a caption rather than the output.
    render(<AnalyzerReport result={assembleAnalysisResult(leveredMsft())} />);

    const h = sectionH();
    expect(within(h).queryByText("Bear")).toBeNull();
    expect(within(h).queryByText("Bull")).toBeNull();
    expect(within(h).queryByText(/Driven by:/)).toBeNull();
  });

  it("renders the state where Gate 0 refused the company (V7)", () => {
    render(<AnalyzerReport result={assembleAnalysisResult(bankMsft())} />);

    expect(
      within(sectionH()).getByText("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1")
    ).not.toBeNull();
  });

  it("carries the cause beside the state, never a bare name (§9.5, design §6)", () => {
    render(<AnalyzerReport result={assembleAnalysisResult(bankMsft())} />);

    const h = sectionH();
    // Design §6: UNSUPPORTED PROFILE's cause line is "which Gate 0 test fired".
    expect(within(h).getByText(/sector/i)).not.toBeNull();
  });

  it("still renders section H itself — never collapsed or hidden (design §10.3)", () => {
    render(<AnalyzerReport result={assembleAnalysisResult(leveredMsft())} />);

    expect(screen.getByRole("heading", { name: "H — Fair-value range" })).not.toBeNull();
  });

  it("keeps rendering the range where nothing suppresses it (V4 — MSFT as it stands)", () => {
    // The other direction, so a renderer that dropped section H's range
    // unconditionally could not pass this file.
    render(<AnalyzerReport result={assembleAnalysisResult(MSFT_FIXTURE)} />);

    const h = sectionH();
    expect(within(h).getByText("Bear")).not.toBeNull();
    expect(within(h).getByText("Bull")).not.toBeNull();
    expect(within(h).queryByText("LEVERAGE UNSUPPORTED IN v1")).toBeNull();
  });
});

describe("§9.6 — the report says how much of the analysis can be used", () => {
  it("reports UNUSABLE in the states manifest where the range was removed", () => {
    // §10.0.1 binds every active state to the output it applies to, so section
    // A's manifest must say the fair-value range is gone — not leave the reader
    // to notice an absence in section H.
    render(<AnalyzerReport result={assembleAnalysisResult(leveredMsft())} />);

    const result = assembleAnalysisResult(leveredMsft());
    expect(result.trust.status).toBe("UNUSABLE");
    expect(
      result.states.suppressing.some((s) => s.appliesTo.includes("fair-value range"))
    ).toBe(true);
    expect(screen.getAllByText("LEVERAGE UNSUPPORTED IN v1").length).toBeGreaterThan(1);
  });
});
