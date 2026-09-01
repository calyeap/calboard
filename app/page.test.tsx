// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import Decimal from "decimal.js";
import type { PortfolioView, PositionView } from "@/lib/portfolio";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { getLastSnapshotConfirmation } from "@/lib/holdings";
import { PrivacyProvider } from "@/app/components/PrivacyContext";

vi.mock("@/lib/accounts", () => ({ listAccounts: vi.fn() }));
vi.mock("@/lib/portfolio", () => ({ getPortfolioView: vi.fn() }));
vi.mock("@/lib/holdings", () => ({ getLastSnapshotConfirmation: vi.fn() }));
// Pulled in transitively by <PriceRefreshControl> in the value block.
vi.mock("@/app/actions/prices", () => ({
  retryPriceFetchAction: vi.fn(),
  refreshAllPricesAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
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
    assetClass: over.assetClass ?? "equity",
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

  it("two priced holdings: both in the legend with percentage + USD, and the centre total equals the value block total", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "AAPL", quantity: new Decimal("10"), latestPriceUsd: new Decimal("300"), marketValueUsd: new Decimal("3000") }),
        position({ symbol: "MSFT", quantity: new Decimal("10"), latestPriceUsd: new Decimal("100"), marketValueUsd: new Decimal("1000") }),
      ])
    );
    const { container } = render(await DashboardPage());

    // Value block
    const valueBlock = container.querySelector(".valueblock")!;
    expect(valueBlock.textContent).toContain("US$4000.00");

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
    const { container } = render(await DashboardPage());

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

    // Value block total = the same total, from the same aggregate.
    const valueBlock = container.querySelector(".valueblock")!;
    expect(valueBlock.textContent).toContain("US$3500.00");

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

