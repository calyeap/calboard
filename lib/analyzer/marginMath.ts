import Decimal from "decimal.js";

// Shared arithmetic over a chronological margin window (oldest first,
// current year last) — used by both the §6.4 triggers (gates.ts) and the
// §7.2 M3 margin/history diagnostic, so the two never compute range,
// median or worst-decline by two different routes.

export function windowMax(margins: Decimal[]): Decimal {
  return Decimal.max(...margins);
}

export function windowMin(margins: Decimal[]): Decimal {
  return Decimal.min(...margins);
}

export function windowRange(margins: Decimal[]): Decimal {
  return windowMax(margins).minus(windowMin(margins));
}

export function windowMedian(margins: Decimal[]): Decimal {
  const sorted = [...margins].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? sorted[mid - 1].plus(sorted[mid]).dividedBy(2) : sorted[mid];
}

// The largest positive year-over-year drop in the window — zero if the
// margin never declined from one year to the next.
export function worstSingleYearDecline(margins: Decimal[]): Decimal {
  let worst = new Decimal(0);
  for (let i = 0; i < margins.length - 1; i++) {
    const decline = margins[i].minus(margins[i + 1]);
    if (decline.greaterThan(worst)) {
      worst = decline;
    }
  }
  return worst;
}
