// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
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
    expect(screen.getAllByText(/MATURE_PROFITABLE_STABLE_FCF/).length).toBeGreaterThan(0);
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
    expect(screen.getByText("20.9%")).not.toBeNull();
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
});

describe("AnalyzerReport — OKLO", () => {
  const result = assembleAnalysisResult(OKLO_FIXTURE);

  it("renders HISTORY INSUFFICIENT and the pre-revenue profile", () => {
    render(<AnalyzerReport result={result} />);
    expect(screen.getAllByText("HISTORY INSUFFICIENT").length).toBeGreaterThan(0);
    // Appears in both Quick Read's profile line and Section A's profileline.
    expect(screen.getAllByText(/PRE_REVENUE_UNPROFITABLE/).length).toBeGreaterThan(0);
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
    render(<AnalyzerReport result={result} />);
    expect(screen.getAllByText("THIS SUCCESS IS WORTH LESS THAN FAILURE")).toHaveLength(2);
    // Scoped to each definition's own table row — "25%" alone also
    // legitimately appears elsewhere (Section G's price-location figure).
    const def3Row = screen.getByText(/Definition 3/).closest("tr");
    const def4Row = screen.getByText(/Definition 4/).closest("tr");
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
});
