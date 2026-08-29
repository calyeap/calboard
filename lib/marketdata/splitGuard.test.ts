import { describe, it, expect, beforeEach } from "vitest";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { matchesCommonSplitRatio, checkSplitCorruption } from "./splitGuard";

describe("matchesCommonSplitRatio", () => {
  it("matches an exact 4:1 split ratio", () => {
    expect(matchesCommonSplitRatio(4)).toBe(true);
  });

  it("matches a 10:1 split ratio (NVDA's actual June 2024 split)", () => {
    expect(matchesCommonSplitRatio(10)).toBe(true);
  });

  it("matches a 5:1 split ratio (e.g. Tesla 2020)", () => {
    expect(matchesCommonSplitRatio(5)).toBe(true);
  });

  it("matches a 7:1 split ratio (e.g. Apple 2014)", () => {
    expect(matchesCommonSplitRatio(7)).toBe(true);
  });

  it("matches a 20:1 split ratio (e.g. Amazon/Alphabet 2022)", () => {
    expect(matchesCommonSplitRatio(20)).toBe(true);
  });

  it("matches a ratio within 2% of a common split ratio", () => {
    expect(matchesCommonSplitRatio(2 * 1.015)).toBe(true); // 1.5% off 2:1
  });

  it("does not match a ratio just outside the 2% tolerance", () => {
    expect(matchesCommonSplitRatio(2 * 1.03)).toBe(false); // 3% off 2:1
  });

  it("does not match an ordinary day-to-day price move", () => {
    expect(matchesCommonSplitRatio(1.02)).toBe(false); // a normal +2% day
  });

  it("matches reverse-split ratios (e.g. 1-for-10, 1-for-4)", () => {
    expect(matchesCommonSplitRatio(0.1)).toBe(true);
    expect(matchesCommonSplitRatio(0.25)).toBe(true);
  });
});

