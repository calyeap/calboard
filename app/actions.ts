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

// Parses a decimal form field, throwing a clear error instead of letting
// `new Decimal(...)` surface its own cryptic message. `transactions` is
// append-only with no in-app correction path, so a legible rejection here —
// before the write — is the only safety net.
//   - required: true  -> field must be present/non-empty (amount, quantity, priceUsd)
//   - required: false -> field may be absent, defaulting to `fallback` (feesUsd)
//   - allowZero: true  -> value must be >= 0 (priceUsd, feesUsd)
//   - allowZero: false -> value must be > 0 (amount, quantity)
function parseDecimalField(
  formData: FormData,
  fieldName: string,
  opts: { required: boolean; allowZero: boolean; fallback?: string }
): Decimal {
  const raw = formData.get(fieldName);
  const isEmpty = raw === null || String(raw).trim() === "";
  if (isEmpty && !opts.required) {
    return new Decimal(opts.fallback ?? "0");
  }
  if (isEmpty) {
    throw new Error(`${fieldName} is required`);
  }
  let value: Decimal;
  try {
    value = new Decimal(String(raw));
  } catch {
    throw new Error(`${fieldName} must be a valid number (got "${String(raw)}")`);
  }
  if (opts.allowZero ? value.lt(0) : value.lte(0)) {
    throw new Error(
      opts.allowZero ? `${fieldName} must not be negative` : `${fieldName} must be greater than zero`
    );
  }
  return value;
}

export async function createTransactionAction(formData: FormData) {
  const accountId = Number(formData.get("accountId"));
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error("A valid account must be selected");
  }
  const txnType = String(formData.get("txnType")) as "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";
  const tradeDate = String(formData.get("tradeDate"));
  const feesUsd = parseDecimalField(formData, "feesUsd", { required: false, allowZero: true, fallback: "0" });
  const note = String(formData.get("note") ?? "").trim() || null;

  if (txnType === "DEPOSIT" || txnType === "WITHDRAWAL") {
    const amount = parseDecimalField(formData, "amount", { required: true, allowZero: false });
    await applyTransaction({
      accountId, assetId: null, txnType, tradeDate,
      quantity: null, priceUsd: null, feesUsd, grossAmountUsd: amount, note,
    });
  } else {
    const tickerRaw = formData.get("ticker");
    const ticker = tickerRaw ? String(tickerRaw).toUpperCase().trim() : "";
    if (!ticker) throw new Error("Ticker is required");
    const assetClass = String(formData.get("assetClass")) as AssetClass;
    const quantity = parseDecimalField(formData, "quantity", { required: true, allowZero: false });
    const priceUsd = parseDecimalField(formData, "priceUsd", { required: true, allowZero: true });

    const asset = await resolveOrCreateAsset(ticker, assetClass, ticker);
    await applyTransaction({
      accountId, assetId: asset.id, txnType, tradeDate,
      quantity, priceUsd, feesUsd, grossAmountUsd: null, note,
    });

    try {
      await upsertLatestPrice(asset.id, ticker, asset.assetClass);
    } catch (err) {
      // Best-effort: the dashboard shows "no price yet" if this fails; the
      // transaction itself has already committed successfully above. Logged
      // (never retried) so a provider quota/failure error is visible rather than silent.
      console.error("Price fetch skipped:", err instanceof Error ? err.message : err);
    }
  }

  revalidatePath("/");
}
