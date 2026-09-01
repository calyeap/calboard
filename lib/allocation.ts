import Decimal from "decimal.js";
import { formatAssetClass, type AssetClass } from "./assets";

// Minimal input the allocation view needs from a PositionView — kept
// decoupled from lib/portfolio.ts so this stays a pure, framework-free
// helper. `marketValueUsd` is the SAME per-position value getPortfolioView
// already computed (quantity × latest price); null means the holding has no
// usable price and is excluded from the allocation entirely.
export interface AllocationInput {
  symbol: string;
  marketValueUsd: Decimal | null;
}

export interface AllocationEntry {
  symbol: string;
  marketValueUsd: string; // formatted "1234.56"
  percent: string; // formatted "42.50" — of the priced portfolio total
  percentNumber: number; // the same percentage as a plain Number, for SVG geometry only
}

export interface AllocationResult {
  hasAllocation: boolean; // false ⇒ no holding has a usable market value
  entries: AllocationEntry[]; // one per priced holding, in the given order
  totalUsd: string; // === totalMarketValueUsd.toFixed(2) — the Dashboard "Portfolio Value"
}

// Allocation by holding, priced market value only.
//
//  - current AND stale priced holdings are usable (their marketValueUsd is
//    non-null), so both are included;
//  - a holding whose market value is unavailable (no usable price) is
//    excluded from the entries;
//  - percentages use `totalMarketValueUsd` — the exact aggregate the
//    Dashboard shows as "Portfolio Value" — as the denominator, so there is
//    no second competing total; the caller displays that same Decimal in the
//    donut centre.
export function computeAllocation(
  positions: AllocationInput[],
  totalMarketValueUsd: Decimal
): AllocationResult {
  const totalUsd = totalMarketValueUsd.toFixed(2);

  const priced = positions.filter(
    (p): p is { symbol: string; marketValueUsd: Decimal } => p.marketValueUsd !== null
  );

  if (priced.length === 0 || totalMarketValueUsd.lte(0)) {
    return { hasAllocation: false, entries: [], totalUsd };
  }

  const entries: AllocationEntry[] = priced.map((p) => {
    const pct = p.marketValueUsd.div(totalMarketValueUsd).mul(100);
    return {
      symbol: p.symbol,
      marketValueUsd: p.marketValueUsd.toFixed(2),
      percent: pct.toFixed(2),
      percentNumber: pct.toNumber(),
    };
  });

  return { hasAllocation: true, entries, totalUsd };
}

export interface AssetClassGroupingInput {
  symbol: string;
  assetClass: AssetClass;
  marketValueUsd: Decimal | null;
}

// Aggregates priced holdings by asset class into the same AllocationInput
// shape computeAllocation already accepts, so the allocation-by-class view
// reuses that one calculation unchanged — only the grouping is new. A class
// with no priced holding at all is omitted rather than passed through as a
// null entry, matching computeAllocation's own exclusion of the unpriced.
export function groupByAssetClass(positions: AssetClassGroupingInput[]): AllocationInput[] {
  const sums = new Map<AssetClass, Decimal>();
  for (const p of positions) {
    if (p.marketValueUsd === null) continue;
    const running = sums.get(p.assetClass) ?? new Decimal(0);
    sums.set(p.assetClass, running.add(p.marketValueUsd));
  }
  return Array.from(sums.entries()).map(([assetClass, marketValueUsd]) => ({
    symbol: formatAssetClass(assetClass),
    marketValueUsd,
  }));
}
