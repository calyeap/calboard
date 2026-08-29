import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset } from "@/lib/assets";
import { upsertLatestPrice } from "@/lib/marketdata";
import { SetupCommitUncertainError } from "@/lib/ledger/setupAccount";
import { resolveTickerAction, setupAccountAction } from "./setup";

// Deterministic provider: the Yahoo client is stubbed so no test touches the
// network or live prices. `chart` is the single seam — tests assert the exact
// symbol the adapter sent, and control the close it gets back.
const { mockChart } = vi.hoisted(() => ({ mockChart: vi.fn() }));
vi.mock("yahoo-finance2", () => ({ default: class { chart = mockChart; } }));

function chartClose(close: number, date = "2026-08-28") {
  return { quotes: [{ date: new Date(`${date}T00:00:00Z`), close, adjclose: close }] };
}

// revalidatePath is a request-scoped Next primitive with nothing to
// invalidate in a bare test process — stub it so the action's own logic is
// what's under test.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// setupAccount runs for real (integration, real DB) in every test except
// the one that needs to force an ambiguous COMMIT — there it's overridden
// per-call with mockRejectedValueOnce.
vi.mock("@/lib/ledger/setupAccount", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ledger/setupAccount")>();
  return { ...actual, setupAccount: vi.fn(actual.setupAccount) };
});
import { setupAccount } from "@/lib/ledger/setupAccount";
const setupAccountMock = vi.mocked(setupAccount);

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
});

