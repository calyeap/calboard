import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// A CAPTURED PRICE MUST NEVER REACH A REAL RUN.
//
// Command Center's condition, 8 September 2026. Captured filing slices are
// fine — a 10-K figure does not change after it is filed. A captured PRICE is
// different in kind: it is a stale price, and price is the most consequential
// input to the valuation position.
//
// The guard is a single branch in gate.latestPrice: `prices.json` is read only
// by `capturedPrice`, which is called only under `isOffline()`. This file pins
// that branch. It does not add a second guard.
//
// The provider is stubbed so the online case never touches the network — the
// test is about which SOURCE a run reads, not about Yahoo being up.
// ---------------------------------------------------------------------------

const LIVE_QUOTE = { date: "2026-09-05", close: 123.45, adjustedClose: 123.45 };

vi.mock("../marketdata", () => ({
  activeProvider: () => ({
    sourceName: "STUB",
    resolveInstrument: async () => ({ outcome: "unknown" as const }),
    fetchLatestEod: async () => LIVE_QUOTE,
    fetchHistoricalEod: async () => [],
  }),
}));

const { latestPrice } = await import("./gate");

const CAPTURED_MARKER = "recorded capture";
const OFFLINE = process.env.ANALYZER_OFFLINE;

afterEach(() => {
  // vitest.setup.ts turns offline mode on for the whole suite; every test here
  // restores it so nothing downstream inherits an online analyzer.
  if (OFFLINE === undefined) delete process.env.ANALYZER_OFFLINE;
  else process.env.ANALYZER_OFFLINE = OFFLINE;
});

describe("a real run never reads a price from a capture", () => {
  beforeEach(() => {
    delete process.env.ANALYZER_OFFLINE;
  });

  it("reads the live provider, not prices.json", async () => {
    const price = await latestPrice("MSFT");

    expect(price).not.toBeNull();
    // The load-bearing assertion. MSFT IS in prices.json at 499.70, so a run
    // that reached the capture would come back with that figure and a source
    // naming the capture. Neither may happen here.
    expect(price?.source).not.toContain(CAPTURED_MARKER);
    expect(price?.value.toString()).not.toBe("499.7");

    expect(price?.source).toBe("STUB latest close");
    expect(price?.value.toString()).toBe("123.45");
    expect(price?.timestamp).toBe("2026-09-05");
  });

  it("returns no price rather than a captured one when the provider fails", async () => {
    // The failure mode the guard exists for. A stale price served precisely
    // when the feed is down is worse than no price: §5.1 admits no estimate,
    // no carried-forward prior value, and §3.4 has no approximate price state.
    // Absent, price-dependent outputs return INCOMPLETE and say so.
    const marketdata = await import("../marketdata");
    vi.spyOn(marketdata, "activeProvider").mockReturnValue({
      sourceName: "STUB",
      resolveInstrument: async () => ({ outcome: "unavailable" as const }),
      fetchLatestEod: async () => {
        throw new Error("provider unreachable");
      },
      fetchHistoricalEod: async () => [],
    });

    await expect(latestPrice("MSFT")).resolves.toBeNull();
    vi.restoreAllMocks();
  });

  it("does not fall through to a capture for a ticker the provider does not know", async () => {
    // OKLO is in prices.json too. A run for it must still take the live path.
    const price = await latestPrice("OKLO");
    expect(price?.source).not.toContain(CAPTURED_MARKER);
    expect(price?.value.toString()).not.toBe("41.27");
  });
});

describe("an offline run does read the capture, and says so", () => {
  beforeEach(() => {
    process.env.ANALYZER_OFFLINE = "1";
  });

  it("serves the recorded quote with a source that names it as a capture", async () => {
    const price = await latestPrice("MSFT");

    expect(price?.value.toString()).toBe("499.7");
    expect(price?.source).toContain(CAPTURED_MARKER);
    // The capture is never passed off as live: the marker is on the fact's own
    // source field, which Screen 2 renders on the card.
    expect(price?.source).not.toBe("STUB latest close");
  });

  it("returns null for a ticker the capture does not carry", async () => {
    // Absence in the capture is absence, not a reason to call out.
    await expect(latestPrice("NVDA")).resolves.toBeNull();
  });
});
