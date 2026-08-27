import Decimal from "decimal.js";
import { getPool } from "./db";
import type { AssetClass } from "./assets";
import { normalizePgDate } from "./dateValidation";

export type PriceStatus = "current" | "stale" | "unavailable";

// Price age is measured against the EOD price's own date (price_date), not
// when it was fetched (retrieved_at) — a 3-day-old EOD close fetched a
// minute ago is still a 3-day-old price. 5 days tolerates a normal weekend
// or market holiday without flagging an ordinary gap as stale.
const STALE_PRICE_THRESHOLD_DAYS = 5;

function daysSince(dateStr: string, today: Date): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateUtc = Date.UTC(y, m - 1, d);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((todayUtc - dateUtc) / (1000 * 60 * 60 * 24));
}

export interface PositionView {
  accountId: number;
  accountName: string;
  assetId: string;
  symbol: string;
  assetName: string;
  assetClass: AssetClass;
  quantity: Decimal;
  avgCostUsd: Decimal | null;
  costBasisUsd: Decimal;
  latestPriceUsd: Decimal | null;
  priceDate: string | null;
  priceSourceId: number | null;
  priceStatus: PriceStatus;
  marketValueUsd: Decimal | null;
  unrealisedPlUsd: Decimal | null;
}

export interface PortfolioView {
  positions: PositionView[];
  totalCashUsd: Decimal;
  totalMarketValueUsd: Decimal;
  totalPortfolioValueUsd: Decimal;
  // Symbols excluded from totalMarketValueUsd because no price row exists at
  // all yet — used to disclose that the total is a floor, not the true value
  // (spec §8). Stale-but-present prices still contribute their last-known
  // market value and are NOT in this list.
  excludedFromTotalSymbols: string[];
}

export async function getPortfolioView(asOf: Date = new Date()): Promise<PortfolioView> {
  const pool = getPool();

  const positionsResult = await pool.query(`
    SELECT
      pc.account_id, a.name AS account_name,
      pc.asset_id, ast.primary_symbol AS symbol, ast.name AS asset_name, ast.asset_class,
      pc.quantity, pc.avg_cost_usd, pc.cost_basis_usd,
      lp.close AS latest_price, lp.price_date, lp.source_id AS price_source_id
    FROM positions_current pc
    JOIN accounts a ON a.id = pc.account_id
    JOIN assets ast ON ast.id = pc.asset_id
    LEFT JOIN LATERAL (
      -- prices_daily's PK is (asset_id, price_date, source_id), so the same
      -- asset/date can hold one row per provider. price_date DESC alone is
      -- not a deterministic tiebreaker among same-date rows from different
      -- sources — break ties with retrieved_at DESC (most recently fetched
      -- wins) and surface source_id so callers can see provenance.
      SELECT close, price_date, source_id FROM prices_daily
      WHERE asset_id = pc.asset_id
      ORDER BY price_date DESC, retrieved_at DESC LIMIT 1
    ) lp ON true
    WHERE pc.quantity <> 0
    ORDER BY ast.primary_symbol
  `);

  const positions: PositionView[] = positionsResult.rows.map((row) => {
    const quantity = new Decimal(row.quantity);
    const costBasisUsd = new Decimal(row.cost_basis_usd);
    const avgCostUsd = row.avg_cost_usd ? new Decimal(row.avg_cost_usd) : null;
    const latestPriceUsd = row.latest_price ? new Decimal(row.latest_price) : null;
    const marketValueUsd = latestPriceUsd ? quantity.mul(latestPriceUsd) : null;
    const unrealisedPlUsd = marketValueUsd ? marketValueUsd.sub(costBasisUsd) : null;
    // Reuse the shared normalizePgDate helper (the app's ONE definition of
    // how a Postgres DATE becomes a plain "YYYY-MM-DD" string) — it handles
    // both the raw string lib/db.ts's global type-parser override returns
    // and a JS Date object defensively via LOCAL year/month/day components
    // (never toISOString(), which converts through UTC and can shift the
    // date by a day).
    const priceDate: string | null = row.price_date ? normalizePgDate(row.price_date) : null;

    const priceStatus: PriceStatus =
      !latestPriceUsd || !priceDate
        ? "unavailable"
        : daysSince(priceDate, asOf) > STALE_PRICE_THRESHOLD_DAYS
          ? "stale"
          : "current";

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      assetId: row.asset_id,
      symbol: row.symbol,
      assetName: row.asset_name,
      assetClass: row.asset_class,
      quantity,
      avgCostUsd,
      costBasisUsd,
      latestPriceUsd,
      priceDate,
      priceSourceId: row.price_source_id ?? null,
      priceStatus,
      marketValueUsd,
      unrealisedPlUsd,
    };
  });

  const cashResult = await pool.query(`SELECT COALESCE(SUM(cash_usd), 0) AS total FROM account_cash`);
  const totalCashUsd = new Decimal(cashResult.rows[0].total);

  const totalMarketValueUsd = positions.reduce(
    (sum, p) => (p.marketValueUsd ? sum.add(p.marketValueUsd) : sum),
    new Decimal(0)
  );

  const excludedFromTotalSymbols = positions
    .filter((p) => p.priceStatus === "unavailable")
    .map((p) => p.symbol);

  return {
    positions,
    totalCashUsd,
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalCashUsd.add(totalMarketValueUsd),
    excludedFromTotalSymbols,
  };
}
