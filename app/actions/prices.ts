"use server";

import { revalidatePath } from "next/cache";
import { upsertLatestPrice } from "@/lib/marketdata";
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
