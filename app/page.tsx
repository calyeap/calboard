import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { computeAllocation, groupByAssetClass } from "@/lib/allocation";
import { formatCheckedTime } from "@/lib/formatCheckedAt";
import { formatUsd } from "@/lib/formatUsd";
import { DashboardShell } from "./components/DashboardShell";
import { DashboardTopBar } from "./components/DashboardTopBar";
import { DashboardHoldingsTable } from "./components/DashboardHoldingsTable";
import { AllocationDonut } from "./components/AllocationDonut";
import { PriceRefreshControl } from "./components/PriceRefreshControl";
import { MaskableValue } from "./components/MaskableValue";

// Always render dynamically — this page reads live DB state (accounts,
// portfolio positions) on every request and must never be frozen as a
// static build-time snapshot, so the revalidatePath("/") calls in
// app/actions/setup.ts and app/actions/prices.ts always have a per-request
// render to invalidate.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Prices as of DATE close" — the latest EOD date behind the value figure.
function formatAsOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = accounts.length > 0 ? await getPortfolioView() : null;

  // Empty vs. populated Dashboard is derived purely from whether any holdings
  // exist (spec §2.3) — never from whether an account row exists. An account
  // whose holdings were all removed in /holdings (every position zeroed via
  // ADJUSTMENT) still exists, but getPortfolioView returns no positions; that
  // state shows the same "Add your holdings" empty state, not a $0.00 view.
  const hasHoldings = portfolio !== null && portfolio.positions.length > 0;

  // Weight-sorted for THIS page only (spec: default sort is portfolio
  // weight, never percentage change). getPortfolioView()'s own SQL order
  // (alphabetical) is left untouched — /holdings' pre-fill still uses it
  // directly and must not reorder because the Dashboard changed.
  const sortedPositions = portfolio
    ? [...portfolio.positions].sort(
        (a, b) => (b.marketValueUsd?.toNumber() ?? -1) - (a.marketValueUsd?.toNumber() ?? -1)
      )
    : [];

  // Allocation by holding — priced market value only, using the exact
  // per-position marketValueUsd getPortfolioView already computed and the
  // exact totalMarketValueUsd shown above as the value figure (no second
  // total). computeAllocation itself excludes unpriced holdings. Fed from
  // sortedPositions so the legend/segments follow the same weight order as
  // the Holdings table.
  const allocation = portfolio
    ? computeAllocation(
        sortedPositions.map((p) => ({ symbol: p.symbol, marketValueUsd: p.marketValueUsd })),
        portfolio.totalMarketValueUsd
      )
    : null;

  // Allocation by asset class — same computeAllocation calculation, just
  // grouped differently first (spec: no change to the allocation math).
  const allocationByAssetClass = portfolio
    ? computeAllocation(
        groupByAssetClass(
          sortedPositions.map((p) => ({
            symbol: p.symbol,
            assetClass: p.assetClass,
            marketValueUsd: p.marketValueUsd,
          }))
        ),
        portfolio.totalMarketValueUsd
      )
    : null;

  const latestPriceDate = sortedPositions.reduce<string | null>(
    (max, p) => (p.priceDate && (!max || p.priceDate > max) ? p.priceDate : max),
    null
  );
  const checkedAt = formatCheckedTime(new Date());
  const freshness = latestPriceDate
    ? `Prices as of the ${formatAsOfDate(latestPriceDate)} close · checked ${checkedAt}`
    : `checked ${checkedAt}`;

  return (
    <>
      <DashboardShell>
        <DashboardTopBar />
        <main>
          {!hasHoldings ? (
            <section className="dashboard-section">
              <p>No holdings yet.</p>
              <Link href="/accounts/new" className="button-link">
                Add your holdings
              </Link>
            </section>
          ) : (
            <>
              <div className="valueblock">
                <h2>Portfolio value</h2>
                <div className="value num">
                  US$
                  <MaskableValue>{formatUsd(portfolio!.totalMarketValueUsd)}</MaskableValue>
                </div>
                <div
                  className={`delta num${portfolio!.totalUnrealisedPlUsd.isNegative() ? " loss" : " gain"}`}
                >
                  {portfolio!.totalUnrealisedPlUsd.isNegative() ? "−" : "+"}US$
                  <MaskableValue>{formatUsd(portfolio!.totalUnrealisedPlUsd.abs())}</MaskableValue>
                  {portfolio!.totalUnrealisedPlPct !== null && (
                    <> ({portfolio!.totalUnrealisedPlPct.toFixed(2)}%)</>
                  )}
                </div>
                <PriceRefreshControl label={freshness} />
                {portfolio!.excludedFromTotalSymbols.length > 0 && (
                  <p className="status-msg status-warning">
                    Portfolio total excludes {portfolio!.excludedFromTotalSymbols.length} holding
                    {portfolio!.excludedFromTotalSymbols.length === 1 ? "" : "s"} with no price yet (
                    {portfolio!.excludedFromTotalSymbols.join(", ")}) — true value is higher.
                  </p>
                )}
              </div>

              {/* Hierarchy is value block -> holdings (dominant) -> allocation
                  (recedes) — holdings comes first, not allocation. */}
              <section className="dashboard-section">
                <div className="sechead">
                  <h2>Holdings</h2>
                  <div className="dashboard-note">Sorted by weight</div>
                </div>
                <DashboardHoldingsTable positions={sortedPositions} />
              </section>

              {allocation && (
                <AllocationDonut
                  allocation={allocation}
                  allocationByAssetClass={allocationByAssetClass ?? undefined}
                />
              )}
            </>
          )}
        </main>
      </DashboardShell>
    </>
  );
}