// --- Dashboard v2 (2026-09-01 redesign): hierarchy, responsive markup, sort ---
describe("Dashboard — hierarchy, weight sort & responsive Dashboard", () => {
  const twoPriced = () =>
    portfolio([
      position({ symbol: "AAPL", quantity: new Decimal("10"), latestPriceUsd: new Decimal("300"), marketValueUsd: new Decimal("3000") }),
      position({ symbol: "MSFT", quantity: new Decimal("10"), latestPriceUsd: new Decimal("100"), marketValueUsd: new Decimal("1000") }),
    ]);

  function holdingsTableOf(): HTMLTableElement {
    // The Holdings detail table is the one inside the "Holdings" section;
    // the AllocationDonut legend lives in the "Allocation" section and has
    // an accessible name (<caption>Allocation by holding</caption>).
    return within(
      screen.getByRole("heading", { name: /^holdings$/i }).closest("section")!
    ).getByRole("table") as HTMLTableElement;
  }

  it("section reading order is value block -> Holdings -> Allocation (hierarchy: value block -> holdings (dominant) -> allocation (recedes))", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    const { container } = render(await DashboardPage());

    const valueBlock = container.querySelector(".valueblock")!;
    const holdings = screen.getByRole("heading", { name: /^holdings$/i });
    const alloc = screen.getByRole("heading", { name: /^allocation$/i });
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

    expect(valueBlock.compareDocumentPosition(holdings) & FOLLOWING).toBeTruthy();
    expect(holdings.compareDocumentPosition(alloc) & FOLLOWING).toBeTruthy();
  });

  it("the Dashboard holdings table is a table.holdings wrapped in the .editor-table responsive container", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    const holdingsTable = holdingsTableOf();
    expect(holdingsTable).toHaveClass("holdings");
    expect(holdingsTable.parentElement).toHaveClass("editor-table");
  });

  it("each mobile stack card carries the symbol, quantity, avg cost and asset class as visible text", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    const { container } = render(await DashboardPage());

    const firstCard = container.querySelector(".stack .hrow")!;
    expect(firstCard.textContent).toContain("AAPL");
    expect(firstCard.textContent).toMatch(/10\.0000/);
    expect(firstCard.textContent).toContain("Equity");
  });

  it("holdings render in descending market-value (weight) order, not fetch order", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "SMALL", latestPriceUsd: new Decimal("100"), marketValueUsd: new Decimal("100") }),
        position({ symbol: "BIG", latestPriceUsd: new Decimal("500"), marketValueUsd: new Decimal("500") }),
        position({ symbol: "MID", latestPriceUsd: new Decimal("200"), marketValueUsd: new Decimal("200") }),
      ])
    );
    render(await DashboardPage());

    const rows = within(holdingsTableOf()).getAllByRole("row").slice(1); // skip header
    const symbolsInOrder = rows.map((r) => r.querySelector(".sym")?.textContent);
    expect(symbolsInOrder).toEqual(["BIG", "MID", "SMALL"]);
  });

  it("(pass-at-baseline regression guard) one tbody, one row per position, and NO per-row Retry control — replaced by the global refresh", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "AAPL", priceStatus: "current", latestPriceUsd: new Decimal("300"), marketValueUsd: new Decimal("3000") }),
        position({ symbol: "STL", priceStatus: "stale", priceDate: "2026-06-01", latestPriceUsd: new Decimal("50"), marketValueUsd: new Decimal("500") }),
        position({ symbol: "NOPX", priceStatus: "unavailable", latestPriceUsd: null, marketValueUsd: null, unrealisedPlUsd: null }),
      ])
    );
    render(await DashboardPage());

    const holdingsTable = holdingsTableOf();
    expect(holdingsTable.querySelectorAll("tbody").length).toBe(1);
    expect(holdingsTable.querySelectorAll("tbody tr").length).toBe(3);
    expect(screen.queryAllByRole("button", { name: /retry/i }).length).toBe(0);
  });

  it("the value figure uses the .value hook and the confirmation line uses .dashboard-note", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    const { container } = render(await DashboardPage());

    const valueEl = container.querySelector(".valueblock .value");
    expect(valueEl).not.toBeNull();
    expect(valueEl!.textContent).toContain("US$4000.00");

    const freshness = screen.getByText(/holdings last updated:/i);
    expect(freshness).toHaveClass("dashboard-note");
  });

  it("the Dashboard-only top bar renders (brand, Dashboard/Holdings nav, privacy + theme controls)", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    expect(screen.getByText("Calboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveClass("on");
    expect(screen.getByRole("link", { name: /^holdings$/i })).toHaveAttribute("href", "/holdings");
    expect(screen.getByRole("button", { name: /hide values/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });
});

describe("Dashboard — empty state derives from holdings existence (Rev-3 §2.3)", () => {
  it("an active account whose holdings were all removed shows the empty-state CTA, not a $0.00 populated Dashboard", async () => {
    // The confirmed reachable bug: an existing portfolio, then /holdings ->
    // remove every holding -> Save. The account row persists (is_active), so
    // listAccounts() still returns it, but getPortfolioView() has no positions.
    // Rev-3 §2.3: the Dashboard's empty vs. full state is derived entirely from
    // whether any holdings exist — not from whether an account row exists.
    listAccountsMock.mockResolvedValue([{ id: 1, name: "My Portfolio", custodian: null }]);
    getPortfolioViewMock.mockResolvedValue(portfolio([]));
    getLastSnapshotConfirmationMock.mockResolvedValue({
      confirmedAt: new Date("2026-08-28T10:00:00Z"),
      asOfDate: "2026-08-28",
    });

    const { container } = render(await DashboardPage());

    // The existing zero-holdings empty state + its existing CTA / destination.
    expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add your holdings/i })).toHaveAttribute(
      "href",
      "/accounts/new"
    );
    // Chrome still renders in the empty state.
    expect(screen.getByText("Calboard")).toBeInTheDocument();

    // None of the populated-Dashboard content renders.
    expect(container.querySelector(".valueblock")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^holdings$/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /allocation/i })).toBeNull();
    expect(screen.queryByText(/holdings last updated/i)).toBeNull();
  });

  it("a portfolio with at least one holding still renders the populated Dashboard", async () => {
    getPortfolioViewMock.mockResolvedValue(portfolio([position({ symbol: "AAPL" })]));

    const { container } = render(await DashboardPage());

    expect(container.querySelector(".valueblock")).not.toBeNull();
    expect(screen.getByRole("heading", { name: /^holdings$/i })).toBeInTheDocument();
    expect(screen.queryByText(/no holdings yet/i)).toBeNull();
  });
});

