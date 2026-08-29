import type { MarketDataProvider, EodPricePoint, InstrumentResolution } from "./provider";
import type { AssetClass } from "../assets";

export function toEodhdSymbol(ticker: string, assetClass: AssetClass): string {
  const symbol = ticker.toUpperCase();
  return assetClass === "crypto" ? `${symbol}.CC` : `${symbol}.US`;
}

interface EodhdSearchRow {
  Code: string;
  Exchange: string;
  Name: string;
  Type: string;
}

export class EodhdQuotaExceededError extends Error {
  constructor(status: number) {
    super(
      `EODHD quota exhausted (HTTP ${status}). Not retrying automatically — ` +
        `wait for the free-tier daily reset or upgrade the plan before fetching more prices.`
    );
    this.name = "EodhdQuotaExceededError";
  }
}

export const eodhdProvider: MarketDataProvider = {
  sourceName: "EODHD",
  // Resolves identity ONLY, via EODHD's /search endpoint — never touching
  // price. A quota/rate-limit response, a 5xx, or a thrown network/parse
  // error all map to "unavailable", not "unknown": a provider outage is
  // never treated as proof the symbol doesn't exist.
  async resolveInstrument(ticker: string): Promise<InstrumentResolution> {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      throw new Error("EODHD_API_KEY is not set — check .env.local");
    }
    const symbol = ticker.trim().toUpperCase();
    let res: Response;
    try {
      res = await fetch(
        `https://eodhd.com/api/search/${encodeURIComponent(symbol)}?api_token=${apiKey}&fmt=json`
      );
    } catch {
      return { outcome: "unavailable" };
    }
    if (!res.ok) {
      return { outcome: "unavailable" };
    }
    let rows: EodhdSearchRow[];
    try {
      rows = (await res.json()) as EodhdSearchRow[];
    } catch {
      return { outcome: "unavailable" };
    }
    const match = rows.find((r) => r.Code?.toUpperCase() === symbol && r.Exchange === "US");
    if (!match) {
      return { outcome: "unknown" };
    }
    if (match.Type !== "Common Stock" && match.Type !== "ETF") {
      return { outcome: "unsupported" };
    }
    if (!match.Name) {
      return { outcome: "unknown" };
    }
    return {
      outcome: "resolved",
      symbol: match.Code.toUpperCase(),
      assetClass: match.Type === "Common Stock" ? "equity" : "etf",
      name: match.Name,
    };
  },
  async fetchLatestEod(ticker: string, assetClass: AssetClass): Promise<EodPricePoint> {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      throw new Error("EODHD_API_KEY is not set — check .env.local");
    }
    const symbol = toEodhdSymbol(ticker, assetClass);
    const url = `https://eodhd.com/api/eod/${symbol}?api_token=${apiKey}&fmt=json&period=d&order=d&limit=1`;
    const res = await fetch(url);
    if (res.status === 402 || res.status === 429) {
      // Quota/rate-limit exhaustion — fail clearly and immediately. No retry
      // loop: retrying a quota error just burns more of tomorrow's allowance.
      throw new EodhdQuotaExceededError(res.status);
    }
    if (!res.ok) {
      throw new Error(`EODHD request failed: ${res.status}`);
    }
    const rows = (await res.json()) as { date: string; close: number; adjusted_close: number }[];
    if (!rows.length) {
      throw new Error(`No EOD data returned for ${symbol}`);
    }
    return { date: rows[0].date, close: rows[0].close, adjustedClose: rows[0].adjusted_close };
  },
  async fetchHistoricalEod(
    ticker: string,
    assetClass: AssetClass,
    from: string,
    to: string
  ): Promise<EodPricePoint[]> {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      throw new Error("EODHD_API_KEY is not set — check .env.local");
    }
    const symbol = toEodhdSymbol(ticker, assetClass);
    const url = `https://eodhd.com/api/eod/${symbol}?api_token=${apiKey}&fmt=json&period=d&order=d&from=${from}&to=${to}`;
    const res = await fetch(url);
    if (res.status === 402 || res.status === 429) {
      throw new EodhdQuotaExceededError(res.status);
    }
    if (!res.ok) {
      throw new Error(`EODHD request failed: ${res.status}`);
    }
    // The plain /eod endpoint returns only close/adjusted_close — no split or
    // dividend event payload to accidentally consume here.
    const rows = (await res.json()) as { date: string; close: number; adjusted_close: number }[];
    return rows.map((r) => ({ date: r.date, close: r.close, adjustedClose: r.adjusted_close }));
  },
};
