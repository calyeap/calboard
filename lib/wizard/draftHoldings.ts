import Decimal from "decimal.js";

export type CostBasisMode = "average" | "total";

// Spec §4: cost-basis mode is chosen once for the snapshot. When
// "total" is chosen, the wizard divides by quantity to derive the average
// cost that applyOpeningPositionAdjustment actually stores — that function
// only ever receives an average cost, regardless of which mode the user
// picked in the UI.
export function computeAvgCostUsd(quantity: Decimal, costInput: Decimal, mode: CostBasisMode): Decimal {
  if (mode === "average") return costInput;
  if (quantity.eq(0)) {
    throw new Error("Cannot derive an average cost from a total cost basis when quantity is zero");
  }
  return costInput.div(quantity);
}

// Spec §4: case-insensitive duplicate-ticker block within the draft.
export function isDuplicateTickerInDraft(existingTickers: string[], newTicker: string): boolean {
  const normalized = newTicker.trim().toUpperCase();
  return existingTickers.some((t) => t.trim().toUpperCase() === normalized);
}