describe("checkSplitCorruption", () => {
  beforeEach(async () => {
    const pool = getPool();
    await pool.query(
      "TRUNCATE data_quality_flags, corporate_actions, transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
    );
  });

  async function eodhdSourceId(): Promise<number> {
    const pool = getPool();
    const row = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    return row.rows[0].id;
  }

  async function linkBenchmark(assetId: string, benchmarkAssetId: string): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE assets SET benchmark_asset_id = $2 WHERE id = $1`, [assetId, benchmarkAssetId]);
  }

  async function insertBenchmarkPrice(assetId: string, date: string, close: number): Promise<void> {
    const pool = getPool();
    const sourceId = await eodhdSourceId();
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, $2, $3, $3, $4, now())`,
      [assetId, date, close, sourceId]
    );
  }

  it("flags a clear common-ratio split with no matching corporate action, when the benchmark moved normally (NVDA's real 10:1 June 2024 split, benchmark SPY)", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
    await linkBenchmark(asset.id, benchmark.id);
    await insertBenchmarkPrice(benchmark.id, "2024-06-06", 527.5);
    await insertBenchmarkPrice(benchmark.id, "2024-06-07", 529.0); // ordinary ~0.3% day

    const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

    expect(result.suspected).toBe(true);
    expect(result.outcome).toBe("possible_unrecorded_split");
    expect(result.flagged).toBe(true);

    const pool = getPool();
    const flags = await pool.query(
      `SELECT rule, severity, entity_type, entity_id FROM data_quality_flags WHERE entity_id = $1`,
      [asset.id]
    );
    expect(flags.rows).toHaveLength(1);
    expect(flags.rows[0]).toMatchObject({
      rule: "possible_unrecorded_split",
      severity: "error",
      entity_type: "asset",
      entity_id: asset.id,
    });
  });

  it("does not treat a split as unrecorded when a matching corporate action exists", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const pool = getPool();
    await pool.query(
      `INSERT INTO corporate_actions (asset_id, action_type, ex_date, ratio_num, ratio_den)
       VALUES ($1, 'split', '2024-06-07', 10, 1)`,
      [asset.id]
    );

    // Deliberately no benchmark configured — the corporate-action match short-circuits
    // before the benchmark leg is ever consulted, so this must still resolve clean.
    const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

    expect(result.suspected).toBe(true);
    expect(result.outcome).toBe("clean");
    expect(result.flagged).toBe(false);

    const flags = await pool.query(`SELECT 1 FROM data_quality_flags WHERE entity_id = $1`, [asset.id]);
    expect(flags.rows).toHaveLength(0);
  });

  it("does not falsely classify an ordinary price move as a split", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });

    // Deliberately no benchmark configured — the ratio never matches a split
    // ratio, so the benchmark leg is never reached.
    const result = await checkSplitCorruption(asset.id, "2024-06-06", 118.11, "2024-06-07", 120.47);

    expect(result.suspected).toBe(false);
    expect(result.outcome).toBe("clean");
    expect(result.flagged).toBe(false);

    const pool = getPool();
    const flags = await pool.query(`SELECT 1 FROM data_quality_flags WHERE entity_id = $1`, [asset.id]);
    expect(flags.rows).toHaveLength(0);
  });

  it("does not raise a duplicate flag for the same suspected split on re-check", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
    await linkBenchmark(asset.id, benchmark.id);
    await insertBenchmarkPrice(benchmark.id, "2024-06-06", 527.5);
    await insertBenchmarkPrice(benchmark.id, "2024-06-07", 529.0);

    await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);
    await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

    const pool = getPool();
    const flags = await pool.query(`SELECT 1 FROM data_quality_flags WHERE entity_id = $1`, [asset.id]);
    expect(flags.rows).toHaveLength(1);
  });

  describe("benchmark leg (TDD §3.1 third conjunct)", () => {
    it("does not classify a split-like move as asset-specific when the benchmark moved by a comparable split-sized ratio", async () => {
      const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
      const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
      await linkBenchmark(asset.id, benchmark.id);
      // Benchmark itself shows a ~10x ratio too (e.g. a market-wide data/feed
      // anomaly) — the asset's move is not specific to it, so no
      // possible_unrecorded_split flag should be raised.
      await insertBenchmarkPrice(benchmark.id, "2024-06-06", 5000);
      await insertBenchmarkPrice(benchmark.id, "2024-06-07", 500);

      const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

      expect(result.suspected).toBe(true);
      expect(result.outcome).toBe("clean");
      expect(result.flagged).toBe(false);

      const pool = getPool();
      const flags = await pool.query(
        `SELECT rule FROM data_quality_flags WHERE entity_id = $1`,
        [asset.id]
      );
      expect(flags.rows).toHaveLength(0);
    });

    it("blocks rather than silently passing clean when no benchmark_asset_id is configured", async () => {
      const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
      // No linkBenchmark() call — benchmark_asset_id stays NULL.

      const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

      expect(result.suspected).toBe(true);
      expect(result.outcome).toBe("benchmark_unavailable");
      expect(result.flagged).toBe(true);

      const pool = getPool();
      const flags = await pool.query(
        `SELECT rule, severity FROM data_quality_flags WHERE entity_id = $1`,
        [asset.id]
      );
      expect(flags.rows).toHaveLength(1);
      expect(flags.rows[0]).toMatchObject({ rule: "split_check_benchmark_unavailable", severity: "error" });
    });

    it("blocks rather than silently passing clean when the benchmark price is missing for either required date", async () => {
      const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
      const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
      await linkBenchmark(asset.id, benchmark.id);
      // Only T is populated — T-1 is missing.
      await insertBenchmarkPrice(benchmark.id, "2024-06-07", 529.0);

      const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

      expect(result.outcome).toBe("benchmark_unavailable");
      expect(result.flagged).toBe(true);

      const pool = getPool();
      const flags = await pool.query(
        `SELECT rule FROM data_quality_flags WHERE entity_id = $1`,
        [asset.id]
      );
      expect(flags.rows).toHaveLength(1);
      expect(flags.rows[0].rule).toBe("split_check_benchmark_unavailable");
    });

    it("uses the benchmark's raw/unadjusted close, not its adjusted close", async () => {
      const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
      const benchmark = await resolveOrCreateAsset({ symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500 ETF" });
      await linkBenchmark(asset.id, benchmark.id);
      const pool = getPool();
      const sourceId = await eodhdSourceId();
      // adj_close is fabricated to itself look like a ~10x split-sized move,
      // while the raw close (what the guard must actually read) is an
      // ordinary day. If the guard mistakenly read adj_close, it would
      // wrongly suppress the flag as "comparable move".
      await pool.query(
        `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
         VALUES ($1, '2024-06-06', 527.5, 5000, $2, now())`,
        [benchmark.id, sourceId]
      );
      await pool.query(
        `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
         VALUES ($1, '2024-06-07', 529.0, 500, $2, now())`,
        [benchmark.id, sourceId]
      );

      const result = await checkSplitCorruption(asset.id, "2024-06-06", 1210, "2024-06-07", 121);

      expect(result.outcome).toBe("possible_unrecorded_split");
      expect(result.flagged).toBe(true);
    });
  });
});
