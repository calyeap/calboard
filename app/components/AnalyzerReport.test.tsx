// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import Decimal from "decimal.js";
import { AnalyzerReport } from "./AnalyzerReport";
import { assembleAnalysisResult } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { OKLO_FIXTURE } from "@/lib/analyzer/fixtures/oklo";

afterEach(cleanup);

// Milestone 6 — component-level rendering checks. Every assertion below
// reads a value already proven correct by lib/analyzer/assemble.test.ts;
// this file checks that the RENDERER faithfully surfaces those values and
// states (§10.0.2 rule 3: no figure in the report that is not in the
// result), not that the calculations are right (that's Milestone 5's job).

describe("AnalyzerReport — MSFT", () => {
  const result = assembleAnalysisResult(MSFT_FIXTURE);

  it("renders the company header, price and confirmed profile", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByRole("heading", { name: "Microsoft Corporation" })).not.toBeNull();
    // Appears at least in the price row and again in the closing "at a
    // glance" current-price figure — both are legitimate, not a defect.
    expect(screen.getAllByText("$510.12").length).toBeGreaterThan(0);
    // Defect C3 — the raw enum must never render; the human label from
    // both mocks' own profileline does.
    expect(screen.getAllByText(/mature, profitable, stable FCF/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/MATURE_PROFITABLE_STABLE_FCF/)).toBeNull();
  });

  it("shows DEGENERATE reverse-DCF cells (Section E) and Trigger A's qualifying flag in Section A's manifest", () => {
    render(<AnalyzerReport result={result} />);
    // Each of the 4 degenerate cells' state name is echoed in Quick Read's
    // active-states list, Section A's manifest and Section E's own grid —
    // duplication across the report is expected, not a defect.
    expect(screen.getAllByText("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("MARGIN AT HISTORICAL HIGH").length).toBeGreaterThan(0);
  });

  it("shows the M5 implied-return-on-new-capital diagnostic at 20.9%, present in Section D (not silently discarded)", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/Implied return on new capital/)).not.toBeNull();
    // Section H's restored right column (defect B2) legitimately echoes
    // this same RONIC figure — duplication across the report is expected,
    // not a defect (same principle as the MSFT DEGENERATE test above).
    expect(screen.getAllByText("20.9%").length).toBeGreaterThan(0);
  });

  it("shows PRECONDITION FAILED for FCF yield + growth, matching the mock", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getAllByText("PRECONDITION FAILED").length).toBeGreaterThan(0);
  });

  it("never renders Sections I/I2 as populated — no interpretation or challenger call exists yet (Milestone 8)", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/interpretation call has not run/)).not.toBeNull();
    expect(screen.getByText(/challenger call has not completed/)).not.toBeNull();
  });

  it("does not render any pre-revenue-only D subsection for the mature-profitable profile", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.queryByText("D — Implied probability of success")).toBeNull();
    expect(screen.queryByText("D — Unit economics and the scale solve")).toBeNull();
    expect(screen.queryByText("D — Funding stack")).toBeNull();
  });

  it("report order is exactly A, B, C, D, E, F, G, H, I, I2, J, at-a-glance — J immediately followed by at-a-glance, no section between them", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    const ids = Array.from(container.querySelectorAll("main > section")).map((el) => el.id);
    expect(ids).toEqual(["quickread", "A", "B", "C", "D", "E", "F", "G", "H", "I", "I2", "J", "atglance"]);
  });

  it("Section J shows plain-English labels with units, never a raw PolicyConstants key (defect 4)", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/Terminal ROIC = r \+ 3 percentage points — PROVISIONAL/)).not.toBeNull();
    expect(screen.getByText(/Gate 1 thresholds — <5 \/ 5-9 filed years — PROVISIONAL/)).not.toBeNull();
    expect(screen.queryByText(/terminalRoicPremium|gate1HistoryInsufficientYears/)).toBeNull();
  });

  it("Section J omits pre-revenue-only thresholds for the mature profile (defect 6 curation, the other direction)", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#J") as HTMLElement;
    expect(section.textContent).not.toMatch(/Construction lead fixed/);
  });
});

