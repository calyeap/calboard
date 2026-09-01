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

// --- Task 31: hierarchy & responsive Dashboard ---
describe("Dashboard — Task 31: hierarchy & responsive Dashboard", () => {
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

  it("T31-1 (pass-at-baseline regression guard): section reading order is Portfolio Value -> Allocation -> Holdings", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    const pv = screen.getByRole("heading", { name: "Portfolio Value" });
    const alloc = screen.getByRole("heading", { name: /^allocation$/i });
    const holdings = screen.getByRole("heading", { name: /^holdings$/i });
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

    expect(pv.compareDocumentPosition(alloc) & FOLLOWING).toBeTruthy();
    expect(alloc.compareDocumentPosition(holdings) & FOLLOWING).toBeTruthy();
  });

  it("T31-2: the Dashboard holdings table is wrapped in the .editor-table responsive container", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    const holdingsTable = holdingsTableOf();
    expect(holdingsTable).not.toHaveAccessibleName();
    expect(holdingsTable.parentElement).toHaveClass("editor-table");
  });

  it("T31-3: each Dashboard holdings row carries real-text .cell-label field labels in column order", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    const firstRow = holdingsTableOf().querySelector("tbody tr")!;
    const labels = Array.from(firstRow.querySelectorAll("td")).map(
      (td) => td.querySelector(".cell-label")?.textContent ?? null
    );
    expect(labels).toEqual([
      "Symbol",
      "Type",
      "Qty",
      "Avg cost",
      "Price",
      "Market value",
      "Unrealised P&L",
    ]);
  });

  it("T31-4 (pass-at-baseline regression guard): no duplicated holdings markup — one tbody, one row per position, one retry control per unpriced position", async () => {
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
    // Retry appears for the stale and the unavailable holding only (2), not
    // for the current one.
    expect(screen.getAllByRole("button", { name: /retry/i }).length).toBe(2);
  });

  it("T31-5: Portfolio Value uses the .pv-amount hook and the freshness line uses .dashboard-note", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPriced());
    render(await DashboardPage());

    const pvSection = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section")!;
    const pvAmount = pvSection.querySelector(".pv-amount");
    expect(pvAmount).not.toBeNull();
    expect(pvAmount!.textContent).toContain("US$4000.00");

    const freshness = screen.getByText(/holdings last updated:/i);
    expect(freshness).toHaveClass("dashboard-note");
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

    render(await DashboardPage());

    // The existing zero-holdings empty state + its existing CTA / destination.
    expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add your holdings/i })).toHaveAttribute(
      "href",
      "/accounts/new"
    );

    // None of the populated-Dashboard content renders.
    expect(screen.queryByRole("heading", { name: /portfolio value/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^holdings$/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /allocation/i })).toBeNull();
    expect(screen.queryByText(/holdings last updated/i)).toBeNull();
  });

  it("a portfolio with at least one holding still renders the populated Dashboard", async () => {
    getPortfolioViewMock.mockResolvedValue(portfolio([position({ symbol: "AAPL" })]));

    render(await DashboardPage());

    expect(screen.getByRole("heading", { name: /portfolio value/i })).toBeInTheDocument();
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
    render(<PrivacyProvider>{await DashboardPage()}</PrivacyProvider>);
    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
  }

  it("before toggling, values render normally", async () => {
    getPortfolioViewMock.mockResolvedValue(twoPricedDifferentClasses());
    render(<PrivacyProvider>{await DashboardPage()}</PrivacyProvider>);

    const pvSection = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section")!;
    expect(pvSection.textContent).toContain("US$4000.00");
    const holdingsSection = screen.getByRole("heading", { name: /^holdings$/i }).closest("section")!;
    expect(holdingsSection.textContent).toContain("3000.00");
  });

  it("hides Portfolio Value and the Unrealised P&L dollar figure, but keeps the P&L percentage visible", async () => {
    await renderHidden();

    const pvSection = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section")!;
    expect(pvSection.textContent).not.toContain("4000.00");
    expect(pvSection.textContent).not.toContain("200.00"); // total unrealised P&L dollar figure
    expect(pvSection.textContent).toContain("10.00%"); // its percentage stays visible
    expect(screen.getAllByText("••••••").length).toBeGreaterThan(0);
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
    await renderHidden();
    fireEvent.click(screen.getByRole("button", { name: /show values/i }));

    const pvSection = screen.getByRole("heading", { name: "Portfolio Value" }).closest("section")!;
    expect(pvSection.textContent).toContain("US$4000.00");
    expect(screen.queryByText("••••••")).toBeNull();
  });
});
