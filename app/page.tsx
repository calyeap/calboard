import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { getLastSnapshotConfirmation } from "@/lib/holdings";
import { computeAllocation, groupByAssetClass } from "@/lib/allocation";
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

// "Holdings last updated" is a confirmation timestamp (model rule 10): the
// moment the user pressed Save, shown as local "YYYY-MM-DD HH:MM". It is NOT
// the as-of date the entered figures represent, and it is NOT price
// freshness — kept as its own muted line, distinct from the two ranked
// price timestamps above it.
function formatConfirmedAt(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Prices as of DATE close" — the latest EOD date behind the value figure.
function formatAsOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "Data checked TIME SGT" — Singapore has no DST (fixed UTC+8), so the
// abbreviation is safe to hardcode rather than trust Intl's zone-name output.
function formatCheckedAt(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} SGT`;
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

  // V1 keeps exactly one hidden portfolio account. Only read freshness when
  // that invariant holds; if more than one account somehow exists, don't
  // guess which is "the" portfolio — omit the line rather than risk showing
  // the wrong timestamp. (Duplicate-account setup is out of scope here.)
  const lastConfirmation =
    accounts.length === 1 ? await getLastSnapshotConfirmation(accounts[0].id) : null;

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
  const checkedAt = formatCheckedAt(new Date());

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap"
        rel="stylesheet"
      />
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
                <div className="asof">
                  Portfolio value
                  {latestPriceDate && ` · Prices as of ${formatAsOfDate(latestPriceDate)} close`}
                </div>
                <div className="value num">
                  US$
                  <MaskableValue>{portfolio!.totalMarketValueUsd.toFixed(2)}</MaskableValue>
                </div>
                <div
                  className={`delta num${portfolio!.totalUnrealisedPlUsd.isNegative() ? " loss" : " gain"}`}
                >
                  {portfolio!.totalUnrealisedPlUsd.isNegative() ? "−" : "+"}US$
                  <MaskableValue>{portfolio!.totalUnrealisedPlUsd.abs().toFixed(2)}</MaskableValue> since
                  cost
                  {portfolio!.totalUnrealisedPlPct !== null && (
                    <> ({portfolio!.totalUnrealisedPlPct.toFixed(2)}%)</>
                  )}
                </div>
                <PriceRefreshControl checkedAt={checkedAt} />
                <div className="dashboard-note">
                  {lastConfirmation ? (
                    <>
                      Holdings last updated: {formatConfirmedAt(lastConfirmation.confirmedAt)}
                      {lastConfirmation.asOfDate && ` (snapshot as of ${lastConfirmation.asOfDate})`}
                    </>
                  ) : (
                    "Holdings last updated: —"
                  )}
                </div>
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
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
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