describe("Dashboard — M1.5: asset type display", () => {
  function holdingsTableOf(): HTMLTableElement {
    return within(
      screen.getByRole("heading", { name: /^holdings$/i }).closest("section")!
    ).getByRole("table") as HTMLTableElement;
  }

  it("each row shows its stored asset type — sourced from assetClass, not inferred from the ticker", async () => {
    getPortfolioViewMock.mockResolvedValue(
      portfolio([
        position({ symbol: "NVDA", assetClass: "equity", quantity: new Decimal("1") }),
        position({ symbol: "VOO", assetClass: "etf", quantity: new Decimal("1") }),
        position({ symbol: "BTC", assetClass: "crypto", quantity: new Decimal("1") }),
      ])
    );
    render(await DashboardPage());

    const rows = within(holdingsTableOf()).getAllByRole("row").slice(1); // skip header
    expect(rows[0].textContent).toContain("Equity");
    expect(rows[1].textContent).toContain("ETF");
    expect(rows[2].textContent).toContain("Crypto");
  });
});

describe("Dashboard — M1.5: privacy toggle", () => {
  function twoPricedDifferentClasses() {
    return portfolio([
      position({
        symbol: "AAPL",
        assetClass: "equity",
        quantity: new Decimal("10"),
        avgCostUsd: new Decimal("100"),
        latestPriceUsd: new Decimal("300"),
        marketValueUsd: new Decimal("3000"),
        unrealisedPlUsd: new Decimal("2000"),
      }),
      position({
        symbol: "VOO",
        assetClass: "etf",
        quantity: new Decimal("2"),
        avgCostUsd: new Decimal("400"),
        latestPriceUsd: new Decimal("500"),
        marketValueUsd: new Decimal("1000"),
        unrealisedPlUsd: new Decimal("200"),
      }),
    ]);
  }

  async function renderHidden() {
    getPortfolioViewMock.mockResolvedValue(twoPricedDifferentClasses());
    const result = render(<PrivacyProvider>{await DashboardPage()}</PrivacyProvider>);
    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
    return result;
  }

  it("before toggling, values render normally", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPricedDifferentClasses());
    const { container } = render(<PrivacyProvider>{await DashboardPage()}</PrivacyProvider>);

    const valueBlock = container.querySelector(".valueblock")!;
    expect(valueBlock.textContent).toContain("US$4000.00");
    const holdingsSection = screen.getByRole("heading", { name: /^holdings$/i }).closest("section")!;
    expect(holdingsSection.textContent).toContain("3000.00");
  });

  it("hides the value figure and the Unrealised P&L dollar figure, but keeps the P&L percentage visible", async () => {
    const { container } = await renderHidden();

    const valueBlock = container.querySelector(".valueblock")!;
    expect(valueBlock.textContent).not.toContain("4000.00");
    expect(valueBlock.textContent).not.toContain("200.00"); // total unrealised P&L dollar figure
    expect(valueBlock.textContent).toContain("10.00%"); // its percentage stays visible
    expect(screen.getAllByText(/•/).length).toBeGreaterThan(0);
  });

  it("hides per-row Quantity, Avg cost and Market value in the Holdings table, but keeps Price visible", async () => {
    await renderHidden();

    const holdingsSection = screen.getByRole("heading", { name: /^holdings$/i }).closest("section")!;
    expect(holdingsSection.textContent).not.toContain("3000.00");
    expect(holdingsSection.textContent).not.toContain("100.00"); // AAPL avg cost
    // Quantity "10" alone is too fragile to assert absence of, but the
    // formatted 4dp quantity is not — "10.0000" would appear unmasked.
    expect(holdingsSection.textContent).not.toContain("10.0000");
    // Price is never masked — it's public market data, not derived from the
    // user's position.
    expect(within(holdingsSection).getByText("$300.00")).toBeInTheDocument();
  });

  it("keeps every Allocation percentage visible while hiding its dollar figures", async () => {
    await renderHidden();

    const allocSection = screen.getByRole("heading", { name: /^allocation$/i }).closest("section")!;
    expect(allocSection.textContent).toContain("75.00%");
    expect(allocSection.textContent).toContain("25.00%");
    expect(allocSection.textContent).not.toContain("3000.00");
    expect(allocSection.textContent).not.toContain("1000.00");
  });

  it("toggling back off restores every value", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPricedDifferentClasses());
    const { container } = render(<PrivacyProvider>{await DashboardPage()}</PrivacyProvider>);
    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
    fireEvent.click(screen.getByRole("button", { name: /show values/i }));

    const valueBlock = container.querySelector(".valueblock")!;
    expect(valueBlock.textContent).toContain("US$4000.00");
    expect(screen.queryByText(/•/)).toBeNull();
  });
});
