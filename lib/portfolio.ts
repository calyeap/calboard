import Decimal from "decimal.js";
import { getPool } from "./db";

export interface PositionView {
  accountId: number;
  accountName: string;
  assetId: number;
  symbol: string;
  assetName: string;
  quantity: Decimal;
  avgCostUsd: Decimal | null;
  costBasisUsd: Decimal;
  latestPriceUsd: Decimal | null;
  priceDate: string | null;
  priceSourceId: number | null;
  marketValueUsd: Decimal | null;
  unrealisedPlUsd: Decimal | null;
}

export interface PortfolioView {
  positions: PositionView[];
  totalCashUsd: Decimal;
  totalMarketValueUsd: Decimal;
  totalPortfolioValueUsd: Decimal;
}

export async function getPortfolioView(): Promise<PortfolioView> {
  const pool = getPool();

  const positionsResult = await pool.query(`
    SELECT
      pc.account_id, a.name AS account_name,
      pc.asset_id, ast.primary_symbol AS symbol, ast.name AS asset_name,
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
    // node-postgres parses `date` columns into JS Date objects (not strings) by
    // default, but this view's contract (and app/page.tsx, which renders this
    // value directly as JSX text) is a plain ISO date string. pg constructs
    // that Date from the date's own year/month/day as LOCAL time components
    // (not UTC midnight), so we must read it back with the local getters —
    // toISOString() converts to UTC first and would shift the date by one day
    // on any machine whose local timezone is behind UTC.
    const priceDate: string | null = row.price_date
      ? row.price_date instanceof Date
        ? `${row.price_date.getFullYear()}-${String(row.price_date.getMonth() + 1).padStart(2, "0")}-${String(row.price_date.getDate()).padStart(2, "0")}`
        : String(row.price_date)
      : null;

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      assetId: row.asset_id,
      symbol: row.symbol,
      assetName: row.asset_name,
      quantity,
      avgCostUsd,
      costBasisUsd,
      latestPriceUsd,
      priceDate,
      priceSourceId: row.price_source_id ?? null,
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

  return {
    positions,
    totalCashUsd,
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalCashUsd.add(totalMarketValueUsd),
  };
}