describe("resolveTickerAction", () => {
  const originalProvider = process.env.MARKET_DATA_PROVIDER;
  beforeEach(() => {
    process.env.MARKET_DATA_PROVIDER = "YAHOO";
    mockChart.mockReset();
  });
  afterEach(() => {
    if (originalProvider === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = originalProvider;
  });

  // --- M1.1 crypto-resolution hotfix (BTC-only) ---------------------------

  it("resolves Crypto + BTC to Bitcoin (BTC-USD) and persists the canonical identity", async () => {
    mockChart.mockResolvedValue(chartClose(79950.5));

    const result = await resolveTickerAction("BTC", "crypto");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetClass).toBe("crypto");
      // Bitcoin's price, never a ~$35 Grayscale Bitcoin Mini Trust ETF share.
      expect(new Decimal(result.priceUsd).gt(1000)).toBe(true);
    }
    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.anything());
    expect(mockChart).not.toHaveBeenCalledWith("BTC", expect.anything());

    // Canonical identity persisted for later price retrieval / Retry.
    const pool = getPool();
    const asset = await pool.query(
      `SELECT primary_symbol, asset_class, name FROM assets WHERE primary_symbol = 'BTC'`
    );
    expect(asset.rows[0]).toMatchObject({
      primary_symbol: "BTC",
      asset_class: "crypto",
      name: "Bitcoin",
    });
  });

  it("later price retrieval re-uses the saved crypto identity, not a bare-ticker search", async () => {
    mockChart.mockResolvedValue(chartClose(80000));
    const first = await resolveTickerAction("BTC", "crypto");
    expect(first.ok).toBe(true);
    const assetId = first.ok ? first.assetId : "";

    // Force the price cache stale so the next call goes back to the provider,
    // exactly as PriceCell's Retry -> retryPriceFetchAction -> upsertLatestPrice
    // does, using only the columns persisted on the asset.
    const pool = getPool();
    await pool.query(`UPDATE prices_daily SET retrieved_at = now() - interval '2 days'`);
    mockChart.mockClear();

    await upsertLatestPrice(assetId, "BTC", "crypto");

    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.anything());
    expect(mockChart).not.toHaveBeenCalledWith("BTC", expect.anything());
  });

  it("corrects a stale bare-ticker name left on an existing BTC asset", async () => {
    // Pre-hotfix state: a BTC crypto asset saved with its ticker as the name.
    const stale = await resolveOrCreateAsset("BTC", "crypto", "BTC");
    mockChart.mockResolvedValue(chartClose(80500));

    const result = await resolveTickerAction("BTC", "crypto");

    expect(result.ok).toBe(true);
    const pool = getPool();
    const row = await pool.query(`SELECT name FROM assets WHERE id = $1`, [stale.id]);
    expect(row.rows[0].name).toBe("Bitcoin");
  });

  it("BTC LIVE REGRESSION: a fresh bare-ticker price cached against the BTC identity is never surfaced — the resolve re-fetches through BTC-USD", async () => {
    // Pre-hotfix residue: the BTC crypto asset already exists with its
    // canonical name (PR #2 deployed), but prices_daily still holds a FRESH
    // row from the old bare-ticker fetch — Yahoo's "BTC" is the ~$35 Grayscale
    // Bitcoin Mini Trust ETF, not Bitcoin. Within upsertLatestPrice's 12h
    // freshness window the resolve path must NOT serve that cached close.
    const asset = await resolveOrCreateAsset("BTC", "crypto", "Bitcoin");
    const pool = getPool();
    const source = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'YAHOO'`);
    // Last trading day before the hotfix, fetched only hours ago — still
    // inside upsertLatestPrice's 12h freshness window.
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, CURRENT_DATE - 1, 35.34, 35.34, $2, now() - interval '3 hours')`,
      [asset.id, source.rows[0].id]
    );

    mockChart.mockResolvedValue(chartClose(80123.45, "2026-08-29"));
    const result = await resolveTickerAction("BTC", "crypto");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Bitcoin's price via the verified BTC-USD pair — never the $35 ETF close.
      expect(result.priceUsd).toBe("80123.45");
      expect(new Decimal(result.priceUsd).gt(1000)).toBe(true);
    }
    expect(mockChart).toHaveBeenCalledWith("BTC-USD", expect.anything());
    expect(mockChart).not.toHaveBeenCalledWith("BTC", expect.anything());
  });

  it("EQUITY REGRESSION: a fresh cached equity price is still served without a provider call", async () => {
    // The crypto force-refresh must not leak into the equity/ETF path — the
    // shared 12h cache short-circuit stays intact for a bare-ticker instrument.
    const asset = await resolveOrCreateAsset("CSHORT", "equity", "Cache Short Corp");
    const pool = getPool();
    const source = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'YAHOO'`);
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, CURRENT_DATE, 42.50, 42.50, $2, now())`,
      [asset.id, source.rows[0].id]
    );

    const result = await resolveTickerAction("CSHORT", "equity");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.priceUsd).toBe("42.50");
    expect(mockChart).not.toHaveBeenCalled();
  });

  it("rejects an unsupported crypto clearly and creates no add-anyway asset", async () => {
    // A symbol not in the verified registry must not resolve to an equity,
    // an ETF, or any other instrument — and must not leave a row the caller
    // could 'add anyway'.
    const result = await resolveTickerAction("NOTACOIN", "crypto");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.assetId).toBeNull();
      expect(result.message).toMatch(/not a supported cryptocurrency/i);
    }
    expect(mockChart).not.toHaveBeenCalled();

    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM assets`)).rows).toHaveLength(0);
  });

  it("EQUITY REGRESSION: NOW and NVDA still resolve by their bare ticker", async () => {
    mockChart.mockResolvedValue(chartClose(912.34));
    const now = await resolveTickerAction("NOW", "equity");
    expect(now.ok).toBe(true);
    expect(mockChart).toHaveBeenCalledWith("NOW", expect.anything());

    mockChart.mockClear();
    mockChart.mockResolvedValue(chartClose(178.9));
    const nvda = await resolveTickerAction("NVDA", "equity");
    expect(nvda.ok).toBe(true);
    expect(mockChart).toHaveBeenCalledWith("NVDA", expect.anything());
  });

  it("resolves from a fresh cached price without a live provider call", async () => {
    const asset = await resolveOrCreateAsset("CACHED", "equity", "Cached Corp");
    const pool = getPool();
    const source = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'YAHOO'`);
    // A fresh prices_daily row makes upsertLatestPrice hit its cache
    // short-circuit — no provider.fetchLatestEod call. (If it *did* fall
    // through, a live fetch for the bogus ticker "CACHED" would fail and
    // the action would return ok:false — so ok:true also proves the cache
    // path was taken.)
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, CURRENT_DATE, 42.5, 42.5, $2, now())`,
      [asset.id, source.rows[0].id]
    );

    const result = await resolveTickerAction("cached", "equity");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetId).toBe(asset.id);
      expect(result.assetClass).toBe("equity");
      expect(result.priceUsd).toBe("42.50");
      expect(result.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("rejects an empty ticker with a friendly message and creates no asset", async () => {
    const result = await resolveTickerAction("   ", "equity");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.assetId).toBeNull();
      expect(result.message).toMatch(/enter a ticker/i);
    }

    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM assets`)).rows).toHaveLength(0);
  });
});

