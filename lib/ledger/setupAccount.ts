import Decimal from "decimal.js";
import { getPool } from "../db";
import { createAccount } from "../accounts";
import { applyOpeningPositionAdjustment } from "./openingImport";

export interface SetupHoldingInput {
  assetId: string;
  quantity: Decimal;
  avgCostUsd: Decimal;
}

export interface SetupAccountInput {
  name: string;
  custodian: string | null;
  asOfDate: string; // YYYY-MM-DD — the date the entered figures represent
  holdings: SetupHoldingInput[];
}

export interface SetupAccountResult {
  accountId: number;
  holdingTransactionIds: string[];
}

// Thrown when the COMMIT command itself fails in a way that leaves the
// write outcome genuinely unknown (e.g. the connection drops between
// sending COMMIT and receiving Postgres's acknowledgement). Distinct from
// every pre-COMMIT failure: no ROLLBACK is attempted (there may be nothing
// left to roll back, and issuing one could itself throw without telling us
// anything), and the outcome must NEVER be inferred from whether an
// account of the given name now exists (duplicate names are allowed).
// Task 14 maps this to status: "save_unknown", never "save_failed".
export class SetupCommitUncertainError extends Error {
  readonly commitError: unknown;
  constructor(message: string, commitError: unknown) {
    super(message);
    this.name = "SetupCommitUncertainError";
    this.commitError = commitError;
  }
}

// Atomically creates the single hidden portfolio account, declares every
// opening holding, and records one portfolio-level snapshot-confirmation
// row in audit_log — all in ONE Postgres transaction on ONE caller-owned
// client. Either the whole snapshot lands or nothing does. There is no
// cash in V1, so no opening-cash adjustment is ever written, and
// account_reconciliations is deliberately not touched (pressing Save is
// not a broker reconciliation).
export async function setupAccount(input: SetupAccountInput): Promise<SetupAccountResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const account = await createAccount(input.name, input.custodian, client);

    // The wizard always starts from an empty portfolio, so
    // applyOpeningPositionAdjustment is correct here — its "refuse if a
    // non-zero position already exists" guard never trips. It runs on the
    // injected client, so it participates in this transaction.
    const holdingTransactionIds: string[] = [];
    for (const holding of input.holdings) {
      const { transactionId } = await applyOpeningPositionAdjustment(
        {
          accountId: account.id,
          assetId: holding.assetId,
          tradeDate: input.asOfDate,
          quantity: holding.quantity,
          avgCostUsd: holding.avgCostUsd,
          note: "OPENING IMPORT: setup",
        },
        client
      );
      holdingTransactionIds.push(transactionId);
    }

    // Portfolio-level snapshot confirmation (spec §9.2, model rule 10).
    // audit_log.at (DEFAULT now()) is the confirmation timestamp — the
    // moment the user confirmed the whole visible portfolio. The as-of
    // date the figures represent is stored separately in the JSON payload.
    await client.query(
      `INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
       VALUES ('accounts', $1, 'snapshot_confirm', 'user', NULL, jsonb_build_object('as_of_date', $2::text))`,
      [account.id, input.asOfDate]
    );

    try {
      await client.query("COMMIT");
    } catch (commitErr) {
      throw new SetupCommitUncertainError(
        "COMMIT failed — the setup's saved state is unknown; do not retry blindly, check the Dashboard.",
        commitErr
      );
    }

    return { accountId: account.id, holdingTransactionIds };
  } catch (err) {
    if (err instanceof SetupCommitUncertainError) {
      // The COMMIT outcome is ambiguous — issuing a ROLLBACK now is
      // meaningless and could itself throw without telling us anything.
      throw err;
    }
    // Every pre-COMMIT failure means nothing was saved. Attempt ROLLBACK,
    // but never let a failing ROLLBACK replace/mask the original error.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      if (err instanceof Error) {
        (err as Error & { rollbackError?: unknown }).rollbackError = rollbackErr;
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