describe("AnalyzerReport — OKLO", () => {
  const result = assembleAnalysisResult(OKLO_FIXTURE);

  it("renders HISTORY INSUFFICIENT and the pre-revenue profile", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getAllByText("HISTORY INSUFFICIENT").length).toBeGreaterThan(0);
    // Defect C3 — the raw enum must never render; the human label from
    // both mocks' own profileline does. Appears in both Quick Read's
    // profile line and Section A's profileline.
    expect(screen.getAllByText(/pre-revenue \/ unprofitable/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/PRE_REVENUE_UNPROFITABLE/)).toBeNull();
  });

  it("renders the pre-revenue-distribution fair-value shape (cash floor $3.10), never bear/bull bounds", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText("Distribution summary")).not.toBeNull();
    expect(screen.getAllByText("$3.10").length).toBeGreaterThan(0);
    expect(screen.queryByText("Fair-value range")).toBeNull();
  });

  it("shows 'success as commonly described' as the full $31.00-$48.00 range (both qualifying definitions), never a single arbitrarily-chosen value", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getAllByText("$31.00 - $48.00").length).toBeGreaterThan(0);
  });

  it("renders all four success definitions with definitions 1-2 correctly stating worth-less-than-failure, 3-4 with real probabilities", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    // Scoped to Section D's own table — Quick Read (restored, defect 1)
    // legitimately echoes this state inline too, so a document-wide count
    // is no longer exactly 2; duplication across the report is expected,
    // not a defect (same principle the MSFT DEGENERATE test above uses).
    const sectionD = container.querySelector("section#D") as HTMLElement;
    expect(within(sectionD).getAllByText("THIS SUCCESS IS WORTH LESS THAN FAILURE")).toHaveLength(2);
    // Scoped to each definition's own table row — "25%" alone also
    // legitimately appears elsewhere (Section G's price-location figure,
    // and now Section H's restored right column also names each
    // probability-bearing definition, defect B2).
    const def3Row = within(sectionD).getByText(/Definition 3/).closest("tr");
    const def4Row = within(sectionD).getByText(/Definition 4/).closest("tr");
    expect(def3Row?.textContent).toContain("40%");
    expect(def4Row?.textContent).toContain("25%");
  });

  it("renders the M16 pre-revenue material as Section D subsections, not a new top-level section", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText("D — Implied probability of success")).not.toBeNull();
    expect(screen.getByText("D — Unit economics and the scale solve")).not.toBeNull();
    expect(screen.getByText("D — Funding stack")).not.toBeNull();
    expect(screen.getByText(/Unit-economics breakeven/)).not.toBeNull();
  });

  it("report order is exactly A, B, C, D, E, F, G, H, I, I2, J, at-a-glance — J immediately followed by at-a-glance, no extra section inserted for the pre-revenue material", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    const ids = Array.from(container.querySelectorAll("main > section")).map((el) => el.id);
    expect(ids).toEqual(["quickread", "A", "B", "C", "D", "E", "F", "G", "H", "I", "I2", "J", "atglance"]);
  });

  it("both funding-stack ramps render with their four lines", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/Back-loaded/)).not.toBeNull();
    expect(screen.getByText("Steady")).not.toBeNull();
    expect(screen.getAllByText("Project debt").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Customer prepayments").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Retained OCF").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("New equity").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the pre-revenue success-case leverage exception in Section C, alongside the company-level PASS", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/company today/)).not.toBeNull();
    expect(screen.getByText(/success-case cash flow is a residual after debt/)).not.toBeNull();
  });

  it("Section J curates a small, relevant register with plain-English labels and an impact column — never a raw PolicyConstants key, never all nine thresholds regardless of relevance", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#J") as HTMLElement;
    expect(section.querySelector("dl.jreg")).toBeNull();
    expect(section.textContent).not.toMatch(/gate0InterestIncomeOverRevenueThreshold|gate1HistoryInsufficientYears|terminalRoicPremium|runRateSequentialGrowthTrigger/);
    // Pre-revenue: construction lead is relevant, terminal-ROIC/gate-0/
    // run-rate thresholds (reverse-DCF-only) are not.
    expect(screen.getByText(/Construction lead fixed at 2 years — PROVISIONAL/)).not.toBeNull();
    expect(section.textContent).not.toMatch(/Terminal ROIC = r \+/);
    // Row 5 — restored (defect 5): named unmodelled risks, absent before.
    expect(screen.getByText("Named unmodelled risks")).not.toBeNull();
    expect(screen.getByText(/debt availability/)).not.toBeNull();
    // Curation + impact column (defect 6): every row pairs a plain-English
    // label with an impact figure, not a flat list with no column at all.
    const rows = section.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of Array.from(rows)) {
      expect(row.querySelector("td:nth-child(2) .v")?.textContent).not.toBe("");
    }
  });

  // CB-H3-IMPLEMENT-01. This fixture's dates are aligned (its own
  // FactRecord already documents "adjusted for burn to today"), so both
  // the acquired basis and each success definition's own valuation date
  // render alongside the figures they qualify.
  it("shows the acquired cash-per-share and burn dates, and each success definition's V_success/V_fail dates", () => {
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionD = container.querySelector("section#D") as HTMLElement;
    expect(within(sectionD).getAllByText(/as of/).length).toBeGreaterThan(0);
    for (const row of result.preRevenue!.successDefinitions) {
      expect(sectionD.textContent).toContain(row.vFailAsOfDate!);
      expect(sectionD.textContent).toContain(row.vSuccessAsOfDate!);
    }
  });
});

