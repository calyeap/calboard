import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { gate0Heading, gate0TestRows, gate0ExplanationIfFailed } from "./gateBand";
import { evaluateGate0, type Gate0Input } from "./gates";

// ---------------------------------------------------------------------------
// Design §5.1's gate band — Gate 0's block, derived from Gate 0's output.
//
// THE DEFECT. The profile screen printed `<h3>Gate 0 — supported profile</h3>`
// as a literal, above the gate's INPUTS, and never called evaluateGate0 at all.
// It reads as a verdict and is not one. Meanwhile the report reads the actual
// output — two surfaces, two sources, one of them the input to the function the
// other displays.
//
// Same fix as the verification state that travelled beside the fact instead of
// deriving from the decision: one source, and the screen reads it.
//
// Design §5.1 requires the block to show "result, and the four classification
// tests with their evaluated values. Where it failed, the §6.1 explanation copy
// is shown."
// ---------------------------------------------------------------------------

function gate0(overrides: Partial<Gate0Input> = {}) {
  return evaluateGate0({
    sectorClassification: "Services-Prepackaged Software",
    industryClassification: "Services-Prepackaged Software",
    interestIncomeOverRevenue: new Decimal(0),
    hasInsurancePremiumOrReserveLineItems: false,
    override: null,
    ...overrides,
  } as Gate0Input);
}

describe("the Gate 0 heading states what the gate returned", () => {
  it("says supported profile where the gate passed", () => {
    expect(gate0Heading(gate0())).toMatch(/supported profile/i);
  });

  it("states the refusal where the asset-based row fired", () => {
    const result = gate0({ sectorClassification: "Financials" });

    expect(gate0Heading(result)).toContain(
      "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1"
    );
  });

  it("NEVER says supported profile where the gate failed — the exact defect", () => {
    // The literal heading said "supported profile" for a bank. This is the test
    // that fails if anyone writes it back.
    const bank = gate0({ sectorClassification: "Financials" });
    const unclassifiable = gate0({ sectorClassification: null, industryClassification: null });

    expect(gate0Heading(bank)).not.toMatch(/— supported profile/i);
    expect(gate0Heading(unclassifiable)).not.toMatch(/— supported profile/i);
  });

  it("states the fail-closed refusal by its own §6.1 name", () => {
    const result = gate0({ sectorClassification: null, industryClassification: null });

    expect(gate0Heading(result)).toContain("UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE");
  });
});

describe("the four classification tests, with their evaluated values (design §5.1)", () => {
  it("lists all four, not the two that used to be printed", () => {
    // The screen showed sector and industry only — and showed the same value for
    // both — while interest income and the insurance line items, the two inputs
    // that were hard-coded null, were not on screen anywhere.
    const rows = gate0TestRows(gate0());

    expect(rows).toHaveLength(4);
    const labels = rows.map((r) => r.label.toLowerCase()).join(" | ");
    expect(labels).toContain("sector");
    expect(labels).toContain("industry");
    expect(labels).toContain("interest income");
    expect(labels).toContain("insurance");
  });

  it("shows each test's evaluated value", () => {
    const rows = gate0TestRows(gate0({ interestIncomeOverRevenue: new Decimal("0.62") }));

    const interest = rows.find((r) => r.label.toLowerCase().includes("interest income"));
    expect(interest?.value).toContain("62.0");
  });

  it("says NOT ACQUIRED rather than printing an empty value for a missing input", () => {
    // §9.5's rule applied to an input: never blank, never a bare dash. A reader
    // must be able to tell "evaluated and did not fire" from "never acquired",
    // because those are the two different reasons Gate 0 can refuse.
    const rows = gate0TestRows(gate0({ interestIncomeOverRevenue: null }));

    const interest = rows.find((r) => r.label.toLowerCase().includes("interest income"));
    expect(interest?.value).toMatch(/not acquired/i);
  });

  it("marks which tests actually fired", () => {
    const rows = gate0TestRows(gate0({ sectorClassification: "Financials" }));

    const sector = rows.find((r) => r.label.toLowerCase().includes("sector"));
    expect(sector?.fired).toBe(true);
    const industry = rows.find((r) => r.label.toLowerCase().includes("industry"));
    expect(industry?.fired).toBe(false);
  });
});

describe("§6.1's explanation copy, shown only where the gate failed", () => {
  it("is absent where the gate passed", () => {
    expect(gate0ExplanationIfFailed(gate0())).toBeNull();
  });

  it("carries §6.1's own reasoning where the gate failed", () => {
    // §6.1: "carry this into the interface copy, because it is not obvious".
    const explanation = gate0ExplanationIfFailed(gate0({ sectorClassification: "Financials" }));

    expect(explanation).not.toBeNull();
    expect(explanation!).toMatch(/funding rather than capital structure/i);
  });

  it("names no remedy (§6.5's rule, and the same reasoning applies here)", () => {
    const explanation = gate0ExplanationIfFailed(gate0({ sectorClassification: "Financials" }));

    expect(explanation!).not.toMatch(/\bWACC\b|cost of equity|instead you (can|could)/i);
  });
});
