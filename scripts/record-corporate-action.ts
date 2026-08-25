import { config } from "dotenv";
config({ path: ".env.local" });

import { recordConfirmedSplit } from "../lib/marketdata/corporateActions";
import { getPool } from "../lib/db";

function usage(): never {
  console.error(
    "Usage: npm run record-split -- <TICKER> <EX_DATE:YYYY-MM-DD> <RATIO_NUM> <RATIO_DEN>\n" +
      "Example (NVDA's real 10-for-1 split on 2024-06-07): npm run record-split -- NVDA 2024-06-07 10 1"
  );
  process.exit(1);
}

async function main() {
  const [ticker, exDate, ratioNumRaw, ratioDenRaw] = process.argv.slice(2);
  if (!ticker || !exDate || !ratioNumRaw || !ratioDenRaw) {
    usage();
  }

  const result = await recordConfirmedSplit({
    ticker,
    exDate,
    ratioNum: Number(ratioNumRaw),
    ratioDen: Number(ratioDenRaw),
  });

  console.log(
    `Recorded ${result.actionType} for asset ${result.assetId} ` +
      `(corporate_actions id ${result.corporateActionId}).`
  );
  if (result.resolvedFlagIds.length > 0) {
    console.log(
      `Resolved ${result.resolvedFlagIds.length} data_quality_flags row(s): ${result.resolvedFlagIds.join(", ")}`
    );
  } else {
    console.log("No matching unresolved data_quality_flags row found for this date — nothing to resolve.");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
