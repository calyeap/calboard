import Link from "next/link";
import { NavBar } from "./components/NavBar";
import { PriceCell } from "./components/PriceCell";
import { AllocationDonut } from "./components/AllocationDonut";
import { MaskableValue } from "./components/MaskableValue";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { getLastSnapshotConfirmation } from "@/lib/holdings";
import { computeAllocation, groupByAssetClass } from "@/lib/allocation";
import { formatAssetClass } from "@/lib/assets";

// Always render dynamically — this page reads live DB state (accounts,
// portfolio positions) on every request and must never be frozen as a
// static build-time snapshot, so the revalidatePath("/") calls in
// app/actions/setup.ts and app/actions/prices.ts always have a per-request
// render to invalidate.
export const dynamic = "force-dynamic";

// "Holdings last updated" is a confirmation timestamp (model rule 10): the
// moment the user pressed Save, shown as local "YYYY-MM-DD HH:MM". It is NOT
// the as-of date the entered figures represent.
function formatConfirmedAt(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
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

  // Allocation by holding — priced market value only, using the exact
  // per-position marketValueUsd getPortfolioView already computed and the
  // exact totalMarketValueUsd shown above as "Portfolio Value" (no second
  // total). computeAllocation itself excludes unpriced holdings.
  const allocation = portfolio
    ? computeAllocation(
        portfolio.positions.map((p) => ({ symbol: p.symbol, marketValueUsd: p.marketValueUsd })),
        portfolio.totalMarketValueUsd
      )
    : null;

  // Allocation by asset class — same computeAllocation calculation, just
  // grouped differently first (spec: no change to the allocation math).
  const allocationByAssetClass = portfolio
    ? computeAllocation(
        groupByAssetClass(
          portfolio.positions.map((p) => ({
            symbol: p.symbol,
            assetClass: p.assetClass,
            marketValueUsd: p.marketValueUsd,
          }))
        ),
        portfolio.totalMarketValueUsd
      )
    : null;

  return (
    <>
      <NavBar />
      <main className="page-shell">
        <h1>Dashboard</h1>

        {!hasHoldings ? (
          <section>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" className="button-link">Add your holdings</Link>
          </section>
        ) : (
          <>
            <section className="dashboard-section">
              <h2>Portfolio Value</h2>
              <p className="pv-amount">
                US$<MaskableValue>{portfolio.totalMarketValueUsd.toFixed(2)}</MaskableValue>
              </p>
              <p>
                Unrealised gain/loss vs cost basis: US$
                <MaskableValue>{portfolio.totalUnrealisedPlUsd.toFixed(2)}</MaskableValue>
                {portfolio.totalUnrealisedPlPct !== null && (
                  <> ({portfolio.totalUnrealisedPlPct.toFixed(2)}%)</>
                )}
              </p>
              {lastConfirmation ? (
                <p className="dashboard-note">
                  Holdings last updated: {formatConfirmedAt(lastConfirmation.confirmedAt)}
                  {lastConfirmation.asOfDate && (
                    <span style={{ fontSize: "0.85em" }}> (snapshot as of {lastConfirmation.asOfDate})</span>
                  )}
                </p>
              ) : (
                <p className="dashboard-note">Holdings last updated: —</p>
              )}
              {portfolio.excludedFromTotalSymbols.length > 0 && (
                <p className="status-msg status-warning">
                  Portfolio total excludes {portfolio.excludedFromTotalSymbols.length} holding
                  {portfolio.excludedFromTotalSymbols.length === 1 ? "" : "s"} with no price yet (
                  {portfolio.excludedFromTotalSymbols.join(", ")}) — true value is higher.
                </p>
              )}
            </section>

            {allocation && (
              <AllocationDonut allocation={allocation} allocationByAssetClass={allocationByAssetClass ?? undefined} />
            )}

            <section className="dashboard-section">
              <h2>Holdings</h2>
              {/*
                No day-price-movement column in V1: the market-data provider
                interface (EodPricePoint) and getPortfolioView expose only the
                latest close, never a prior close, so per the Task 17 contract's
                "omit the cell otherwise" fallback there is nothing to render.
              */}
              <div className="editor-table">
              <table border={1} cellPadding={6}>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Type</th><th>Qty</th><th>Avg cost</th>
                    <th>Price</th><th>Market value</th><th>Unrealised P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((p) => {
                    // Same formula as the aggregate in lib/portfolio.ts:
                    // (price − avgCost) × qty, and % over (avgCost × qty).
                    const plUsd =
                      p.latestPriceUsd && p.avgCostUsd
                        ? p.latestPriceUsd.sub(p.avgCostUsd).mul(p.quantity)
                        : null;
                    const basis = p.avgCostUsd ? p.avgCostUsd.mul(p.quantity) : null;
                    const plPct =
                      plUsd && basis && !basis.isZero() ? plUsd.div(basis).mul(100) : null;
                    return (
                      <tr key={`${p.accountId}-${p.assetId}`}>
                        <td><span className="cell-label">Symbol</span>{p.symbol}</td>
                        <td><span className="cell-label">Type</span>{formatAssetClass(p.assetClass)}</td>
                        <td><span className="cell-label">Qty</span><MaskableValue>{p.quantity.toFixed(4)}</MaskableValue></td>
                        <td><span className="cell-label">Avg cost</span>{p.avgCostUsd ? <MaskableValue>{p.avgCostUsd.toFixed(2)}</MaskableValue> : "—"}</td>
                        <td>
                          <span className="cell-label">Price</span>
                          <PriceCell
                            assetId={p.assetId}
                            symbol={p.symbol}
                            assetClass={p.assetClass}
                            priceStatus={p.priceStatus}
                            priceUsd={p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : null}
                            priceDate={p.priceDate}
                          />
                        </td>
                        <td><span className="cell-label">Market value</span>{p.marketValueUsd ? <MaskableValue>{p.marketValueUsd.toFixed(2)}</MaskableValue> : "—"}</td>
                        <td>
                          <span className="cell-label">Unrealised P&amp;L</span>
                          {plUsd ? (
                            <>
                              <MaskableValue>{plUsd.toFixed(2)}</MaskableValue>
                              {plPct !== null && <> ({plPct.toFixed(2)}%)</>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
