// scripts/evidence/run.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { config as loadEnv } from "dotenv";
import {
  DEFAULT_BASE_URL,
  REQUIRED_CHECK_STEPS,
  STATE_MARKERS,
  TARGETS,
  UNDECIDED_SUFFIX,
  WIDTHS,
} from "./config";
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
import { runSelfTest } from "./selfTest";
import { readRunnerRevision, readSourceIdentity } from "./identity/source";
import { decideServedBinding, probeServedIdentity } from "./identity/served";
import { captureDirName, decideRepeat, findPriorRuns, resolveOutcomeId } from "./outcome";
import { buildCheckInventory, decideEvidenceComplete } from "./completeness";
import {
  decideDeliveryGate,
  deliverArchive,
  promoteToDelivered,
  type DeliveryResult,
} from "./delivery";
import {
  decideRetrievalRoute,
  deliverViaGitHubDraftRelease,
  probeRouteCapability,
} from "./retrieval";
import { LostWriteError, describeLostWrite } from "./consequential";
import { buildReturnObject, exitCodeFor } from "./returnObject";
import type { CheckResult, ProbeDocument } from "./preflight/types";

loadEnv({ path: ".env.local" });

const REPO_ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(REPO_ROOT, ".evidence");

/**
 * The run was refused before it started — no OUTCOME ID, or a duplicate one.
 *
 * Deliberately outside the 0-3 range those codes describe: nothing was
 * measured, so reporting a preflight FAIL (1) or a delivery failure (3) would
 * name a result this run never produced.
 */
const EXIT_REFUSED = 4;

/** Screen 1 UNAVAILABLE — a real UNKNOWN, with the reason it stays one. */
const UNAVAILABLE_REASON =
  "UNKNOWN — not reachable without changing the environment under measurement. " +
  "Every route requires either MARKET_DATA_PROVIDER / EODHD_API_KEY reconfiguration, " +
  "or a test seam in app/actions/analyzer.ts (application code, outside this runner's " +
  "authority). Capture this state separately.";

const UNAVAILABLE_STEP = "Screen 1 UNAVAILABLE captured";

