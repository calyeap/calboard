import { describe, it, expect, vi, beforeEach } from "vitest";

// yahoo-finance2 is instantiated at module load (`new YahooFinance()`), so
// the mock must be a constructor exposing the same methods. All provider
// calls funnel through these spies so tests can assert the exact symbol
// string the adapter sent to Yahoo.
const { mockChart, mockQuote } = vi.hoisted(() => ({ mockChart: vi.fn(), mockQuote: vi.fn() }));
vi.mock("yahoo-finance2", () => ({
  default: class {
    chart = mockChart;
    quote = mockQuote;
  },
}));

import { yahooProvider } from "./yahooProvider";

function chartResponse(rows: Array<{ date: string; close: number }>) {
  return {
    quotes: rows.map((r) => ({ date: new Date(`${r.date}T00:00:00Z`), close: r.close, adjclose: r.close })),
  };
}

// Bare "BTC" on Yahoo is the Grayscale Bitcoin Mini Trust ETF (~$35/share),
// NOT Bitcoin — this is the exact instrument the M1.1 bug resolved. Bitcoin
// is the "BTC-USD" pair (~$79k). NOW / NVDA are the equity regression anchors.
const GRAYSCALE_BTC_ETF_CLOSE = 35.34;
const BITCOIN_USD_CLOSE = 79805.13;

beforeEach(() => {
  mockChart.mockReset();
  mockQuote.mockReset();
  mockChart.mockImplementation(async (symbol: string) => {
    switch (symbol) {
      case "BTC-USD":
        return chartResponse([{ date: "2026-08-28", close: BITCOIN_USD_CLOSE }]);
      case "BTC":
        return chartResponse([{ date: "2026-08-28", close: GRAYSCALE_BTC_ETF_CLOSE }]);
      case "NVDA":
        return chartResponse([{ date: "2026-08-28", close: 180.5 }]);
      case "NOW":
        return chartResponse([{ date: "2026-08-28", close: 900.1 }]);
      default:
        throw new Error("No data found, symbol may be delisted");
    }
  });
});

describe("yahooProvider — asset-type-aware symbol resolution", () => {
  it("REGRESSION: Crypto + BTC prices Bitcoin (BTC-USD), never the bare-ticker Grayscale ETF", async () => {
    const point = await yahooProvider.fetchLatestEod("BTC", "crypto");

    // The adapter must qualify the crypto ticker before hitting Yahoo.
    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.anything());
    expect(mockChart).not.toHaveBeenCalledWith("BTC", expect.anything());
    // And the price must be Bitcoin's, not a ~$35 ETF share price.
    expect(point.close).toBe(BITCOIN_USD_CLOSE);
  });

  it("maps a lowercase crypto ticker to the verified USD pair too", async () => {
    await yahooProvider.fetchLatestEod("btc", "crypto");
    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.anything());
  });

  it("rejects an unverified crypto ticker instead of guessing a pair or falling back", async () => {
    await expect(yahooProvider.fetchLatestEod("NOTACOIN", "crypto")).rejects.toThrow(
      /not a supported cryptocurrency/i
    );
    // It must not have attempted ANY Yahoo lookup for an unsupported crypto.
    expect(mockChart).not.toHaveBeenCalled();
  });

  it("crypto historical data also uses the verified USD pair", async () => {
    mockChart.mockResolvedValueOnce(
      chartResponse([
        { date: "2026-08-27", close: 78000 },
        { date: "2026-08-28", close: BITCOIN_USD_CLOSE },
      ])
    );
    const points = await yahooProvider.fetchHistoricalEod("BTC", "crypto", "2026-08-27", "2026-08-28");
    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.objectContaining({ period1: "2026-08-27" }));
    expect(points).toHaveLength(2);
  });

  it("EQUITY REGRESSION: NOW and NVDA still resolve by their bare ticker, unchanged", async () => {
    const now = await yahooProvider.fetchLatestEod("now", "equity");
    const nvda = await yahooProvider.fetchLatestEod("NVDA", "equity");

    expect(mockChart).toHaveBeenCalledWith("NOW", expect.anything());
    expect(mockChart).toHaveBeenCalledWith("NVDA", expect.anything());
    expect(now.close).toBe(900.1);
    expect(nvda.close).toBe(180.5);
  });

  it("ETF lookups are unchanged: the bare ticker is used as-is", async () => {
    // Asking for BTC *as an ETF* is a different instrument from the crypto —
    // asset class must not cross. The bare-ticker path still reaches the ETF.
    const point = await yahooProvider.fetchLatestEod("BTC", "etf");
    expect(mockChart).toHaveBeenCalledWith("BTC", expect.anything());
    expect(point.close).toBe(GRAYSCALE_BTC_ETF_CLOSE);
  });
});