// CB-H3-IMPLEMENT-01 — CalFinance Methodology v2's acquired-run cash basis
// and success-weight date-consistency ruling. A synthetic variant of the
// OKLO fixture with the acquired basis missing, exercising the renderer's
// suppression path rather than the M5 fixture's always-established one.
describe("AnalyzerReport — OKLO, acquired cash basis not established (H3)", () => {
  const missingBasisResult = assembleAnalysisResult({
    ...OKLO_FIXTURE,
    preRevenue: {
      ...OKLO_FIXTURE.preRevenue!,
      cashPerShare: null,
      cashPerShareAsOfDate: null,
      cashPerShareCause: "missing REQUIRED input: acquired cash balance, shares outstanding used by the acquired run",
      quarterlyBurn: null,
      quarterlyBurnAsOfDate: null,
      quarterlyBurnCause: "missing REQUIRED input: acquired quarterly operating cash flow (burn)",
      runway: null,
      runwayCause: "missing REQUIRED input: acquired cash balance, acquired quarterly burn",
    },
  });

  it("renders INCOMPLETE — never $NaN or a bare zero — for cash per share, quarterly burn and runway", () => {
    const { container } = render(<AnalyzerReport result={missingBasisResult} />);
    const sectionD = container.querySelector("section#D") as HTMLElement;
    expect(within(sectionD).getAllByText("INCOMPLETE").length).toBeGreaterThan(0);
    expect(sectionD.textContent).not.toMatch(/NaN/);
    const cashPerShareRow = within(sectionD).getByText("Cash per share").closest("tr");
    const burnRunwayRow = within(sectionD).getByText("Quarterly burn / runway").closest("tr");
    expect(cashPerShareRow?.textContent).not.toMatch(/\$/);
    expect(burnRunwayRow?.textContent).not.toMatch(/\$/);
    expect(cashPerShareRow?.textContent).toContain("INCOMPLETE");
    expect(burnRunwayRow?.textContent).toContain("INCOMPLETE");
  });

  it("renders NOT COMPUTED / SUPPRESSED for every success definition's weight, with its cause, never a percentage", () => {
    const { container } = render(<AnalyzerReport result={missingBasisResult} />);
    const sectionD = container.querySelector("section#D") as HTMLElement;
    expect(missingBasisResult.preRevenue!.successDefinitions.length).toBeGreaterThan(0);
    expect(within(sectionD).getAllByText("NOT COMPUTED / SUPPRESSED").length).toBe(
      missingBasisResult.preRevenue!.successDefinitions.length
    );
    for (const row of missingBasisResult.preRevenue!.successDefinitions) {
      if (row.state.kind === "NOT COMPUTED / SUPPRESSED") {
        expect(sectionD.textContent).toContain(row.state.cause);
      }
    }
    // V_success itself still renders — the endpoint is not withheld, only
    // the weight is.
    expect(within(sectionD).queryAllByText(/^\d+%$/).length).toBe(0);
  });

  it("the closing distribution summary is replaced by the suppressed state, never a NaN-valued cash floor", () => {
    render(<AnalyzerReport result={missingBasisResult} />);
    expect(screen.queryByText("Distribution summary")).toBeNull();
    expect(screen.getAllByText("INCOMPLETE").length).toBeGreaterThan(0);
  });
});