describe("setupAccountAction", () => {
  async function twoValidHoldings() {
    const a = await resolveOrCreateAsset("SAA", "equity", "Setup Action A");
    const b = await resolveOrCreateAsset("SAB", "etf", "Setup Action B ETF");
    return {
      asOfDate: "2026-02-10",
      holdings: [
        { assetId: a.id, quantity: "10", avgCostUsd: "100" },
        { assetId: b.id, quantity: "5", avgCostUsd: "200" },
      ],
      a,
      b,
    };
  }

  it("rejects a future as-of date as save_failed and writes nothing", async () => {
    const { holdings } = await twoValidHoldings();
    const result = await setupAccountAction({ asOfDate: "2099-01-01", holdings });

    expect(result.status).toBe("save_failed");
    if (result.status === "save_failed") expect(result.message).toMatch(/future/i);

    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM accounts`)).rows).toHaveLength(0);
    expect(
      (await pool.query(`SELECT 1 FROM audit_log WHERE action = 'snapshot_confirm'`)).rows
    ).toHaveLength(0);
  });

  it("rejects a non-positive quantity as save_failed at the action layer, before any write", async () => {
    const a = await resolveOrCreateAsset("SANEG", "equity", "Setup Action Neg");
    const result = await setupAccountAction({
      asOfDate: "2026-02-10",
      holdings: [{ assetId: a.id, quantity: "-1", avgCostUsd: "50" }],
    });

    expect(result.status).toBe("save_failed");
    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM accounts`)).rows).toHaveLength(0);
  });

  it("saves a valid multi-holding portfolio: status saved, positions present, no cash", async () => {
    const { asOfDate, holdings, a, b } = await twoValidHoldings();
    const result = await setupAccountAction({ asOfDate, holdings });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(typeof result.accountId).toBe("number");

    const pool = getPool();
    const positions = await pool.query<{ asset_id: string; quantity: string; avg_cost_usd: string }>(
      `SELECT asset_id, quantity, avg_cost_usd FROM positions_current WHERE account_id = $1 ORDER BY asset_id`,
      [result.accountId]
    );
    expect(positions.rows).toHaveLength(2);
    const byAsset = new Map(positions.rows.map((r) => [r.asset_id, r]));
    expect(new Decimal(byAsset.get(a.id)!.quantity).toFixed(2)).toBe("10.00");
    expect(new Decimal(byAsset.get(b.id)!.avg_cost_usd).toFixed(2)).toBe("200.00");

    // No user-facing cash: the derived balance, if a row exists at all, is exactly zero.
    const cash = await pool.query<{ cash_usd: string }>(
      `SELECT cash_usd FROM account_cash WHERE account_id = $1`,
      [result.accountId]
    );
    if (cash.rows.length > 0) {
      expect(new Decimal(cash.rows[0].cash_usd).toFixed(2)).toBe("0.00");
    }

    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE action = 'snapshot_confirm' AND row_id = $1`,
      [result.accountId]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("rolls the whole setup back when a holding references a non-existent asset", async () => {
    const result = await setupAccountAction({
      asOfDate: "2026-02-10",
      holdings: [{ assetId: "99999999", quantity: "3", avgCostUsd: "12" }],
    });

    expect(result.status).toBe("save_failed");
    const pool = getPool();
    expect((await pool.query(`SELECT 1 FROM accounts`)).rows).toHaveLength(0);
    expect((await pool.query(`SELECT 1 FROM transactions`)).rows).toHaveLength(0);
    expect(
      (await pool.query(`SELECT 1 FROM audit_log WHERE action = 'snapshot_confirm'`)).rows
    ).toHaveLength(0);
  });

  it("normalizes a >10dp quantity once (unsurfaced) and round-trips it at exactly 10dp", async () => {
    const a = await resolveOrCreateAsset("SADP", "crypto", "Setup Action DP");
    const result = await setupAccountAction({
      asOfDate: "2026-02-10",
      holdings: [{ assetId: a.id, quantity: "1.123456789012345", avgCostUsd: "30000" }],
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;

    const pool = getPool();
    const row = await pool.query<{ quantity: string }>(
      `SELECT quantity FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
      [result.accountId, a.id]
    );
    expect(new Decimal(row.rows[0].quantity).toFixed(10)).toBe("1.1234567890");
  });

  it("maps an ambiguous COMMIT (SetupCommitUncertainError) to save_unknown without inferring the outcome", async () => {
    setupAccountMock.mockRejectedValueOnce(
      new SetupCommitUncertainError("COMMIT failed — state unknown", new Error("connection reset"))
    );
    const a = await resolveOrCreateAsset("SAUNK", "equity", "Setup Action Unknown");

    const result = await setupAccountAction({
      asOfDate: "2026-02-10",
      holdings: [{ assetId: a.id, quantity: "1", avgCostUsd: "10" }],
    });

    expect(result.status).toBe("save_unknown");
    if (result.status === "save_unknown") {
      expect(result.message).not.toMatch(/nothing was saved/i);
      expect(result.message).toMatch(/couldn't confirm|check the dashboard/i);
    }
  });
});
