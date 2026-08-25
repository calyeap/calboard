import YahooFinance from "yahoo-finance2";
import type { MarketDataProvider, EodPricePoint } from "./provider";

// yahoo-finance2 v4 (installed: see package.json) exports the class itself as
// the default export rather than a ready-made singleton (v2 API assumed by
// an earlier draft of this file). Instantiating here is the corrected pattern
// confirmed working against live Yahoo data in Task 7's spike
// (scripts/spike-yahoo.ts).
const yahooFinance = new YahooFinance();

export const yahooProvider: MarketDataProvider = {
  sourceName: "YAHOO",
  async fetchLatestEod(ticker: string): Promise<EodPricePoint> {
    // Yahoo's own symbol conventions already match plain US tickers and
    // "BTC-USD"-style crypto pairs — confirmed in the Task 7 spike, so no
    // per-asset-class suffix mapping is needed here (unlike EODHD).
    const symbol = ticker.toUpperCase();
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
  async fetchHistoricalEod(ticker: string, _assetClass, from: string, to: string): Promise<EodPricePoint[]> {
    const symbol = ticker.toUpperCase();
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
