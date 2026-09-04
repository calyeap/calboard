import Decimal from "decimal.js";

// The app's ONE money policy.
//
// Calboard displays money to the cent everywhere (DESIGN.md: "money 2 dp;
// a detail row and its aggregate are computed and formatted identically").
// That rule only holds if rounding happens at a single, known point rather
// than falling out of whatever each display path happens to do — which is
// exactly how the Dashboard and /holdings came to disagree by a cent on the
// same holding.
//
// Two things follow, and both matter:
//
//  1. Round the PRICE to the cent before multiplying, not after. Providers
//     serve prices as JS floats and lib/marketdata/index.ts persists them at
//     6dp, so a real 703.41 close is stored 703.409973 and a real 80532.58
//     close as 80532.578125. Both routes display that price as $703.41, so
//     both must also multiply by 703.41 — otherwise "price × quantity" does
//     not reconcile with the market value shown on the same row.
//  2. Round each row, then sum the ROUNDED rows for the aggregate. Summing
//     first and rounding once makes the headline total disagree with the
//     rows printed underneath it.
//
// ROUND_HALF_UP is decimal.js's default and the conventional money rule; it
// is named explicitly here so the tie-breaking direction is a decision on
// the record rather than an inherited default. It is what makes BTC's
// 0.25 × 80532.58 = 20133.145 settle at 20133.15 on both routes.
export const MONEY_DP = 2;

export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

// Market value of a position — the one definition, used by the Dashboard's
// server-computed rows, the portfolio total, and the /holdings editor's
// live-edited rows alike. `priceUsd` must already be cent-rounded (see
// getPortfolioView).
export function marketValue(quantity: Decimal, priceUsd: Decimal): Decimal {
  return roundMoney(quantity.mul(priceUsd));
}

// Unrealised gain/loss vs average cost — (price − avgCost) × quantity, the
// one definition behind the per-row figure on both routes AND the aggregate
// in getPortfolioView.
export function unrealisedPl(
  quantity: Decimal,
  priceUsd: Decimal,
  avgCostUsd: Decimal
): Decimal {
  return roundMoney(priceUsd.sub(avgCostUsd).mul(quantity));
}
