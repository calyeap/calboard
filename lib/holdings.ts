import Decimal from "decimal.js";
import { getPool } from "./db";
import type { AssetClass } from "./assets";

export interface AccountHolding {
  assetId: string; // BIGINT — node-postgres returns int8 as string, never Number
  symbol: string;
  assetClass: AssetClass;
  quantity: Decimal;
}

// The whole portfolio's current holdings (V1 has one hidden account, so
// there is no source/broker column). Feeds the Dashboard table, the
// /holdings pre-filled editor, and updateHoldingsAction's current-state read.
const HOLDINGS_SELECT = `
  SELECT pc.asset_id, a.primary_symbol AS symbol, a.asset_class, pc.quantity
  FROM positions_current pc
  JOIN assets a ON a.id = pc.asset_id
  WHERE pc.quantity <> 0
`;

function mapHoldingRows(
  rows: { asset_id: string; symbol: string; asset_class: AssetClass; quantity: string }[]
): AccountHolding[] {
  return rows.map((r) => ({
    assetId: r.asset_id,
    symbol: r.symbol,
    assetClass: r.asset_class,
    quantity: new Decimal(r.quantity),
  }));
}

export async function getAccountHoldings(accountId: number): Promise<AccountHolding[]> {
  const pool = getPool();
  const result = await pool.query(
    `${HOLDINGS_SELECT} AND pc.account_id = $1 ORDER BY a.primary_symbol`,
    [accountId]
  );
  return mapHoldingRows(result.rows);
}

export async function getAllHoldings(): Promise<AccountHolding[]> {
  const pool = getPool();
  const result = await pool.query(`${HOLDINGS_SELECT} ORDER BY a.primary_symbol`);
  return mapHoldingRows(result.rows);
}

// "Holdings last updated" (spec §5, model rule 10): the confirmation time of
// the last successful Save — the latest audit_log snapshot_confirm row's
// `at`. `at` is the moment the user pressed Save; `asOfDate` is the date the
// entered figures represent (optional secondary detail). null when the
// portfolio has never been saved. Read-only.
export async function getLastSnapshotConfirmation(
  accountId: number
): Promise<{ confirmedAt: Date; asOfDate: string } | null> {
  const pool = getPool();
  const result = await pool.query<{ at: Date; as_of_date: string | null }>(
    `SELECT at, after->>'as_of_date' AS as_of_date
     FROM audit_log
     WHERE action = 'snapshot_confirm' AND row_id = $1
     ORDER BY at DESC
     LIMIT 1`,
    [accountId]
  );
  if (result.rows.length === 0) return null;
  return {
    confirmedAt: new Date(result.rows[0].at),
    asOfDate: result.rows[0].as_of_date ?? "",
  };
}