/**
 * Prints a gate's result and, when it stopped the run, exits.
 *
 * Only FAIL exits non-zero — the branch's own rule. Gates only ever return
 * PASS/FAIL today, but a gate returning UNKNOWN in the future must still
 * exit 0 rather than borrow FAIL's exit code, so this branches on the exact
 * status rather than on "anything but PASS".
 *
 * A gate stop produces no return object by design: the gates run before
 * anything is captured, so there is no evidence to describe. §3 puts
 * PREFLIGHT VERIFIED ahead of EXECUTION COMPLETE for the same reason.
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

  const started = new Date().toISOString();

  // The assignment this evidence belongs to. Resolved first: an archive that
  // cannot name its assignment is not deliverable, so there is no point
  // measuring anything before knowing it.
  const outcome = resolveOutcomeId(process.argv, process.env);
  if (outcome.outcomeId === null) {
    console.error(`\nSTOP — ${outcome.error}\n`);
    process.exit(EXIT_REFUSED);
  }
  const outcomeId = outcome.outcomeId;

  // Prior state is inspected BEFORE the browser opens and before any analyzer
  // run is created (§5.4). Those are the consequential steps — re-executing
  // them is what a duplicate dispatch must not do silently.
  const priorRuns = await findPriorRuns(EVIDENCE_ROOT, outcomeId);
  const repeat = decideRepeat(priorRuns, process.argv.includes("--repeat"));
  if (!repeat.proceed) {
    console.error(`\nSTOP — duplicate OUTCOME ID ${outcomeId}\n  ${repeat.reason}\n`);
    process.exit(EXIT_REFUSED);
  }

  const baseUrl = process.env.EVIDENCE_BASE_URL ?? DEFAULT_BASE_URL;
  const source = await readSourceIdentity(REPO_ROOT);
  const runnerRevision = await readRunnerRevision(REPO_ROOT);

  console.log(`Evidence runner — ${baseUrl}`);
  console.log(`  outcome: ${outcomeId}`);
  console.log(
    `  source:  ${source.repo ?? "(no remote)"} ${source.branch} @ ${source.resultHead.slice(0, 12)}` +
      (source.dirty ? ` (dirty ${source.dirtyFingerprint?.slice(0, 12)})` : " (clean)")
  );
  if (repeat.reason !== "") console.log(`  repeat:  ${repeat.reason}`);
  console.log("");

  console.log("Gates:");
  const frozenGate = stopOn(await verifyFrozenArtefacts(REPO_ROOT));
  const reachableGate = stopOn(await verifyAppReachable(baseUrl));
  const dbGate = stopOn(await verifyDatabaseReady());

  // Which code the server is actually running. Asked after the reachability
  // gate because it needs the same server, and recorded whatever the answer
  // is — a healthy response was never proof of this on its own.
  const servedProbe = await probeServedIdentity(baseUrl, REPO_ROOT, source.dirty);
  const servedDecision = decideServedBinding(servedProbe);
  const served = {
    baseUrl,
    revision: servedProbe.servedBuildId,
    binding: servedDecision.binding,
    reason: servedDecision.reason,
  };
  console.log(`  ${servedDecision.binding === "MATCH" ? "ok  " : "----"} served revision: ${servedDecision.binding}`);
  if (servedDecision.binding !== "MATCH") console.log(`       ${servedDecision.reason}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(EVIDENCE_ROOT, captureDirName(outcomeId, stamp));
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const captured = new Map<string, ProbeDocument>();
  const runIds: Record<string, string> = {};
  /** A consequential write whose response never came back, if one did. */
  let lostWrite: CheckResult | null = null;

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
  } catch (err) {
    // §5.5. A consequential write whose response was lost is not a runner
    // error and not a preflight FAIL — it is an UNKNOWN about state that may
    // or may not have changed. It is recorded, the current state has already
    // been inspected, and the run continues to a return object rather than
    // dying in main().catch on exit 1.
    if (!(err instanceof LostWriteError)) throw err;
    lostWrite = describeLostWrite(err.write, err.inspected);
    console.error(`\n  UNKNOWN  ${lostWrite.step}`);
    console.error(`  ${lostWrite.detail}\n`);
  } finally {
    await browser.close();
  }

  const results: CheckResult[] = [];
  // The capture checks are evaluated only when the drive actually finished.
  //
  // After a lost consequential write the run aborted part-way, so the targets
  // it never reached are missing by construction. Judging them would turn an
  // incomplete run into a preflight FAIL — a verdict about the application
  // that this run never measured — and that FAIL would then exit 1, which is
  // exactly the code §5.5 says a lost write must not borrow. The run is
  // reported as the UNKNOWN it is, with its required checks unaccounted for.
  if (lostWrite === null) {
    results.push(checkRendered(TARGETS, WIDTHS, captured));
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
  }
  // The gate-phase results, captured above rather than re-run, so the
  // archive carries evidence the app was reachable and the schema present —
  // not just that the frozen artefacts matched.
  results.push(frozenGate, reachableGate, dbGate);
  results.push({ step: UNAVAILABLE_STEP, status: "UNKNOWN", detail: UNAVAILABLE_REASON });
  // Recorded as its own UNKNOWN so the verdict carries it and the archive
  // shows the state nobody could determine.
  if (lostWrite !== null) results.push(lostWrite);

  const verdict = aggregate(results);
  const unknowns = [{ target: "s1-unavailable", reason: UNAVAILABLE_REASON }];

  // Required / executed / not-run. `executed` counts only the checks this
  // runner is required to run, so the deliberately-not-run Screen 1 state is
  // reported once, as a not-run with its reason, rather than appearing in
  // both lists. It stays in `results` regardless, so the verdict it makes
  // UNKNOWN stays UNKNOWN.
  const inventory = buildCheckInventory(
    REQUIRED_CHECK_STEPS,
    results.filter((r) => REQUIRED_CHECK_STEPS.includes(r.step)),
    [{ step: UNAVAILABLE_STEP, reason: UNAVAILABLE_REASON }]
  );

  const completed = new Date().toISOString();
  const execution = { started, completed, runnerRevision };

  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      buildManifest({
        outcomeId,
        baseUrl,
        captured,
        verdict,
        runIds,
        unknowns,
        source,
        served,
        execution,
        inventory,
        priorRuns: repeat.priorRuns,
      }),
      null,
      1
    ),
    "utf8"
  );

  // EVIDENCE COMPLETE: is the capture the manifest describes actually on disk?
  // Every captured page claims one screenshot, and the manifest claims itself.
  const claimed = ["manifest.json", ...[...captured.keys()].map((k) => {
    const [target, width] = k.split("|");
    return `${target}-${width}.png`;
  })];
  const present = await fs.readdir(outDir);
  const completeness = decideEvidenceComplete(claimed, present);

  // Printed before packaging: a delivery failure below must not cost the
  // operator the preflight verdict they came here for. The capture is already
  // complete on disk at this point regardless of what packaging does next.
  console.log(`\nPreflight: ${verdict.status}`);
  if (verdict.failingStep) console.log(`  step: ${verdict.failingStep}`);
  for (const r of verdict.results.filter((x) => x.status !== "PASS")) {
    console.log(`  ${r.status}  ${r.step} — ${r.detail}`);
  }

  // EVIDENCE DELIVERED, and the two things that forbid it: evidence that does
  // not describe the code it claims to, and evidence that is not all there.
  const gate = decideDeliveryGate(served.binding, completeness.complete, inventory.complete);
  const zipPath = `${outDir}.zip`;
  let delivery: DeliveryResult = gate.allowed
    ? await deliverArchive(outDir, zipPath)
    : {
        status: "FAILED",
        location: null,
        archiveSha256: null,
        error: gate.reason,
        retrieval: null,
        gap: gate.reason,
      };

  // Packaging got us LOCAL_READY at best. DELIVERED requires that an owner
  // elsewhere can actually retrieve it, and the only acceptable proof of that
  // is fetching the archive back and finding the same bytes.
  //
  // The repo slug comes from source.repo (already resolved once by
  // readSourceIdentity) rather than being re-derived here — CB-G2-EVIDENCE-03
  // was exactly that kind of duplication: a second, wrong resolution
  // (REPO_ROOT, a filesystem path) reaching gh's --repo flag where this
  // slug was required.
  if (delivery.status === "LOCAL_READY") {
    const capability = await probeRouteCapability(source.repo);
    const routeDecision = decideRetrievalRoute(capability);
    if (routeDecision.route === null || capability.gh === null || capability.repoSlug === null) {
      delivery = promoteToDelivered(delivery, null, routeDecision.gap);
    } else {
      try {
        const proof = await deliverViaGitHubDraftRelease(
          capability.gh,
          capability.repoSlug,
          zipPath,
          outcomeId
        );
        delivery = promoteToDelivered(delivery, proof, "");
      } catch (err) {
        // The route exists but did not carry the evidence. That is a gap, not
        // a delivery: the archive is still only local.
        delivery = promoteToDelivered(
          delivery,
          null,
          `${routeDecision.route} route failed: ${(err as Error).message}`
        );
      }
    }
  }

  const returnObject = buildReturnObject({
    outcomeId,
    source,
    served,
    execution,
    inventory,
    verdict,
    artefacts: {
      captureDir: outDir,
      manifest: path.join(outDir, "manifest.json"),
      // Repo-relative, POSIX-separated, so an owner on another machine can act
      // on them. The absolute pair above stays for the operator standing here.
      captureDirRelative: path.relative(REPO_ROOT, outDir).split(path.sep).join("/"),
      manifestRelative: path
        .relative(REPO_ROOT, path.join(outDir, "manifest.json"))
        .split(path.sep)
        .join("/"),
      artefactCount: claimed.length,
    },
    delivery,
    evidenceComplete: completeness.complete,
    priorRuns: repeat.priorRuns,
  });

  // The one retrievable return object, at a path derived from the OUTCOME ID
  // alone — an owner who knows only the assignment can find it without being
  // told the run's timestamp. It is written outside the capture directory so
  // it can name the archive's own hash, and it points at the newest run:
  // prior *evidence* is never overwritten (each run is stamped), only this
  // pointer moves.
  const returnPath = path.join(EVIDENCE_ROOT, `${outcomeId}.return.json`);
  await fs.writeFile(returnPath, JSON.stringify(returnObject, null, 1), "utf8");

  console.log(`\nEvidence:  ${completeness.complete ? "COMPLETE" : "INCOMPLETE"} — ${completeness.reason}`);
  console.log(`Execution: ${inventory.complete ? "COMPLETE" : "INCOMPLETE"}`);
  if (!inventory.complete) {
    console.log(`  unaccounted-for required checks: ${inventory.unaccountedFor.join(", ")}`);
  }
  console.log(`Delivery:  ${delivery.status}`);
  if (delivery.status === "DELIVERED") {
    console.log(`  retrieve: ${delivery.retrieval?.command}`);
    console.log(`  verified: ${delivery.retrieval?.verifiedBytes} bytes fetched back, hash matches`);
    console.log(`  archive:  ${delivery.location}`);
    console.log(`  sha256:   ${delivery.archiveSha256}`);
  } else if (delivery.status === "LOCAL_READY") {
    // Packaged and verified, but only here. Named as a gap rather than a
    // failure, because nothing went wrong — the evidence simply has not
    // reached its owner.
    console.log(`  NOT DELIVERED — ${delivery.gap}`);
    console.log(`  archive (local only): ${delivery.location}`);
    console.log(`  sha256:               ${delivery.archiveSha256}`);
  } else {
    console.log(`  ${delivery.error}`);
    console.log(`  capture directory (intact): ${outDir}`);
  }
  console.log(`Return:    ${returnPath}`);

  // One axis per failure kind. 1 keeps its existing meaning exactly — a
  // preflight FAIL and nothing else — so an UNKNOWN verdict still exits 0,
  // while incomplete evidence (2) and failed delivery (3) can no longer be
  // reported as success.
  process.exit(
    exitCodeFor(verdict.status, completeness.complete, delivery.status, inventory.complete)
  );
}

main().catch((err) => {
  console.error(`\nSTOP — runner error\n  ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
