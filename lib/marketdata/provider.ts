import type { AssetClass } from "../assets";

export interface EodPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
  adjustedClose: number;
}

export interface MarketDataProvider {
  readonly sourceName: string; // must match a row in the `sources` table
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
