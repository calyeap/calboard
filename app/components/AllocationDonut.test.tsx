// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { computeAllocation } from "@/lib/allocation";
import Decimal from "decimal.js";
import { AllocationDonut } from "./AllocationDonut";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";

afterEach(() => {
  cleanup();
});

describe("AllocationDonut", () => {
  it("renders a legend row per included holding with symbol, percentage and formatted USD market value, plus the priced total in the centre", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAPL", marketValueUsd: new Decimal("3000.00") },
        { symbol: "MSFT", marketValueUsd: new Decimal("1000.00") },
      ],
      new Decimal("4000.00")
    );
    const { container } = render(<AllocationDonut allocation={allocation} />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // header + 2 data rows
    const text = table.textContent ?? "";
    expect(text).toContain("AAPL");
    expect(text).toContain("75.00%");
    expect(text).toContain("US$3,000.00");
    expect(text).toContain("MSFT");
    expect(text).toContain("25.00%");
    expect(text).toContain("US$1,000.00");
    // centre total = the exact priced aggregate
    expect(container.querySelector("svg")?.textContent).toContain("US$4,000.00");
    expect(rows.length).toBe(3);
  });

  it("one included holding shows as 100%", () => {
    const allocation = computeAllocation(
      [{ symbol: "ONLY", marketValueUsd: new Decimal("500.00") }],
      new Decimal("500.00")
    );
    render(<AllocationDonut allocation={allocation} />);
    expect(screen.getByRole("table").textContent).toContain("100.00%");
  });

  it("excludes an unpriced holding from the legend and the segments", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAPL", marketValueUsd: new Decimal("400.00") },
        { symbol: "NOPX", marketValueUsd: null },
      ],
      new Decimal("400.00")
    );
    const { container } = render(<AllocationDonut allocation={allocation} />);

    expect(screen.getByRole("table").textContent).toContain("AAPL");
    expect(screen.getByRole("table").textContent).not.toContain("NOPX");
    // one drawn segment per included entry (plus the background track circle)
    const segmentCircles = container.querySelectorAll("svg circle[stroke-dasharray]");
    expect(segmentCircles.length).toBe(1);
  });

  it("no usable market value → a clear non-chart state, no donut, no legend", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAA", marketValueUsd: null },
        { symbol: "BBB", marketValueUsd: null },
      ],
      new Decimal("0")
    );
    const { container } = render(<AllocationDonut allocation={allocation} />);

    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText(/allocation isn't available yet/i)).toBeInTheDocument();
  });

  it("T31-6: the section carries the dashboard-section + allocation hooks, the donut/legend share an .allocation-layout wrapper, and the not-available branch keeps the heading + .dashboard-note", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAPL", marketValueUsd: new Decimal("3000.00") },
        { symbol: "MSFT", marketValueUsd: new Decimal("1000.00") },
      ],
      new Decimal("4000.00")
    );
    const { container, unmount } = render(<AllocationDonut allocation={allocation} />);

    const section = container.querySelector("section")!;
    expect(section).toHaveClass("dashboard-section");
    expect(section).toHaveClass("allocation");

    const layout = container.querySelector(".allocation-layout")!;
    expect(layout).not.toBeNull();
    expect(layout.querySelector("svg")).not.toBeNull();
    expect(within(layout as HTMLElement).getByRole("table")).toBeInTheDocument();

    unmount();

    // not-available branch
    const empty = computeAllocation(
      [
        { symbol: "AAA", marketValueUsd: null },
        { symbol: "BBB", marketValueUsd: null },
      ],
      new Decimal("0")
    );
    const { container: emptyContainer } = render(<AllocationDonut allocation={empty} />);
    const emptySection = emptyContainer.querySelector("section")!;
    expect(emptySection).toHaveClass("dashboard-section");
    expect(emptySection).toHaveClass("allocation");
    expect(screen.getByRole("heading", { name: /allocation/i })).toBeInTheDocument();
    const note = screen.getByText(/allocation isn't available yet/i);
    expect(note).toHaveClass("dashboard-note");
  });

  it("does not communicate allocation through colour alone: the SVG is hidden from assistive tech and colour swatches are decorative", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAPL", marketValueUsd: new Decimal("3000.00") },
        { symbol: "MSFT", marketValueUsd: new Decimal("1000.00") },
      ],
      new Decimal("4000.00")
    );
    const { container } = render(<AllocationDonut allocation={allocation} />);

    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    for (const sw of container.querySelectorAll("[data-swatch]")) {
      expect(sw.getAttribute("aria-hidden")).toBe("true");
    }
    // The section has a heading so the legend is discoverable.
    expect(screen.getByRole("heading", { name: /allocation/i })).toBeInTheDocument();
  });
});

