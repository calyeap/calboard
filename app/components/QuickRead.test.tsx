// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { QuickRead } from "./QuickRead";
import { assembleAnalysisResult } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { OKLO_FIXTURE } from "@/lib/analyzer/fixtures/oklo";

afterEach(cleanup);

// IA-audit restoration (2026-09-05) — Quick Read matches §17.16: eight
// items, always visible, no "Learn more" drawer. Every assertion below
// checks restatement of already-computed AnalysisResult fields — no new
// calculation is exercised or expected.

const ITEM_LABELS = [
  "Main finding",
  "Price vs scenarios",
  "What today's price requires",
  "What supports the case",
  "What worries Calboard",
  "Biggest uncertainty",
  "Strongest challenger point",
  "Data and model quality",
];

describe("QuickRead — structure", () => {
  it("renders as a single in-flow <section>, not an <aside> sidebar", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<QuickRead result={result} />);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("section#quickread")).not.toBeNull();
  });

  it("renders exactly the eight §17.16 items, capped at eight, no more and no fewer", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<QuickRead result={result} />);
    expect(container.querySelectorAll(".qitem")).toHaveLength(8);
    for (const label of ITEM_LABELS) {
      expect(screen.getByText(label)).not.toBeNull();
    }
  });

  it("never hides a state or flag behind a <details> disclosure — Quick Read is always visible", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<QuickRead result={result} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(/Learn more/)).toBeNull();
  });
});

describe("QuickRead — MSFT", () => {
  const result = assembleAnalysisResult(MSFT_FIXTURE);

  it("shows the human-readable profile label, never the raw enum", () => {
    render(<QuickRead result={result} />);
    expect(screen.getByText(/mature, profitable, stable free cash flow/)).not.toBeNull();
    expect(screen.queryByText(/MATURE_PROFITABLE_STABLE_FCF/)).toBeNull();
  });

  it("consolidates the several DEGENERATE reverse-DCF cells into ONE line, not one per row, while keeping the state name visible and never inventing a count", () => {
    render(<QuickRead result={result} />);
    const matches = screen.getAllByText(/DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE/);
    // At most one in the main-finding sentence, one in "what worries
    // Calboard", one in "data and model quality" — never one per
    // underlying cell (4, per Section E's own grid).
    expect(matches.length).toBeLessThan(4);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  it("main finding restates the price-implied growth figure already computed in Section E, not a new number", () => {
    render(<QuickRead result={result} />);
    expect(screen.getAllByText(/13\.7%/).length).toBeGreaterThan(0);
  });

  it("keeps MARGIN AT HISTORICAL HIGH visible inline, with its section reference, never behind a disclosure", () => {
    render(<QuickRead result={result} />);
    expect(screen.getAllByText(/MARGIN AT HISTORICAL HIGH/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Section D").length).toBeGreaterThan(0);
  });

  it("keeps PRECONDITION FAILED visible inline in Data and model quality", () => {
    render(<QuickRead result={result} />);
    expect(screen.getAllByText(/PRECONDITION FAILED/).length).toBeGreaterThan(0);
  });
});

describe("QuickRead — OKLO", () => {
  const result = assembleAnalysisResult(OKLO_FIXTURE);

  it("shows the human-readable pre-revenue profile label, never the raw enum", () => {
    render(<QuickRead result={result} />);
    expect(screen.getByText(/pre-revenue \/ unprofitable/)).not.toBeNull();
    expect(screen.queryByText(/PRE_REVENUE_UNPROFITABLE/)).toBeNull();
  });

  it("main finding states the worth-less-than-failure finding with the state name kept visible (state travels with the summary), without inventing a count", () => {
    render(<QuickRead result={result} />);
    expect(screen.getAllByText(/THIS SUCCESS IS WORTH LESS THAN FAILURE/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  it("restates the $31-$48 commonly-described range already computed in the Analysis Result, not a new figure", () => {
    render(<QuickRead result={result} />);
    expect(screen.getByText(/\$31\.00-\$48\.00/)).not.toBeNull();
  });

  it("keeps HISTORY INSUFFICIENT visible inline, never behind a disclosure", () => {
    render(<QuickRead result={result} />);
    expect(screen.getAllByText(/HISTORY INSUFFICIENT/).length).toBeGreaterThan(0);
  });

  it("does not introduce any BUY/SELL/target/score language", () => {
    const { container } = render(<QuickRead result={result} />);
    const text = container.textContent ?? "";
    expect(/\bbuy\b/i.test(text)).toBe(false);
    expect(/\bsell\b/i.test(text)).toBe(false);
    expect(/target price/i.test(text)).toBe(false);
  });
});
