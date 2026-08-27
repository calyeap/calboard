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
      <span style={{ color: "#888" }}>
        ${priceUsd} <span style={{ fontSize: "0.85em" }}>(as of {priceDate})</span>{" "}
        <button type="button" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry"}
        </button>
        {retryError && <div style={{ color: "#b00020" }}>{retryError}</div>}
      </span>
    );
  }

  return (
    <span>
      No price yet{" "}
      <button type="button" onClick={handleRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
      {retryError && <div style={{ color: "#b00020" }}>{retryError}</div>}
    </span>
  );
}
