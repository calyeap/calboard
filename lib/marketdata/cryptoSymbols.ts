// Verified-cryptocurrency registry (M1.1 crypto-resolution hotfix).
//
// The M1.1 bug: selecting "Crypto" + "BTC" priced the holding off Yahoo's
// bare "BTC" ticker, which is the Grayscale Bitcoin Mini Trust ETF (~$35/
// share), not Bitcoin. A cryptocurrency must be resolved by a verified
// provider identifier, never an unqualified ticker that can collide with an
// equity or ETF.
//
// This registry is that verified mapping and the ONLY place a crypto ticker
// becomes a provider symbol. Each entry has been individually confirmed:
//   - `yahooSymbol` is the Yahoo Finance USD-pair symbol that returns the
//     cryptocurrency itself (documented for BTC-USD in
//     docs/superpowers/plans/2026-08-25-yahoo-spike-results.md);
//   - `name` is the canonical instrument name persisted with the holding so
//     later price retrieval / Retry never re-runs a bare-ticker lookup.
//
// Scope is intentionally BTC-only. Adding another coin is a deliberate act:
// verify its Yahoo pair and name, add a row here, add its tests. Do not
// derive entries from a pattern.

export interface CryptoInstrument {
  /** User-facing ticker, upper-case. */
  ticker: string;
  /** Verified Yahoo Finance quote symbol for the USD pair. */
  yahooSymbol: string;
  /** Canonical full instrument name, persisted as the asset's name. */
  name: string;
}

const REGISTRY: Record<string, CryptoInstrument> = {
  BTC: { ticker: "BTC", yahooSymbol: "BTC-USD", name: "Bitcoin" },
};

function normalize(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/** The verified instrument for a crypto ticker, or null if it is not one we support. */
export function lookupCrypto(ticker: string): CryptoInstrument | null {
  return REGISTRY[normalize(ticker)] ?? null;
}

export function isSupportedCrypto(ticker: string): boolean {
  return lookupCrypto(ticker) !== null;
}

/**
 * Raised when a ticker is presented as a cryptocurrency but is not in the
 * verified registry. Callers surface this as a clear "unsupported" result —
 * they must never fall back to a bare-ticker lookup.
 */
export class UnsupportedCryptoError extends Error {
  constructor(ticker: string) {
    super(
      `"${normalize(ticker)}" is not a supported cryptocurrency. Calboard tracks a ` +
        `specific set of verified cryptocurrencies, and this symbol is not one of them.`
    );
    this.name = "UnsupportedCryptoError";
  }
}
