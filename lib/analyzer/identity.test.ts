import { describe, it, expect } from "vitest";
import {
  resolveAnalyzerIdentity,
  mayBeginAnalysis,
  offersTryAgain,
  disabledReason,
} from "./identity";
import type { InstrumentResolution, MarketDataProvider } from "../marketdata/provider";

function providerReturning(resolution: InstrumentResolution): MarketDataProvider {
  return {
    sourceName: "TEST",
    resolveInstrument: async () => resolution,
    fetchLatestEod: async () => {
      throw new Error("not used");
    },
    fetchHistoricalEod: async () => {
      throw new Error("not used");
    },
  };
}

function providerThrowing(err: unknown): MarketDataProvider {
  return {
    ...providerReturning({ outcome: "unknown" }),
    resolveInstrument: async () => {
      throw err;
    },
  };
}

const RESOLVED_MSFT: InstrumentResolution = {
  outcome: "resolved",
  symbol: "MSFT",
  assetClass: "equity",
  name: "Microsoft Corporation",
};

describe("resolveAnalyzerIdentity — the four Screen 1 states", () => {
  it("RESOLVED for a listed operating company, carrying the company name", async () => {
    const identity = await resolveAnalyzerIdentity("msft", providerReturning(RESOLVED_MSFT));
    expect(identity).toEqual({
      outcome: "RESOLVED",
      ticker: "MSFT",
      companyName: "Microsoft Corporation",
    });
  });

  it("UNKNOWN for a nonsense symbol", async () => {
    const identity = await resolveAnalyzerIdentity(
      "ZZQQXX",
      providerReturning({ outcome: "unknown" })
    );
    expect(identity.outcome).toBe("UNKNOWN");
  });

  // §1.2, §2, §9.3.1 — the narrowing. This refuses at resolution, not at
  // Step 2, and not as a downstream failure on a fact set that never existed.
  it("UNSUPPORTED for an ETF, which resolves perfectly well as an instrument", async () => {
    const identity = await resolveAnalyzerIdentity(
      "SPY",
      providerReturning({
        outcome: "resolved",
        symbol: "SPY",
        assetClass: "etf",
        name: "SPDR S&P 500 ETF Trust",
      })
    );
    expect(identity.outcome).toBe("UNSUPPORTED");
    expect(identity).toMatchObject({ instrumentDescription: "a fund or index" });
  });

  it("does not consult the provider for a recognised non-company instrument", async () => {
    let providerCalled = false;
    const provider: MarketDataProvider = {
      ...providerReturning({ outcome: "unknown" }),
      resolveInstrument: async () => {
        providerCalled = true;
        return { outcome: "unknown" };
      },
    };
    const identity = await resolveAnalyzerIdentity("BTC-USD", provider);
    expect(identity.outcome).toBe("UNSUPPORTED");
    expect(providerCalled).toBe(false);
  });

  it.each([
    ["BTC", "a cryptocurrency"],
    ["BTC-USD", "a cryptocurrency pair"],
    ["ETH-USD", "a currency or crypto pair"],
    ["EURUSD=X", "a currency pair"],
    ["^GSPC", "an index"],
  ])("UNSUPPORTED for %s, described as %s", async (ticker, description) => {
    const identity = await resolveAnalyzerIdentity(
      ticker,
      providerThrowing(new Error("must not be consulted"))
    );
    expect(identity).toMatchObject({ outcome: "UNSUPPORTED", instrumentDescription: description });
  });

  // The trap in any hyphen-based pair rule: BRK-B is Berkshire Hathaway class
  // B, a listed operating company this analyzer must accept. A "contains a
  // hyphen" test would refuse it.
  it.each([["BRK-B"], ["BRK.B"], ["RDS-A"]])(
    "does not mistake the share-class ticker %s for a currency pair",
    async (ticker) => {
      const identity = await resolveAnalyzerIdentity(
        ticker,
        providerReturning({
          outcome: "resolved",
          symbol: ticker,
          assetClass: "equity",
          name: "A Listed Company",
        })
      );
      expect(identity.outcome).toBe("RESOLVED");
    }
  );

  it("UNSUPPORTED when the provider itself says unsupported", async () => {
    const identity = await resolveAnalyzerIdentity(
      "^GSPC",
      providerReturning({ outcome: "unsupported" })
    );
    expect(identity.outcome).toBe("UNSUPPORTED");
  });

  it("UNAVAILABLE when the provider reports a failure", async () => {
    const identity = await resolveAnalyzerIdentity(
      "MSFT",
      providerReturning({ outcome: "unavailable" })
    );
    expect(identity.outcome).toBe("UNAVAILABLE");
  });

  // provider.ts: "a failure to reach the provider is not proof the symbol is
  // invalid". This is the distinction that must not collapse — a timeout
  // reported as UNKNOWN tells the analyst their ticker is wrong when it is not.
  it.each([
    ["a timeout", new Error("ETIMEDOUT")],
    ["an HTTP error", new Error("503 Service Unavailable")],
    ["a quota rejection", new Error("quota exceeded")],
    ["a non-Error throw", "something unclassified"],
  ])("UNAVAILABLE, never UNKNOWN, when resolution throws: %s", async (_label, thrown) => {
    const identity = await resolveAnalyzerIdentity("MSFT", providerThrowing(thrown));
    expect(identity.outcome).toBe("UNAVAILABLE");
  });

  it("normalises the ticker before resolving", async () => {
    const identity = await resolveAnalyzerIdentity("  msft  ", providerReturning(RESOLVED_MSFT));
    expect(identity).toMatchObject({ outcome: "RESOLVED", ticker: "MSFT" });
  });

  it("treats an empty entry as UNKNOWN rather than calling the provider", async () => {
    const identity = await resolveAnalyzerIdentity("   ", providerThrowing(new Error("unreached")));
    expect(identity.outcome).toBe("UNKNOWN");
  });
});

