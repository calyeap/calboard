import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toEodhdSymbol, eodhdProvider } from "./eodhdProvider";

describe("toEodhdSymbol", () => {
  it("maps equity tickers to the .US suffix", () => {
    expect(toEodhdSymbol("aapl", "equity")).toBe("AAPL.US");
  });
  it("maps ETF tickers to the .US suffix", () => {
    expect(toEodhdSymbol("qqq", "etf")).toBe("QQQ.US");
  });
  it("maps crypto tickers to the .CC suffix", () => {
    expect(toEodhdSymbol("btc-usd", "crypto")).toBe("BTC-USD.CC");
  });
});

function searchResponse(rows: Array<{ Code: string; Exchange: string; Name: string; Type: string }>) {
  return { ok: true, status: 200, json: async () => rows } as Response;
}

describe("eodhdProvider.resolveInstrument — identity resolution, independent of price", () => {
  const originalKey = process.env.EODHD_API_KEY;
  const mockFetch = vi.fn();

  beforeEach(() => {
    process.env.EODHD_API_KEY = "test-key";
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.EODHD_API_KEY;
    else process.env.EODHD_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("resolves a known equity: canonical symbol, assetClass equity, non-empty name", async () => {
    mockFetch.mockResolvedValue(
      searchResponse([{ Code: "NVDA", Exchange: "US", Name: "NVIDIA Corporation", Type: "Common Stock" }])
    );

    const result = await eodhdProvider.resolveInstrument("nvda");

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("NVDA"));
    expect(result).toEqual({
      outcome: "resolved",
      symbol: "NVDA",
      assetClass: "equity",
      name: "NVIDIA Corporation",
    });
  });

  it("resolves a known ETF: canonical symbol, assetClass etf, non-empty name", async () => {
    mockFetch.mockResolvedValue(
      searchResponse([{ Code: "SPY", Exchange: "US", Name: "SPDR S&P 500 ETF Trust", Type: "ETF" }])
    );

    const result = await eodhdProvider.resolveInstrument("SPY");

    expect(result).toEqual({ outcome: "resolved", symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF Trust" });
  });

  it("returns unknown when no result matches the exact US-listed ticker", async () => {
    mockFetch.mockResolvedValue(searchResponse([]));
    const result = await eodhdProvider.resolveInstrument("DSADASD");
    expect(result).toEqual({ outcome: "unknown" });
  });

  it("returns unknown when only a non-exact / non-US match is returned", async () => {
    mockFetch.mockResolvedValue(
      searchResponse([{ Code: "NVDA", Exchange: "XETRA", Name: "NVIDIA Corp", Type: "Common Stock" }])
    );
    const result = await eodhdProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unknown" });
  });

  it("returns unsupported when the matched instrument type is neither Common Stock nor ETF", async () => {
    mockFetch.mockResolvedValue(
      searchResponse([{ Code: "VBTLX", Exchange: "US", Name: "Vanguard Total Bond Market Fund", Type: "Mutual Fund" }])
    );
    const result = await eodhdProvider.resolveInstrument("VBTLX");
    expect(result).toEqual({ outcome: "unsupported" });
  });

  it("returns unavailable on a quota/rate-limit response (402/429) — never unknown", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => [] } as Response);
    const result = await eodhdProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("returns unavailable on a 5xx server error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => [] } as Response);
    const result = await eodhdProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("returns unavailable on a network/timeout failure", async () => {
    mockFetch.mockRejectedValue(new Error("network timeout"));
    const result = await eodhdProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("returns unavailable on an unclassified error (e.g. malformed JSON)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("unexpected token");
      },
    } as unknown as Response);
    const result = await eodhdProvider.resolveInstrument("NVDA");
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("canonicalises whitespace and casing before matching", async () => {
    mockFetch.mockResolvedValue(
      searchResponse([{ Code: "NVDA", Exchange: "US", Name: "NVIDIA Corporation", Type: "Common Stock" }])
    );
    const result = await eodhdProvider.resolveInstrument("  nvda  ");
    expect(result).toEqual({ outcome: "resolved", symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corporation" });
  });
});
