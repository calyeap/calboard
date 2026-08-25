import Decimal from "decimal.js";
import { getPool } from "../db";
import { yahooProvider } from "./yahooProvider";
import { eodhdProvider } from "./eodhdProvider";
import type { MarketDataProvider } from "./provider";
import type { AssetClass } from "../assets";

const providers: Record<string, MarketDataProvider> = {
  YAHOO: yahooProvider,
  EODHD: eodhdProvider,
};

// Default provider for this slice, per Task 7's spike result. Swap via
// MARKET_DATA_PROVIDER=EODHD in .env.local — no code change needed to fall back.
function activeProvider(): MarketDataProvider {
  const name = (process.env.MARKET_DATA_PROVIDER ?? "YAHOO").toUpperCase();
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown MARKET_DATA_PROVIDER '${name}' — expected one of: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

const CACHE_FRESHNESS_HOURS = 12;

export function isPriceCacheFresh(retrievedAt: Date, now: Date = new Date()): boolean {
  const ageHours = (now.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60);
  return ageHours < CACHE_FRESHNESS_HOURS;
}

export async function upsertLatestPrice(
  assetId: number,
  ticker: string,
  assetClass: AssetClass
): Promise<{ fromCache: boolean; provider: string }> {
  const provider = activeProvider();
  const pool = getPool();

  const sourceResult = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = $1`, [
    provider.sourceName,
  ]);
  if (sourceResult.rows.length === 0) {
    throw new Error(
      `${provider.sourceName} source row missing — was migrations/001_portfolio_core.sql applied?`
    );
  }
  const sourceId = sourceResult.rows[0].id;

  // Reuse a recent stored price instead of calling the provider again — this
  // is the free-tier protection: fetch only assets actually being
  // transacted, and only once per freshness window, regardless of provider.
  const cached = await pool.query<{ retrieved_at: string }>(
    `SELECT retrieved_at FROM prices_daily
     WHERE asset_id = $1 AND source_id = $2
     ORDER BY price_date DESC LIMIT 1`,
    [assetId, sourceId]
  );
  if (cached.rows.length > 0 && isPriceCacheFresh(new Date(cached.rows[0].retrieved_at))) {
    return { fromCache: true, provider: provider.sourceName };
  }

  const point = await provider.fetchLatestEod(ticker, assetClass);
  await pool.query(
    `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (asset_id, price_date, source_id) DO UPDATE SET
       close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, retrieved_at = now()`,
    [
      assetId,
      point.date,
      new Decimal(point.close).toFixed(10),
      new Decimal(point.adjustedClose).toFixed(10),
      sourceId,
    ]
  );
  return { fromCache: false, provider: provider.sourceName };
}
