import Decimal from "decimal.js";
import type { FactUnit } from "./acquisition/factUnit";
import type { FactRecord } from "./types";

// ---------------------------------------------------------------------------
// How a fact's value is DISPLAYED. Ruled by Calvin, 8 September 2026.
//
// Acquisition produces exact figures in the filing's own units — an operating
// margin of 0.46780818408927220731, a net debt of 30045000000. No filing states
// a figure either way, so Step 2 was asking the analyst to confirm a form that
// appears in no document.
//
// The separation is the one already in force at the Decimal boundary: the exact
// value stays exact for calculation, provenance and the cross-checks, and this
// module produces a string for the screen. Nothing is ever recomputed FROM one
// of these strings — every consumer of a figure reads the Decimal.
//
// The unit is not inferred here. It arrives from acquisition (see
// acquisition/factUnit.ts, where it is the mapping's own enforced unit), and a
// fact whose unit is unknown is rendered exactly as acquired rather than
// guessed at.
// ---------------------------------------------------------------------------

const BILLION = new Decimal("1e9");
const MILLION = new Decimal("1e6");

/**
 * The value as the card shows it.
 *
 * §4.3 — absence is displayed, never rendered as zero, so a null value is a
 * dash whatever the unit.
 */
export function formatFactValue(
  value: FactRecord["value"],
  unit: FactUnit | null
): string {
  if (value === null) return "—";

  // A non-numeric fact value (§3.2 admits a string) has no unit arithmetic to
  // do — show it as it is.
  if (typeof value === "string" && !isNumeric(value)) return value;

  let d: Decimal;
  try {
    d = value instanceof Decimal ? value : new Decimal(String(value));
  } catch {
    return String(value);
  }

  switch (unit) {
    case "pure":
      return formatRatio(d);
    case "USD":
      return formatUsd(d);
    case "shares":
      return formatShares(d);
    default:
      // Unknown unit: the exact figure, unscaled. Never guessed at.
      return d.toString();
  }
}

/**
 * A ratio as a percentage to 0.1 of a point.
 *
 * §7.3's granularity for growth and margin, and the form every filing and every
 * one of the frozen mocks states a margin in: 46.8%, not 0.4678081840892722.
 */
function formatRatio(d: Decimal): string {
  return `${d.mul(100).toFixed(1)}%`;
}

/**
 * Money at the magnitude a filing states it.
 *
 * Billions and millions to one decimal, which is how the frozen mocks and the
 * filings' own summary lines read ($30.0B of net debt, $24.6B of ROU
 * additions). Below a million the exact figure with separators, because that is
 * the scale at which a filing prints the digits and an analyst compares them.
 */
export function formatUsd(d: Decimal): string {
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();

  if (abs.greaterThanOrEqualTo(BILLION)) {
    return `${sign}$${abs.div(BILLION).toFixed(1)}B`;
  }
  if (abs.greaterThanOrEqualTo(MILLION)) {
    return `${sign}$${abs.div(MILLION).toFixed(1)}M`;
  }
  return `${sign}$${group(abs)}`;
}

/**
 * A share count in full, with separators.
 *
 * Deliberately NOT scaled to billions. §3.5 turns on the exact count — the
 * cover page states 7,425,545,491 and the analyst checks that figure against
 * it, so "7.4B" would be the one form they cannot compare. This is the case
 * where the filing's own form IS the decision-readable one.
 */
function formatShares(d: Decimal): string {
  return `${group(d)} shares`;
}

function group(d: Decimal): string {
  const fixed = d.toFixed();
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function isNumeric(s: string): boolean {
  return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s.trim());
}
