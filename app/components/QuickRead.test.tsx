// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { QuickRead } from "./QuickRead";
import { assembleAnalysisResult } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { OKLO_FIXTURE } from "@/lib/analyzer/fixtures/oklo";

afterEach(cleanup);

// Milestone 6 correction — Quick Read now matches the approved Calboard UX
// (Main finding -> Why it matters -> What it means here -> What to examine
// next -> Learn more), rendered in-flow at the top of the report rather
// than a permanent sidebar. Every assertion below checks restatement of
// already-computed AnalysisResult fields — no new calculation is exercised
// or expected.

describe("QuickRead — structure", () => {
  it("renders as a single in-flow <section>, not an <aside> sidebar", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    const { container } = render(<QuickRead result={result} />);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("section#quickread")).not.toBeNull();
  });

  it("follows the approved structure: main finding, why it matters, what it means here, what to examine next, then a disclosure for more", () => {
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    render(<QuickRead result={result} />);
    expect(screen.getByText("Why it matters")).not.toBeNull();
    expect(screen.getByText("What it means here")).not.toBeNull();
    expect(screen.getByText("What to examine next")).not.toBeNull();
    expect(screen.getByText(/Learn more/)).not.toBeNull();
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
    // Exactly one occurrence in Quick Read (the consolidated main-finding
    // sentence) plus at most one more in the "learn more" detail line -
    // never one per underlying cell (4, per Section E's own grid).
    expect(matches.length).toBeLessThan(4);
    expect(matches.length).toBeGreaterThan(0);
    // No "N of M" ratio anywhere — that count is not itself a field in the
    // Analysis Result (only each cell's own state is), so Quick Read must
    // not manufacture one.
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  it("main finding restates the price-implied growth figure already computed in Section E, not a new number", () => {
    render(<QuickRead result={result} />);
    expect(screen.getByText(/13\.7%/)).not.toBeNull();
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
    expect(screen.getByText(/THIS SUCCESS IS WORTH LESS THAN FAILURE/)).not.toBeNull();
    // No "N of M" ratio anywhere — that count is not itself a field in the
    // Analysis Result (only each definition's own state is), so Quick Read
    // must not manufacture one.
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  it("restates the $31-$48 commonly-described range already computed in the Analysis Result, not a new figure", () => {
    render(<QuickRead result={result} />);
    expect(screen.getByText(/\$31\.00-\$48\.00/)).not.toBeNull();
  });

  it("does not introduce any BUY/SELL/target/score language", () => {
    const { container } = render(<QuickRead result={result} />);
    const text = container.textContent ?? "";
    expect(/\bbuy\b/i.test(text)).toBe(false);
    expect(/\bsell\b/i.test(text)).toBe(false);
    expect(/target price/i.test(text)).toBe(false);
  });
});
