import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { getPool } from "../../lib/db";
import {
  createRun,
  recordFactDecision,
  recordJudgment,
  recordProfileDecision,
} from "../../lib/analyzer/runStore";
import { loadGateState } from "../../lib/analyzer/gate";
import { analysisForReport } from "../../lib/analyzer/reportAnalysis";
import { analystCallIfConfigured } from "../../lib/analyzer/ai/anthropicCall";
import type { AnalystCall } from "../../lib/analyzer/ai/analystCall";
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

  // §4.4's second judgment — WHICH INVESTMENTS ARE NON-OPERATING. No tag says,
  // so the software does not choose: left unrecorded, enterprise value is
  // INCOMPLETE and everything built on it reports that state, which is the
  // correct answer to a question nobody has answered.
  //
  // It is a FLAG here rather than a default for the same reason. Passing
  // --nonoperating records a judgment; the value printed below says which one
  // was recorded, so a run's output can never be read as though the analyzer
  // had decided this itself.
  const nonOperating = process.argv.find((a) => a.startsWith("--nonoperating="))?.split("=")[1];
  if (nonOperating !== undefined) {
    const candidates = gateState.acquired.acquired.acquisition.candidateNonOperatingInvestments;
    const selection =
      nonOperating === "none"
        ? "None of these are non-operating"
        : candidates.map((c) => c.tag).join(" + ");
    await recordJudgment(runId, "NON-OPERATING INVESTMENTS", selection, "Recorded for a verification run.");
    console.log(`§4.4 judgment: NON-OPERATING INVESTMENTS = ${selection}`);
  } else {
    console.log("§4.4 judgment: NON-OPERATING INVESTMENTS not recorded — enterprise value reports INCOMPLETE");
  }

  // Step 6. Confirming the recommendation, which is what keeps trust CLEAN
  // rather than PARTIAL — the position slot's suppression path is M7's and is
  // not what this script is exercising.
  const recommended = gateState.fixture.profile.recommended;
  await recordProfileDecision(runId, "CONFIRMED", recommended, null);
  console.log(`Step 6: profile CONFIRMED as ${recommended}`);

  // Steps 8-10, including the two M8-b calls.
  //
  // The call is wrapped so this script can report what a run actually cost:
  // how many model calls were made, how long each took, and how much of the
  // wall time was a REGENERATION after a refusal rather than one generation
  // running slowly. Those have different fixes, so the number decides which
  // problem this is. The wrapper only observes — it changes no behaviour.
  const attempts: { label: string; ms: number }[] = [];
  const live = analystCallIfConfigured();
  const instrumented: AnalystCall | null =
    live === null
      ? null
      : async (request) => {
          const started = Date.now();
          try {
            return await live(request);
          } finally {
            attempts.push({ label: request.label, ms: Date.now() - started });
          }
        };

  const startedAt = Date.now();
  const report = await analysisForReport(runId, instrumented);
  const totalMs = Date.now() - startedAt;

  heading(`AI layer — ${report.aiLayer.status}`);
  if (report.aiLayer.model !== null) console.log(`model: ${report.aiLayer.model}`);
  if (report.aiLayer.detail !== null) console.log(report.aiLayer.detail);

  // One call per label is a clean generation. A second is a REGENERATION after
  // a refusal — the whole output was discarded and asked for again — so the
  // gap between the two counts is what a refusal costs in latency.
  const byLabel = new Map<string, number[]>();
  for (const a of attempts) byLabel.set(a.label, [...(byLabel.get(a.label) ?? []), a.ms]);

  console.log(`\nmodel calls:   ${attempts.length}`);
  for (const [label, durations] of byLabel) {
    const regenerations = durations.length - 1;
    console.log(
      `  ${label.padEnd(15)} ${durations.length} call(s) — ${durations.map((d) => `${(d / 1000).toFixed(1)}s`).join(" + ")}` +
        (regenerations > 0 ? `   [${regenerations} regeneration after a refusal]` : "")
    );
  }
  const firstAttemptMs = [...byLabel.values()].reduce((max, d) => Math.max(max, d[0]), 0);
  const retryMs = attempts.reduce((sum, a) => sum + a.ms, 0) - [...byLabel.values()].reduce((s, d) => s + d[0], 0);
  console.log(`\nwall time:     ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  the two calls run concurrently, so one clean generation costs about the slower of the two:`);
  console.log(`  slowest first attempt   ${(firstAttemptMs / 1000).toFixed(1)}s`);
  console.log(`  spent on regenerations  ${(retryMs / 1000).toFixed(1)}s`);

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

  if (process.argv.includes("--slots")) {
    // Everything [C] was ALLOWED to reference on this run. Worth reading
    // before the prose: a figure absent from this list cannot appear in a
    // sentence, so this is the boundary of §8.3 limit 3 for this company.
    heading("The catalogue [C] could reference");
    for (const slot of buildSlotCatalogue(report.result).values()) {
      console.log(`  {{${slot.id}}}  ${slot.label} = ${slot.formatted}${slot.suppressed ? "  [state]" : ""}`);
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