describe("yahooProvider.resolveInstrument — identity resolution, independent of price", () => {
  it("resolves a known equity: canonical symbol, assetClass equity, non-empty name", async () => {
    mockQuote.mockResolvedValue({
      symbol: "NVDA",
      quoteType: "EQUITY",
      longName: "NVIDIA Corporation",
    });

    const result = await yahooProvider.resolveInstrument("nvda");

    expect(mockQuote).toHaveBeenCalledWith("NVDA");
    expect(result).toEqual({
      outcome: "resolved",
      symbol: "NVDA",
      assetClass: "equity",
      name: "NVIDIA Corporation",
    });
  });

  it("resolves a known ETF: canonical symbol, assetClass etf, non-empty name", async () => {
    mockQuote.mockResolvedValue({
      symbol: "SPY",
      quoteType: "ETF",
      longName: "SPDR S&P 500 ETF Trust",
    });

    const result = await yahooProvider.resolveInstrument("SPY");

    expect(result).toEqual({
      outcome: "resolved",
      symbol: "SPY",
      assetClass: "etf",
      name: "SPDR S&P 500 ETF Trust",
    });
  });

  it("falls back to shortName when longName is absent", async () => {
    mockQuote.mockResolvedValue({ symbol: "NVDA", quoteType: "EQUITY", shortName: "NVIDIA" });
    const result = await yahooProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "resolved", symbol: "NVDA", assetClass: "equity", name: "NVIDIA" });
  });

  it("returns unknown when Yahoo has no quote for the symbol", async () => {
    mockQuote.mockResolvedValue(undefined);
    const result = await yahooProvider.resolveInstrument("DSADASD");
    expect(result).toEqual({ outcome: "unknown" });
  });

  it("returns unsupported when the resolved instrument type is neither EQUITY nor ETF", async () => {
    mockQuote.mockResolvedValue({ symbol: "BTC-USD", quoteType: "CRYPTOCURRENCY", longName: "Bitcoin USD" });
    const result = await yahooProvider.resolveInstrument("BTC-USD");
    expect(result).toEqual({ outcome: "unsupported" });
  });

  it("returns unknown when the resolved instrument has no display name", async () => {
    mockQuote.mockResolvedValue({ symbol: "NVDA", quoteType: "EQUITY" });
    const result = await yahooProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unknown" });
  });

  it("returns unavailable, never unknown, on a network/timeout failure — a failure is not proof of invalidity", async () => {
    mockQuote.mockRejectedValue(new Error("network timeout"));
    const result = await yahooProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("returns unavailable on an HTTP error from Yahoo (e.g. 429/5xx)", async () => {
    mockQuote.mockRejectedValue(new Error("HTTP 429: Too Many Requests"));
    const result = await yahooProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("returns unavailable on an unclassified thrown error", async () => {
    mockQuote.mockRejectedValue("not even an Error instance");
    const result = await yahooProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("canonicalises whitespace and casing before calling Yahoo", async () => {
    mockQuote.mockResolvedValue({ symbol: "NVDA", quoteType: "EQUITY", longName: "NVIDIA Corporation" });
    await yahooProvider.resolveInstrument("  nvda  ");
    expect(mockQuote).toHaveBeenCalledWith("NVDA");
  });
});
