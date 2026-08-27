// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { computeAllocation } from "@/lib/allocation";
import Decimal from "decimal.js";
import { AllocationDonut } from "./AllocationDonut";

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
    // header + 2 data rows + footer
    const text = table.textContent ?? "";
    expect(text).toContain("AAPL");
    expect(text).toContain("75.00%");
    expect(text).toContain("US$3000.00");
    expect(text).toContain("MSFT");
    expect(text).toContain("25.00%");
    expect(text).toContain("US$1000.00");
    // centre total = the exact priced aggregate
    expect(container.querySelector("svg")?.textContent).toContain("US$4000.00");
    // legend also carries the priced total (understandable without the SVG)
    expect(text).toContain("US$4000.00");
    expect(rows.length).toBe(4);
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
