import { config } from "dotenv";
config({ path: ".env.local" });

import Decimal from "decimal.js";
import { recordAccountReconciliation, type ReconciliationStatus } from "../lib/accountReconciliation";
import { getPool } from "../lib/db";

const VALID_STATUSES: ReconciliationStatus[] = ["ok", "investigating", "resolved"];

function usage(): never {
  console.error(
    "Usage: npm run record-reconciliation -- <ACCOUNT_NAME> <AS_OF_DATE:YYYY-MM-DD> " +
      "<BROKER_REPORTED_CASH_USD> <STATUS:ok|investigating|resolved> [NOTES...]\n" +
      'Example: npm run record-reconciliation -- "Cutover Brokerage" 2026-01-01 50000 ok "matches statement"'
  );
  process.exit(1);
}

async function main() {
  const [accountName, asOfDate, brokerCashRaw, statusRaw, ...notesParts] = process.argv.slice(2);
  if (!accountName || !asOfDate || !brokerCashRaw || !statusRaw) {
    usage();
  }
  if (!VALID_STATUSES.includes(statusRaw as ReconciliationStatus)) {
    console.error(`STATUS must be one of ${VALID_STATUSES.join(", ")} (got "${statusRaw}")`);
    usage();
  }

  const result = await recordAccountReconciliation({
    accountName,
    asOfDate,
    brokerReportedCashUsd: new Decimal(brokerCashRaw),
    status: statusRaw as ReconciliationStatus,
    notes: notesParts.length > 0 ? notesParts.join(" ") : null,
  });

  console.log(
    `Recorded reconciliation ${result.reconciliationId} for account ${result.accountId} on ${asOfDate}.`
  );
  console.log(`  System-computed cash: ${result.systemComputedCashUsd.toFixed(2)}`);
  console.log(`  Broker-reported cash: ${brokerCashRaw}`);
  console.log(`  Delta: ${result.maxDeltaPct!.toFixed(4)}%`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
