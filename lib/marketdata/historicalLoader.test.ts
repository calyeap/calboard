import { describe, it, expect, beforeEach } from "vitest";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { loadHistoricalPrices } from "./historicalLoader";
import type { MarketDataProvider, EodPricePoint } from "./provider";

function fakeProvider(sourceName: string, points: EodPricePoint[]): MarketDataProvider {
  return {
    sourceName,
    async resolveInstrument() {
      throw new Error("fakeProvider.resolveInstrument is not used by loadHistoricalPrices");
    },
    async fetchLatestEod() {
      return points[points.length - 1];
    },
    async fetchHistoricalEod() {
      return points;
    },
  };
}

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE data_quality_flags, corporate_actions, transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("loadHistoricalPrices", () => {
  it("idempotently upserts only the requested asset/date history into prices_daily", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "AAPL", assetClass: "equity", name: "Apple Inc." });
    const provider = fakeProvider("EODHD", [
      { date: "2026-01-05", close: 118.11, adjustedClose: 118.11 },
      { date: "2026-01-06", close: 120.47, adjustedClose: 120.47 },
      { date: "2026-01-07", close: 121.0, adjustedClose: 121.0 },
    ]);

    const first = await loadHistoricalPrices(provider, asset.id, "AAPL", "equity", "2026-01-05", "2026-01-07");
    const second = await loadHistoricalPrices(provider, asset.id, "AAPL", "equity", "2026-01-05", "2026-01-07");

    expect(first.pointsLoaded).toBe(3);
    expect(second.pointsLoaded).toBe(3);

    const pool = getPool();
    const rows = await pool.query(
      `SELECT price_date, close FROM prices_daily WHERE asset_id = $1 ORDER BY price_date`,
      [asset.id]
    );
    expect(rows.rows).toHaveLength(3); // no duplicates from the second run
    expect(rows.rows.map((r) => r.close)).toEqual(["118.1100000000", "120.4700000000", "121.0000000000"]);
  });

  it("works identically with any conforming provider — the loader is not coupled to a specific vendor", async () => {
    const points: EodPricePoint[] = [
      { date: "2026-01-05", close: 118.11, adjustedClose: 118.11 },
      { date: "2026-01-06", close: 120.47, adjustedClose: 120.47 },
    ];
    const assetA = await resolveOrCreateAsset({ symbol: "AAPL", assetClass: "equity", name: "Apple Inc." });
    const assetB = await resolveOrCreateAsset({ symbol: "MSFT", assetClass: "equity", name: "Microsoft Corp." });

    const eodhd = fakeProvider("EODHD", points);
    const yahoo = fakeProvider("YAHOO", points);

    const resultA = await loadHistoricalPrices(eodhd, assetA.id, "AAPL", "equity", "2026-01-05", "2026-01-06");
    const resultB = await loadHistoricalPrices(yahoo, assetB.id, "MSFT", "equity", "2026-01-05", "2026-01-06");

    expect(resultA.pointsLoaded).toBe(2);
    expect(resultB.pointsLoaded).toBe(2);

    const pool = getPool();
    const sources = await pool.query<{ name: string }>(
      `SELECT s.name FROM prices_daily p JOIN sources s ON s.id = p.source_id
       WHERE p.asset_id = ANY($1) GROUP BY s.name ORDER BY s.name`,
      [[assetA.id, assetB.id]]
    );
    expect(sources.rows.map((r) => r.name)).toEqual(["EODHD", "YAHOO"]);
  });

  it("detects and flags an unrecorded split encountered during ingestion (NVDA's real June 2024 10:1 ratio, benchmark moved normally)", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
    const pool = getPool();
    await pool.query(`UPDATE assets SET benchmark_asset_id = $2 WHERE id = $1`, [asset.id, benchmark.id]);
    const sourceId = (await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`)).rows[0].id;
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, '2024-06-06', 527.5, 527.5, $2, now()), ($1, '2024-06-07', 529.0, 529.0, $2, now())`,
      [benchmark.id, sourceId]
    );
    const provider = fakeProvider("EODHD", [
      { date: "2024-06-05", close: 1200, adjustedClose: 1200 },
      { date: "2024-06-06", close: 1210, adjustedClose: 1210 },
      { date: "2024-06-07", close: 121, adjustedClose: 121 }, // ~10:1, unrecorded
    ]);

    const result = await loadHistoricalPrices(provider, asset.id, "NVDA", "equity", "2024-06-05", "2024-06-07");

    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ date: "2024-06-07", outcome: "possible_unrecorded_split" });

    const flags = await pool.query(
      `SELECT rule, severity FROM data_quality_flags WHERE entity_id = $1`,
      [asset.id]
    );
    expect(flags.rows).toHaveLength(1);
    expect(flags.rows[0]).toMatchObject({ rule: "possible_unrecorded_split", severity: "error" });
  });

  it("does not silently pass a suspected split as clean when the asset has no benchmark configured", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    // No benchmark_asset_id set.
    const provider = fakeProvider("EODHD", [
      { date: "2024-06-06", close: 1210, adjustedClose: 1210 },
      { date: "2024-06-07", close: 121, adjustedClose: 121 },
    ]);

    const result = await loadHistoricalPrices(provider, asset.id, "NVDA", "equity", "2024-06-06", "2024-06-07");

    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ date: "2024-06-07", outcome: "benchmark_unavailable" });

    const pool = getPool();
    const flags = await pool.query(`SELECT rule FROM data_quality_flags WHERE entity_id = $1`, [asset.id]);
    expect(flags.rows).toHaveLength(1);
    expect(flags.rows[0].rule).toBe("split_check_benchmark_unavailable");
  });

  it("does not flag a split that has a matching corporate_actions row", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const pool = getPool();
    await pool.query(
      `INSERT INTO corporate_actions (asset_id, action_type, ex_date, ratio_num, ratio_den)
       VALUES ($1, 'split', '2024-06-07', 10, 1)`,
      [asset.id]
    );
    const provider = fakeProvider("EODHD", [
      { date: "2024-06-06", close: 1210, adjustedClose: 1210 },
      { date: "2024-06-07", close: 121, adjustedClose: 121 },
    ]);

    const result = await loadHistoricalPrices(provider, asset.id, "NVDA", "equity", "2024-06-06", "2024-06-07");

    expect(result.flags).toHaveLength(0);
    const flags = await pool.query(`SELECT 1 FROM data_quality_flags WHERE entity_id = $1`, [asset.id]);
    expect(flags.rows).toHaveLength(0);
  });
});
