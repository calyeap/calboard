import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getPool } from "../../lib/db";
import { createRun, recordFactDecision, recordProfileDecision } from "../../lib/analyzer/runStore";
import { loadGateState } from "../../lib/analyzer/gate";
import { analysisForReport } from "../../lib/analyzer/reportAnalysis";
import { buildSlotCatalogue } from "../../lib/analyzer/ai/slots";
import type { AnalysisResult } from "../../lib/analyzer/types";

// ---------------------------------------------------------------------------
// One real run, end to end, through the M7 flow — and then a report of what
// the two M8-b calls produced.
//
// This drives the SAME functions the routes drive: loadGateState for the Step
// 2 queue, recordFactDecision for each decision, recordProfileDecision for
// Step 6, and analysisForReport for Steps 8-10. Nothing here is a shortcut
// past a gate; a run that has not completed its spot-check gets the same
// refusal from this script as from the browser.
//
// The last section is the point. It re-walks every figure in every [C]
// sentence and prints the field it came from, so the traceability claim can be
// READ rather than taken on the say-so of a green test.
//
//   npm run ai-run -- MSFT
//   npm run ai-run -- OKLO
// ---------------------------------------------------------------------------

const COMPANY_NAMES: Record<string, string> = {
  MSFT: "Microsoft Corporation",
  OKLO: "Oklo Inc.",
};

function heading(text: string): void {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

/**
 * Prints each figure a [C] sentence rests on, with the Analysis Result field
 * it was substituted from.
 *
 * §8.3 limit 3 is checked mechanically inside the AI layer — an output that
 * fails it never becomes a result at all. This is that check made legible: the
 * catalogue is rebuilt from the same Analysis Result and every recorded value
 * id is looked up in it. A miss here would mean a figure reached the page
 * without a field behind it.
 */
function reportTraceability(result: AnalysisResult): void {
  const catalogue = buildSlotCatalogue(result);
  const sentences = [
    ...result.interpretation.statements.map((s, i) => ({ where: `statement ${i + 1}`, s })),
    ...(result.interpretation.pageOne === null
      ? []
      : Object.entries(result.interpretation.pageOne).map(([key, s]) => ({ where: `page one — ${key}`, s }))),
  ];

  let cited = 0;
  let missing = 0;
  for (const { where, s } of sentences) {
    for (const id of s.referencesValueIds) {
      const slot = catalogue.get(id);
      cited += 1;
      if (slot === undefined) {
        missing += 1;
        console.log(`  UNTRACEABLE  ${where}: ${id}`);
      } else {
        console.log(`  ok  ${where}: ${id} = ${slot.formatted}${slot.suppressed ? "  [state, not a number]" : ""}`);
      }
    }
  }
  console.log(`\n  ${cited} figure reference(s) in [C] prose; ${missing} without a field behind them.`);
}

async function main(): Promise<void> {
  const ticker = (process.argv[2] ?? "").toUpperCase();
  if (ticker === "") {
    console.error("Usage: npm run ai-run -- <TICKER>");
    process.exit(1);
  }

  heading(`${ticker} — a real run through the M7 flow`);

  const runId = await createRun(ticker, COMPANY_NAMES[ticker] ?? ticker);
  console.log(`run ${runId}`);

  // Step 2. Every queued fact carries a decision, or nothing computes (§2).
  const gateState = await loadGateState(runId);
  console.log(`Step 2: ${gateState.queuedCount} fact(s) queued for spot-check`);
  for (const factId of gateState.outstandingFactIds) {
    await recordFactDecision(runId, factId, "CONFIRMED", null);
  }

  // Step 6. Confirming the recommendation, which is what keeps trust CLEAN
  // rather than PARTIAL — the position slot's suppression path is M7's and is
  // not what this script is exercising.
  const recommended = gateState.fixture.profile.recommended;
  await recordProfileDecision(runId, "CONFIRMED", recommended, null);
  console.log(`Step 6: profile CONFIRMED as ${recommended}`);

  // Steps 8-10, including the two M8-b calls.
  const report = await analysisForReport(runId);

  heading(`AI layer — ${report.aiLayer.status}`);
  if (report.aiLayer.model !== null) console.log(`model: ${report.aiLayer.model}`);
  if (report.aiLayer.detail !== null) console.log(report.aiLayer.detail);

  heading("Section I — interpretation [C]");
  if (report.result.interpretation.statements.length === 0) {
    console.log("(none)");
  } else {
    for (const s of report.result.interpretation.statements) {
      console.log(`\n[${s.responsibility}]\n${s.statement}`);
    }
  }

  heading("Page one — the four variable sentences (§10.7 rule 2)");
  const pageOne = report.result.interpretation.pageOne;
  if (pageOne === null) {
    console.log("(none — page one falls back to its deterministic template)");
  } else {
    for (const [key, s] of Object.entries(pageOne)) {
      console.log(`\n${key}: ${s.statement}`);
    }
  }

  heading("Section I2 — challenger findings (a call that did not see the analysis)");
  if (report.result.challenger === null) {
    console.log("(none)");
  } else {
    console.log(`completed at ${report.result.challenger.completedAt}`);
    if (report.result.challenger.findings.length === 0) {
      console.log("\nThe independent call recorded no finding against this fact set.");
    }
    for (const f of report.result.challenger.findings) {
      console.log(`\nbears on: ${f.claimOrFactReference}`);
      console.log(`evidence: ${f.evidence}`);
      console.log(`what would have to be true: ${f.whatWouldHaveToBeTrue}`);
    }
  }

  heading("Every figure in [C] output, traced to its field (§8.3 limit 3)");
  reportTraceability(report.result);

  console.log(`\nReport: /analyzer/${runId}/report\n`);
  await getPool().end();
}

main().catch(async (err) => {
  console.error(err);
  await getPool().end();
  process.exit(1);
});
