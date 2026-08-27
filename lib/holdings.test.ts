import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { getAccountHoldings, getAllHoldings, getLastSnapshotConfirmation } from "./holdings";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

async function buy(accountId: number, assetId: string, qty: number, price: number) {
  await applyTransaction({
    accountId, assetId, txnType: "BUY",
    tradeDate: "2026-01-02", quantity: new Decimal(qty), priceUsd: new Decimal(price),
    feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
  });
}

describe("getAccountHoldings / getAllHoldings", () => {
  it("returns only non-zero positions — a fully-sold holding is excluded", async () => {
    const account = await createAccount("Brokerage", null);
    const held = await resolveOrCreateAsset("HELD", "equity", "Held Corp");
    const sold = await resolveOrCreateAsset("SOLD", "equity", "Sold Corp");
    await buy(account.id, held.id, 10, 100);
    await buy(account.id, sold.id, 4, 50);
    await applyTransaction({
      accountId: account.id, assetId: sold.id, txnType: "SELL",
      tradeDate: "2026-01-03", quantity: new Decimal(4), priceUsd: new Decimal(55),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const holdings = await getAccountHoldings(account.id);
    expect(holdings.map((h) => h.symbol)).toEqual(["HELD"]);
    expect(holdings[0].assetId).toBe(held.id);
    expect(typeof holdings[0].assetId).toBe("string");
    expect(holdings[0].assetClass).toBe("equity");
    expect(holdings[0].quantity.toFixed(2)).toBe("10.00");
  });

  it("getAccountHoldings scopes to a single account; getAllHoldings spans every account", async () => {
    const a1 = await createAccount("Acct One", null);
    const a2 = await createAccount("Acct Two", null);
    const x = await resolveOrCreateAsset("XXX", "equity", "X Corp");
    const y = await resolveOrCreateAsset("YYY", "etf", "Y ETF");
    await buy(a1.id, x.id, 5, 20);
    await buy(a2.id, y.id, 7, 30);

    expect((await getAccountHoldings(a1.id)).map((h) => h.symbol)).toEqual(["XXX"]);
    expect((await getAccountHoldings(a2.id)).map((h) => h.symbol)).toEqual(["YYY"]);
    expect((await getAllHoldings()).map((h) => h.symbol)).toEqual(["XXX", "YYY"]);
  });

  it("returns [] for an empty portfolio", async () => {
    const account = await createAccount("Empty", null);
    expect(await getAccountHoldings(account.id)).toEqual([]);
    expect(await getAllHoldings()).toEqual([]);
  });
});

describe("getLastSnapshotConfirmation", () => {
  it("returns null when the portfolio has never been saved", async () => {
    const account = await createAccount("Never Saved", null);
    expect(await getLastSnapshotConfirmation(account.id)).toBeNull();
  });

  it("returns the latest snapshot_confirm row's confirmation time and as-of date", async () => {
    const account = await createAccount("Saved Twice", null);
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_log (table_name, row_id, action, actor, before, after, at)
       VALUES ('accounts', $1, 'snapshot_confirm', 'user', NULL,
               jsonb_build_object('as_of_date', '2026-01-10'::text), now() - interval '1 hour')`,
      [account.id]
    );
    await pool.query(
      `INSERT INTO audit_log (table_name, row_id, action, actor, before, after, at)
       VALUES ('accounts', $1, 'snapshot_confirm', 'user', NULL,
               jsonb_build_object('as_of_date', '2026-02-20'::text), now())`,
      [account.id]
    );

    const result = await getLastSnapshotConfirmation(account.id);
    expect(result).not.toBeNull();
    expect(result!.asOfDate).toBe("2026-02-20");
    expect(result!.confirmedAt).toBeInstanceOf(Date);
    expect(Date.now() - result!.confirmedAt.getTime()).toBeLessThan(60_000);
  });

  it("scopes to the given account", async () => {
    const mine = await createAccount("Mine", null);
    const other = await createAccount("Other", null);
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
       VALUES ('accounts', $1, 'snapshot_confirm', 'user', NULL,
               jsonb_build_object('as_of_date', '2026-03-03'::text))`,
      [other.id]
    );
    expect(await getLastSnapshotConfirmation(mine.id)).toBeNull();
  });
});
