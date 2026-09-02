import Decimal from "decimal.js";

// Display-layer only. Never apply to a value bound to an editable input —
// Holdings' Quantity and Avg cost inputs stay raw so save-time Decimal
// parsing is unaffected by a thousands separator.
const usdFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: Decimal | number | string): string {
  const n = value instanceof Decimal ? value.toNumber() : Number(value);
  return usdFormatter.format(n);
}

// Matches DashboardHoldingsTable's signed P&L treatment exactly: −$ (U+2212
// minus, not a hyphen) for negative, +$ for positive.
export function formatSignedUsd(d: Decimal): string {
  return d.isNegative() ? `−$${formatUsd(d.abs())}` : `+$${formatUsd(d)}`;
}
