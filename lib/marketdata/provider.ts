import type { AssetClass } from "../assets";

export interface EodPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
  adjustedClose: number;
}

// Equity/ETF identity resolution, independent of price availability. A
// provider/network failure (timeout, HTTP error, quota, or anything
// unclassified) must resolve to "unavailable" — never "unknown" — because a
// failure to reach the provider is not proof the symbol is invalid.
export type InstrumentResolution =
  | { outcome: "resolved"; symbol: string; assetClass: "equity" | "etf"; name: string }
  | { outcome: "unknown" }
  | { outcome: "unsupported" }
  | { outcome: "unavailable" };

export interface MarketDataProvider {
  readonly sourceName: string; // must match a row in the `sources` table
  // Crypto is never resolved here — lib/marketdata/cryptoSymbols.ts is the
  // sole authority for crypto identity, unchanged by this method.
  resolveInstrument(ticker: string): Promise<InstrumentResolution>;
  fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint>;
  // from/to are inclusive "YYYY-MM-DD" bounds. Returned points may be in any
  // order — callers that need chronological order must sort explicitly.
  fetchHistoricalEod(
    ticker: string,
    assetClass: AssetClass,
    from: string,
    to: string
  ): Promise<EodPricePoint[]>;
}
