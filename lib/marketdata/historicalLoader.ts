import Decimal from "decimal.js";
import { getPool } from "../db";
import type { AssetClass } from "../assets";
import type { MarketDataProvider } from "./provider";
import { checkSplitCorruption } from "./splitGuard";

export interface HistoricalLoadResult {
  pointsLoaded: number;
  // Non-empty means this range must not be treated as clean — either a
  // suspected unrecorded split (outcome "possible_unrecorded_split") or a
  // suspected split that couldn't be checked against a benchmark at all
  // (outcome "benchmark_unavailable"). Both require attention before the
  // range is trusted for backfill.
  flags: Array<{ date: string; ratio: number; outcome: "possible_unrecorded_split" | "benchmark_unavailable" }>;
}

// Backfill entry point for Phase B. Depends only on the MarketDataProvider
// interface — never imports a concrete adapter — so portfolio/backfill code
// stays swappable between vendors via whichever provider the caller passes.
//
// Runs the TDD §3.1 split-corruption rule synchronously against every
// consecutive pair of unadjusted closes as they're ingested, before the
// range is considered trusted for backfill. This is the inline replacement
// for the (still-deferred) nightly `split_guard` job.
export async function loadHistoricalPrices(
  provider: MarketDataProvider,
  assetId: string,
  ticker: string,
  assetClass: AssetClass,
  from: string,
  to: string
): Promise<HistoricalLoadResult> {
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

  const points = (await provider.fetchHistoricalEod(ticker, assetClass, from, to))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  // Seed the T-1 baseline from whatever's already stored just before this
  // range, so a split landing on the very first day of a backfill batch is
  // still caught rather than silently skipped for lack of a prior point.
  const priorRow = await pool.query<{ price_date: string; close: string }>(
    `SELECT price_date, close FROM prices_daily
     WHERE asset_id = $1 AND source_id = $2 AND price_date < $3
     ORDER BY price_date DESC LIMIT 1`,
    [assetId, sourceId, from]
  );
  let prevDate: string | null = priorRow.rows[0]?.price_date ?? null;
  let prevClose: number | null = priorRow.rows[0] ? Number(priorRow.rows[0].close) : null;

  const flags: HistoricalLoadResult["flags"] = [];

  for (const point of points) {
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (asset_id, price_date, source_id) DO UPDATE SET
         close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, retrieved_at = now()`,
      [
        assetId,
        point.date,
        new Decimal(point.close).toDecimalPlaces(6).toFixed(10),
        new Decimal(point.adjustedClose).toDecimalPlaces(6).toFixed(10),
        sourceId,
      ]
    );

    if (prevClose !== null && prevDate !== null) {
      const check = await checkSplitCorruption(assetId, prevDate, prevClose, point.date, point.close);
      if (check.flagged && check.outcome !== "clean") {
        flags.push({ date: point.date, ratio: check.ratio, outcome: check.outcome });
      }
    }

    prevDate = point.date;
    prevClose = point.close; // unadjusted, per TDD §3.1
  }

  return { pointsLoaded: points.length, flags };
}
