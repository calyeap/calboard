import Decimal from "decimal.js";
import { getPool } from "./db";
import type { AssetClass } from "./assets";
import { normalizePgDate } from "./dateValidation";
import { marketValue, roundMoney, unrealisedPl } from "./money";

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
  // The latest EOD close ROUNDED TO THE CENT — the price this app displays,
  // and the price every money figure derived from it is computed with (see
  // lib/money.ts). Prices are persisted at 6dp, so this is not always the
  // stored value; rawLatestPriceUsd keeps that.
  latestPriceUsd: Decimal | null;
  // The close exactly as persisted (6dp). Provenance only — it lets a price
  // refresh tell whether the provider actually returned a different number,
  // at full stored precision. Never multiply money by this; use latestPriceUsd.
  rawLatestPriceUsd: Decimal | null;
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
  // Aggregate current unrealized gain/loss vs cost basis — V1's entire
  // "performance" surface (spec §9.1); no MWR/TWR/IRR, no return series.
  // Sum of (latestPrice − avgCost) × quantity over every position that has
  // BOTH a usable latest price and an avg cost (stale prices still count;
  // only price-unavailable positions are left out). The percentage is that
  // sum over the summed avg-cost basis (avgCost × quantity) for the same
  // positions, or null when nothing qualifies (zero denominator).
  totalUnrealisedPlUsd: Decimal;
  totalUnrealisedPlPct: Decimal | null;
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
    const rawLatestPriceUsd = row.latest_price ? new Decimal(row.latest_price) : null;
    // Round the price to the cent ONCE, here, before anything multiplies by
    // it. Both routes display this price, so both must compute from it —
    // otherwise price × quantity does not reconcile with the market value
    // printed on the same row. See lib/money.ts.
    const latestPriceUsd = rawLatestPriceUsd ? roundMoney(rawLatestPriceUsd) : null;
    const marketValueUsd = latestPriceUsd ? marketValue(quantity, latestPriceUsd) : null;
    const unrealisedPlUsd = marketValueUsd ? roundMoney(marketValueUsd.sub(costBasisUsd)) : null;
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
      rawLatestPriceUsd,
      priceDate,
      priceSourceId: row.price_source_id ?? null,
      priceStatus,
      marketValueUsd,
      unrealisedPlUsd,
    };
  });

  const cashResult = await pool.query(`SELECT COALESCE(SUM(cash_usd), 0) AS total FROM account_cash`);
  const totalCashUsd = new Decimal(cashResult.rows[0].total);

  // The sum of the ROUNDED per-row market values, so the headline figure is
  // exactly what the rows printed underneath it add up to (DESIGN.md: "a
  // detail row and its aggregate are computed and formatted identically").
  const totalMarketValueUsd = positions.reduce(
    (sum, p) => (p.marketValueUsd ? sum.add(p.marketValueUsd) : sum),
    new Decimal(0)
  );

  const excludedFromTotalSymbols = positions
    .filter((p) => p.priceStatus === "unavailable")
    .map((p) => p.symbol);

  // Aggregate unrealized gain/loss vs cost basis (spec §9.1). One formula,
  // (latestPrice − avgCost) × quantity, used here and per-row on the
  // Dashboard. Only positions with both a usable price and an avg cost
  // contribute — a price-unavailable position is left out of numerator and
  // denominator alike, so the percentage is not diluted by holdings we
  // can't value yet.
  let totalUnrealisedPlUsd = new Decimal(0);
  let aggregateCostBasisUsd = new Decimal(0);
  for (const p of positions) {
    if (p.latestPriceUsd && p.avgCostUsd) {
      // The same one formula, rounded the same way, that both routes print
      // per row — so this aggregate is the sum of the visible row figures.
      totalUnrealisedPlUsd = totalUnrealisedPlUsd.add(
        unrealisedPl(p.quantity, p.latestPriceUsd, p.avgCostUsd)
      );
      aggregateCostBasisUsd = aggregateCostBasisUsd.add(p.avgCostUsd.mul(p.quantity));
    }
  }
  const totalUnrealisedPlPct = aggregateCostBasisUsd.isZero()
    ? null
    : totalUnrealisedPlUsd.div(aggregateCostBasisUsd).mul(100);

  return {
    positions,
    totalCashUsd,
    totalMarketValueUsd,
    totalPortfolioValueUsd: totalCashUsd.add(totalMarketValueUsd),
    excludedFromTotalSymbols,
    totalUnrealisedPlUsd,
    totalUnrealisedPlPct,
  };
}
