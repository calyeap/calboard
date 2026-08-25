import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { createAccount } from "../accounts";
import { resolveOrCreateAsset } from "../assets";
import { applyTransaction } from "./applyTransaction";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("applyTransaction integration", () => {
  it("derives cash and position correctly across deposit + two buys + a sell", async () => {
    const account = await createAccount("Test Brokerage", "IBKR");
    const asset = await resolveOrCreateAsset("AAPL", "equity", "Apple Inc.");

    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(10000), note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(10), priceUsd: new Decimal(100),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-03", quantity: new Decimal(10), priceUsd: new Decimal(120),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "SELL",
      tradeDate: "2026-01-04", quantity: new Decimal(5), priceUsd: new Decimal(130),
      feesUsd: new Decimal(1), grossAmountUsd: null, note: null,
    });

    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    const posRow = await pool.query(
      `SELECT quantity, cost_basis_usd, avg_cost_usd, realised_pl_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );

    // Cash: 10000 (deposit) - 1001 (buy1) - 1201 (buy2) + 649 (sell) = 8447
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("8447.00");

    // 20 bought at blended avg (1001+1201)/20 = 110.10, sell 5 -> qty 15, avg unchanged
    expect(new Decimal(posRow.rows[0].quantity).toFixed(2)).toBe("15.00");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(4)).toBe("110.1000");
  });

  it("rejects UPDATE and DELETE on transactions (append-only, AC-L5)", async () => {
    const account = await createAccount("Trigger Test", null);
    const { transactionId } = await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(100), note: null,
    });

    const pool = getPool();
    await expect(
      pool.query(`UPDATE transactions SET note = 'x' WHERE id = $1`, [transactionId])
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM transactions WHERE id = $1`, [transactionId])
    ).rejects.toThrow();
  });
});
