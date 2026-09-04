// @vitest-environment jsdom
//
// Cross-route money parity (regression).
//
// The Dashboard renders server-computed figures out of getPortfolioView;
// /holdings serializes the same positions to the client and the editor
// re-derives market value and unrealised P&L live from the edited quantity.
// Two code paths, one set of numbers — they must agree to the cent, and the
// rows must add up to the total shown above them.
//
// The defect this pins: provider prices are persisted at 6dp
// (lib/marketdata/index.ts), so a real 703.41 close is stored as
// 703.409973 and a real 80532.58 close as 80532.578125. The Dashboard
// multiplied by the stored price while /holdings multiplied by the
// 2dp price it displays, so the two routes disagreed by a cent on
// BTC and VOO, and the Dashboard's own rows did not sum to its own total.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset } from "@/lib/assets";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { getPortfolioView, type PositionView } from "@/lib/portfolio";
import { formatUsd } from "@/lib/formatUsd";
import { PrivacyProvider } from "@/app/components/PrivacyContext";
import { DashboardHoldingsTable } from "@/app/components/DashboardHoldingsTable";
import { HoldingsEditor } from "@/app/holdings/HoldingsEditor";
import { buildInitialRows } from "@/app/holdings/buildInitialRows";

vi.mock("@/app/actions/setup", () => ({ resolveTickerAction: vi.fn() }));
vi.mock("@/app/actions/holdings", () => ({ updateHoldingsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(cleanup);

// The live demo dataset, with the prices exactly as the ingest boundary
// persists them (6dp, carrying the providers' float noise). BTC and VOO are
// the two rows that exposed the divergence:
//   - BTC 0.25 x 80532.58 = 20133.145 — a genuine half-cent tie;
//   - VOO 450 x 703.41    = 316534.50 — no tie at all, yet the Dashboard
//     showed a cent less because it multiplied by 703.409973.
const DATASET = [
  { symbol: "AAPL", assetClass: "equity" as const, qty: "1",    avgCost: "1.00",     close: "324.9599910000" },
  { symbol: "BTC",  assetClass: "crypto" as const, qty: "0.25", avgCost: "48000.00", close: "80532.5781250000" },
  { symbol: "CRWV", assetClass: "equity" as const, qty: "300",  avgCost: "100.00",   close: "80.9300000000" },
  { symbol: "NOW",  assetClass: "equity" as const, qty: "2500", avgCost: "165.00",   close: "136.7200010000" },
  { symbol: "NVDA", assetClass: "equity" as const, qty: "1200", avgCost: "165.00",   close: "224.4100040000" },
  { symbol: "VOO",  assetClass: "etf" as const,    qty: "450",  avgCost: "560.00",   close: "703.4099730000" },
];

// What both routes must display, derived from the cent-rounded price the
// two routes also display — so "price x quantity" reconciles on screen.
const EXPECTED: Record<string, { mv: string; pl: string }> = {
  AAPL: { mv: "$324.96",      pl: "+$323.96" },
  BTC:  { mv: "$20,133.15",   pl: "+$8,133.15" },   // half-cent tie, rounded half-up
  CRWV: { mv: "$24,279.00",   pl: "−$5,721.00" },
  NOW:  { mv: "$341,800.00",  pl: "−$70,700.00" },
  NVDA: { mv: "$269,292.00",  pl: "+$71,292.00" },
  VOO:  { mv: "$316,534.50",  pl: "+$64,534.50" },
};

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    "TRUNCATE transactions, positions_current, account_cash, audit_log, prices_daily, assets, accounts RESTART IDENTITY CASCADE"
  );
  const account = await createAccount("Demo Brokerage", null);
  const source = await pool.query<{ id: number }>(`SELECT id FROM sources WHERE name = 'EODHD'`);
  for (const h of DATASET) {
    const asset = await resolveOrCreateAsset({
      symbol: h.symbol, assetClass: h.assetClass, name: h.symbol,
    });
    await applyTransaction({
      accountId: account.id, assetId: asset.id, txnType: "BUY",
      tradeDate: "2026-01-02",
      quantity: new Decimal(h.qty), priceUsd: new Decimal(h.avgCost),
      feesUsd: new Decimal(0), grossAmountUsd: null, note: null,
    });
    await pool.query(
      `INSERT INTO prices_daily (asset_id, price_date, close, adj_close, source_id, retrieved_at)
       VALUES ($1, '2026-09-03', $2, $2, $3, now())`,
      [asset.id, h.close, source.rows[0].id]
    );
  }
});

// A rendered cell's visible money text, with the responsive-restack
// "<span class='cell-label'>" prefix (Holdings) stripped.
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll(".cell-label").forEach((n) => n.remove());
  return (clone.textContent ?? "").trim();
}

// symbol -> { mv, pl } read out of a rendered table.holdings.
function readRows(container: Element, mvCol: number, plCol: number) {
  const out: Record<string, { mv: string; pl: string }> = {};
  for (const tr of container.querySelectorAll("table.holdings tbody tr")) {
    const tds = tr.querySelectorAll("td");
    out[cellText(tds[0])] = { mv: cellText(tds[mvCol]), pl: cellText(tds[plCol]) };
  }
  return out;
}

describe("Dashboard and /holdings money parity", () => {
  it("shows identical market value and unrealised P&L for every holding, on both routes", async () => {
    const view = await getPortfolioView(new Date("2026-09-04"));
    const positions: PositionView[] = view.positions;

    const dash = render(
      <PrivacyProvider>
        <DashboardHoldingsTable positions={positions} />
      </PrivacyProvider>
    );
    // Dashboard columns: Symbol, Type, Quantity, Avg cost, Price, MV, P&L
    const dashRows = readRows(dash.container, 5, 6);
    cleanup();

    const hold = render(
      <PrivacyProvider>
        <HoldingsEditor initial={buildInitialRows(positions)} />
      </PrivacyProvider>
    );
    // Holdings columns: Symbol, Type, Quantity, Average cost, Price, MV, P&L, actions
    const holdRows = readRows(hold.container, 5, 6);

    expect(Object.keys(dashRows).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(dashRows).toEqual(holdRows);
    expect(dashRows).toEqual(EXPECTED);
  });

  it("the displayed rows sum to the displayed portfolio total", async () => {
    const view = await getPortfolioView(new Date("2026-09-04"));

    const summed = view.positions.reduce(
      (sum, p) => (p.marketValueUsd ? sum.add(p.marketValueUsd) : sum),
      new Decimal(0)
    );
    // The value block's headline figure, and the sum of the rows beneath it.
    expect(formatUsd(view.totalMarketValueUsd)).toBe(formatUsd(summed));
    expect(formatUsd(view.totalMarketValueUsd)).toBe("972,363.61");

    // Same rule for the P&L line: aggregate === sum of the per-row figures.
    const summedPl = view.positions.reduce(
      (sum, p) =>
        p.latestPriceUsd && p.avgCostUsd
          ? sum.add(p.latestPriceUsd.sub(p.avgCostUsd).mul(p.quantity))
          : sum,
      new Decimal(0)
    );
    expect(formatUsd(view.totalUnrealisedPlUsd)).toBe(formatUsd(summedPl));
    expect(formatUsd(view.totalUnrealisedPlUsd)).toBe("67,862.61");
  });
});
