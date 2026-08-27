import Link from "next/link";
import { NavBar, buttonLinkStyle } from "./components/NavBar";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";

// Always render dynamically — this page reads live DB state (accounts,
// portfolio positions) on every request and must never be frozen as a
// static build-time snapshot. Per this session's final-review correction,
// this is stated explicitly rather than relied on implicitly, so the
// revalidatePath("/") calls in app/actions/setup.ts (Task 14) and
// app/actions/prices.ts (Task 17) always have a per-request render to
// invalidate.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = accounts.length > 0 ? await getPortfolioView() : null;

  return (
    <>
      <NavBar />
      <main style={{ fontFamily: "system-ui", padding: "0 2rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <h1>Dashboard</h1>

        {!portfolio ? (
          <section>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" style={buttonLinkStyle}>Add your holdings</Link>
          </section>
        ) : (
          <>
            <section>
              <h2>Portfolio Value</h2>
              <p style={{ fontSize: "1.5rem" }}>US${portfolio.totalMarketValueUsd.toFixed(2)}</p>
              {/* Task 17 replaces the placeholder with the real most-recent as-of date. */}
              <p style={{ color: "#666" }}>Holdings last updated: —</p>
            </section>

            <section>
              <h2>Holdings</h2>
              <table border={1} cellPadding={6}>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Qty</th><th>Avg cost</th>
                    <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((p) => (
                    <tr key={`${p.accountId}-${p.assetId}`}>
                      <td>{p.symbol}</td>
                      <td>{p.quantity.toFixed(4)}</td>
                      <td>{p.avgCostUsd ? p.avgCostUsd.toFixed(2) : "—"}</td>
                      <td>{p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : "no price yet"}</td>
                      <td>{p.priceDate ?? "—"}</td>
                      <td>{p.marketValueUsd ? p.marketValueUsd.toFixed(2) : "—"}</td>
                      <td>{p.unrealisedPlUsd ? p.unrealisedPlUsd.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </>
  );
}
