import Decimal from "decimal.js";
import { getPool } from "./db";
import { isValidCalendarDate } from "./dateValidation";

export type ReconciliationStatus = "ok" | "investigating" | "resolved";
const VALID_STATUSES: ReconciliationStatus[] = ["ok", "investigating", "resolved"];

export interface RecordReconciliationInput {
  accountName: string;
  asOfDate: string; // YYYY-MM-DD
  brokerReportedCashUsd: Decimal;
  status: ReconciliationStatus;
  notes?: string | null;
}

export interface RecordReconciliationResult {
  reconciliationId: string;
  accountId: number;
  systemComputedCashUsd: Decimal;
  maxDeltaPct: Decimal | null;
}

// Phase B's smallest safe admin path to compare Calboard's imported totals
// against a broker/exchange statement after the opening import — no manual
// SQL, no automation or scheduling. system_computed is read straight from
// the DB (never guessed or hand-entered); broker_reported and the resulting
// status are supplied by the human reviewing the comparison.
export async function recordAccountReconciliation(
  input: RecordReconciliationInput
): Promise<RecordReconciliationResult> {
  if (!isValidCalendarDate(input.asOfDate)) {
    throw new Error(`asOfDate must be a valid YYYY-MM-DD calendar date (got "${input.asOfDate}")`);
  }
  if (!VALID_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of ${VALID_STATUSES.join(", ")} (got "${input.status}")`);
  }

  const pool = getPool();
  const accountRows = await pool.query<{ id: number }>(
    `SELECT id FROM accounts WHERE name = $1`,
    [input.accountName]
  );
  if (accountRows.rows.length === 0) {
    throw new Error(`No account found named "${input.accountName}" — refusing to guess`);
  }
  if (accountRows.rows.length > 1) {
    throw new Error(`Account name "${input.accountName}" matches more than one account — disambiguate manually`);
  }
  const accountId = accountRows.rows[0].id;

  const cashRow = await pool.query<{ cash_usd: string }>(
    `SELECT cash_usd FROM account_cash WHERE account_id = $1`,
    [accountId]
  );
  const systemComputedCashUsd = cashRow.rows.length > 0 ? new Decimal(cashRow.rows[0].cash_usd) : new Decimal(0);

  const positionRows = await pool.query<{ symbol: string; quantity: string; cost_basis_usd: string }>(
    `SELECT a.primary_symbol AS symbol, p.quantity, p.cost_basis_usd
     FROM positions_current p JOIN assets a ON a.id = p.asset_id
     WHERE p.account_id = $1 AND p.quantity <> 0
     ORDER BY a.primary_symbol`,
    [accountId]
  );
  const systemComputedPositions = positionRows.rows.map((r) => ({
    symbol: r.symbol,
    quantity: new Decimal(r.quantity).toString(),
    cost_basis_usd: new Decimal(r.cost_basis_usd).toString(),
  }));

  const brokerCash = input.brokerReportedCashUsd;
  // When broker-reported cash is exactly zero, dividing by it is undefined;
  // fall back to a base of 1 so any mismatch still reports as a large,
  // impossible-to-miss percentage rather than throwing or dividing by zero.
  // Not a literal "percent of broker cash" in that case — it's a big-number
  // flag for the human reviewing the reconciliation, not a precise metric.
  const deltaBase = brokerCash.abs().eq(0) ? new Decimal(1) : brokerCash.abs();
  const maxDeltaPct = systemComputedCashUsd.sub(brokerCash).abs().div(deltaBase).mul(100);

  const brokerReported = { cash_usd: brokerCash.toString() };
  const systemComputed = { cash_usd: systemComputedCashUsd.toString(), positions: systemComputedPositions };

  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO account_reconciliations
         (account_id, as_of_date, scope, broker_reported, system_computed, max_delta_pct, status, notes)
       VALUES ($1, $2, 'total', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        accountId,
        input.asOfDate,
        JSON.stringify(brokerReported),
        JSON.stringify(systemComputed),
        maxDeltaPct.toFixed(6),
        input.status,
        input.notes ?? null,
      ]
    );
    return {
      reconciliationId: inserted.rows[0].id,
      accountId,
      systemComputedCashUsd,
      maxDeltaPct,
    };
  } catch (err) {
    if (err instanceof Error && /duplicate key value/i.test(err.message)) {
      throw new Error(
        `A 'total' reconciliation for this account on ${input.asOfDate} already exists — refusing to duplicate it`
      );
    }
    throw err;
  }
}
