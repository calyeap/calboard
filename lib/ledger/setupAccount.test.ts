import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "../db";
import { resolveOrCreateAsset } from "../assets";
import { setupAccount, SetupCommitUncertainError } from "./setupAccount";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("setupAccount", () => {
  it("atomically creates the account, every holding, and exactly one audit_log snapshot_confirm row — with no cash and no reconciliation", async () => {
    const a = await resolveOrCreateAsset({ symbol: "SETA", assetClass: "equity", name: "Setup A Corp" });
    const b = await resolveOrCreateAsset({ symbol: "SETB", assetClass: "etf", name: "Setup B ETF" });

    const result = await setupAccount({
      name: "My Portfolio",
      custodian: null,
      asOfDate: "2026-01-15",
      holdings: [
        { assetId: a.id, quantity: new Decimal(10), avgCostUsd: new Decimal(100) },
        { assetId: b.id, quantity: new Decimal(5), avgCostUsd: new Decimal(200) },
      ],
    });

    expect(typeof result.accountId).toBe("number");
    expect(result.holdingTransactionIds).toHaveLength(2);

    const pool = getPool();

    const acct = await pool.query<{ name: string; custodian: string | null }>(
      `SELECT name, custodian FROM accounts WHERE id = $1`,
      [result.accountId]
    );
    expect(acct.rows).toHaveLength(1);
    expect(acct.rows[0].name).toBe("My Portfolio");
    expect(acct.rows[0].custodian).toBeNull();

    const positions = await pool.query<{ asset_id: string; quantity: string; avg_cost_usd: string; cost_basis_usd: string }>(
      `SELECT asset_id, quantity, avg_cost_usd, cost_basis_usd FROM positions_current WHERE account_id = $1 ORDER BY asset_id`,
      [result.accountId]
    );
    expect(positions.rows).toHaveLength(2);
    const byAsset = new Map(positions.rows.map((r) => [r.asset_id, r]));
    expect(new Decimal(byAsset.get(a.id)!.quantity).toFixed(2)).toBe("10.00");
    expect(new Decimal(byAsset.get(a.id)!.avg_cost_usd).toFixed(2)).toBe("100.00");
    expect(new Decimal(byAsset.get(a.id)!.cost_basis_usd).toFixed(2)).toBe("1000.00");
    expect(new Decimal(byAsset.get(b.id)!.quantity).toFixed(2)).toBe("5.00");
    expect(new Decimal(byAsset.get(b.id)!.avg_cost_usd).toFixed(2)).toBe("200.00");

    const audit = await pool.query<{
      action: string; actor: string; table_name: string; row_id: string; before: unknown; as_of_date: string; at: Date;
    }>(
      `SELECT action, actor, table_name, row_id, before, after->>'as_of_date' AS as_of_date, at
       FROM audit_log WHERE action = 'snapshot_confirm'`
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("snapshot_confirm");
    expect(audit.rows[0].actor).toBe("user");
    expect(audit.rows[0].table_name).toBe("accounts");
    expect(Number(audit.rows[0].row_id)).toBe(result.accountId);
    expect(audit.rows[0].before).toBeNull();
    // The as-of date the figures represent — stored separately in the payload.
    expect(audit.rows[0].as_of_date).toBe("2026-01-15");
    // The confirmation TIMESTAMP — distinct from the as-of date; a real, recent instant.
    expect(audit.rows[0].at).toBeInstanceOf(Date);
    expect(Date.now() - new Date(audit.rows[0].at).getTime()).toBeLessThan(60_000);

    // No user-facing cash. applyTransaction always recomputes the derived
    // account_cash balance, but every opening-position ADJUSTMENT carries
    // cash_effect 0 — so the derived balance is exactly zero, and there is
    // no cash-only (asset_id IS NULL) transaction of any kind.
    const cash = await pool.query<{ cash_usd: string }>(
      `SELECT cash_usd FROM account_cash WHERE account_id = $1`,
      [result.accountId]
    );
    if (cash.rows.length > 0) {
      expect(new Decimal(cash.rows[0].cash_usd).toFixed(2)).toBe("0.00");
    }
    expect(
      (await pool.query(`SELECT 1 FROM transactions WHERE account_id = $1 AND asset_id IS NULL`, [result.accountId])).rows
    ).toHaveLength(0);
    // account_reconciliations must not be misused for the confirmation record.
    expect(
      (await pool.query(`SELECT 1 FROM account_reconciliations WHERE account_id = $1`, [result.accountId])).rows
    ).toHaveLength(0);
  });

  it("rolls back the entire setup — account, the earlier holding, and any audit row — when a later holding is invalid", async () => {
    const a = await resolveOrCreateAsset({ symbol: "ROLLBK", assetClass: "equity", name: "Rollback Corp" });

    await expect(
      setupAccount({
        name: "My Portfolio",
        custodian: null,
        asOfDate: "2026-01-15",
        holdings: [
          { assetId: a.id, quantity: new Decimal(10), avgCostUsd: new Decimal(100) }, // valid, written first
          { assetId: a.id, quantity: new Decimal(-1), avgCostUsd: new Decimal(50) }, // invalid → throws
        ],
      })
    ).rejects.toThrow(/quantity must be positive/i);

    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM accounts`)).rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM positions_current`)).rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM transactions`)).rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM audit_log WHERE action = 'snapshot_confirm'`)).rows).toHaveLength(0);
  });

  it("never lets a failing ROLLBACK mask the original pre-COMMIT error", async () => {
    const pool = getPool();
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN") return { rows: [] };
        if (/INSERT INTO accounts/i.test(sql)) return { rows: [{ id: 1, name: "My Portfolio", custodian: null }] };
        if (sql === "ROLLBACK") throw new Error("rollback also failed");
        throw new Error("original pre-commit failure");
      }),
      release: vi.fn(),
    };
    const connectSpy = vi.spyOn(pool, "connect").mockResolvedValueOnce(fakeClient as never);
    try {
      const err = (await setupAccount({
        name: "My Portfolio",
        custodian: null,
        asOfDate: "2026-01-15",
        holdings: [],
      }).catch((e) => e)) as Error & { rollbackError?: unknown };

      expect(err.message).toBe("original pre-commit failure");
      expect(err).not.toBeInstanceOf(SetupCommitUncertainError);
      expect(fakeClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect((err.rollbackError as Error).message).toBe("rollback also failed");
      expect(fakeClient.release).toHaveBeenCalledTimes(1);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it("throws SetupCommitUncertainError (wrapping the cause) and does NOT attempt ROLLBACK when COMMIT itself fails", async () => {
    const pool = getPool();
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN") return { rows: [] };
        if (/INSERT INTO accounts/i.test(sql)) return { rows: [{ id: 1, name: "My Portfolio", custodian: null }] };
        if (/INSERT INTO audit_log/i.test(sql)) return { rows: [] };
        if (sql === "COMMIT") throw new Error("connection reset during commit");
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const connectSpy = vi.spyOn(pool, "connect").mockResolvedValueOnce(fakeClient as never);
    try {
      const err = (await setupAccount({
        name: "My Portfolio",
        custodian: null,
        asOfDate: "2026-01-15",
        holdings: [],
      }).catch((e) => e)) as SetupCommitUncertainError;

      expect(err).toBeInstanceOf(SetupCommitUncertainError);
      expect(err.commitError).toBeInstanceOf(Error);
      expect((err.commitError as Error).message).toMatch(/connection reset/i);
      expect(fakeClient.query).not.toHaveBeenCalledWith("ROLLBACK");
      expect(fakeClient.release).toHaveBeenCalledTimes(1);
    } finally {
      connectSpy.mockRestore();
    }
  });
});
