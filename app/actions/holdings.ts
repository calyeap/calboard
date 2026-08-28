"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { isValidCalendarDate, isFutureDate } from "@/lib/dateValidation";
import { applyTransaction } from "@/lib/ledger/applyTransaction";
import { SetupCommitUncertainError } from "@/lib/ledger/setupAccount";
import { diffHoldings, type HoldingSnapshot } from "@/lib/holdingsUpdate";

export interface UpdateHoldingInput {
  assetId: string;
  quantity: string; // serialized Decimal across the client→server boundary
  avgCostUsd: string;
}

export interface UpdateHoldingsInput {
  asOfDate: string;
  holdings: UpdateHoldingInput[];
}

// Three-way outcome (never throws for a normal validation failure):
//  - { ok: true }                 : committed.
//  - { ok: false, errors }        : rejected (validation) OR rolled back
//                                   (definite mid-transaction failure);
//                                   nothing was saved.
//  - { ok: "unknown", message }   : the COMMIT was genuinely ambiguous.
export type UpdateHoldingsResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> }
  | { ok: "unknown"; message: string };

const SAVE_UNKNOWN_MESSAGE =
  "We couldn't confirm whether this saved — check the Dashboard before trying again.";

export async function updateHoldingsAction(
  input: UpdateHoldingsInput
): Promise<UpdateHoldingsResult> {
  const { asOfDate, holdings } = input;

  // 1. Validate at the action layer — the ledger primitives' own tested
  //    validation is untouched. No cash fields exist here.
  const errors: Record<string, string> = {};

  if (!isValidCalendarDate(asOfDate)) {
    errors.asOfDate = "Choose a valid date for these figures.";
  } else if (isFutureDate(asOfDate)) {
    errors.asOfDate = "That date is in the future — enter the holdings you have now.";
  }

  const desired: HoldingSnapshot[] = [];
  holdings.forEach((h, i) => {
    let quantity: Decimal | null = null;
    let avgCostUsd: Decimal | null = null;
    try {
      quantity = new Decimal(h.quantity);
    } catch {
      /* reported below */
    }
    try {
      avgCostUsd = new Decimal(h.avgCostUsd);
    } catch {
      /* reported below */
    }
    if (!quantity || !quantity.isFinite() || quantity.lt(0)) {
      errors[`holdings.${i}.quantity`] = "Quantity must be zero or greater.";
    }
    if (!avgCostUsd || !avgCostUsd.isFinite() || avgCostUsd.lte(0)) {
      errors[`holdings.${i}.avgCostUsd`] = "Average cost must be greater than zero.";
    }
    if (
      quantity &&
      avgCostUsd &&
      quantity.isFinite() &&
      avgCostUsd.isFinite() &&
      quantity.gte(0) &&
      avgCostUsd.gt(0)
    ) {
      // Normalize the quantity once to NUMERIC(28,10)'s scale — matches
      // setupAccountAction; not surfaced to the user.
      desired.push({ assetId: h.assetId, quantity: quantity.toDecimalPlaces(10), avgCostUsd });
    }
  });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // 2–4. Everything below runs on ONE pooled client inside ONE transaction:
  //   BEGIN
  //   -> resolve the single hidden portfolio account (V1 invariant)
  //   -> read current stored state (quantity AND avg cost — diffHoldings
  //      needs both to spot an avg-cost-only change and to carry a removed
  //      holding's prior avg cost as the internal price placeholder)
  //   -> one raw ADJUSTMENT per changed holding (the ADJUSTMENT primitive is
  //      an absolute setter — never a delta, never applyOpeningPositionAdjustment)
  //   -> exactly one audit_log snapshot_confirm row — written even when there
  //      is zero delta
  //   COMMIT
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const acctResult = await client.query<{ id: number }>(
      `SELECT id FROM accounts WHERE is_active = TRUE ORDER BY id`
    );
    if (acctResult.rows.length !== 1) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        errors: {
          form:
            acctResult.rows.length === 0
              ? "There is no portfolio to update yet — add your holdings first."
              : "Couldn't identify a single portfolio to update.",
        },
      };
    }
    const accountId = acctResult.rows[0].id;

    const currentResult = await client.query<{
      asset_id: string;
      quantity: string;
      avg_cost_usd: string | null;
    }>(
      `SELECT asset_id, quantity, avg_cost_usd FROM positions_current
       WHERE account_id = $1 AND quantity <> 0`,
      [accountId]
    );
    const current: HoldingSnapshot[] = currentResult.rows.map((r) => ({
      assetId: r.asset_id,
      quantity: new Decimal(r.quantity),
      avgCostUsd: new Decimal(r.avg_cost_usd ?? "0"),
    }));

    const { targets } = diffHoldings(current, desired);

    for (const target of targets) {
      await applyTransaction(
        {
          accountId,
          assetId: target.assetId,
          txnType: "ADJUSTMENT",
          tradeDate: asOfDate,
          quantity: target.quantity, // absolute; 0 for a removal
          priceUsd: target.avgCostUsd, // desired avg cost; prior avg for a removal
          feesUsd: new Decimal(0),
          grossAmountUsd: new Decimal(0),
          note: `SNAPSHOT UPDATE: ${asOfDate}`,
        },
        client
      );
    }

    await client.query(
      `INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
       VALUES ('accounts', $1, 'snapshot_confirm', 'user', NULL, jsonb_build_object('as_of_date', $2::text))`,
      [accountId, asOfDate]
    );

    try {
      await client.query("COMMIT");
    } catch (commitErr) {
      // The COMMIT outcome is genuinely unknown — do NOT ROLLBACK, do NOT
      // infer the result from stored state (model rule 10 / setupAccount).
      throw new SetupCommitUncertainError(
        "COMMIT failed — the holdings update's saved state is unknown; check the Dashboard before retrying.",
        commitErr
      );
    }
  } catch (err) {
    if (err instanceof SetupCommitUncertainError) {
      return { ok: "unknown", message: SAVE_UNKNOWN_MESSAGE };
    }
    // Every pre-COMMIT failure means nothing was saved. Attempt ROLLBACK,
    // but never let a failing ROLLBACK mask the original error.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* swallow — the original error is what matters */
    }
    return {
      ok: false,
      errors: { form: err instanceof Error ? err.message : "Couldn't save your holdings." },
    };
  } finally {
    client.release();
  }

  // 5. Success — no read-back verification in the flow (spec revision 3).
  revalidatePath("/");
  revalidatePath("/holdings");
  return { ok: true };
}
