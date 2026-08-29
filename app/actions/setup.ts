"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset, findAssetBySymbol, type Asset, type AssetClass } from "@/lib/assets";
import { upsertLatestPrice, activeProvider } from "@/lib/marketdata";
import { lookupCrypto } from "@/lib/marketdata/cryptoSymbols";
import { isValidCalendarDate, isFutureDate, normalizePgDate } from "@/lib/dateValidation";
import { setupAccount, SetupCommitUncertainError } from "@/lib/ledger/setupAccount";

export type TickerResolutionResult =
  | { ok: true; assetId: string; assetClass: AssetClass; priceUsd: string; priceDate: string }
  | { ok: false; assetId: string | null; message: string };

const NOT_A_SYMBOL_MESSAGE = (symbol: string) =>
  `Couldn't find "${symbol}". Check the symbol and try again.`;
const UNSUPPORTED_TYPE_MESSAGE = (symbol: string) =>
  `"${symbol}" isn't a supported equity or ETF.`;
const PROVIDER_UNAVAILABLE_MESSAGE = (symbol: string) =>
  `Couldn't verify "${symbol}" right now — the market data provider is unavailable. Try again shortly.`;
const NOT_A_CRYPTO_MESSAGE = (symbol: string) =>
  `"${symbol}" is not a supported cryptocurrency. Calboard tracks a specific ` +
  `set of verified cryptocurrencies, and this symbol is not one of them.`;
const PRICE_UNAVAILABLE_MESSAGE = (symbol: string) =>
  `Identity confirmed for "${symbol}", but its live price is unavailable right now. ` +
  `You can still add it — the price will refresh automatically once it's back.`;

// Resolves the (ticker, assetClass) the user typed to a real instrument's
// identity — separately from whether a live price is available for it right
// now. Equity/ETF identity comes from the active provider's
// resolveInstrument(); crypto identity comes only from the verified registry
// (lib/marketdata/cryptoSymbols.ts), unchanged. An unknown, unsupported, or
// provider-unavailable identity NEVER creates an asset row — there is
// nothing left to "add anyway". Once identity is confirmed, a failed price
// fetch still returns the created asset's id so the holding can still be
// added (price shows as unavailable and can be retried later); it is never
// treated as proof the identity itself was invalid.
export async function resolveTickerAction(
  ticker: string,
  assetClass: AssetClass
): Promise<TickerResolutionResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) {
    return { ok: false, assetId: null, message: "Enter a ticker symbol." };
  }

  let asset: Asset;

  if (assetClass === "crypto") {
    // A cryptocurrency is resolved only through the verified crypto
    // registry — never by its bare ticker, which on the price provider can
    // be an unrelated ETF or equity (the M1.1 "BTC -> Grayscale Bitcoin Mini
    // Trust ETF" bug). This is a cheap local lookup, not a provider call, so
    // it always runs — even for an already-known asset — to correct a stale
    // pre-hotfix name.
    const instrument = lookupCrypto(symbol);
    if (!instrument) {
      return { ok: false, assetId: null, message: NOT_A_CRYPTO_MESSAGE(symbol) };
    }
    asset = await resolveOrCreateAsset({ symbol, assetClass: "crypto", name: instrument.name });
    if (asset.name !== instrument.name) {
      await getPool().query(`UPDATE assets SET name = $1 WHERE id = $2`, [instrument.name, asset.id]);
      asset = { ...asset, name: instrument.name };
    }
  } else {
    // An already-known symbol short-circuits identity resolution entirely —
    // never a provider call for a symbol already on file.
    const existing = await findAssetBySymbol(symbol);
    if (existing) {
      asset = existing;
    } else {
      const resolution = await activeProvider().resolveInstrument(symbol);
      if (resolution.outcome === "unknown") {
        return { ok: false, assetId: null, message: NOT_A_SYMBOL_MESSAGE(symbol) };
      }
      if (resolution.outcome === "unsupported") {
        return { ok: false, assetId: null, message: UNSUPPORTED_TYPE_MESSAGE(symbol) };
      }
      if (resolution.outcome === "unavailable") {
        // Provider/network failure is never proof the symbol is invalid —
        // no asset row, but a distinct message from "unknown".
        return { ok: false, assetId: null, message: PROVIDER_UNAVAILABLE_MESSAGE(symbol) };
      }
      asset = await resolveOrCreateAsset({
        symbol: resolution.symbol,
        assetClass: resolution.assetClass,
        name: resolution.name,
      });
    }
  }

  const priceUnavailable: TickerResolutionResult = {
    ok: false,
    assetId: asset.id,
    message: PRICE_UNAVAILABLE_MESSAGE(symbol),
  };

  try {
    // Crypto resolves through the verified registry symbol every time: never
    // let a fresh bare-ticker price cached against this asset identity by a
    // pre-hotfix resolve (the ~$35 Grayscale ETF close) short-circuit the
    // fetch. equity/ETF keep the shared 12h price cache untouched.
    await upsertLatestPrice(asset.id, symbol, asset.assetClass, { force: asset.assetClass === "crypto" });
  } catch {
    return priceUnavailable;
  }

  const pool = getPool();
  const priceRow = await pool.query<{ close: string; price_date: string | Date }>(
    `SELECT close, price_date FROM prices_daily WHERE asset_id = $1 ORDER BY price_date DESC LIMIT 1`,
    [asset.id]
  );
  if (priceRow.rows.length === 0) {
    return priceUnavailable;
  }

  return {
    ok: true,
    assetId: asset.id,
    assetClass: asset.assetClass,
    priceUsd: new Decimal(priceRow.rows[0].close).toFixed(2),
    priceDate: normalizePgDate(priceRow.rows[0].price_date),
  };
}

