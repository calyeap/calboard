import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { createAccountAction, createTransactionAction } from "./actions";

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = await getPortfolioView();

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>Calboard</h1>

      <section>
        <h2>Portfolio value</h2>
        <p style={{ fontSize: "1.5rem" }}>US${portfolio.totalPortfolioValueUsd.toFixed(2)}</p>
        <p>
          Cash: US${portfolio.totalCashUsd.toFixed(2)} &middot; Holdings: US$
          {portfolio.totalMarketValueUsd.toFixed(2)}
        </p>
      </section>

      <section>
        <h2>Holdings</h2>
        <table border={1} cellPadding={6}>
          <thead>
            <tr>
              <th>Symbol</th><th>Account</th><th>Qty</th><th>Avg cost</th>
              <th>Price</th><th>Price date</th><th>Market value</th><th>Unrealised P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={`${p.accountId}-${p.assetId}`}>
                <td>{p.symbol}</td>
                <td>{p.accountName}</td>
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

      <section>
        <h2>Accounts</h2>
        <ul>
          {accounts.map((a) => (
            <li key={a.id}>{a.name}{a.custodian ? ` (${a.custodian})` : ""}</li>
          ))}
        </ul>
        <form action={createAccountAction}>
          <input name="name" placeholder="Account name" required />
          <input name="custodian" placeholder="Custodian (optional)" />
          <button type="submit">Add account</button>
        </form>
      </section>

      <section>
        <h2>Add transaction</h2>
        <form action={createTransactionAction}>
          <select name="accountId" required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select name="txnType" required>
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
          <input name="tradeDate" type="date" required />
          <input name="amount" placeholder="Amount (deposit/withdrawal)" />
          <input name="ticker" placeholder="Ticker (buy/sell)" />
          <select name="assetClass">
            <option value="equity">Equity</option>
            <option value="etf">ETF</option>
            <option value="crypto">Crypto</option>
          </select>
          <input name="quantity" placeholder="Quantity (buy/sell)" />
          <input name="priceUsd" placeholder="Price USD (buy/sell)" />
          <input name="feesUsd" placeholder="Fees USD" defaultValue="0" />
          <input name="note" placeholder="Note (optional)" />
          <button type="submit">Add transaction</button>
        </form>
      </section>
    </main>
  );
}
