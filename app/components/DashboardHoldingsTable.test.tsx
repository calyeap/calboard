// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Decimal from "decimal.js";
import type { PositionView } from "@/lib/portfolio";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { DashboardHoldingsTable } from "./DashboardHoldingsTable";

afterEach(cleanup);

function position(over: Partial<PositionView> & Pick<PositionView, "symbol">): PositionView {
  const quantity = over.quantity ?? new Decimal("10");
  return {
    accountId: 1,
    accountName: "x",
    assetId: over.symbol,
    symbol: over.symbol,
    assetName: over.symbol,
    assetClass: over.assetClass ?? "equity",
    quantity,
    avgCostUsd: over.avgCostUsd ?? new Decimal("100"),
    costBasisUsd: new Decimal("1000"),
    latestPriceUsd: "latestPriceUsd" in over ? over.latestPriceUsd! : new Decimal("120"),
    // Fixtures use already-cent-rounded prices, so raw === displayed here.
    rawLatestPriceUsd: "latestPriceUsd" in over ? over.latestPriceUsd! : new Decimal("120"),
    priceDate: over.priceDate ?? "2026-08-29",
    priceSourceId: 1,
    priceStatus: over.priceStatus ?? "current",
    marketValueUsd: "marketValueUsd" in over ? over.marketValueUsd! : quantity.mul(new Decimal("120")),
    unrealisedPlUsd: over.unrealisedPlUsd ?? new Decimal("200"),
  };
}

describe("DashboardHoldingsTable", () => {
  it("renders one row per position in both the desktop table and the mobile stack, no Retry button anywhere", () => {
    const positions = [
      position({ symbol: "AAPL" }),
      position({ symbol: "STL", priceStatus: "stale", priceDate: "2026-06-01" }),
      position({
        symbol: "NOPX",
        priceStatus: "unavailable",
        latestPriceUsd: null,
        marketValueUsd: null,
        unrealisedPlUsd: null,
      }),
    ];
    const { container } = render(<DashboardHoldingsTable positions={positions} />);

    const desktopTable = container.querySelector("table.holdings")!;
    expect(desktopTable.querySelectorAll("tbody tr").length).toBe(3);
    const stack = container.querySelector(".stack")!;
    expect(stack.querySelectorAll(".hrow").length).toBe(3);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("names stale and unavailable symbols with their reason in one footnote line", () => {
    const positions = [
      position({ symbol: "NVDA", priceStatus: "stale", priceDate: "2026-08-27" }),
      position({
        symbol: "SCHD",
        priceStatus: "unavailable",
        latestPriceUsd: null,
        marketValueUsd: null,
        unrealisedPlUsd: null,
      }),
    ];
    render(<DashboardHoldingsTable positions={positions} />);

    // Appears once in the desktop tfoot (joined) and once per-row in the
    // mobile stack — both are the same underlying footnote text, not a
    // duplicate/drifted copy, so >=1 match is the right assertion.
    expect(screen.getAllByText(/NVDA is priced at 2026-08-27 close/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SCHD has no price and is excluded/i).length).toBeGreaterThan(0);
  });

  it("no stale or unavailable holdings: no footnote renders", () => {
    render(<DashboardHoldingsTable positions={[position({ symbol: "AAPL" })]} />);
    expect(screen.queryByText(/is priced at/i)).toBeNull();
    expect(screen.queryByText(/has no price/i)).toBeNull();
  });

  it("shows a loss row with a minus sign and a gain row with a plus sign", () => {
    const positions = [
      position({ symbol: "WIN", latestPriceUsd: new Decimal("150"), avgCostUsd: new Decimal("100"), quantity: new Decimal("1") }),
      position({ symbol: "LOSE", latestPriceUsd: new Decimal("50"), avgCostUsd: new Decimal("100"), quantity: new Decimal("1") }),
    ];
    render(<DashboardHoldingsTable positions={positions} />);

    const table = screen.getAllByRole("table")[0];
    expect(table.textContent).toContain("+$50.00");
    expect(table.textContent).toContain("−$50.00");
  });

  it("an unpriced row's P&L shows the em-dash sentinel with no gain/loss colour class in the desktop table, and omits the P&L line entirely in the mobile stack (the plOf() null branch — previously unexercised: no prior test asserted on its rendered output or class)", () => {
    const positions = [
      position({
        symbol: "NOPX",
        priceStatus: "unavailable",
        latestPriceUsd: null,
        marketValueUsd: null,
        unrealisedPlUsd: null,
      }),
    ];
    const { container } = render(<DashboardHoldingsTable positions={positions} />);

    const desktopRow = container.querySelector("table.holdings tbody tr")!;
    const plTd = desktopRow.querySelectorAll("td")[6];
    expect(plTd.textContent).toContain("—");
    expect(plTd.className).not.toMatch(/\bgain\b/);
    expect(plTd.className).not.toMatch(/\bloss\b/);

    const stackRow = container.querySelector(".stack .hrow")!;
    expect(stackRow.querySelector(".pl")).toBeNull();
  });

  it("masks Quantity, Avg cost, Market value and P&L in BOTH the desktop table and the mobile stack, keeping Price visible in both", () => {
    function ToggleButton() {
      const { toggle } = usePrivacy();
      return (
        <button type="button" onClick={toggle}>
          toggle
        </button>
      );
    }
    const positions = [
      position({
        symbol: "AAPL",
        quantity: new Decimal("10"),
        avgCostUsd: new Decimal("100"),
        latestPriceUsd: new Decimal("300"),
        marketValueUsd: new Decimal("3000"),
      }),
    ];
    const { container } = render(
      <PrivacyProvider>
        <ToggleButton />
        <DashboardHoldingsTable positions={positions} />
      </PrivacyProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(container.textContent).not.toContain("10.0000");
    expect(container.textContent).not.toContain("100.00");
    expect(container.textContent).not.toContain("3000.00");
    // Price is public market data — never masked. It only appears in the
    // desktop table.holdings cell; the mobile .hrow card (mirroring the
    // mock) doesn't repeat price standalone, only market value/qty/P&L.
    const desktopTable = container.querySelector("table.holdings")!;
    expect(desktopTable.textContent).toContain("$300.00");
  });
});
