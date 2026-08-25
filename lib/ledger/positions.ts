import Decimal from "decimal.js";

export interface PositionState {
  quantity: Decimal;
  costBasisUsd: Decimal;
  realisedPlUsd: Decimal;
}

export const EMPTY_POSITION: PositionState = {
  quantity: new Decimal(0),
  costBasisUsd: new Decimal(0),
  realisedPlUsd: new Decimal(0),
};

export function applyBuy(
  prior: PositionState,
  quantity: Decimal,
  priceUsd: Decimal,
  feesUsd: Decimal
): PositionState {
  const addedCost = quantity.mul(priceUsd).add(feesUsd);
  return {
    quantity: prior.quantity.add(quantity),
    costBasisUsd: prior.costBasisUsd.add(addedCost),
    realisedPlUsd: prior.realisedPlUsd,
  };
}

export function applySell(
  prior: PositionState,
  quantity: Decimal,
  priceUsd: Decimal,
  feesUsd: Decimal
): PositionState {
  if (quantity.gt(prior.quantity)) {
    throw new Error("Cannot sell more than current position quantity");
  }
  const avgCost = prior.quantity.eq(0)
    ? new Decimal(0)
    : prior.costBasisUsd.div(prior.quantity);
  const costRemoved = quantity.mul(avgCost);
  const proceeds = quantity.mul(priceUsd).sub(feesUsd);
  const realised = proceeds.sub(costRemoved);
  return {
    quantity: prior.quantity.sub(quantity),
    costBasisUsd: prior.costBasisUsd.sub(costRemoved),
    realisedPlUsd: prior.realisedPlUsd.add(realised),
  };
}

export function avgCostUsd(state: PositionState): Decimal | null {
  if (state.quantity.eq(0)) return null;
  return state.costBasisUsd.div(state.quantity);
}