describe("what Screen 1 does with each state", () => {
  const resolved = { outcome: "RESOLVED", ticker: "MSFT", companyName: "Microsoft" } as const;
  const unknown = { outcome: "UNKNOWN", ticker: "ZZQQXX" } as const;
  const unsupported = {
    outcome: "UNSUPPORTED",
    ticker: "SPY",
    instrumentDescription: "a fund or index",
  } as const;
  const unavailable = { outcome: "UNAVAILABLE", ticker: "MSFT" } as const;

  it("permits Begin analysis only when resolved", () => {
    expect(mayBeginAnalysis(resolved)).toBe(true);
    expect(mayBeginAnalysis(unknown)).toBe(false);
    expect(mayBeginAnalysis(unsupported)).toBe(false);
    expect(mayBeginAnalysis(unavailable)).toBe(false);
  });

  // UNAVAILABLE keeps the entry and offers Try again; the rejections do not.
  it("offers Try again only on a provider failure", () => {
    expect(offersTryAgain(unavailable)).toBe(true);
    expect(offersTryAgain(unknown)).toBe(false);
    expect(offersTryAgain(unsupported)).toBe(false);
    expect(offersTryAgain(resolved)).toBe(false);
  });

  it("states a reason for every disabled state, and none when resolved", () => {
    expect(disabledReason(resolved)).toBeNull();
    for (const identity of [unknown, unsupported, unavailable]) {
      const reason = disabledReason(identity);
      expect(reason).toBeTruthy();
      expect(reason!.length).toBeGreaterThan(10);
    }
  });

  it("names the instrument class in the UNSUPPORTED reason", () => {
    expect(disabledReason(unsupported)).toMatch(/fund or index/);
    expect(disabledReason(unsupported)).toMatch(/listed operating companies only/);
  });

  // A provider failure says nothing about the ticker, and the wording must not
  // imply it did.
  it("does not blame the ticker when the service could not be reached", () => {
    const reason = disabledReason(unavailable)!;
    expect(reason).toMatch(/could not be reached/);
    expect(reason).not.toMatch(/invalid|not found|does not exist/i);
  });
});
