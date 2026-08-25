import { getPool } from "../db";

// TDD §3.1 split-corruption guard. 2% tolerance is verbatim from the spec.
// The spec's ratio list (2, 3, 4, 1.5, 0.5, 0.1, "…") is illustrative, not
// exhaustive — a narrow reading would miss real events this guard exists to
// catch (e.g. NVDA's actual June 2024 split was 10:1, not 4:1). Forward
// ratios cover every split multiple seen in recent large-cap history
// (Tesla 5:1 2020, Apple 7:1 2014, NVDA 10:1 2021/2024, Amazon/Alphabet
// 20:1 2022); reverse ratios are their reciprocals for symmetric coverage
// of reverse splits.
const FORWARD_SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20];
const COMMON_SPLIT_RATIOS = [
  ...FORWARD_SPLIT_RATIOS,
  ...FORWARD_SPLIT_RATIOS.map((r) => 1 / r),
];
const TOLERANCE = 0.02;

export function matchesCommonSplitRatio(ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return COMMON_SPLIT_RATIOS.some((r) => Math.abs(ratio - r) <= r * TOLERANCE);
}

export type SplitCheckOutcome = "clean" | "possible_unrecorded_split" | "benchmark_unavailable";

export interface SplitCheckResult {
  suspected: boolean;
  ratio: number;
  outcome: SplitCheckOutcome;
  flagged: boolean;
}

const SPLIT_RULE = "possible_unrecorded_split";
const BENCHMARK_UNAVAILABLE_RULE = "split_check_benchmark_unavailable";

// Raises (or reuses, if already raised for the exact same detail) a
// data_quality_flags row. Dedupe is on exact content so re-running ingestion
// over the same range — idempotent by design — doesn't spam a fresh flag
// every run.
async function raiseFlag(assetId: string, rule: string, severity: "error", detail: string): Promise<void> {
  const pool = getPool();
  const existing = await pool.query(
    `SELECT 1 FROM data_quality_flags WHERE entity_type = 'asset' AND entity_id = $1 AND rule = $2 AND detail = $3`,
    [assetId, rule, detail]
  );
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO data_quality_flags (entity_type, entity_id, rule, severity, detail, raised_at)
       VALUES ('asset', $1, $2, $3, $4, now())`,
      [assetId, rule, severity, detail]
    );
  }
}

async function getRawClose(assetId: string, date: string): Promise<number | null> {
  const pool = getPool();
  // Freshest row wins if more than one source has a price for this date —
  // this leg only needs a plausible raw close, not source-level precision.
  const row = await pool.query<{ close: string }>(
    `SELECT close FROM prices_daily WHERE asset_id = $1 AND price_date = $2 ORDER BY retrieved_at DESC LIMIT 1`,
    [assetId, date]
  );
  return row.rows.length > 0 ? Number(row.rows[0].close) : null;
}

// TDD §3.1: "ratio = close(T-1) / close(T) using UNADJUSTED closes; if ratio
// is within 2% of a common split ratio AND no corporate_action exists for
// that asset with ex_date = T AND no comparable move exists in the asset's
// benchmark -> raise data_quality_flag('possible_unrecorded_split',
// severity='error')".
//
// The benchmark leg is evaluated via assets.benchmark_asset_id — no new
// schema concept. A missing benchmark link or missing benchmark price data
// is never treated as "no comparable move" (that would silently weaken the
// guard exactly when it can't actually check); it raises a distinct
// 'split_check_benchmark_unavailable' flag instead, so a real historical
// backfill can never be considered clean by omission.
export async function checkSplitCorruption(
  assetId: string,
  prevDate: string,
  prevClose: number,
  currDate: string,
  currClose: number
): Promise<SplitCheckResult> {
  const ratio = prevClose / currClose;
  if (!matchesCommonSplitRatio(ratio)) {
    return { suspected: false, ratio, outcome: "clean", flagged: false };
  }

  const pool = getPool();
  const corporateAction = await pool.query(
    `SELECT 1 FROM corporate_actions
     WHERE asset_id = $1 AND action_type IN ('split', 'reverse_split') AND ex_date = $2`,
    [assetId, currDate]
  );
  if (corporateAction.rows.length > 0) {
    return { suspected: true, ratio, outcome: "clean", flagged: false };
  }

  const assetRow = await pool.query<{ benchmark_asset_id: string | null }>(
    `SELECT benchmark_asset_id FROM assets WHERE id = $1`,
    [assetId]
  );
  const benchmarkAssetId = assetRow.rows[0]?.benchmark_asset_id ?? null;

  const splitDetail =
    `Unadjusted close ratio ${ratio.toFixed(4)} between ${prevDate} (${prevClose}) and ` +
    `${currDate} (${currClose}) matches a common split ratio; no corporate_actions row ` +
    `exists for ex_date=${currDate}.`;

  if (benchmarkAssetId === null) {
    await raiseFlag(
      assetId,
      BENCHMARK_UNAVAILABLE_RULE,
      "error",
      `${splitDetail} Cannot evaluate the TDD §3.1 benchmark leg: no benchmark_asset_id configured for this asset.`
    );
    return { suspected: true, ratio, outcome: "benchmark_unavailable", flagged: true };
  }

  const [benchmarkPrev, benchmarkCurr] = await Promise.all([
    getRawClose(benchmarkAssetId, prevDate),
    getRawClose(benchmarkAssetId, currDate),
  ]);
  if (benchmarkPrev === null || benchmarkCurr === null) {
    const missingDate = benchmarkPrev === null ? prevDate : currDate;
    await raiseFlag(
      assetId,
      BENCHMARK_UNAVAILABLE_RULE,
      "error",
      `${splitDetail} Cannot evaluate the TDD §3.1 benchmark leg: no prices_daily row for ` +
        `benchmark asset ${benchmarkAssetId} on ${missingDate}.`
    );
    return { suspected: true, ratio, outcome: "benchmark_unavailable", flagged: true };
  }

  const benchmarkRatio = benchmarkPrev / benchmarkCurr;
  if (matchesCommonSplitRatio(benchmarkRatio)) {
    // The benchmark itself moved by a comparable split-sized ratio over the
    // same two dates — the asset's move isn't specific to it, so this isn't
    // classified as an asset-specific unrecorded split.
    return { suspected: true, ratio, outcome: "clean", flagged: false };
  }

  await raiseFlag(assetId, SPLIT_RULE, "error", splitDetail);
  return { suspected: true, ratio, outcome: "possible_unrecorded_split", flagged: true };
}
