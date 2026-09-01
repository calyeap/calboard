"use server";

import { revalidatePath } from "next/cache";
import { upsertLatestPrice } from "@/lib/marketdata";
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import type { AssetClass } from "@/lib/assets";

// Spec §8's "retry affordance" for an unavailable/stale price. Attempts a
// fresh fetch on demand; failures are reported back to the caller rather
// than thrown, since this runs from a button click, not a form submission.
export async function retryPriceFetchAction(
  assetId: string,
  symbol: string,
  assetClass: AssetClass
): Promise<{ ok: boolean; message?: string }> {
  try {
    await upsertLatestPrice(assetId, symbol, assetClass);
    // Both surfaces render prices now — the Dashboard and the /holdings editor.
    revalidatePath("/");
    revalidatePath("/holdings");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Price fetch failed." };
  }
}

function priceKey(priceDate: string | null, priceUsd: import("decimal.js").default | null): string {
  return `${priceDate ?? ""}|${priceUsd?.toString() ?? ""}`;
}

// The Dashboard's ONE global refresh control (spec: per-holding Retry is
// gone from the Dashboard). Manual only — never called on a timer or on
// mount. Refreshes every holding, tolerating individual failures so one bad
// symbol never blocks the rest; `changed` lets the caller show an honest
// "checked, nothing changed" state instead of implying something happened
// when an EOD refresh (as most are) finds nothing new.
export async function refreshAllPricesAction(): Promise<{
  ok: boolean;
  changed: boolean;
  message?: string;
}> {
  const holdings = await getAllHoldings();
  if (holdings.length === 0) {
    return { ok: true, changed: false };
  }

  const before = await getPortfolioView();
  const beforeKeys = new Map(before.positions.map((p) => [p.assetId, priceKey(p.priceDate, p.latestPriceUsd)]));

  const results = await Promise.allSettled(
    holdings.map((h) => upsertLatestPrice(h.assetId, h.symbol, h.assetClass))
  );
  const failures = results.filter((r) => r.status === "rejected").length;

  if (failures === holdings.length) {
    return { ok: false, changed: false, message: "Price refresh failed for every holding." };
  }

  revalidatePath("/");
  revalidatePath("/holdings");

  const after = await getPortfolioView();
  const changed = after.positions.some(
    (p) => beforeKeys.get(p.assetId) !== priceKey(p.priceDate, p.latestPriceUsd)
  );

  return failures > 0
    ? { ok: true, changed, message: `${failures} of ${holdings.length} holdings couldn't be refreshed.` }
    : { ok: true, changed };
}
