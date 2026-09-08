// scripts/evidence/run.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { config as loadEnv } from "dotenv";
import { DEFAULT_BASE_URL, STATE_MARKERS, TARGETS, UNDECIDED_SUFFIX, WIDTHS } from "./config";
import { verifyAppReachable, verifyDatabaseReady, verifyFrozenArtefacts } from "./gates";
import { driveRun, driveScreen1 } from "./drive";
import {
  checkConsoleErrors,
  checkContinueGated,
  checkFont,
  checkOverflow,
  checkRendered,
  checkStatesAppeared,
} from "./preflight/checks";
import { aggregate } from "./preflight/verdict";
import { buildManifest } from "./manifest";
import { zipDirectory } from "./archive";
import { runSelfTest } from "./selfTest";
import type { CheckResult, ProbeDocument } from "./preflight/types";

loadEnv({ path: ".env.local" });

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Screen 1 UNAVAILABLE — a real UNKNOWN, with the reason it stays one. */
const UNAVAILABLE_REASON =
  "UNKNOWN — not reachable without changing the environment under measurement. " +
  "Every route requires either MARKET_DATA_PROVIDER / EODHD_API_KEY reconfiguration, " +
  "or a test seam in app/actions/analyzer.ts (application code, outside this runner's " +
  "authority). Capture this state separately.";

/**
 * Prints a gate's result and, when it stopped the run, exits.
 *
 * Only FAIL exits non-zero — the branch's own rule. Gates only ever return
 * PASS/FAIL today, but a gate returning UNKNOWN in the future must still
 * exit 0 rather than borrow FAIL's exit code, so this branches on the exact
 * status rather than on "anything but PASS".
 *
 * Returns the CheckResult (rather than void) so gate-phase results can be
 * recorded into the manifest without re-running the gate later.
 */
function stopOn(r: CheckResult): CheckResult {
  if (r.status === "PASS") {
    console.log(`  ok   ${r.step}`);
    return r;
  }
  console.error(`\nSTOP — ${r.step}\n  ${r.detail}\n`);
  process.exit(r.status === "FAIL" ? 1 : 0);
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    const results = await runSelfTest();
    for (const r of results) {
      console.log(
        `  ${r.ok ? "ok  " : "BAD "} ${r.name}: expected ${r.expected}, got ${r.actual}` +
          (r.step ? `  [${r.step}]` : "")
      );
    }
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }

  const baseUrl = process.env.EVIDENCE_BASE_URL ?? DEFAULT_BASE_URL;
  console.log(`Evidence runner — ${baseUrl}\n`);

  console.log("Gates:");
  const frozenGate = stopOn(await verifyFrozenArtefacts(REPO_ROOT));
  const reachableGate = stopOn(await verifyAppReachable(baseUrl));
  const dbGate = stopOn(await verifyDatabaseReady());

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(REPO_ROOT, ".evidence", `m7-gate-capture-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const captured = new Map<string, ProbeDocument>();
  const runIds: Record<string, string> = {};

  try {
    console.log("\nDriving:");
    for (const [k, v] of await driveScreen1(browser, baseUrl, outDir)) captured.set(k, v);
    console.log("  ok   Screen 1 — RESOLVED, UNKNOWN, UNSUPPORTED");

    const msft = await driveRun(browser, baseUrl, "MSFT", outDir, { cannotVerifyFirstFact: true });
    runIds.MSFT = msft.runId;
    for (const [k, v] of msft.captured) captured.set(k, v);
    console.log(`  ok   MSFT run ${msft.runId} — one fact on Cannot verify with a reason code`);

    const oklo = await driveRun(browser, baseUrl, "OKLO", outDir, { cannotVerifyFirstFact: false });
    runIds.OKLO = oklo.runId;
    for (const [k, v] of oklo.captured) captured.set(k, v);
    console.log(`  ok   OKLO run ${oklo.runId}`);
  } finally {
    await browser.close();
  }

  const results: CheckResult[] = [checkRendered(TARGETS, WIDTHS, captured)];
  for (const [key, doc] of captured) {
    const target = key.split("|")[0];
    results.push(checkOverflow(target, doc));
    results.push(checkFont(target, doc));
    results.push(checkConsoleErrors(target, doc));
    results.push(checkStatesAppeared(target, STATE_MARKERS[target], doc));
    if (target.endsWith(UNDECIDED_SUFFIX)) {
      results.push(checkContinueGated(target, doc));
    }
  }
  // The gate-phase results, captured above rather than re-run, so the
  // archive carries evidence the app was reachable and the schema present —
  // not just that the frozen artefacts matched.
  results.push(frozenGate, reachableGate, dbGate);
  results.push({
    step: "Screen 1 UNAVAILABLE captured",
    status: "UNKNOWN",
    detail: UNAVAILABLE_REASON,
  });

  const verdict = aggregate(results);
  const unknowns = [{ target: "s1-unavailable", reason: UNAVAILABLE_REASON }];

  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(buildManifest({ baseUrl, captured, verdict, runIds, unknowns }), null, 1),
    "utf8"
  );

  // Printed before packaging: a zip failure below must not cost the operator
  // the preflight verdict they came here for. The capture is already
  // complete on disk at this point regardless of what packaging does next.
  console.log(`\nPreflight: ${verdict.status}`);
  if (verdict.failingStep) console.log(`  step: ${verdict.failingStep}`);
  for (const r of verdict.results.filter((x) => x.status !== "PASS")) {
    console.log(`  ${r.status}  ${r.step} — ${r.detail}`);
  }

  const zipPath = `${outDir}.zip`;
  try {
    await zipDirectory(outDir, zipPath);
    console.log(`\nArchive: ${zipPath}`);
  } catch (err) {
    // Reported as its own named condition, not thrown up to main().catch —
    // that path prints "STOP — runner error" and exits 1, which would read
    // as a preflight FAIL even on a verdict of PASS or UNKNOWN. The capture
    // is intact on disk; only the zip step failed.
    console.error(
      `\nPackaging FAILED — the capture is complete but was not zipped.\n` +
        `  capture directory: ${outDir}\n` +
        `  error: ${(err as Error).message}\n`
    );
  }

  // Exit code is driven by the preflight verdict alone. FAIL is the only
  // non-zero outcome; UNKNOWN is a real result, not an error; and a
  // packaging failure is a delivery-mechanics problem, not a preflight
  // result, so it must not borrow FAIL's exit code either — the message
  // above is how the operator learns about it.
  process.exit(verdict.status === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nSTOP — runner error\n  ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
