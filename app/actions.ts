"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { createAccount } from "@/lib/accounts";
import { resolveOrCreateAsset, type AssetClass } from "@/lib/assets";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { upsertLatestPrice } from "@/lib/marketdata";

export async function createAccountAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const custodian = String(formData.get("custodian") ?? "").trim() || null;
  if (!name) throw new Error("Account name is required");
  await createAccount(name, custodian);
  revalidatePath("/");
}

export async function createTransactionAction(formData: FormData) {
  const accountId = Number(formData.get("accountId"));
  const txnType = String(formData.get("txnType")) as "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";
  const tradeDate = String(formData.get("tradeDate"));
  const feesUsd = new Decimal(String(formData.get("feesUsd") || "0"));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (txnType === "DEPOSIT" || txnType === "WITHDRAWAL") {
    const amount = new Decimal(String(formData.get("amount")));
    await applyTransaction({
      accountId, assetId: null, txnType, tradeDate,
      quantity: null, priceUsd: null, feesUsd, grossAmountUsd: amount, note,
    });
  } else {
    const ticker = String(formData.get("ticker")).toUpperCase().trim();
    const assetClass = String(formData.get("assetClass")) as AssetClass;
    const quantity = new Decimal(String(formData.get("quantity")));
    const priceUsd = new Decimal(String(formData.get("priceUsd")));

    const asset = await resolveOrCreateAsset(ticker, assetClass, ticker);
    await applyTransaction({
      accountId, assetId: asset.id, txnType, tradeDate,
      quantity, priceUsd, feesUsd, grossAmountUsd: null, note,
    });

    try {
      await upsertLatestPrice(asset.id, ticker, assetClass);
    } catch (err) {
      // Best-effort: the dashboard shows "no price yet" if this fails; the
      // transaction itself has already committed successfully above. Logged
      // (never retried) so a provider quota/failure error is visible rather than silent.
      console.error("Price fetch skipped:", err instanceof Error ? err.message : err);
    }
  }

  revalidatePath("/");
}
