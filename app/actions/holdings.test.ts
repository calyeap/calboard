import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset } from "@/lib/assets";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { getAccountHoldings } from "@/lib/holdings";
import { updateHoldingsAction } from "./holdings";

// revalidatePath is request-scoped with nothing to invalidate in a bare
// test process — stub it so the action's own logic is what's under test.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

// Seed a position at an exact quantity/avg cost via a raw ADJUSTMENT (the
// absolute setter) — mirrors what the wizard's first write produces.
async function seedPosition(accountId: number, assetId: string, quantity: string, avgCostUsd: string) {
  await applyTransaction({
    accountId,
    assetId,
    txnType: "ADJUSTMENT",
    tradeDate: "2026-01-01",
    quantity: new Decimal(quantity),
    priceUsd: new Decimal(avgCostUsd),
    feesUsd: new Decimal(0),
    grossAmountUsd: new Decimal(0),
    note: "OPENING IMPORT: seed",
  });
}

async function snapshotRows(accountId: number) {
  const pool = getPool();
  return (
    await pool.query<{ as_of_date: string; at: Date }>(
      `SELECT after->>'as_of_date' AS as_of_date, at FROM audit_log
       WHERE action = 'snapshot_confirm' AND row_id = $1`,
      [accountId]
    )
  ).rows;
}

async function snapshotUpdateTxns(accountId: number) {
  const pool = getPool();
  return (
    await pool.query<{ txn_type: string; note: string }>(
      `SELECT txn_type, note FROM transactions
       WHERE account_id = $1 AND note LIKE 'SNAPSHOT UPDATE:%'`,
      [accountId]
    )
  ).rows;
}

async function position(accountId: number, assetId: string) {
  const pool = getPool();
  return (
    await pool.query<{ quantity: string; cost_basis_usd: string; avg_cost_usd: string | null }>(
      `SELECT quantity, cost_basis_usd, avg_cost_usd FROM positions_current
       WHERE account_id = $1 AND asset_id = $2`,
      [accountId, assetId]
    )
  ).rows[0];
}

