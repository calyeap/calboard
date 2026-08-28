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

  it("applies an opening-position ADJUSTMENT directly (quantity x trusted avg cost, zero cash effect, stored as ADJUSTMENT not BUY)", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    const asset = await resolveOrCreateAsset("ZZZTEST", "equity", "Smoke Test Corp");

    const { transactionId } = await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "ADJUSTMENT",
      tradeDate: "2026-01-01", quantity: new Decimal(100), priceUsd: new Decimal(42.5),
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(0), note: "OPENING IMPORT: cutover",
    });

    const pool = getPool();
    const txnRow = await pool.query(`SELECT txn_type, cash_effect_usd FROM transactions WHERE id = $1`, [
      transactionId,
    ]);
    expect(txnRow.rows[0].txn_type).toBe("ADJUSTMENT");
    expect(new Decimal(txnRow.rows[0].cash_effect_usd).toFixed(2)).toBe("0.00");

    const posRow = await pool.query(
      `SELECT quantity, cost_basis_usd, avg_cost_usd FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [account.id, asset.id]
    );
    expect(new Decimal(posRow.rows[0].quantity).toFixed(4)).toBe("100.0000");
    expect(new Decimal(posRow.rows[0].cost_basis_usd).toFixed(2)).toBe("4250.00");
    expect(new Decimal(posRow.rows[0].avg_cost_usd).toFixed(2)).toBe("42.50");

    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("0.00"); // opening position must not touch cash
  });

  it("applies an opening-cash ADJUSTMENT directly (cash changes, no position row created)", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");

    const { transactionId } = await applyTransaction({
      accountId: account.id, assetId: null, txnType: "ADJUSTMENT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(50000), note: "OPENING IMPORT: cutover cash",
    });

    const pool = getPool();
    const txnRow = await pool.query(`SELECT txn_type, cash_effect_usd FROM transactions WHERE id = $1`, [
      transactionId,
    ]);
    expect(txnRow.rows[0].txn_type).toBe("ADJUSTMENT");
    expect(new Decimal(txnRow.rows[0].cash_effect_usd).toFixed(2)).toBe("50000.00");

    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("50000.00");

    const posRows = await pool.query(`SELECT 1 FROM positions_current WHERE account_id = $1`, [account.id]);
    expect(posRows.rows).toHaveLength(0); // no asset touched, no position row
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

  it("rejects UPDATE and DELETE on an ADJUSTMENT row too — append-only is type-agnostic", async () => {
    const account = await createAccount("Trigger Test ADJUSTMENT", null);
    const { transactionId } = await applyTransaction({
      accountId: account.id, assetId: null, txnType: "ADJUSTMENT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(100), note: "OPENING IMPORT: trigger test",
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

describe("applyTransaction with an injected client", () => {
  it("participates in the caller's transaction and rolls back together when the caller rolls back", async () => {
    const account = await createAccount("Injected Client Test", null);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyTransaction(
        {
          accountId: account.id, assetId: null, txnType: "DEPOSIT",
          tradeDate: "2026-01-01", quantity: null, priceUsd: null,
          feesUsd: new Decimal(0), grossAmountUsd: new Decimal(500), note: null,
        },
        client
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(cashRow.rows).toHaveLength(0);
    const txnRow = await pool.query(`SELECT id FROM transactions WHERE account_id = $1`, [account.id]);
    expect(txnRow.rows).toHaveLength(0);
  });

  it("omitted client still commits its own transaction as before (regression)", async () => {
    const account = await createAccount("No Injected Client Test", null);
    await applyTransaction({
      accountId: account.id, assetId: null, txnType: "DEPOSIT",
      tradeDate: "2026-01-01", quantity: null, priceUsd: null,
      feesUsd: new Decimal(0), grossAmountUsd: new Decimal(500), note: null,
    });
    const pool = getPool();
    const cashRow = await pool.query(`SELECT cash_usd FROM account_cash WHERE account_id = $1`, [account.id]);
    expect(new Decimal(cashRow.rows[0].cash_usd).toFixed(2)).toBe("500.00");
  });

  it("createAccount with an injected client rolls back with the caller's transaction", async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await createAccount("Injected Client Account", null, client);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const row = await pool.query(`SELECT id FROM accounts WHERE name = $1`, ["Injected Client Account"]);
    expect(row.rows).toHaveLength(0);
  });
});
