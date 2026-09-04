import Decimal from "decimal.js";
import { MONEY_DP, roundMoney } from "./money";

// Display-layer only. Never apply to a value bound to an editable input —
// Holdings' Quantity and Avg cost inputs stay raw so save-time Decimal
// parsing is unaffected by a thousands separator.
const usdFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: MONEY_DP,
  maximumFractionDigits: MONEY_DP,
});

// Rounds through Decimal, NOT through the binary float Intl would otherwise
// round for us. An exact half-cent like 20133.145 is not representable as a
// double — the nearest one sits just below it — so handing Intl a Number
// broke the tie downward by accident, in the opposite direction from
// lib/money.ts's stated ROUND_HALF_UP policy. Rounding first makes the value
// exact at 2dp, after which the Number conversion is lossless and Intl only
// has thousands separators left to add.
export function formatUsd(value: Decimal | number | string): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return usdFormatter.format(Number(roundMoney(d).toFixed(MONEY_DP)));
}

// Matches DashboardHoldingsTable's signed P&L treatment exactly: −$ (U+2212
// minus, not a hyphen) for negative, +$ for positive.
export function formatSignedUsd(d: Decimal): string {
  return d.isNegative() ? `−$${formatUsd(d.abs())}` : `+$${formatUsd(d)}`;
}
