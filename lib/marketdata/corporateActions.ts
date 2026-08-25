import { getPool } from "../db";

export interface RecordSplitInput {
  ticker: string;
  exDate: string; // YYYY-MM-DD
  ratioNum: number;
  ratioDen: number;
}

export interface RecordSplitResult {
  corporateActionId: string;
  assetId: string;
  actionType: "split" | "reverse_split";
  resolvedFlagIds: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Phase B's smallest safe administrative path for confirming a genuine
// historical split without manual SQL. Records the corporate action and
// resolves any matching split_guard flag for the same asset/date in one
// transaction — a failure in either half rolls back both, so the guard
// never ends up in a state where a flag is cleared but no corporate action
// backs it, or vice versa.
export async function recordConfirmedSplit(input: RecordSplitInput): Promise<RecordSplitResult> {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) {
    throw new Error("ticker is required");
  }
  if (!isValidCalendarDate(input.exDate)) {
    throw new Error(`exDate must be a valid YYYY-MM-DD calendar date (got "${input.exDate}")`);
  }
  if (
    !Number.isFinite(input.ratioNum) ||
    !Number.isFinite(input.ratioDen) ||
    input.ratioNum <= 0 ||
    input.ratioDen <= 0
  ) {
    throw new Error("ratioNum and ratioDen must both be positive numbers");
  }
  if (input.ratioNum === input.ratioDen) {
    throw new Error("ratioNum and ratioDen must differ — a 1:1 ratio is not a split");
  }
  const actionType: "split" | "reverse_split" = input.ratioNum > input.ratioDen ? "split" : "reverse_split";

  const pool = getPool();
  const assetRows = await pool.query<{ id: string }>(`SELECT id FROM assets WHERE primary_symbol = $1`, [ticker]);
  if (assetRows.rows.length === 0) {
    throw new Error(`No asset found for ticker "${ticker}" — refusing to guess`);
  }
  if (assetRows.rows.length > 1) {
    throw new Error(
      `Ticker "${ticker}" matches more than one asset (multiple exchanges) — refusing to guess; disambiguate manually`
    );
  }
  const assetId = assetRows.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Matches the exact detail text checkSplitCorruption writes for this
    // ex_date, for either rule it can raise (see splitGuard.ts).
    const likePattern = `%ex_date=${input.exDate}.%`;
    const resolved = await client.query<{ id: string }>(
      `UPDATE data_quality_flags
       SET resolved_at = now()
       WHERE entity_type = 'asset' AND entity_id = $1
         AND rule IN ('possible_unrecorded_split', 'split_check_benchmark_unavailable')
         AND resolved_at IS NULL
         AND detail LIKE $2
       RETURNING id`,
      [assetId, likePattern]
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO corporate_actions (asset_id, action_type, ex_date, ratio_num, ratio_den, applied_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [assetId, actionType, input.exDate, input.ratioNum, input.ratioDen]
    );

    await client.query("COMMIT");
    return {
      corporateActionId: inserted.rows[0].id,
      assetId,
      actionType,
      resolvedFlagIds: resolved.rows.map((r) => r.id),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof Error && /duplicate key value/i.test(err.message)) {
      throw new Error(
        `A ${actionType} corporate action for ${ticker} on ${input.exDate} is already recorded — refusing to duplicate it`
      );
    }
    throw err;
  } finally {
    client.release();
  }
}