// Second-pass IA audit (2026-09-05) — B2, B3, B6, B7.
describe("AnalyzerReport — Section H two-column frame (defect B2)", () => {
  it("MSFT: renders both columns — driving inputs and the weighted marker moved into the left column, the right column restated from Section E, never shown alone", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionH = container.querySelector("section#H") as HTMLElement;
    expect(within(sectionH).getByText(/Driven by:/)).not.toBeNull();
    expect(within(sectionH).getByText("Inference")).not.toBeNull();
    expect(within(sectionH).getByText("Weighted")).not.toBeNull();
    expect(within(sectionH).getByText("What the price assumes")).not.toBeNull();
    expect(within(sectionH).getByText(/Restated from Section E/)).not.toBeNull();
    expect(within(sectionH).getByText(/PVGO share of EV/)).not.toBeNull();
    expect(within(sectionH).getByText(/Reverse-DCF cells returning a state/)).not.toBeNull();
    // The header tag no longer sits above a range shown alone.
    expect(within(sectionH).getByText("Never shown alone")).not.toBeNull();
  });

  it("OKLO: renders the pre-revenue distribution summary alongside a restated right column, not the old bare Cash floor box", () => {
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionH = container.querySelector("section#H") as HTMLElement;
    expect(within(sectionH).getByText("What the price assumes")).not.toBeNull();
    expect(within(sectionH).queryByText("Cash floor")).toBeNull();
    expect(within(sectionH).getByText(/Success definitions returning a state/)).not.toBeNull();
    expect(within(sectionH).getByText(/Dilution required/)).not.toBeNull();
    expect(within(sectionH).getByText("Inference")).not.toBeNull();
  });
});

describe("AnalyzerReport — camelCase humanized in state causes (defect B3)", () => {
  it("OKLO: Section D and E cause text is plain English, never a raw camelCase field name", () => {
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/fiveYearDeltaNopat|fiveYearDeltaInvestedCapital|financeLeaseRouAdditions|depreciationAndAmortization|deltaNwc|baseYearRevenue|targetEnterpriseValue|currentMargin|medianMarginNopat/);
    expect(text).toMatch(/five year delta NOPAT/);
    expect(text).toMatch(/finance lease ROU additions/);
    expect(text).toMatch(/depreciation and amortization/);
    expect(text).toMatch(/delta NWC/);
    expect(text).toMatch(/base year revenue/);
    expect(text).toMatch(/target enterprise value/);
  });
});

describe("AnalyzerReport — Section J detail text has no leaked spec/appendix citations", () => {
  it("MSFT: no '§' or 'Appendix' citation renders inside Section J, same defect class as B3", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#J") as HTMLElement;
    expect(section.textContent).not.toMatch(/§|Appendix/);
  });
});

