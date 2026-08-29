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
    const asset = await resolveOrCreateAsset({ symbol: "AAPL", assetClass: "equity", name: "Apple Inc." });

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
    // Aggregate unrealized G/L vs cost basis (spec §9.1):
    // (120 - 100) * 10 = 200 over an avg-cost basis of 100 * 10 = 1000 -> 20%.
    expect(view.totalUnrealisedPlUsd.toFixed(2)).toBe("200.00");
    expect(view.totalUnrealisedPlPct!.toFixed(2)).toBe("20.00");
  });

  it("aggregate unrealized G/L counts only positions with a usable price AND avg cost", async () => {
    const account = await createAccount("Mixed Brokerage", null);
    const gain = await resolveOrCreateAsset({ symbol: "GAIN", assetClass: "equity", name: "Gain Corp" });
    const loss = await resolveOrCreateAsset({ symbol: "LOSS", assetClass: "equity", name: "Loss Corp" });
    const noprice = await resolveOrCreateAsset({ symbol: "NOPX", assetClass: "equity", name: "No Price Corp" });

    // GAIN: 10 @ 100 cost, price 120 -> +200, basis 1000
    await applyTransaction({
      accountId: account.id, assetId: gain.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(10), priceUsd: new Decimal(100),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    // LOSS: 5 @ 40 cost, price 30 -> -50, basis 200
    await applyTransaction({
      accountId: account.id, assetId: loss.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(5), priceUsd: new Decimal(40),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    // NOPX: 3 @ 50 cost, no price row -> excluded from the aggregate entirely
    await applyTransaction({
      accountId: account.id, assetId: noprice.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(3), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const pool = getPool();
    const src = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, $3, 120.00, 120.00, $2, now()), ($4, $3, 30.00, 30.00, $2, now())`,
      [gain.id, src.rows[0].id, today, loss.id]
    );

    const view = await getPortfolioView();
    // numerator: 200 + (-50) = 150 ; denominator: 1000 + 200 = 1200 ; 150/1200 = 12.5%
    expect(view.totalUnrealisedPlUsd.toFixed(2)).toBe("150.00");
    expect(view.totalUnrealisedPlPct!.toFixed(2)).toBe("12.50");
  });

  it("classifies a position with no price row as unavailable and excludes it from the total, with disclosure", async () => {
    const account = await createAccount("No Price Brokerage", null);
    const asset = await resolveOrCreateAsset({ symbol: "NOPRICE", assetClass: "equity", name: "No Price Corp" });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(5), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });

    const view = await getPortfolioView();
    const position = view.positions.find((p) => p.symbol === "NOPRICE")!;
    expect(position.priceStatus).toBe("unavailable");
    expect(position.marketValueUsd).toBeNull();
    expect(view.excludedFromTotalSymbols).toContain("NOPRICE");
    // Nothing has a usable price -> aggregate G/L is zero and the percentage
    // is null (no cost basis to divide by).
    expect(view.totalUnrealisedPlUsd.toFixed(2)).toBe("0.00");
    expect(view.totalUnrealisedPlPct).toBeNull();
  });

  it("classifies a price older than the freshness threshold as stale, but still includes it in the total", async () => {
    const account = await createAccount("Stale Price Brokerage", null);
    const asset = await resolveOrCreateAsset({ symbol: "STALE", assetClass: "equity", name: "Stale Corp" });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(5), priceUsd: new Decimal(50),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    const pool = getPool();
    const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    const tenDaysAgo = new Date();
    tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
    const staleDate = tenDaysAgo.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, $2, 60.00, 60.00, $3, now())`,
      [asset.id, staleDate, sourceRow.rows[0].id]
    );

    const view = await getPortfolioView();
    const position = view.positions.find((p) => p.symbol === "STALE")!;
    expect(position.priceStatus).toBe("stale");
    expect(position.marketValueUsd!.toFixed(2)).toBe("300.00");
    expect(view.excludedFromTotalSymbols).not.toContain("STALE");
  });

  it("classifies a fresh price (within the threshold) as current", async () => {
    const account = await createAccount("Current Price Brokerage", null);
    const asset = await resolveOrCreateAsset({ symbol: "CURR", assetClass: "equity", name: "Current Corp" });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02", quantity: new Decimal(2), priceUsd: new Decimal(10),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    const pool = getPool();
    const sourceRow = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, $2, 15.00, 15.00, $3, now())`,
      [asset.id, yesterday.toISOString().slice(0, 10), sourceRow.rows[0].id]
    );

    const view = await getPortfolioView();
    const position = view.positions.find((p) => p.symbol === "CURR")!;
    expect(position.priceStatus).toBe("current");
  });
});
