import Link from "next/link";
import { HoldingsTopBar } from "../components/HoldingsTopBar";
import { HoldingsShell } from "../components/HoldingsShell";
import { PriceRefreshControl } from "../components/PriceRefreshControl";
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import { formatCheckedTime } from "@/lib/formatCheckedAt";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Prices as of DATE close" — the latest EOD date behind the priced rows.
// Mirrors app/page.tsx's identical helper; not worth sharing since Holdings
// derives it from a differently-shaped source (raw rows, not sorted positions).
function formatAsOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// /holdings IS the editor for the existing portfolio snapshot — there is no
// read-only recap table before it. Zero holdings falls back to the wizard CTA.
export default async function HoldingsPage() {
  const holdings = await getAllHoldings();

  return (
    <HoldingsShell>
      <HoldingsTopBar />
      <main>
        {holdings.length === 0 ? (
          <section>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" className="button-link">
              Add your holdings
            </Link>
          </section>
        ) : (
          <HoldingsPageBody />
        )}
      </main>
    </HoldingsShell>
  );
}

async function HoldingsPageBody() {
  const portfolio = await getPortfolioView();
  const initial = buildInitialRows(portfolio.positions);
  const latestPriceDate = initial.reduce<string | null>(
    (max, p) => (p.priceDate && (!max || p.priceDate > max) ? p.priceDate : max),
    null
  );
  const checkedTime = formatCheckedTime(new Date());
  const freshness = latestPriceDate
    ? `Prices as of ${formatAsOfDate(latestPriceDate)} close · checked ${checkedTime}`
    : `checked ${checkedTime}`;

  return (
    <>
      <div className="pagehead">
        <h2>Holdings</h2>
        <PriceRefreshControl label={freshness} />
      </div>
      <HoldingsEditor initial={initial} />
    </>
  );
}

// Current holdings pre-fill with per-row price health. getPortfolioView's
// positions carry the average cost, latest price, and price date; every
// value crossing to the client component is serialized to a plain string
// first. Market value and unrealised P&L are NOT passed — the editor
// derives them live from each row's edited quantity / average cost.
function buildInitialRows(positions: Awaited<ReturnType<typeof getPortfolioView>>["positions"]): EditorInitialRow[] {
  return positions.map((p) => ({
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
