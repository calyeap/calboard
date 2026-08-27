import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset } from "@/lib/assets";
import { resolveTickerAction } from "./setup";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("resolveTickerAction", () => {
  const originalProvider = process.env.MARKET_DATA_PROVIDER;
  beforeEach(() => {
    process.env.MARKET_DATA_PROVIDER = "YAHOO";
  });
  afterEach(() => {
    if (originalProvider === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = originalProvider;
  });

  it("resolves from a fresh cached price without a live provider call", async () => {
    const asset = await resolveOrCreateAsset("CACHED", "equity", "Cached Corp");
    const pool = getPool();
    const source = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'YAHOO'`);
    // A fresh prices_daily row makes upsertLatestPrice hit its cache
    // short-circuit — no provider.fetchLatestEod call. (If it *did* fall
    // through, a live fetch for the bogus ticker "CACHED" would fail and
    // the action would return ok:false — so ok:true also proves the cache
    // path was taken.)
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, CURRENT_DATE, 42.5, 42.5, $2, now())`,
      [asset.id, source.rows[0].id]
    );

    const result = await resolveTickerAction("cached", "equity");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetId).toBe(asset.id);
      expect(result.assetClass).toBe("equity");
      expect(result.priceUsd).toBe("42.50");
      expect(result.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("rejects an empty ticker with a friendly message and creates no asset", async () => {
    const result = await resolveTickerAction("   ", "equity");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.assetId).toBeNull();
      expect(result.message).toMatch(/enter a ticker/i);
    }

    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM assets`)).rows).toHaveLength(0);
  });
});
