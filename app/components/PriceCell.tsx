import type { PriceStatus } from "@/lib/portfolio";
import { formatUsd } from "@/lib/formatUsd";

// Presentational only — no Retry (APPROVED BEHAVIOUR CHANGE #1: Holdings uses
// the page-level global refresh instead, same as the Dashboard). Mirrors
// DashboardHoldingsTable's price-cell pattern exactly: a stale or
// unavailable price gets a small marker dot and the reason in a `title`
// tooltip, never inline text, so both routes read price health identically.
export function PriceCell({
  priceStatus,
  priceUsd,
  priceDate,
}: {
  priceStatus: PriceStatus;
  priceUsd: string | null;
  priceDate: string | null;
}) {
  const degraded = priceStatus !== "current";
  const title =
    priceStatus === "stale"
      ? `Priced at ${priceDate} close`
      : priceStatus === "unavailable"
        ? "No price available"
        : undefined;

  return (
    <span className={degraded ? "stale" : undefined} title={title}>
      {degraded && <span className="marker" aria-hidden="true" />}
      {priceUsd ? `$${formatUsd(priceUsd)}` : "—"}
    </span>
  );
}
