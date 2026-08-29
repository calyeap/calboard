import YahooFinance from "yahoo-finance2";
import type { MarketDataProvider, EodPricePoint, InstrumentResolution } from "./provider";
import type { AssetClass } from "../assets";
import { lookupCrypto, UnsupportedCryptoError } from "./cryptoSymbols";

// yahoo-finance2 v4 (installed: see package.json) exports the class itself as
// the default export rather than a ready-made singleton (v2 API assumed by
// an earlier draft of this file). Instantiating here is the corrected pattern
// confirmed working against live Yahoo data in Task 7's spike
// (scripts/spike-yahoo.ts).
const yahooFinance = new YahooFinance();

// Resolve the caller's (ticker, assetClass) to the exact symbol Yahoo needs.
//
// Equities and ETFs use their bare ticker, exactly as before — Yahoo's plain
// US-ticker convention (NOW, NVDA, …) is unchanged.
//
// A cryptocurrency is NEVER looked up by its bare ticker: Yahoo lists "BTC"
// as the Grayscale Bitcoin Mini Trust ETF, not Bitcoin. It is resolved only
// through the verified crypto registry (BTC -> "BTC-USD"); anything not in
// that registry is rejected outright rather than guessed at or silently
// falling through to a colliding instrument.
function toYahooSymbol(ticker: string, assetClass: AssetClass): string {
  if (assetClass === "crypto") {
    const instrument = lookupCrypto(ticker);
    if (!instrument) {
      throw new UnsupportedCryptoError(ticker);
    }
    return instrument.yahooSymbol;
  }
  return ticker.toUpperCase();
}

export const yahooProvider: MarketDataProvider = {
  sourceName: "YAHOO",
  // Resolves identity ONLY — a canonical symbol, its EQUITY/ETF type, and a
  // display name — never touching price. Any thrown error (network failure,
  // timeout, Yahoo HTTP error, or anything unclassified) maps to
  // "unavailable", not "unknown": a provider outage is never treated as
  // proof the symbol doesn't exist.
  async resolveInstrument(ticker: string): Promise<InstrumentResolution> {
    const symbol = ticker.trim().toUpperCase();
    let result;
    try {
      result = await yahooFinance.quote(symbol);
    } catch {
      return { outcome: "unavailable" };
    }
    if (!result) {
      return { outcome: "unknown" };
    }
    if (result.quoteType !== "EQUITY" && result.quoteType !== "ETF") {
      return { outcome: "unsupported" };
    }
    const name = result.longName || result.shortName;
    if (!name) {
      return { outcome: "unknown" };
    }
    return {
      outcome: "resolved",
      symbol: (result.symbol || symbol).toUpperCase(),
      assetClass: result.quoteType === "EQUITY" ? "equity" : "etf",
      name,
    };
  },
  async fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint> {
    const symbol = toYahooSymbol(ticker, assetClass);
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = await yahooFinance.chart(symbol, {
      period1: weekAgo.toISOString().slice(0, 10),
      period2: today.toISOString().slice(0, 10),
      interval: "1d",
    });
    const quotes = result.quotes.filter((q) => q.close != null);
    if (!quotes.length) {
      throw new Error(`No EOD data returned for ${symbol} from Yahoo`);
    }
    const latest = quotes[quotes.length - 1];
    return {
      date: new Date(latest.date).toISOString().slice(0, 10),
      close: latest.close!,
      adjustedClose: latest.adjclose ?? latest.close!,
    };
  },
  async fetchHistoricalEod(
    ticker: string,
    assetClass: AssetClass,
    from: string,
    to: string
  ): Promise<EodPricePoint[]> {
    const symbol = toYahooSymbol(ticker, assetClass);
    const result = await yahooFinance.chart(symbol, { period1: from, period2: to, interval: "1d" });
    // Only result.quotes (the close-price series) is read here. Yahoo's chart
    // response can also carry result.events.splits / .dividends — those are
    // never touched by this path: raw vendor split/dividend data must not
    // write directly to transactions, cost basis, or corporate_actions.
    // Splits enter the ledger only through the reviewed corporate-action
    // entry path; this loader only ever observes their effect on price via
    // the TDD §3.1 split-corruption guard.
    return result.quotes
      .filter((q) => q.close != null)
      .map((q) => ({
        date: new Date(q.date).toISOString().slice(0, 10),
        close: q.close!,
        adjustedClose: q.adjclose ?? q.close!,
      }));
  },
};