describe("AnalyzerReport — Section J Trigger A row restored (defect B6)", () => {
  it("MSFT: shows the Trigger A thresholds row, derived from real PolicyConstants fields, when trigger A or B fired", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    expect(result.gates.triggerA.fired || result.gates.triggerB.fired).toBe(true);
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/Trigger A thresholds — 2 points of window maximum, 15-point window range/)).not.toBeNull();
  });

  it("OKLO's five-row register is unchanged — no Trigger A row for the pre-revenue profile", () => {
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#J") as HTMLElement;
    expect(section.textContent).not.toMatch(/Trigger A thresholds/);
    expect(section.querySelectorAll("tbody tr")).toHaveLength(5);
  });
});

describe("AnalyzerReport — §17.12 disclosure component restored in the report body (defect B7)", () => {
  it("renders working <details> disclosures in Sections A and E, verbatim from the frozen mock, entire row clickable", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const disclosures = container.querySelectorAll("details.disclose");
    expect(disclosures.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("What is a discount rate?")).not.toBeNull();
    expect(screen.getByText("What is a reverse DCF, and why nine cells?")).not.toBeNull();
    expect(screen.getByText("See calculation — PVGO")).not.toBeNull();
    expect(screen.getByText("What is PVGO?")).not.toBeNull();
    for (const d of Array.from(disclosures)) {
      expect(d.querySelector("summary")).not.toBeNull();
      expect(d.querySelector(".body")).not.toBeNull();
    }
  });

  it("shows the Section D flag-distinction disclosure only when trigger A or B actually fired", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText("Why one flag fired and the other did not")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CB-AUDIT-FIX-01B — sites where a figure was printed for something never
// computed, or a false reason was printed for its absence.
// ---------------------------------------------------------------------------

function rowOf(section: HTMLElement, label: string | RegExp): HTMLElement {
  return within(section).getByText(label).closest("tr") as HTMLElement;
}

// The value cell alone — a row's label can itself carry digits ("±1% rate
// sensitivity").
function valueOf(section: HTMLElement, label: string | RegExp): HTMLElement {
  return rowOf(section, label).querySelectorAll("td")[1] as HTMLElement;
}

describe("AnalyzerReport — G, the rate at which the base case equals the price", () => {
  it("MSFT (no revaluation supplied): renders INCOMPLETE with the missing input named — never 'no solution in range', never a rate", () => {
    const { container } = render(<AnalyzerReport result={assembleAnalysisResult(MSFT_FIXTURE)} />);
    const row = rowOf(container.querySelector("section#G") as HTMLElement, "Discount rate at which the base case equals the price");
    expect(within(row).getByText("INCOMPLETE")).not.toBeNull();
    expect(row.textContent).toMatch(/revaluation of the base case/);
    expect(row.textContent).not.toMatch(/no solution in range/i);
    expect(row.textContent).not.toMatch(/\d+\.\d%/);
  });

  it("OKLO fixture (a solver ran, no root in the bracket): renders NO SOLUTION IN RANGE — distinguishable from not computed", () => {
    const { container } = render(<AnalyzerReport result={assembleAnalysisResult(OKLO_FIXTURE)} />);
    const row = rowOf(container.querySelector("section#G") as HTMLElement, "Discount rate at which the base case equals the price");
    expect(within(row).getByText("NO SOLUTION IN RANGE")).not.toBeNull();
    expect(within(row).queryByText("INCOMPLETE")).toBeNull();
  });
});

describe("AnalyzerReport — E, ±1% rate sensitivity when it is not modelled (H4 guard)", () => {
  // Replaces the guard that asserted the fallback's value was "0" — which
  // pinned the defect it was meant to guard. What matters is what the reader
  // sees: no figure at all, and the state in its place.
  it("renders no figure — only the state — when cells are supplied but enterprise value is INCOMPLETE", () => {
    const result = assembleAnalysisResult({
      ...MSFT_FIXTURE,
      enterpriseValue: { ...MSFT_FIXTURE.enterpriseValue, nonOperatingEquityInvestmentsAtBook: null },
      rateSensitivityCells: { plusOnePoint: new Decimal("0.05"), minusOnePoint: new Decimal("-0.05") },
    });
    const { container } = render(<AnalyzerReport result={result} />);
    const cell = valueOf(container.querySelector("section#E") as HTMLElement, "±1% rate sensitivity");
    expect(within(cell).getByText("INCOMPLETE")).not.toBeNull();
    expect(cell.textContent).toMatch(/enterprise value/);
    expect(cell.textContent).not.toMatch(/\d/);
  });

  it("renders no figure — only the state — on every fixture, since none supplies rate-sensitivity cells", () => {
    for (const fixture of [MSFT_FIXTURE, OKLO_FIXTURE]) {
      const { container } = render(<AnalyzerReport result={assembleAnalysisResult(fixture)} />);
      const cell = valueOf(container.querySelector("section#E") as HTMLElement, "±1% rate sensitivity");
      expect(within(cell).getByText("INCOMPLETE")).not.toBeNull();
      expect(cell.textContent).not.toMatch(/\d/);
      expect(cell.textContent).not.toMatch(/NaN/);
      cleanup();
    }
  });
});

describe("AnalyzerReport — F, scenario drivers nobody authored", () => {
  it("renders the state in place of growth, margin and reinvestment — never 0.0% — and keeps the written anchor", () => {
    const unauthored = { revenueGrowthOrPath: null, operatingMargin: null, reinvestmentCapitalIntensity: null };
    const result = assembleAnalysisResult({
      ...OKLO_FIXTURE,
      scenarios: {
        bear: { ...OKLO_FIXTURE.scenarios.bear, ...unauthored },
        base: { ...OKLO_FIXTURE.scenarios.base, ...unauthored },
        bull: { ...OKLO_FIXTURE.scenarios.bull, ...unauthored },
      },
    });
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionF = container.querySelector("section#F") as HTMLElement;
    for (const label of ["Bear", "Base", "Bull"]) {
      const row = rowOf(sectionF, label);
      expect(within(row).getByText("INCOMPLETE")).not.toBeNull();
      expect(row.textContent).not.toMatch(/%/);
      expect(row.textContent).not.toMatch(/NaN/);
    }
    expect(within(sectionF).getByText("8 GW back-loaded reference case.")).not.toBeNull();
  });

  it("still renders authored drivers as figures", () => {
    const { container } = render(<AnalyzerReport result={assembleAnalysisResult(MSFT_FIXTURE)} />);
    const sectionF = container.querySelector("section#F") as HTMLElement;
    expect(within(sectionF).queryByText("INCOMPLETE")).toBeNull();
    expect(sectionF.textContent).toMatch(/\d+\.\d%/);
  });
});

// Third-pass IA audit (2026-09-05) — C2, C3, C5.
describe("AnalyzerReport — scenario labels properly cased (defect C2)", () => {
  it("Section F shows Bear / Base / Bull, never the raw lowercase key", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionF = container.querySelector("section#F") as HTMLElement;
    expect(within(sectionF).getByText("Bear")).not.toBeNull();
    expect(within(sectionF).getByText("Base")).not.toBeNull();
    expect(within(sectionF).getByText("Bull")).not.toBeNull();
    expect(within(sectionF).queryByText("bear")).toBeNull();
    expect(within(sectionF).queryByText("base")).toBeNull();
    expect(within(sectionF).queryByText("bull")).toBeNull();
  });
});

describe("AnalyzerReport — profile renders as a human label, not the raw enum (defect C3)", () => {
  it("MSFT: Section A's profileline reads the mock's own wording", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionA = container.querySelector("section#A") as HTMLElement;
    expect(within(sectionA).getByText(/Profile: mature, profitable, stable FCF/)).not.toBeNull();
    expect(sectionA.textContent).not.toMatch(/MATURE_PROFITABLE_STABLE_FCF/);
  });

  it("OKLO: Section A's profileline reads the mock's own wording", () => {
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionA = container.querySelector("section#A") as HTMLElement;
    expect(within(sectionA).getByText(/Profile: pre-revenue \/ unprofitable/)).not.toBeNull();
    expect(sectionA.textContent).not.toMatch(/PRE_REVENUE_UNPROFITABLE/);
  });
});

