import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { computeCashEffectUsd, SupportedTxnType } from "./cashEffect";
import { EMPTY_POSITION, applyBuy, applySell, applyAdjustment, avgCostUsd, PositionState } from "./positions";

export interface NewTransactionInput {
  accountId: number;
  assetId: string | null; // BIGINT — node-postgres returns int8 as string, never Number
  txnType: SupportedTxnType;
  tradeDate: string; // ISO date, e.g. "2026-01-15"
  quantity: Decimal | null;
  priceUsd: Decimal | null;
  feesUsd: Decimal;
  grossAmountUsd: Decimal | null;
  note: string | null;
}

export async function applyTransaction(
  input: NewTransactionInput,
  providedClient?: PoolClient
): Promise<{ transactionId: string }> {
  const cashEffectUsd = computeCashEffectUsd({
    txnType: input.txnType,
    quantity: input.quantity,
    priceUsd: input.priceUsd,
    feesUsd: input.feesUsd,
    grossAmountUsd: input.grossAmountUsd,
  });

  const pool = getPool();
  const client = providedClient ?? (await pool.connect());
  const ownsTransaction = !providedClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");

    // For DEPOSIT/WITHDRAWAL/BUY/SELL this column is always a non-negative
    // magnitude. For an opening-cash ADJUSTMENT it instead carries
    // grossAmountUsd verbatim — the caller's signed cash effect — since
    // that's the only value available; do not assume gross_amount_usd >= 0
    // when reading ADJUSTMENT rows.
    const grossAmount =
      input.quantity && input.priceUsd
        ? input.quantity.mul(input.priceUsd)
        : input.grossAmountUsd;

    const txnResult = await client.query<{ id: string }>(
      `INSERT INTO transactions
         (account_id, asset_id, txn_type, trade_date, quantity, price_usd,
          gross_amount_usd, fees_usd, cash_effect_usd, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.accountId,
        input.assetId,
        input.txnType,
        input.tradeDate,
        input.quantity ? input.quantity.toFixed(10) : null,
        input.priceUsd ? input.priceUsd.toFixed(10) : null,
        grossAmount ? grossAmount.toFixed(10) : null,
        input.feesUsd.toFixed(10),
        cashEffectUsd.toFixed(10),
        input.note,
      ]
    );
    const transactionId = txnResult.rows[0].id;

    // Recompute account cash from the full ledger — correct and simple at this data volume.
    const cashRow = await client.query<{ total: string | null }>(
      `SELECT SUM(cash_effect_usd) AS total FROM transactions WHERE account_id = $1`,
      [input.accountId]
    );
    const cashTotal = new Decimal(cashRow.rows[0].total ?? "0");
    await client.query(
      `INSERT INTO account_cash (account_id, cash_usd, computed_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_id) DO UPDATE SET cash_usd = EXCLUDED.cash_usd, computed_at = now()`,
      [input.accountId, cashTotal.toFixed(10)]
    );

    // Recompute positions_current for this (account, asset) if this txn touches a position.
    if (input.assetId && (input.txnType === "BUY" || input.txnType === "SELL" || input.txnType === "ADJUSTMENT")) {
      const priorRow = await client.query<{
        quantity: string; cost_basis_usd: string; realised_pl_usd: string; first_acquired: string | null;
      }>(
        `SELECT quantity, cost_basis_usd, realised_pl_usd, first_acquired FROM positions_current
         WHERE account_id = $1 AND asset_id = $2`,
        [input.accountId, input.assetId]
      );
      const hasPrior = priorRow.rows.length > 0;
      const prior: PositionState = hasPrior
        ? {
            quantity: new Decimal(priorRow.rows[0].quantity),
            costBasisUsd: new Decimal(priorRow.rows[0].cost_basis_usd),
            realisedPlUsd: new Decimal(priorRow.rows[0].realised_pl_usd),
          }
        : EMPTY_POSITION;
      const firstAcquired = hasPrior ? priorRow.rows[0].first_acquired : input.tradeDate;

      // priceUsd carries the trade price for BUY/SELL, but for ADJUSTMENT it
      // carries the trusted opening average cost per unit — applyAdjustment
      // sets the position directly rather than accumulating it as a trade,
      // so an opening-position import is never recorded as though it were
      // a purchase at a market price.
      const next =
        input.txnType === "BUY"
          ? applyBuy(prior, input.quantity!, input.priceUsd!, input.feesUsd)
          : input.txnType === "SELL"
            ? applySell(prior, input.quantity!, input.priceUsd!, input.feesUsd)
            : applyAdjustment(prior, input.quantity!, input.priceUsd!);

      const avg = avgCostUsd(next);

      await client.query(
        `INSERT INTO positions_current
           (account_id, asset_id, quantity, cost_basis_usd, avg_cost_usd, realised_pl_usd, first_acquired, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (account_id, asset_id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           cost_basis_usd = EXCLUDED.cost_basis_usd,
           avg_cost_usd = EXCLUDED.avg_cost_usd,
           realised_pl_usd = EXCLUDED.realised_pl_usd,
           computed_at = now()`,
        [
          input.accountId,
          input.assetId,
          next.quantity.toFixed(10),
          next.costBasisUsd.toFixed(10),
          avg ? avg.toFixed(10) : null,
          next.realisedPlUsd.toFixed(10),
          firstAcquired,
        ]
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return { transactionId };
  } catch (err) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}
