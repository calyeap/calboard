import type { getPortfolioView } from "@/lib/portfolio";
import type { EditorInitialRow } from "./HoldingsEditor";

// Current holdings pre-fill with per-row price health. getPortfolioView's
// positions carry the average cost, latest price, and price date; every
// value crossing to the client component is serialized to a plain string
// first. Market value and unrealised P&L are NOT passed — the editor
// derives them live from each row's edited quantity / average cost, using
// the same lib/money.ts helpers the server total uses.
//
// This lives in its own module (rather than inline in page.tsx) because it
// is the exact boundary where the Dashboard's server-computed figures and
// the Holdings editor's client-computed figures have to agree — see
// app/moneyRouteParity.test.tsx.
export function buildInitialRows(
  positions: Awaited<ReturnType<typeof getPortfolioView>>["positions"]
): EditorInitialRow[] {
  return positions.map((p) => ({
    assetId: p.assetId,
    symbol: p.symbol,
    assetClass: p.assetClass,
    quantity: p.quantity.toString(),
    avgCostUsd: p.avgCostUsd ? p.avgCostUsd.toString() : "0",
    // latestPriceUsd is already rounded to the cent by getPortfolioView, so
    // this serialization is exact — it is not a second, competing rounding.
    priceUsd: p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : null,
    priceStatus: p.priceStatus,
    priceDate: p.priceDate,
  }));
}
