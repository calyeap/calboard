import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { upsertLatestPrice } from "@/lib/marketdata";
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import type { PositionView, PortfolioView } from "@/lib/portfolio";
import { retryPriceFetchAction, refreshAllPricesAction } from "./prices";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/marketdata", () => ({ upsertLatestPrice: vi.fn() }));
vi.mock("@/lib/holdings", () => ({ getAllHoldings: vi.fn() }));
vi.mock("@/lib/portfolio", () => ({ getPortfolioView: vi.fn() }));

const revalidatePathMock = vi.mocked(revalidatePath);
const upsertLatestPriceMock = vi.mocked(upsertLatestPrice);
const getAllHoldingsMock = vi.mocked(getAllHoldings);
const getPortfolioViewMock = vi.mocked(getPortfolioView);

beforeEach(() => {
  revalidatePathMock.mockReset();
  upsertLatestPriceMock.mockReset();
  getAllHoldingsMock.mockReset();
  getPortfolioViewMock.mockReset();
});

describe("retryPriceFetchAction", () => {
  it("on success fetches the price and revalidates both / and /holdings", async () => {
    upsertLatestPriceMock.mockResolvedValue({ fromCache: false, provider: "YAHOO" });

    const result = await retryPriceFetchAction("1", "AAPL", "equity");

    expect(result).toEqual({ ok: true });
    expect(upsertLatestPriceMock).toHaveBeenCalledWith("1", "AAPL", "equity");
    const revalidated = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(revalidated).toContain("/");
    expect(revalidated).toContain("/holdings");
  });

  it("on failure reports the error and revalidates nothing", async () => {
    upsertLatestPriceMock.mockRejectedValue(new Error("provider down"));

    const result = await retryPriceFetchAction("1", "AAPL", "equity");

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/provider down/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

function pos(over: { assetId: string; priceDate: string | null; price: string | null }): PositionView {
  return {
    accountId: 1,
    accountName: "x",
    assetId: over.assetId,
    symbol: over.assetId,
    assetName: over.assetId,
    assetClass: "equity",
    quantity: new Decimal(1),
    avgCostUsd: new Decimal(1),
    costBasisUsd: new Decimal(1),
    latestPriceUsd: over.price ? new Decimal(over.price) : null,
    priceDate: over.priceDate,
    priceSourceId: 1,
    priceStatus: over.price ? "current" : "unavailable",
    marketValueUsd: over.price ? new Decimal(over.price) : null,
    unrealisedPlUsd: null,
  };
}

function portfolioOf(positions: PositionView[]): PortfolioView {
  return {
    positions,
    totalCashUsd: new Decimal(0),
    totalMarketValueUsd: new Decimal(0),
    totalPortfolioValueUsd: new Decimal(0),
    excludedFromTotalSymbols: [],
    totalUnrealisedPlUsd: new Decimal(0),
    totalUnrealisedPlPct: null,
  };
}

describe("refreshAllPricesAction", () => {
  it("no holdings: ok, unchanged, nothing fetched", async () => {
    getAllHoldingsMock.mockResolvedValue([]);
    getPortfolioViewMock.mockResolvedValue(portfolioOf([]));

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: false });
    expect(upsertLatestPriceMock).not.toHaveBeenCalled();
  });

  it("every holding refreshes but the close is unchanged: ok, changed = false", async () => {
    getAllHoldingsMock.mockResolvedValue([
      { assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) },
    ]);
    getPortfolioViewMock
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "300" })]))
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "300" })]));
    upsertLatestPriceMock.mockResolvedValue({ fromCache: true, provider: "YAHOO" });

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: false });
  });

  it("a holding's price date advances: ok, changed = true", async () => {
    getAllHoldingsMock.mockResolvedValue([
      { assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) },
    ]);
    getPortfolioViewMock
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-28", price: "300" })]))
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "305" })]));
    upsertLatestPriceMock.mockResolvedValue({ fromCache: false, provider: "YAHOO" });

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: true });
  });

  it("every holding fails: ok = false with a message, revalidates nothing", async () => {
    getAllHoldingsMock.mockResolvedValue([
      { assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) },
    ]);
    getPortfolioViewMock.mockResolvedValue(portfolioOf([pos({ assetId: "1", priceDate: null, price: null })]));
    upsertLatestPriceMock.mockRejectedValue(new Error("provider down"));

    const result = await refreshAllPricesAction();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/every holding/i);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("one of two holdings fails: still ok, message names the count, revalidates", async () => {
    getAllHoldingsMock.mockResolvedValue([
      { assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) },
      { assetId: "2", symbol: "BAD", assetClass: "equity", quantity: new Decimal(1) },
    ]);
    getPortfolioViewMock
      .mockResolvedValueOnce(
        portfolioOf([
          pos({ assetId: "1", priceDate: "2026-08-28", price: "300" }),
          pos({ assetId: "2", priceDate: null, price: null }),
        ])
      )
      .mockResolvedValueOnce(
        portfolioOf([
          pos({ assetId: "1", priceDate: "2026-08-29", price: "305" }),
          pos({ assetId: "2", priceDate: null, price: null }),
        ])
      );
    upsertLatestPriceMock
      .mockResolvedValueOnce({ fromCache: false, provider: "YAHOO" })
      .mockRejectedValueOnce(new Error("provider down"));

    const result = await refreshAllPricesAction();

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.message).toMatch(/1 of 2/i);
    const revalidated = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(revalidated).toContain("/");
    expect(revalidated).toContain("/holdings");
  });
});
