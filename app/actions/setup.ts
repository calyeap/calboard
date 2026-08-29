"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { resolveOrCreateAsset, type AssetClass } from "@/lib/assets";
import { upsertLatestPrice } from "@/lib/marketdata";
import { lookupCrypto } from "@/lib/marketdata/cryptoSymbols";
import { isValidCalendarDate, isFutureDate, normalizePgDate } from "@/lib/dateValidation";
import { setupAccount, SetupCommitUncertainError } from "@/lib/ledger/setupAccount";

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

  // A cryptocurrency is resolved only through the verified crypto registry —
  // never by its bare ticker, which on the price provider can be an unrelated
  // ETF or equity (the M1.1 "BTC -> Grayscale Bitcoin Mini Trust ETF" bug).
  // An unverified crypto symbol fails closed: no asset row, nothing to "add
  // anyway", and never a silently-substituted instrument.
  let canonicalName = symbol;
  if (assetClass === "crypto") {
    const instrument = lookupCrypto(symbol);
    if (!instrument) {
      return {
        ok: false,
        assetId: null,
        message:
          `"${symbol}" is not a supported cryptocurrency. Calboard tracks a specific ` +
          `set of verified cryptocurrencies, and this symbol is not one of them.`,
      };
    }
    canonicalName = instrument.name;
  }

  const asset = await resolveOrCreateAsset(symbol, assetClass, canonicalName);

  // Upgrade a pre-hotfix asset that stored its bare ticker as the name to the
  // verified canonical name (idempotent — a no-op once corrected).
  if (assetClass === "crypto" && asset.name !== canonicalName) {
    await getPool().query(`UPDATE assets SET name = $1 WHERE id = $2`, [canonicalName, asset.id]);
    asset.name = canonicalName;
  }

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