describe("updateHoldingsAction", () => {
  it("rejects a future as-of date with a structured error and writes nothing", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2099-01-01",
      holdings: [{ assetId: a.id, quantity: "25", avgCostUsd: "100" }],
    });

    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.errors.asOfDate).toMatch(/future/i);
    expect(await snapshotRows(account.id)).toHaveLength(0);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(0);
    expect((await position(account.id, a.id)).quantity).toMatch(/^10\.0+$/);
  });

  it("returns structured per-field errors for a non-numeric quantity / non-positive avg cost, writing nothing", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    const b = await resolveOrCreateAsset("BBB", "equity", "B Corp");
    await seedPosition(account.id, a.id, "10", "100");
    await seedPosition(account.id, b.id, "5", "40");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [
        { assetId: a.id, quantity: "abc", avgCostUsd: "100" },
        { assetId: b.id, quantity: "5", avgCostUsd: "0" },
      ],
    });

    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.errors["holdings.0.quantity"]).toBeDefined();
      expect(res.errors["holdings.1.avgCostUsd"]).toBeDefined();
    }
    expect(await snapshotRows(account.id)).toHaveLength(0);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(0);
  });

  it("a quantity increase writes exactly one ADJUSTMENT and reaches the exact target", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [{ assetId: a.id, quantity: "25", avgCostUsd: "100" }],
    });

    expect(res.ok).toBe(true);
    const txns = await snapshotUpdateTxns(account.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].txn_type).toBe("ADJUSTMENT");
    expect(txns[0].note).toBe("SNAPSHOT UPDATE: 2026-02-01");

    const pos = await position(account.id, a.id);
    expect(new Decimal(pos.quantity).toFixed(2)).toBe("25.00");
    expect(new Decimal(pos.cost_basis_usd).toFixed(2)).toBe("2500.00"); // 25 * 100
    expect(new Decimal(pos.avg_cost_usd!).toFixed(2)).toBe("100.00");
  });

  it("a simultaneous quantity + avg-cost change reaches the exact target in one row", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [{ assetId: a.id, quantity: "12", avgCostUsd: "110" }],
    });

    expect(res.ok).toBe(true);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(1);
    const pos = await position(account.id, a.id);
    expect(new Decimal(pos.quantity).toFixed(2)).toBe("12.00");
    expect(new Decimal(pos.cost_basis_usd).toFixed(2)).toBe("1320.00"); // 12 * 110
    expect(new Decimal(pos.avg_cost_usd!).toFixed(2)).toBe("110.00");
  });

  it("an avg-cost-only edit writes one row and leaves the quantity unchanged", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [{ assetId: a.id, quantity: "10", avgCostUsd: "130" }],
    });

    expect(res.ok).toBe(true);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(1);
    const pos = await position(account.id, a.id);
    expect(new Decimal(pos.quantity).toFixed(2)).toBe("10.00");
    expect(new Decimal(pos.avg_cost_usd!).toFixed(2)).toBe("130.00");
    expect(new Decimal(pos.cost_basis_usd).toFixed(2)).toBe("1300.00");
  });

  it("a removed holding is set to quantity 0 and drops out of getAccountHoldings", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    const b = await resolveOrCreateAsset("BBB", "equity", "B Corp");
    await seedPosition(account.id, a.id, "10", "100");
    await seedPosition(account.id, b.id, "5", "40");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [{ assetId: a.id, quantity: "10", avgCostUsd: "100" }], // BBB dropped
    });

    expect(res.ok).toBe(true);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(1); // just BBB
    expect(new Decimal((await position(account.id, b.id)).quantity).isZero()).toBe(true);
    const held = await getAccountHoldings(account.id);
    expect(held.map((h) => h.symbol)).toEqual(["AAA"]);
  });

  it("a zero-delta Save writes exactly one snapshot_confirm row (and no ADJUSTMENT)", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [{ assetId: a.id, quantity: "10", avgCostUsd: "100" }],
    });

    expect(res.ok).toBe(true);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(0);
    const rows = await snapshotRows(account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].as_of_date).toBe("2026-02-01");
    expect(Date.now() - new Date(rows[0].at).getTime()).toBeLessThan(60_000);
  });

  it("a definite failure rolls the whole transaction back — no snapshot_confirm row, prior position intact", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const res = await updateHoldingsAction({
      asOfDate: "2026-02-01",
      holdings: [
        { assetId: a.id, quantity: "10", avgCostUsd: "100" },
        { assetId: "99999999", quantity: "3", avgCostUsd: "12" }, // no such asset -> FK violation
      ],
    });

    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.errors.form).toBeDefined();
    expect(await snapshotRows(account.id)).toHaveLength(0);
    expect(await snapshotUpdateTxns(account.id)).toHaveLength(0);
    expect(new Decimal((await position(account.id, a.id)).quantity).toFixed(2)).toBe("10.00");
  });

  it("maps an ambiguous COMMIT to { ok: 'unknown' } without attempting ROLLBACK", async () => {
    const account = await createAccount("My Portfolio", null);
    const a = await resolveOrCreateAsset("AAA", "equity", "A Corp");
    await seedPosition(account.id, a.id, "10", "100");

    const pool = getPool();
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === "BEGIN") return { rows: [] };
        if (/FROM accounts/i.test(sql)) return { rows: [{ id: account.id }] };
        // Current stored state matches the desired snapshot -> zero delta ->
        // no applyTransaction call, so the fake never needs to model one.
        if (/FROM positions_current/i.test(sql)) {
          return { rows: [{ asset_id: a.id, quantity: "10", avg_cost_usd: "100" }] };
        }
        if (/INSERT INTO audit_log/i.test(sql)) return { rows: [] };
        if (sql === "COMMIT") throw new Error("connection reset during commit");
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const connectSpy = vi.spyOn(pool, "connect").mockResolvedValueOnce(fakeClient as never);
    try {
      const res = await updateHoldingsAction({
        asOfDate: "2026-02-01",
        holdings: [{ assetId: a.id, quantity: "10", avgCostUsd: "100" }], // zero-delta -> no applyTransaction
      });

      expect(res.ok).toBe("unknown");
      if (res.ok === "unknown") {
        expect(res.message).not.toMatch(/nothing was saved/i);
        expect(res.message).toMatch(/couldn't confirm|check the dashboard/i);
      }
      expect(fakeClient.query).not.toHaveBeenCalledWith("ROLLBACK");
      expect(fakeClient.release).toHaveBeenCalledTimes(1);
    } finally {
      connectSpy.mockRestore();
    }
  });
});
