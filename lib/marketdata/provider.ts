import type { AssetClass } from "../assets";

export interface EodPricePoint {
  date: string; // YYYY-MM-DD
  close: number;
  adjustedClose: number;
}

export interface MarketDataProvider {
  readonly sourceName: string; // must match a row in the `sources` table
  fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint>;
}
