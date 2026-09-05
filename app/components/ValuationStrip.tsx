import Decimal from "decimal.js";
import type { AnalysisResult } from "@/lib/analyzer/types";

// E1 — an authorised deviation from §17.16, not something either mock
// shows (Calvin approved it directly; the frozen artefacts are pending
// re-freeze). The SAME component "Investment case — at a glance" already
// renders, reused here as a header above Quick Read's eight items rather
// than duplicated — one component, two call sites, identical figures.
// Every value below already exists in the AnalysisResult; nothing here
// computes, rounds differently, or invents a score/verdict/target.
//
// `showLocation` is Quick Read's own addition (the price-location line);
// the closing recap's call site omits it and keeps its exact prior
// appearance — the grid only, unchanged.

function num(value: Decimal, dp = 2): string {
  return value.toFixed(dp);
}

function formatRange(range: { low: Decimal; high: Decimal }): string {
  return range.low.equals(range.high) ? `$${num(range.low)}` : `$${num(range.low)} - $${num(range.high)}`;
}

export function ValuationStrip({ result, showLocation = false }: { result: AnalysisResult; showLocation?: boolean }) {
  const { preRevenue, fairValueRange, scenarioOutputs } = result;
  const locationPct = scenarioOutputs.priceLocationWithinRange.mul(100).toFixed(0);

  if (preRevenue) {
    return (
      <>
        <div className="atglance" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div>
            <span className="lb">Failure — cash floor</span>
            <span className="fig">${num(preRevenue.cashPerShare)}</span>
          </div>
          <div>
            <span className="lb">Success as described</span>
            <span className="fig">
              {fairValueRange.kind === "pre-revenue-distribution" ? formatRange(fairValueRange.successAsCommonlyDescribed) : "—"}
            </span>
          </div>
          <div className="cur">
            <span className="lb">Current price</span>
            <span className="fig">${num(result.price.value)}</span>
          </div>
        </div>
        {showLocation && <p className="striploc">{locationPct}% of the way from failure to success</p>}
      </>
    );
  }

  return (
    <>
      <div className="atglance">
        <div>
          <span className="lb">Bear</span>
          <span className="fig">{fairValueRange.kind === "range" ? `$${num(fairValueRange.bear, 0)}` : "—"}</span>
        </div>
        <div>
          <span className="lb">Base</span>
          <span className="fig">${num(scenarioOutputs.values.base, 0)}</span>
        </div>
        <div>
          <span className="lb">Bull</span>
          <span className="fig">{fairValueRange.kind === "range" ? `$${num(fairValueRange.bull, 0)}` : "—"}</span>
        </div>
        <div className="cur">
          <span className="lb">Current price</span>
          <span className="fig">${num(result.price.value)}</span>
        </div>
      </div>
      {showLocation && <p className="striploc">{locationPct}% of the way from bear to bull</p>}
    </>
  );
}
