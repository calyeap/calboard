// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import Decimal from "decimal.js";
import type { PortfolioView, PositionView } from "@/lib/portfolio";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { getLastSnapshotConfirmation } from "@/lib/holdings";

vi.mock("@/lib/accounts", () => ({ listAccounts: vi.fn() }));
vi.mock("@/lib/portfolio", () => ({ getPortfolioView: vi.fn() }));
vi.mock("@/lib/holdings", () => ({ getLastSnapshotConfirmation: vi.fn() }));
// Pulled in transitively by <PriceCell> in the Holdings table.
vi.mock("@/app/actions/prices", () => ({ retryPriceFetchAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const listAccountsMock = vi.mocked(listAccounts);
const getPortfolioViewMock = vi.mocked(getPortfolioView);
const getLastSnapshotConfirmationMock = vi.mocked(getLastSnapshotConfirmation);

// Re-import after mocks are registered.
const { default: DashboardPage } = await import("./page");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  listAccountsMock.mockReset();
  getPortfolioViewMock.mockReset();
  getLastSnapshotConfirmationMock.mockReset();
  listAccountsMock.mockResolvedValue([{ id: 1, name: "My Portfolio", custodian: null }]);
  getLastSnapshotConfirmationMock.mockResolvedValue(null);
});

function position(over: Partial<PositionView> & Pick<PositionView, "symbol">): PositionView {
  const quantity = over.quantity ?? new Decimal("10");
  const avgCostUsd = "avgCostUsd" in over ? over.avgCostUsd! : new Decimal("100");
  return {
    accountId: 1,
    accountName: "My Portfolio",
    assetId: over.symbol,
    symbol: over.symbol,
    assetName: over.symbol,
    assetClass: "equity",
    quantity,
    avgCostUsd,
    costBasisUsd: avgCostUsd ? avgCostUsd.mul(quantity) : new Decimal("0"),
    latestPriceUsd: "latestPriceUsd" in over ? over.latestPriceUsd! : new Decimal("120"),
    priceDate: over.priceDate ?? "2026-08-26",
    priceSourceId: 1,
    priceStatus: over.priceStatus ?? "current",
    marketValueUsd: "marketValueUsd" in over ? over.marketValueUsd! : quantity.mul(new Decimal("120")),
    unrealisedPlUsd: over.unrealisedPlUsd ?? new Decimal("200"),
  };
}

function portfolio(positions: PositionView[]): PortfolioView {
  const totalMarketValueUsd = positions.reduce(
    (s, p) => (p.marketValueUsd ? s.add(p.marketValueUsd) : s),
    new Decimal(0)
  );
  return {
    positions,
    totalCashUsd: new Decimal(0),
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalMarketValueUsd,
    excludedFromTotalSymbols: positions.filter((p) => p.priceStatus === "unavailable").map((p) => p.symbol),
    totalUnrealisedPlUsd: new Decimal("200"),
    totalUnrealisedPlPct: new Decimal("10"),
  };
}

describe("Dashboard — Allocation section", () => {
  it("empty portfolio is unchanged — no Allocation section", async () => {
    listAccountsMock.mockResolvedValue([]);
    render(await DashboardPage());

    expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /allocation/i })).toBeNull();
  });

  it("two priced holdings: both in the legend with percentage + USD, and the centre total equals the Dashboard Portfolio Value", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "AAPL", quantity: new Decimal("10"), latestPriceUsd: new Decimal("300"), marketValueUsd: new Decimal("3000") }),
        position({ symbol: "MSFT", quantity: new Decimal("10"), latestPriceUsd: new Decimal("100"), marketValueUsd: new Decimal("1000") }),
      ])
    );
    const { container } = render(await DashboardPage());

    // Portfolio Value display
    const pvHeading = screen.getByRole("heading", { name: "Portfolio Value" });
    expect(pvHeading.parentElement?.textContent).toContain("US$4000.00");

    // Allocation legend
    const table = screen.getByRole("table", { name: /allocation by holding/i });
    const text = table.textContent ?? "";
    expect(text).toContain("AAPL");
    expect(text).toContain("75.00%");
    expect(text).toContain("US$3000.00");
    expect(text).toContain("MSFT");
    expect(text).toContain("25.00%");
    expect(text).toContain("US$1000.00");

    // Same total in the donut centre — one aggregate, not a competing one
    const alloc = screen.getByRole("heading", { name: /^allocation$/i }).closest("section")!;
    expect(alloc.querySelector("svg")?.textContent).toContain("US$4000.00");
    expect(container.querySelectorAll("svg circle[stroke-dasharray]").length).toBe(2);
  });

  it("partially unpriced: a STALE-priced holding is included in the Allocation legend, the unavailable one is excluded, and the existing disclosure still shows", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({
          symbol: "AAPL",
          priceStatus: "current",
          latestPriceUsd: new Decimal("300"),
          marketValueUsd: new Decimal("3000"),
        }),
        position({
          symbol: "STL",
          priceStatus: "stale",
          priceDate: "2026-06-01",
          latestPriceUsd: new Decimal("50"),
          marketValueUsd: new Decimal("500"),
        }),
        position({
          symbol: "NOPX",
          priceStatus: "unavailable",
          latestPriceUsd: null,
          marketValueUsd: null,
          unrealisedPlUsd: null,
        }),
      ])
    );
    render(await DashboardPage());

    // portfolio.totalMarketValueUsd = 3000 + 500 = 3500 (STL's stale price
    // still contributes; NOPX has no usable price).
    const allocTable = screen.getByRole("table", { name: /allocation by holding/i });
    const allocRows = within(allocTable).getAllByRole("row");

    // STL is inside the Allocation legend with its own USD value and percentage.
    const stlRow = allocRows.find((r) => r.textContent?.includes("STL"));
    expect(stlRow).toBeTruthy();
    expect(stlRow!.textContent).toContain("US$500.00");
    expect(stlRow!.textContent).toContain("14.29%"); // 500 / 3500 * 100
    expect(within(allocTable).getByText("AAPL")).toBeInTheDocument();

    // NOPX (no usable price) is NOT in the Allocation legend — scope to the
    // Allocation table so its appearance in the Holdings table can't create
    // a false positive.
    expect(within(allocTable).queryByText("NOPX")).toBeNull();
    expect(allocTable.textContent).not.toContain("NOPX");

    // Donut centre = the exact priced portfolio total.
    const allocSection = screen.getByRole("heading", { name: /^allocation$/i }).closest("section")!;
    expect(allocSection.querySelector("svg")?.textContent).toContain("US$3500.00");

    // Dashboard "Portfolio Value" = the same total, from the same aggregate.
    const pvSection = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section")!;
    expect(pvSection.textContent).toContain("US$3500.00");

    // The existing NOPX excluded-price disclosure is retained.
    expect(
      screen.getByText(/portfolio total excludes 1 holding with no price yet \(NOPX\) — true value is higher\./i)
    ).toBeInTheDocument();
  });

  it("fully unpriced: no misleading donut, a clear allocation-unavailable state, and the unpriced disclosure remains", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "AAA", priceStatus: "unavailable", latestPriceUsd: null, marketValueUsd: null, unrealisedPlUsd: null }),
        position({ symbol: "BBB", priceStatus: "unavailable", latestPriceUsd: null, marketValueUsd: null, unrealisedPlUsd: null }),
      ])
    );
    const { container } = render(await DashboardPage());

    expect(screen.getByRole("heading", { name: /^allocation$/i })).toBeInTheDocument();
    expect(screen.getByText(/allocation isn't available yet/i)).toBeInTheDocument();
    const alloc = screen.getByRole("heading", { name: /^allocation$/i }).closest("section")!;
    expect(alloc.querySelector("svg")).toBeNull();
    expect(within(alloc).queryByRole("table")).toBeNull();

    expect(
      screen.getByText(/portfolio total excludes 2 holdings with no price yet \(AAA, BBB\) — true value is higher\./i)
    ).toBeInTheDocument();
    // sanity: no allocation table anywhere
    void container;
  });

  it("one priced holding shows as 100% allocation", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "ONLY", quantity: new Decimal("4"), latestPriceUsd: new Decimal("250"), marketValueUsd: new Decimal("1000") }),
      ])
    );
    render(await DashboardPage());

    const table = screen.getByRole("table", { name: /allocation by holding/i });
    expect(table.textContent).toContain("ONLY");
    expect(table.textContent).toContain("100.00%");
  });
});