describe("AnalyzerReport — Section D header qualifier restored (defect C5)", () => {
  it("shows 'extract shown' beside the M1-M14 range, matching the MSFT mock", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    render(<AnalyzerReport result={result} />);
    expect(screen.getByText(/M1.M14 · extract shown/)).not.toBeNull();
  });
});

// Fourth-pass IA audit (2026-09-05) — D1.
describe("AnalyzerReport — Section B always shows the full three-token provenance stamp (defect D1, R4)", () => {
  it("every fact row carries source class, extraction type and verification state, including fully-defaulted facts", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionB = container.querySelector("section#B") as HTMLElement;
    const rows = sectionB.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of Array.from(rows)) {
      const prov = row.querySelector(".prov");
      expect(prov).not.toBeNull();
      const text = prov!.textContent ?? "";
      expect(text).toMatch(/Primary|Secondary/);
      expect(text).toMatch(/Deterministic\/structured|AI-extracted/);
      // §3.2's four values, as the report labels them.
      expect(text).toMatch(/Confirmed|Not confirmed|Spot-check pending|Spot-check not required/);
    }
    // "Finance lease liabilities" is PRIMARY/DETERMINISTIC in the fixture and
    // carries the acquisition-time verification state — R4 requires the stamp
    // anyway, unlike derived cells elsewhere, which stay omitted-when-default.
    const defaultRow = within(sectionB).getByText("Finance lease liabilities").closest("tr");
    expect(defaultRow?.querySelector(".prov")?.textContent).toBe("Primary·Deterministic/structured·Spot-check pending");
  });

  it("AI-extracted keeps its distinct .ai styling even when shown alongside two default tokens; a non-default SECONDARY token is plain text, matching both mocks", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionB = container.querySelector("section#B") as HTMLElement;
    const aiRow = within(sectionB).getByText("Finance-lease ROU assets obtained").closest("tr");
    expect(aiRow?.querySelector(".prov .ai")?.textContent).toBe("AI-extracted");
    const secondaryRow = within(sectionB).getByText("Current operating margin").closest("tr");
    expect(secondaryRow?.querySelector(".prov")?.textContent).toBe("Secondary·Deterministic/structured·Spot-check pending");
    expect(secondaryRow?.querySelector(".prov .ai")).toBeNull();
  });

  it("derived cells elsewhere (Section D/E figures) are unaffected — default provenance still omitted there", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const sectionD = container.querySelector("section#D") as HTMLElement;
    // Implied return on new capital is AI-extracted in the fixture — its
    // marker should still show (non-default), but nothing in Section D
    // should render "Confirmed" or "Primary" as bare filler text the way
    // Section B now always does. ("Confirmed" is §3.2's name for what this
    // field used to call VERIFIED — the clean, nothing-qualifying value.)
    expect(within(sectionD).getByText("AI-extracted")).not.toBeNull();
    expect(sectionD.textContent).not.toMatch(/\bPrimary\b/);
    expect(sectionD.textContent).not.toMatch(/\bConfirmed\b/);
  });
});

// Fifth-pass IA audit (2026-09-05) — E1.
describe("AnalyzerReport — closing recap 'Investment case — at a glance' is unchanged by the E1 strip reuse", () => {
  it("MSFT: still renders the same four-figure strip, with no new price-location line added there", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#atglance") as HTMLElement;
    expect(within(section).getByText("Bear")).not.toBeNull();
    expect(within(section).getByText("$265")).not.toBeNull();
    expect(within(section).getByText("Current price")).not.toBeNull();
    expect(section.querySelector(".striploc")).toBeNull();
  });

  it("OKLO: still renders the pre-revenue distribution strip, with no new price-location line added there", () => {
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    const { container } = render(<AnalyzerReport result={result} />);
    const section = container.querySelector("section#atglance") as HTMLElement;
    expect(within(section).getByText("Failure — cash floor")).not.toBeNull();
    expect(within(section).getByText("$3.10")).not.toBeNull();
    expect(section.querySelector(".striploc")).toBeNull();
  });
});
