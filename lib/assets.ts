import { getPool } from "./db";

export type AssetClass = "equity" | "etf" | "crypto";

export interface Asset {
  id: string; // BIGINT — node-postgres returns int8 as string, never Number
  assetClass: AssetClass;
  primarySymbol: string;
  name: string;
}

// attributeTable is chosen from a fixed 3-value hardcoded set below, never
// from external input, so string interpolation here is not a SQL-injection risk.
export async function resolveOrCreateAsset(
  ticker: string,
  assetClass: AssetClass,
  name: string
): Promise<Asset> {
  const pool = getPool();
  const symbol = ticker.toUpperCase();

  const existing = await pool.query<{
    id: string; asset_class: AssetClass; primary_symbol: string; name: string;
  }>(
    `SELECT id, asset_class, primary_symbol, name FROM assets WHERE primary_symbol = $1`,
    [symbol]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return { id: row.id, assetClass: row.asset_class, primarySymbol: row.primary_symbol, name: row.name };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO assets (asset_class, primary_symbol, name) VALUES ($1, $2, $3) RETURNING id`,
      [assetClass, symbol, name]
    );
    const assetId = inserted.rows[0].id;

    const attributeTable: Record<AssetClass, string> = {
      equity: "asset_attributes_equity",
      etf: "asset_attributes_etf",
      crypto: "asset_attributes_crypto",
    };
    await client.query(`INSERT INTO ${attributeTable[assetClass]} (asset_id) VALUES ($1)`, [assetId]);

    await client.query("COMMIT");
    return { id: assetId, assetClass, primarySymbol: symbol, name };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
