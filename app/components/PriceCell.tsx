"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryPriceFetchAction } from "@/app/actions/prices";
import type { AssetClass } from "@/lib/assets";
import type { PriceStatus } from "@/lib/portfolio";

export function PriceCell({
  assetId,
  symbol,
  assetClass,
  priceStatus,
  priceUsd,
  priceDate,
}: {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  priceStatus: PriceStatus;
  priceUsd: string | null;
  priceDate: string | null;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    const result = await retryPriceFetchAction(assetId, symbol, assetClass);
    setRetrying(false);
    if (!result.ok) {
      setRetryError(result.message ?? "Price fetch failed.");
      return;
    }
    router.refresh();
  }

  if (priceStatus === "current") {
    return <span>${priceUsd}</span>;
  }

  if (priceStatus === "stale") {
    return (
      // Muted, not near-invisible: the Task 28 muted-text token instead of the
      // old #888, which the plan flagged as too weak.
      <span style={{ color: "var(--color-text-muted)" }}>
        ${priceUsd} <span style={{ fontSize: "0.85em" }}>(as of {priceDate})</span>{" "}
        <button type="button" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry"}
        </button>
        {retryError && (
          <div className="status-danger" role="alert">
            {retryError}
          </div>
        )}
      </span>
    );
  }

  return (
    <span>
      No price yet{" "}
      <button type="button" onClick={handleRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
      {retryError && (
        <div className="status-danger" role="alert">
          {retryError}
        </div>
      )}
    </span>
  );
}
