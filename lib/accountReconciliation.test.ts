import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyOpeningCashAdjustment, applyOpeningPositionAdjustment } from "./ledger/openingImport";
import { recordAccountReconciliation } from "./accountReconciliation";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE account_reconciliations, transactions, positions_current, account_cash, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("recordAccountReconciliation", () => {
  it("records a reconciliation comparing broker-reported cash against Calboard's computed cash", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await applyOpeningCashAdjustment({
      accountId: account.id,
      tradeDate: "2026-01-01",
      cashEffectUsd: new Decimal(50000),
      note: "OPENING IMPORT: cutover cash",
    });

    const result = await recordAccountReconciliation({
      accountName: "Cutover Brokerage",
      asOfDate: "2026-01-01",
      brokerReportedCashUsd: new Decimal(50000),
      status: "ok",
      notes: "matches broker statement exactly",
    });

    expect(result.systemComputedCashUsd.toFixed(2)).toBe("50000.00");
    expect(result.maxDeltaPct!.toFixed(2)).toBe("0.00");

    const pool = getPool();
    const row = await pool.query(
      `SELECT account_id, as_of_date, scope, status, notes, broker_reported, system_computed FROM account_reconciliations WHERE id = $1`,
      [result.reconciliationId]
    );
    expect(row.rows[0]).toMatchObject({
      account_id: account.id,
      scope: "total",
      status: "ok",
      notes: "matches broker statement exactly",
    });
    expect(row.rows[0].broker_reported).toMatchObject({ cash_usd: "50000" });
    expect(row.rows[0].system_computed).toMatchObject({ cash_usd: "50000" });
  });

  it("includes system-computed position snapshots in the record", async () => {
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

    const result = await recordAccountReconciliation({
      accountName: "Cutover Brokerage",
      asOfDate: "2026-01-01",
      brokerReportedCashUsd: new Decimal(0),
      status: "ok",
    });

    const pool = getPool();
    const row = await pool.query(`SELECT system_computed FROM account_reconciliations WHERE id = $1`, [
      result.reconciliationId,
    ]);
    expect(row.rows[0].system_computed.positions).toEqual([
      { symbol: "ZZZTEST", quantity: "100", cost_basis_usd: "4250" },
    ]);
  });

  it("computes a non-zero max_delta_pct when broker-reported cash disagrees", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await applyOpeningCashAdjustment({
      accountId: account.id,
      tradeDate: "2026-01-01",
      cashEffectUsd: new Decimal(50000),
      note: "OPENING IMPORT: cutover cash",
    });

    const result = await recordAccountReconciliation({
      accountName: "Cutover Brokerage",
      asOfDate: "2026-01-01",
      brokerReportedCashUsd: new Decimal(50500), // broker says 500 more
      status: "investigating",
    });

    // |50000 - 50500| / 50500 * 100 ≈ 0.990099...
    expect(result.maxDeltaPct!.toFixed(2)).toBe("0.99");
  });

  it("rejects an unknown account name", async () => {
    await expect(
      recordAccountReconciliation({
        accountName: "Nonexistent Account",
        asOfDate: "2026-01-01",
        brokerReportedCashUsd: new Decimal(0),
        status: "ok",
      })
    ).rejects.toThrow(/no account found/i);
  });

  it("rejects a duplicate reconciliation for the same account/date/scope", async () => {
    const account = await createAccount("Cutover Brokerage", "Fidelity");
    await recordAccountReconciliation({
      accountName: "Cutover Brokerage",
      asOfDate: "2026-01-01",
      brokerReportedCashUsd: new Decimal(0),
      status: "ok",
    });

    await expect(
      recordAccountReconciliation({
        accountName: "Cutover Brokerage",
        asOfDate: "2026-01-01",
        brokerReportedCashUsd: new Decimal(100),
        status: "ok",
      })
    ).rejects.toThrow(/already (exists|recorded)/i);

    const pool = getPool();
    const rows = await pool.query(`SELECT 1 FROM account_reconciliations WHERE account_id = $1`, [account.id]);
    expect(rows.rows).toHaveLength(1);
  });

  it("rejects a malformed as-of date", async () => {
    await createAccount("Cutover Brokerage", "Fidelity");
    await expect(
      recordAccountReconciliation({
        accountName: "Cutover Brokerage",
        asOfDate: "not-a-date",
        brokerReportedCashUsd: new Decimal(0),
        status: "ok",
      })
    ).rejects.toThrow(/valid YYYY-MM-DD/i);
  });

  it("rejects an invalid status value", async () => {
    await createAccount("Cutover Brokerage", "Fidelity");
    await expect(
      recordAccountReconciliation({
        accountName: "Cutover Brokerage",
        asOfDate: "2026-01-01",
        brokerReportedCashUsd: new Decimal(0),
        status: "not_a_real_status" as never,
      })
    ).rejects.toThrow(/status/i);
  });
});
