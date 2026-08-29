import { describe, it, expect } from "vitest";
import { lookupCrypto, isSupportedCrypto, UnsupportedCryptoError } from "./cryptoSymbols";

// M1.1 crypto-resolution hotfix — BTC-only scope.
// The registry is the ONE place a cryptocurrency's verified provider identity
// lives. Adding a coin here is deliberate (verified Yahoo symbol + canonical
// name); nothing else in the app may infer a crypto identifier from a bare
// ticker, which is what let "BTC" resolve to the Grayscale Bitcoin Mini
// Trust ETF.

describe("cryptoSymbols registry", () => {
  it("resolves BTC to Bitcoin's verified Yahoo USD pair", () => {
    const btc = lookupCrypto("BTC");
    expect(btc).toEqual({ ticker: "BTC", yahooSymbol: "BTC-USD", name: "Bitcoin" });
  });

  it("is case- and whitespace-insensitive on the ticker", () => {
    expect(lookupCrypto("  btc ")).toMatchObject({ yahooSymbol: "BTC-USD" });
    expect(isSupportedCrypto("btc")).toBe(true);
  });

  it("returns null for a symbol that has not been individually verified", () => {
    // Deliberately a non-real symbol: out-of-scope coins are neither
    // supported nor tested here — they must simply be unsupported.
    expect(lookupCrypto("NOTACOIN")).toBeNull();
    expect(isSupportedCrypto("NOTACOIN")).toBe(false);
  });

  it("does not treat a bare equity/ETF ticker as a cryptocurrency", () => {
    expect(isSupportedCrypto("NVDA")).toBe(false);
    expect(isSupportedCrypto("NOW")).toBe(false);
  });

  it("UnsupportedCryptoError carries the offending ticker and a clear message", () => {
    const err = new UnsupportedCryptoError("doge");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UnsupportedCryptoError");
    expect(err.message).toMatch(/DOGE/);
    expect(err.message).toMatch(/not a supported cryptocurrency/i);
  });
});
