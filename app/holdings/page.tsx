import Link from "next/link";
import { NavBar, buttonLinkStyle } from "../components/NavBar";
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

// /holdings IS the editor for the existing portfolio snapshot — there is no
// read-only recap table before it. Zero holdings falls back to the wizard CTA.
export default async function HoldingsPage() {
  const holdings = await getAllHoldings();

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Holdings</h1>

        {holdings.length === 0 ? (
          <>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>
              Add your holdings
            </Link>
          </>
        ) : (
          <HoldingsEditor initial={await buildInitialRows()} />
        )}
      </main>
    </>
  );
}

// Current holdings pre-fill with per-row price health. getPortfolioView's
// positions carry the average cost, latest price, and price date; every
// value crossing to the client component is serialized to a plain string
// first. Market value and unrealised P&L are NOT passed — the editor
// derives them live from each row's edited quantity / average cost.
async function buildInitialRows(): Promise<EditorInitialRow[]> {
  const portfolio = await getPortfolioView();
  return portfolio.positions.map((p) => ({
    assetId: p.assetId,
    symbol: p.symbol,
    assetClass: p.assetClass,
    quantity: p.quantity.toString(),
    avgCostUsd: p.avgCostUsd ? p.avgCostUsd.toString() : "0",
    priceUsd: p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : null,
    priceStatus: p.priceStatus,
    priceDate: p.priceDate,
  }));
}
