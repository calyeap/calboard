// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
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
