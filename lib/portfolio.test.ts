import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "./db";
import { createAccount } from "./accounts";
import { resolveOrCreateAsset } from "./assets";
import { applyTransaction } from "./ledger/applyTransaction";
import { getPortfolioView } from "./portfolio";

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("getPortfolioView", () => {
  it("combines positions, latest price, and cash into totals", async () => {
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
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const pool = getPool();
    const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, '2026-01-03', 120.00, 120.00, $2, now())`,
      [asset.id, sourceRow.rows[0].id]
    );

    const view = await getPortfolioView();

    expect(view.positions).toHaveLength(1);
    expect(view.positions[0].symbol).toBe("AAPL");
    expect(view.positions[0].marketValueUsd!.toFixed(2)).toBe("1200.00");
    expect(view.positions[0].unrealisedPlUsd!.toFixed(2)).toBe("200.00"); // 1200 - 1000 cost basis
    expect(view.totalCashUsd.toFixed(2)).toBe("9000.00"); // 10000 - 1000
    expect(view.totalMarketValueUsd.toFixed(2)).toBe("1200.00");
    expect(view.totalPortfolioValueUsd.toFixed(2)).toBe("10200.00");
  });
});
