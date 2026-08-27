import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { isValidCalendarDate } from "../dateValidation";
import { applyTransaction } from "./applyTransaction";

const OPENING_IMPORT_PREFIX = "OPENING IMPORT:";

function requireOpeningImportNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error("note is required for an opening import adjustment");
  }
  if (!trimmed.startsWith(OPENING_IMPORT_PREFIX)) {
    throw new Error(`note must begin with "${OPENING_IMPORT_PREFIX}"`);
  }
  return trimmed;
}

function requireValidTradeDate(tradeDate: string): void {
  if (!isValidCalendarDate(tradeDate)) {
    throw new Error(`tradeDate must be a valid YYYY-MM-DD calendar date (got "${tradeDate}")`);
  }
}

export interface OpeningCashAdjustmentInput {
  accountId: number;
  tradeDate: string; // YYYY-MM-DD
  cashEffectUsd: Decimal; // signed — the exact opening cash balance effect
  note: string; // must begin with "OPENING IMPORT:"
}

// Phase B, case 1: opening cash. No asset, no quantity — the signed cash
// effect is applied directly to derived account cash. See TDD's ADJUSTMENT
// txn_type and this session's approved spot-only cutover workflow.
export async function applyOpeningCashAdjustment(
  input: OpeningCashAdjustmentInput,
  client?: PoolClient
): Promise<{ transactionId: string }> {
  const note = requireOpeningImportNote(input.note);
  requireValidTradeDate(input.tradeDate);

  return applyTransaction(
    {
      accountId: input.accountId,
      assetId: null,
      txnType: "ADJUSTMENT",
      tradeDate: input.tradeDate,
      quantity: null,
      priceUsd: null,
      feesUsd: new Decimal(0),
      grossAmountUsd: input.cashEffectUsd,
      note,
    },
    client
  );
}

export interface OpeningPositionAdjustmentInput {
  accountId: number;
  assetId: string;
  tradeDate: string; // YYYY-MM-DD
  quantity: Decimal; // positive
  avgCostUsd: Decimal; // positive — the trusted opening average cost per unit
  note: string; // must begin with "OPENING IMPORT:"
}

// Phase B, case 2: opening position. Quantity and a trusted average cost are
// declared directly (cost basis = quantity x avgCostUsd); this must never
// consume cash. Refuses to run if the account/asset already carries a
// non-zero position — the approved model defines opening-a-fresh-position
// only, not correcting an existing one, so guessing at that behavior here
// would be out of scope.
export async function applyOpeningPositionAdjustment(
  input: OpeningPositionAdjustmentInput,
  client?: PoolClient
): Promise<{ transactionId: string }> {
  const note = requireOpeningImportNote(input.note);
  requireValidTradeDate(input.tradeDate);
  if (!input.quantity.isFinite() || input.quantity.lte(0)) {
    throw new Error("quantity must be positive");
  }
  if (!input.avgCostUsd.isFinite() || input.avgCostUsd.lte(0)) {
    throw new Error("avgCostUsd must be positive");
  }

  // Not transactionally atomic with the insert below (a plain SELECT, not
  // SELECT ... FOR UPDATE inside the same transaction as applyTransaction's
  // write) — acceptable for a single-operator one-time cutover import, not
  // for concurrent use. When a caller injects its own client, this SELECT
  // runs on that client (so it sees the caller's in-flight transaction).
  const db = client ?? getPool();
  const existing = await db.query<{ quantity: string }>(
    `SELECT quantity FROM positions_current WHERE account_id = $1 AND asset_id = $2`,
    [input.accountId, input.assetId]
  );
  if (existing.rows.length > 0 && !new Decimal(existing.rows[0].quantity).eq(0)) {
    throw new Error(
      "This account/asset already has a non-zero position on record — opening-position import only " +
        "supports a fresh position. The approved model does not define a safe adjustment-to-existing-" +
        "position rule, so this is refused rather than guessed."
    );
  }

  return applyTransaction(
    {
      accountId: input.accountId,
      assetId: input.assetId,
      txnType: "ADJUSTMENT",
      tradeDate: input.tradeDate,
      quantity: input.quantity,
      priceUsd: input.avgCostUsd,
      feesUsd: new Decimal(0),
      grossAmountUsd: new Decimal(0),
      note,
    },
    client
  );
}
