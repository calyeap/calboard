import { describe, it, expect, beforeEach } from "vitest";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { recordConfirmedSplit } from "./corporateActions";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE data_quality_flags, corporate_actions, transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

async function raiseFlag(assetId: string, rule: string, detail: string): Promise<string> {
  const pool = getPool();
  const row = await pool.query<{ id: string }>(
    `INSERT INTO data_quality_flags (entity_type, entity_id, rule, severity, detail, raised_at)
     VALUES ('asset', $1, $2, 'error', $3, now()) RETURNING id`,
    [assetId, rule, detail]
  );
  return row.rows[0].id;
}

describe("recordConfirmedSplit", () => {
  it("records a valid split confirmation", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });

    const result = await recordConfirmedSplit({ ticker: "nvda", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 });

    expect(result.assetId).toBe(asset.id);
    expect(result.actionType).toBe("split");

    const pool = getPool();
    const rows = await pool.query(
      `SELECT asset_id, action_type, ex_date, ratio_num, ratio_den FROM corporate_actions WHERE id = $1`,
      [result.corporateActionId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      asset_id: asset.id,
      action_type: "split",
      ratio_num: "10.0000000000",
      ratio_den: "1.0000000000",
    });
  });

  it("classifies ratioNum < ratioDen as a reverse_split", async () => {
    await resolveOrCreateAsset({ symbol: "XYZ", assetClass: "equity", name: "Some Reverse-Split Co." });

    const result = await recordConfirmedSplit({ ticker: "XYZ", exDate: "2024-01-15", ratioNum: 1, ratioDen: 10 });

    expect(result.actionType).toBe("reverse_split");
  });

  it("rejects an ambiguous ticker (same symbol on multiple exchanges) rather than guessing", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO assets (asset_class, primary_symbol, exchange_mic, name) VALUES
       ('equity', 'DUAL', 'XNYS', 'Dual-Listed Co (NYSE)'),
       ('equity', 'DUAL', 'XLON', 'Dual-Listed Co (LSE)')`
    );

    await expect(
      recordConfirmedSplit({ ticker: "DUAL", exDate: "2024-06-07", ratioNum: 2, ratioDen: 1 })
    ).rejects.toThrow(/more than one asset/i);
  });

  it("rejects an unknown ticker rather than guessing", async () => {
    await expect(
      recordConfirmedSplit({ ticker: "NOPE", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 })
    ).rejects.toThrow(/no asset found/i);
  });

  it("rejects a malformed date", async () => {
    await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    await expect(
      recordConfirmedSplit({ ticker: "NVDA", exDate: "06/07/2024", ratioNum: 10, ratioDen: 1 })
    ).rejects.toThrow(/valid YYYY-MM-DD/i);
  });

  it("rejects a calendar-invalid date", async () => {
    await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    await expect(
      recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-02-30", ratioNum: 10, ratioDen: 1 })
    ).rejects.toThrow(/valid YYYY-MM-DD/i);
  });

  it("rejects a non-positive ratio", async () => {
    await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    await expect(
      recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: -10, ratioDen: 1 })
    ).rejects.toThrow(/positive/i);
  });

  it("rejects a 1:1 ratio (not a split)", async () => {
    await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    await expect(
      recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: 1, ratioDen: 1 })
    ).rejects.toThrow(/must differ/i);
  });

  it("resolves the matching possible_unrecorded_split flag for that asset and date", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const flagId = await raiseFlag(
      asset.id,
      "possible_unrecorded_split",
      "Unadjusted close ratio 10.0000 between 2024-06-06 (1210) and 2024-06-07 (121) matches a common split ratio; " +
        "no corporate_actions row exists for ex_date=2024-06-07."
    );

    const result = await recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 });

    expect(result.resolvedFlagIds).toEqual([flagId]);
    const pool = getPool();
    const flag = await pool.query(`SELECT resolved_at FROM data_quality_flags WHERE id = $1`, [flagId]);
    expect(flag.rows[0].resolved_at).not.toBeNull();
  });

  it("resolves a benchmark_unavailable flag for the same asset/date too", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const flagId = await raiseFlag(
      asset.id,
      "split_check_benchmark_unavailable",
      "Unadjusted close ratio 10.0000 between 2024-06-06 (1210) and 2024-06-07 (121) matches a common split ratio; " +
        "no corporate_actions row exists for ex_date=2024-06-07. Cannot evaluate the TDD §3.1 benchmark leg: " +
        "no benchmark_asset_id configured for this asset."
    );

    const result = await recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 });

    expect(result.resolvedFlagIds).toEqual([flagId]);
  });

  it("leaves unrelated flags untouched — different date, different asset, already-resolved", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    const otherAsset = await resolveOrCreateAsset({ symbol: "AAPL", assetClass: "equity", name: "Apple Inc." });

    const differentDateFlag = await raiseFlag(
      asset.id,
      "possible_unrecorded_split",
      "Unadjusted close ratio 4.0000 between 2023-01-01 (100) and 2023-01-02 (25) matches a common split ratio; " +
        "no corporate_actions row exists for ex_date=2023-01-02."
    );
    const differentAssetFlag = await raiseFlag(
      otherAsset.id,
      "possible_unrecorded_split",
      "Unadjusted close ratio 10.0000 between 2024-06-06 (1210) and 2024-06-07 (121) matches a common split ratio; " +
        "no corporate_actions row exists for ex_date=2024-06-07."
    );
    const irrelevantRuleFlag = await raiseFlag(asset.id, "some_other_rule", "unrelated data-quality issue");

    await recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 });

    const pool = getPool();
    const untouched = await pool.query<{ id: string; resolved_at: string | null }>(
      `SELECT id, resolved_at FROM data_quality_flags WHERE id = ANY($1)`,
      [[differentDateFlag, differentAssetFlag, irrelevantRuleFlag]]
    );
    for (const row of untouched.rows) {
      expect(row.resolved_at).toBeNull();
    }
  });

  it("rolls back both the flag resolution and the insert when the corporate_actions write fails (duplicate confirmation)", async () => {
    const asset = await resolveOrCreateAsset({ symbol: "NVDA", assetClass: "equity", name: "NVIDIA Corp" });
    // Simulate the split having already been confirmed by someone else a
    // moment earlier, directly at the DB layer.
    const pool = getPool();
    await pool.query(
      `INSERT INTO corporate_actions (asset_id, action_type, ex_date, ratio_num, ratio_den)
       VALUES ($1, 'split', '2024-06-07', 10, 1)`,
      [asset.id]
    );
    const flagId = await raiseFlag(
      asset.id,
      "possible_unrecorded_split",
      "Unadjusted close ratio 10.0000 between 2024-06-06 (1210) and 2024-06-07 (121) matches a common split ratio; " +
        "no corporate_actions row exists for ex_date=2024-06-07."
    );

    await expect(
      recordConfirmedSplit({ ticker: "NVDA", exDate: "2024-06-07", ratioNum: 10, ratioDen: 1 })
    ).rejects.toThrow(/already recorded/i);

    const actions = await pool.query(`SELECT 1 FROM corporate_actions WHERE asset_id = $1`, [asset.id]);
    expect(actions.rows).toHaveLength(1); // still just the pre-existing row — no duplicate

    // The flag-resolution UPDATE ran earlier in the same transaction as the
    // failed INSERT — if rollback is working, its effect must be undone too.
    const flag = await pool.query(`SELECT resolved_at FROM data_quality_flags WHERE id = $1`, [flagId]);
    expect(flag.rows[0].resolved_at).toBeNull();
  });
});
