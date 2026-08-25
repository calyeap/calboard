import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { createAccount } from "../accounts";
import { resolveOrCreateAsset } from "../assets";
import { applyOpeningCashAdjustment, applyOpeningPositionAdjustment } from "./openingImport";
import { applyTransaction } from "./applyTransaction";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("applyOpeningCashAdjustment", () => {
  it("sets account cash to exactly the opening amount", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");

    await applyOpeningCashAdjustment({
      accountId: account.id,
      tradeDate: "2026-01-01",
      cashEffectUsd: new Decimal(50000),
      note: "OPENING IMPORT: cutover cash balance",
    });

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("50000.00");
    const txnRow = await pool.query(`SELECT txn_type FROM transactions WHERE account_id = $1`, [account.id]);
    expect(txnRow.rows[0].txn_type).toBe("ADJUSTMENT");
  });

  it("rejects a note that doesn't start with OPENING IMPORT:", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await expect(
      applyOpeningCashAdjustment({
        accountId: account.id,
        tradeDate: "2026-01-01",
        cashEffectUsd: new Decimal(50000),
        note: "cutover cash balance",
      })
    ).rejects.toThrow(/OPENING IMPORT:/);
  });

  it("rejects a missing/empty note", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await expect(
      applyOpeningCashAdjustment({
        accountId: account.id,
        tradeDate: "2026-01-01",
        cashEffectUsd: new Decimal(50000),
        note: "   ",
      })
    ).rejects.toThrow(/note is required/i);
  });

  it("rejects a malformed trade date", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await expect(
      applyOpeningCashAdjustment({
        accountId: account.id,
        tradeDate: "01/01/2026",
        cashEffectUsd: new Decimal(50000),
        note: "OPENING IMPORT: cutover cash balance",
      })
    ).rejects.toThrow(/valid YYYY-MM-DD/i);
  });
});

describe("applyOpeningPositionAdjustment", () => {
  it("sets quantity, cost basis, and average cost exactly, with zero cash effect, stored as ADJUSTMENT", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");

    const { transactionId } = await applyOpeningPositionAdjustment({
      accountId: account.id,
      assetId: asset.id,
      tradeDate: "2026-01-01",
      quantity: new Decimal(100),
      avgCostUsd: new Decimal(42.5),
      note: "OPENING IMPORT: cutover position",
    });

    const pool = getPool();
    const posRow = await pool.query(
      `SELECT quantity, cost_basis_usd, avg_cost_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );
    expect(new Decimal(posRow.rows[0].quantity).toFixed(4)).toBe("100.0000");
    expect(new Decimal(posRow.rows[0].cost_basis_usd).toFixed(2)).toBe("4250.00");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(2)).toBe("42.50");

    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("0.00");

    const txnRow = await pool.query(`SELECT txn_type FROM transactions WHERE id = $1`, [transactionId]);
    expect(txnRow.rows[0].txn_type).toBe("ADJUSTMENT");
  });

  it("rejects a non-positive quantity", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");
    await expect(
      applyOpeningPositionAdjustment({
        accountId: account.id,
        assetId: asset.id,
        tradeDate: "2026-01-01",
        quantity: new Decimal(0),
        avgCostUsd: new Decimal(42.5),
        note: "OPENING IMPORT: cutover position",
      })
    ).rejects.toThrow(/positive/i);
  });

  it("rejects a non-positive average cost", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");
    await expect(
      applyOpeningPositionAdjustment({
        accountId: account.id,
        assetId: asset.id,
        tradeDate: "2026-01-01",
        quantity: new Decimal(100),
        avgCostUsd: new Decimal(-1),
        note: "OPENING IMPORT: cutover position",
      })
    ).rejects.toThrow(/positive/i);
  });

  it("rejects a note that doesn't start with OPENING IMPORT:", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");
    await expect(
      applyOpeningPositionAdjustment({
        accountId: account.id,
        assetId: asset.id,
        tradeDate: "2026-01-01",
        quantity: new Decimal(100),
        avgCostUsd: new Decimal(42.5),
        note: "cutover position",
      })
    ).rejects.toThrow(/OPENING IMPORT:/);
  });

  it("rejects opening a position that already has a non-zero quantity on record", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");
    await applyOpeningPositionAdjustment({
      accountId: account.id,
      assetId: asset.id,
      tradeDate: "2026-01-01",
      quantity: new Decimal(100),
      avgCostUsd: new Decimal(42.5),
      note: "OPENING IMPORT: cutover position",
    });

    await expect(
      applyOpeningPositionAdjustment({
        accountId: account.id,
        assetId: asset.id,
        tradeDate: "2026-01-02",
        quantity: new Decimal(10),
        avgCostUsd: new Decimal(50),
        note: "OPENING IMPORT: second attempt",
      })
    ).rejects.toThrow(/already (has|exists)/i);

    // The first, valid opening import must be untouched by the rejected second attempt.
    const pool = getPool();
    const posRow = await pool.query(
      `SELECT quantity, avg_cost_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );
    expect(new Decimal(posRow.rows[0].quantity).toFixed(4)).toBe("100.0000");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(2)).toBe("42.50");
  });

  it("allows opening a position when a prior positions_current row exists but is fully zeroed out (e.g. a closed-out BUY/SELL history)", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");
    // Fully close out a prior position so positions_current has a real row
    // at quantity = 0, not merely the absence of a row.
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2025-06-01", quantity: new Decimal(10), priceUsd: new Decimal(10),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: "pre-cutover trade",
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "SELL",
      tradeDate: "2025-06-02", quantity: new Decimal(10), priceUsd: new Decimal(12),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: "pre-cutover trade",
    });
    const pool = getPool();
    const zeroed = await pool.query(
      `SELECT quantity FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );
    expect(new Decimal(zeroed.rows[0].quantity).eq(0)).toBe(true); // precondition: a real row exists at zero

    await applyOpeningPositionAdjustment({
      accountId: account.id,
      assetId: asset.id,
      tradeDate: "2026-01-01",
      quantity: new Decimal(100),
      avgCostUsd: new Decimal(42.5),
      note: "OPENING IMPORT: cutover position",
    });

    const posRow = await pool.query(
      `SELECT quantity, avg_cost_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );
    expect(new Decimal(posRow.rows[0].quantity).toFixed(4)).toBe("100.0000");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(2)).toBe("42.50");
  });
});
