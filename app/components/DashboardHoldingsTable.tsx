import Decimal from "decimal.js";
import type { PositionView } from "@/lib/portfolio";
import { formatAssetClass } from "@/lib/assets";
import { formatUsd, formatSignedUsd } from "@/lib/formatUsd";
import { MaskableValue } from "./MaskableValue";

function plOf(p: PositionView): { usd: Decimal; pct: Decimal | null } | null {
  if (!p.latestPriceUsd || !p.avgCostUsd) return null;
  const usd = p.latestPriceUsd.sub(p.avgCostUsd).mul(p.quantity);
  const basis = p.avgCostUsd.mul(p.quantity);
  const pct = basis.isZero() ? null : usd.div(basis).mul(100);
  return { usd, pct };
}

function footnoteFor(p: PositionView): string | null {
  if (p.priceStatus === "stale") return `${p.symbol} is priced at ${p.priceDate} close.`;
  if (p.priceStatus === "unavailable") {
    return `${p.symbol} has no price and is excluded from portfolio value, allocation and P&L.`;
  }
  return null;
}

// The Dashboard's holdings display: a desktop table.holdings + a mobile
// .stack, generated from one pass over `positions` so the two markups can
// never drift. No per-row Retry — the Dashboard's global PriceRefreshControl
// replaced it; stale/unavailable prices are called out via a muted marker +
// colour plus one shared footnote naming every affected symbol and why.
export function DashboardHoldingsTable({ positions }: { positions: PositionView[] }) {
  const footnotes = positions.map(footnoteFor).filter((f): f is string => f !== null);

  return (
    <>
      <div className="editor-table">
        <table className="holdings">
          <colgroup>
            <col className="c-symbol" />
            <col className="c-type" />
            <col className="c-qty" />
            <col className="c-cost" />
            <col className="c-price" />
            <col className="c-mv" />
            <col className="c-pl" />
          </colgroup>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>Avg cost</th>
              <th>Price</th>
              <th>Market value</th>
              <th>Unrealised P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pl = plOf(p);
              const degraded = p.priceStatus !== "current";
              return (
                <tr key={p.assetId}>
                  <td className="sym">{p.symbol}</td>
                  <td className="dim">{formatAssetClass(p.assetClass)}</td>
                  <td className="num dim">
                    <MaskableValue>{p.quantity.toFixed(4)}</MaskableValue>
                  </td>
                  <td className="num dim">
                    {p.avgCostUsd ? <MaskableValue>{`$${formatUsd(p.avgCostUsd)}`}</MaskableValue> : "—"}
                  </td>
                  <td className={degraded ? "num stale" : "num"} title={footnoteFor(p) ?? undefined}>
                    {degraded && <span className="marker" aria-hidden="true" />}
                    {p.latestPriceUsd ? `$${formatUsd(p.latestPriceUsd)}` : "—"}
                  </td>
                  <td className="num strong">
                    {p.marketValueUsd ? (
                      <MaskableValue>{`$${formatUsd(p.marketValueUsd)}`}</MaskableValue>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`num strong${pl ? (pl.usd.isNegative() ? " loss" : " gain") : ""}`}>
                    {pl ? <MaskableValue>{formatSignedUsd(pl.usd)}</MaskableValue> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {footnotes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7}>{footnotes.join(" ")}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="stack">
        {positions.map((p) => {
          const pl = plOf(p);
          const note = footnoteFor(p);
          return (
            <div className="hrow" key={p.assetId}>
              <div className="line1">
                <span className="sym">{p.symbol}</span>
              </div>
              <div className="mv num">
                {p.marketValueUsd ? <MaskableValue>{`$${formatUsd(p.marketValueUsd)}`}</MaskableValue> : "No price"}
              </div>
              <div className="meta num">
                <MaskableValue>{p.quantity.toFixed(4)}</MaskableValue> &times;{" "}
                {p.avgCostUsd ? (
                  <MaskableValue>{`$${formatUsd(p.avgCostUsd)}`}</MaskableValue>
                ) : (
                  "—"
                )}{" "}
                avg &middot; {formatAssetClass(p.assetClass)}
              </div>
              {note && (
                <div className="meta stale">
                  <span className="marker" aria-hidden="true" />
                  {note}
                </div>
              )}
              {pl && (
                <div className={`pl num${pl.usd.isNegative() ? " loss" : " gain"}`}>
                  <MaskableValue>{formatSignedUsd(pl.usd)}</MaskableValue>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
