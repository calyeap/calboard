import { describe, it, expect, beforeEach } from "vitest";
import { getPool } from "./db";
import { resolveOrCreateAsset, findAssetBySymbol, formatAssetClass } from "./assets";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("resolveOrCreateAsset", () => {
  it("creates a new asset row from a resolved instrument, upper-cased", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "nvda", assetClass: "equity", name: "NVIDIA Corporation" });

    expect(asset.primarySymbol).toBe("NVDA");
    expect(asset.assetClass).toBe("equity");
    expect(asset.name).toBe("NVIDIA Corporation");
    expect(typeof asset.id).toBe("string");
  });

  it("creates the matching attribute row for the asset's class", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF Trust" });

    const pool = getPool();
    const attrs = await pool.query(`SELECT 1 FROM asset_attributes_etf WHERE asset_id = $1`, [asset.id]);
    expect(attrs.rows).toHaveLength(1);
  });

  it("returns the existing row for an already-known symbol instead of inserting a duplicate", async () => {
    const first = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corporation" });
    const second = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corporation" });

    expect(second.id).toBe(first.id);
    const pool = getPool();
    const rows = await pool.query(`SELECT 1 FROM assets WHERE primary_symbol = 'NVDA'`);
    expect(rows.rows).toHaveLength(1);
  });
});

describe("findAssetBySymbol", () => {
  it("returns null when no asset exists for the symbol", async () => {
    const result = await findAssetBySymbol("NOPE");
    expect(result).toBeNull();
  });

  it("finds an existing asset case-insensitively", async () => {
    const created = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corporation" });

    const found = await findAssetBySymbol("nvda");

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.primarySymbol).toBe("NVDA");
  });
});

describe("formatAssetClass", () => {
  it("formats each stored asset class as its display label", () => {
    expect(formatAssetClass("equity")).toBe("Equity");
    expect(formatAssetClass("etf")).toBe("ETF");
    expect(formatAssetClass("crypto")).toBe("Crypto");
  });
});