describe("AllocationDonut — M1.5: view by asset class", () => {
  const byHolding = computeAllocation(
    [
      { symbol: "AAPL", marketValueUsd: new Decimal("3000.00") },
      { symbol: "VOO", marketValueUsd: new Decimal("1000.00") },
    ],
    new Decimal("4000.00")
  );
  const byAssetClass = computeAllocation(
    [
      { symbol: "Equity", marketValueUsd: new Decimal("3000.00") },
      { symbol: "ETF", marketValueUsd: new Decimal("1000.00") },
    ],
    new Decimal("4000.00")
  );

  it("without allocationByAssetClass, no view toggle renders — unchanged single-view behaviour", () => {
    render(<AllocationDonut allocation={byHolding} />);
    expect(screen.queryByRole("button", { name: /by asset class/i })).toBeNull();
  });

  it("with allocationByAssetClass, a view toggle renders, defaulting to By holding", () => {
    render(<AllocationDonut allocation={byHolding} allocationByAssetClass={byAssetClass} />);

    expect(screen.getByRole("button", { name: /by holding/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /by asset class/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("table").textContent).toContain("AAPL");
  });

  it("the toggle group carries the .toggle CSS hook so the segmented-control styling applies", () => {
    render(<AllocationDonut allocation={byHolding} allocationByAssetClass={byAssetClass} />);
    expect(screen.getByRole("group", { name: /allocation view/i })).toHaveClass("toggle");
  });

  it("clicking By asset class swaps the legend to the grouped data, without altering the calculation", () => {
    render(<AllocationDonut allocation={byHolding} allocationByAssetClass={byAssetClass} />);

    fireEvent.click(screen.getByRole("button", { name: /by asset class/i }));

    const table = screen.getByRole("table");
    expect(table.textContent).toContain("Equity");
    expect(table.textContent).toContain("75.00%");
    expect(table.textContent).toContain("ETF");
    expect(table.textContent).toContain("25.00%");
    expect(table.textContent).not.toContain("AAPL");
    expect(table.textContent).not.toContain("VOO");
  });

  it("clicking back to By holding restores the original view", () => {
    render(<AllocationDonut allocation={byHolding} allocationByAssetClass={byAssetClass} />);

    fireEvent.click(screen.getByRole("button", { name: /by asset class/i }));
    fireEvent.click(screen.getByRole("button", { name: /by holding/i }));

    expect(screen.getByRole("table").textContent).toContain("AAPL");
  });
});

describe("AllocationDonut — M1.5: privacy toggle", () => {
  function ToggleButton() {
    const { toggle } = usePrivacy();
    return (
      <button type="button" onClick={toggle}>
        toggle
      </button>
    );
  }

  it("hides the centre total and legend market values while keeping every percentage visible", () => {
    const allocation = computeAllocation(
      [
        { symbol: "AAPL", marketValueUsd: new Decimal("3000.00") },
        { symbol: "MSFT", marketValueUsd: new Decimal("1000.00") },
      ],
      new Decimal("4000.00")
    );
    const { container } = render(
      <PrivacyProvider>
        <ToggleButton />
        <AllocationDonut allocation={allocation} />
      </PrivacyProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    const table = screen.getByRole("table");
    expect(table.textContent).toContain("75.00%");
    expect(table.textContent).toContain("25.00%");
    expect(table.textContent).not.toContain("3000.00");
    expect(table.textContent).not.toContain("1000.00");
    expect(container.querySelector("svg")?.textContent).not.toContain("4000.00");
  });
});
