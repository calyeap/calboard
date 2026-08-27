"use server";

import Decimal from "decimal.js";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset, type AssetClass } from "@/lib/assets";
import { upsertLatestPrice } from "@/lib/marketdata";
import { normalizePgDate } from "@/lib/dateValidation";

export type TickerResolutionResult =
  | { ok: true; assetId: string; assetClass: AssetClass; priceUsd: string; priceDate: string }
  | { ok: false; assetId: string | null; message: string };

// The wizard's holdings step and the /holdings editor both call this on a
// ticker the user typed. resolveOrCreateAsset always upserts a reference
// row (so an unresolved-but-real symbol can still be "added anyway"); the
// live price fetch — reusing the app's existing upsertLatestPrice, cache
// and all — is the resolution signal. A failed/absent price never silently
// becomes a confirmed holding; it returns ok:false with the assetId so the
// caller can offer an explicit override.
export async function resolveTickerAction(
  ticker: string,
  assetClass: AssetClass
): Promise<TickerResolutionResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, assetId: null, message: "Enter a ticker symbol." };
  }

  const asset = await resolveOrCreateAsset(symbol, assetClass, symbol);

  const notFound: TickerResolutionResult = {
    ok: false,
    assetId: asset.id,
    message: `Couldn't find a price for "${symbol}". Check the symbol, or add it anyway if you're sure it's correct.`,
  };

  try {
    await upsertLatestPrice(asset.id, symbol, assetClass);
  } catch {
    return notFound;
  }

  const pool = getPool();
  const priceRow = await pool.query<{ close: string; price_date: string | Date }>(
    `SELECT close, price_date FROM prices_daily WHERE asset_id = $1 ORDER BY price_date DESC LIMIT 1`,
    [asset.id]
  );
  if (priceRow.rows.length === 0) {
    return notFound;
  }

  return {
    ok: true,
    assetId: asset.id,
    assetClass,
    priceUsd: new Decimal(priceRow.rows[0].close).toFixed(2),
    priceDate: normalizePgDate(priceRow.rows[0].price_date),
  };
}