// ---------------------------------------------------------------------------
// setupAccountAction — the wizard's Step 2 "Save" (spec §3.2, §3.3).
// ---------------------------------------------------------------------------

export interface SetupWizardHolding {
  assetId: string;
  quantity: string; // serialized Decimal — crosses the client→server boundary as text
  avgCostUsd: string; // the average cost the wizard already derived (mode handled client-side)
}

export interface SetupWizardInput {
  asOfDate: string;
  holdings: SetupWizardHolding[];
}

// A three-way outcome, never a boolean `ok` (spec revision 3):
//  - save_failed  : the transaction rolled back; nothing was saved.
//  - saved        : committed.
//  - save_unknown : a genuinely ambiguous COMMIT (SetupCommitUncertainError)
//                   OR the action call itself rejecting. The UI must never
//                   reuse "nothing was saved" copy for this case.
export type SetupWizardResult =
  | { status: "saved"; accountId: number }
  | { status: "save_failed"; message: string }
  | { status: "save_unknown"; message: string };

const SAVE_UNKNOWN_MESSAGE =
  "We couldn't confirm whether this saved — check the Dashboard before trying again.";

export async function setupAccountAction(input: SetupWizardInput): Promise<SetupWizardResult> {
  const { asOfDate, holdings } = input;

  // 1. Validate at the action layer — never inside the ledger primitives,
  //    whose own tested validation stays untouched.
  if (!isValidCalendarDate(asOfDate)) {
    return { status: "save_failed", message: "Choose a valid date for these figures." };
  }
  if (isFutureDate(asOfDate)) {
    return {
      status: "save_failed",
      message: "That date is in the future — enter the holdings you have now.",
    };
  }
  if (holdings.length === 0) {
    return { status: "save_failed", message: "Add at least one holding before saving." };
  }

  const parsed: { assetId: string; quantity: Decimal; avgCostUsd: Decimal }[] = [];
  for (const h of holdings) {
    let quantity: Decimal;
    let avgCostUsd: Decimal;
    try {
      quantity = new Decimal(h.quantity);
      avgCostUsd = new Decimal(h.avgCostUsd);
    } catch {
      return { status: "save_failed", message: "Couldn't read the numbers for one of your holdings." };
    }
    if (!quantity.isFinite() || quantity.lte(0)) {
      return { status: "save_failed", message: "Every holding needs a quantity greater than zero." };
    }
    if (!avgCostUsd.isFinite() || avgCostUsd.lte(0)) {
      return {
        status: "save_failed",
        message: "Every holding needs an average cost greater than zero.",
      };
    }
    // 2. Normalize the quantity once to NUMERIC(28,10)'s scale before it is
    //    written — not surfaced back to the user.
    parsed.push({ assetId: h.assetId, quantity: quantity.toDecimalPlaces(10), avgCostUsd });
  }

  // 3. One atomic commit. setupAccount owns the single client + transaction.
  let accountId: number;
  try {
    const result = await setupAccount({
      name: "My Portfolio",
      custodian: null,
      asOfDate,
      holdings: parsed,
    });
    accountId = result.accountId;
  } catch (err) {
    if (err instanceof SetupCommitUncertainError) {
      return { status: "save_unknown", message: SAVE_UNKNOWN_MESSAGE };
    }
    return {
      status: "save_failed",
      message: err instanceof Error ? err.message : "Something went wrong saving your portfolio.",
    };
  }

  // 4. Success — no verifySetup read-back in the flow (spec revision 3).
  revalidatePath("/");
  revalidatePath("/holdings");
  return { status: "saved", accountId };
}
