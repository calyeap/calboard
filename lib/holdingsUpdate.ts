import Decimal from "decimal.js";

export interface HoldingSnapshot {
  assetId: string; // BIGINT — node-postgres returns int8 as string, never Number
  quantity: Decimal;
  avgCostUsd: Decimal;
}

export type HoldingTarget = HoldingSnapshot;

// Pure diff of the stored holdings against the edited ("desired") ones.
//
// The ADJUSTMENT ledger primitive sets a position ABSOLUTELY —
// positions.ts `applyAdjustment` ignores the prior quantity and cost — so
// this emits absolute desired targets, never deltas.
//
//   - unchanged quantity AND avg cost            -> omitted
//   - present in `desired` with either changed   -> { assetId, quantity, avgCostUsd } verbatim
//   - absent from `desired` (removed)            -> { assetId, quantity: 0, avgCostUsd: prior avg }
//
// The removed-holding's prior avg cost is carried only as the internal
// `priceUsd` placeholder `applyTransaction` needs; `applyAdjustment`
// multiplies it by a zero quantity, so it never affects stored state.
export function diffHoldings(
  current: HoldingSnapshot[],
  desired: HoldingSnapshot[]
): { targets: HoldingTarget[] } {
  const currentById = new Map(current.map((c) => [c.assetId, c]));
  const desiredIds = new Set(desired.map((d) => d.assetId));
  const targets: HoldingTarget[] = [];

  for (const d of desired) {
    const c = currentById.get(d.assetId);
    const changed = !c || !c.quantity.eq(d.quantity) || !c.avgCostUsd.eq(d.avgCostUsd);
    if (changed) {
      targets.push({ assetId: d.assetId, quantity: d.quantity, avgCostUsd: d.avgCostUsd });
    }
  }

  for (const c of current) {
    if (!desiredIds.has(c.assetId)) {
      targets.push({ assetId: c.assetId, quantity: new Decimal(0), avgCostUsd: c.avgCostUsd });
    }
  }

  return { targets };
}
