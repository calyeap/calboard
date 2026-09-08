// scripts/evidence/selfTest.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { captureAt } from "./capture";
import {
  checkConsoleErrors,
  checkContinueGated,
  checkFont,
  checkOverflow,
  checkRendered,
  checkStatesAppeared,
} from "./preflight/checks";
import { verifyAppReachable } from "./gates";
import type { CheckResult, ProbeDocument } from "./preflight/types";

export interface SelfTestResult {
  name: string;
  /** The status this fixture is supposed to produce. */
  expected: "PASS" | "FAIL";
  actual: string;
  /** The step the check named, so a FAIL for the wrong reason stays visible. */
  step: string;
  /** The check's own detail string, so a FAIL for the wrong cause stays visible. */
  detail: string;
  ok: boolean;
}

const FIXTURE_DIR = path.join(__dirname, "fixtures");

/**
 * Runs the real capture engine and the real checks against fixtures that are
 * deliberately broken, and asserts each produces a FAIL naming the right step.
 *
 * Covers checkOverflow (both the node limb and the document limb),
 * checkFont, checkConsoleErrors, checkStatesAppeared (both directions),
 * checkRendered (both directions), checkContinueGated (both directions), and
 * the dead-port limb of verifyAppReachable.
 *
 * It does not cover verifyFrozenArtefacts or verifyDatabaseReady. Those are
 * documented residual gaps, both lower-value than they look: the frozen-hash
 * check already fails against real tampered and real absent files in
 * gates.test.ts, which is the same fidelity a fixture would give it since no
 * browser is involved; and proving verifyDatabaseReady's FAIL for real would
 * mean dropping analyzer_runs from a live database, which costs more than the
 * branch is worth. checkFont's "no .cb-analyzer node" guard is likewise
 * hand-built only — no fixture omits the root. Two of checkContinueGated's
 * four branches are hand-built-only too: "no Continue button found at all"
 * and "disabled but no reason line" are proven only in checks.test.ts — only
 * the PASS (found, disabled, has reason) and FAIL (found, not disabled)
 * branches below are proven via a real fixture through runSelfTest().
 *
 * Fixtures rather than temporary edits to app/globals.css: breaking the
 * application to test the instrument would be the runner changing the thing it
 * measures, which is the same objection that keeps Screen 1 UNAVAILABLE out of
 * this pilot. These also stay re-runnable, so the checks are re-proven on every
 * suite run rather than once, in a transcript.
 */
export async function runSelfTest(): Promise<SelfTestResult[]> {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-selftest-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const results: SelfTestResult[] = [];

  const record = (name: string, expected: "PASS" | "FAIL", r: CheckResult): void => {
    results.push({
      name,
      expected,
      actual: r.status,
      step: r.step,
      detail: r.detail,
      ok: r.status === expected,
    });
  };

  try {
    const b = await chromium.launch();
    browser = b;
    const load = (fixture: string): Promise<ProbeDocument> =>
      captureAt(b, {
        target: fixture,
        width: 720,
        url: pathToFileURL(path.join(FIXTURE_DIR, `${fixture}.html`)).toString(),
        outDir: out,
      });

    // The control. If the clean fixture does not pass all three, the checks are
    // over-firing and every FAIL below would be meaningless.
    const clean = await load("clean");
    const cleanChecks = [
      checkOverflow("clean", clean),
      checkFont("clean", clean),
      checkConsoleErrors("clean", clean),
    ];
    const cleanBad = cleanChecks.find((r) => r.status !== "PASS");
    results.push({
      name: "clean",
      expected: "PASS",
      actual: cleanBad ? cleanBad.status : "PASS",
      step: cleanBad ? cleanBad.step : "",
      detail: cleanBad ? cleanBad.detail : "",
      ok: cleanBad === undefined,
    });

    record("overflow", "FAIL", checkOverflow("overflow", await load("overflow")));
    record("missing-font", "FAIL", checkFont("missing-font", await load("missing-font")));
    record("console-error", "FAIL", checkConsoleErrors("console-error", await load("console-error")));
    record("dead-port", "FAIL", await verifyAppReachable("http://127.0.0.1:59999"));

    // overflow.html only ever proves the node limb (it puts overflow-x: auto
    // on .cb-analyzer, which contains the overflow in a scrollable node and
    // keeps the document itself from overflowing). The document limb — a
    // fixture with no scroll container, so the overflow propagates up to
    // document.documentElement.scrollWidth — was previously proven only
    // against a hand-built doc({docOverflow: true}) literal in checks.test.ts,
    // which proves checkOverflow reads the flag but not that the real probe
    // ever sets it. This drives it through the real probe instead.
    record("doc-overflow", "FAIL", checkOverflow("doc-overflow", await load("doc-overflow")));

    // checkStatesAppeared was not exercised at all: every existing fixture
    // happens to contain "Fact acquisition and spot-check", a real
    // STATE_MARKERS value, but nothing tried it in both directions. `clean`
    // is reused for both — it is already known-good from the control above.
    record(
      "states-appeared-pass",
      "PASS",
      checkStatesAppeared("clean", "Fact acquisition and spot-check", clean)
    );
    record(
      "states-appeared-fail",
      "FAIL",
      checkStatesAppeared("clean", "Listed operating company", clean)
    );

    // checkContinueGated was the sixth check with no fixture-driven proof.
    // continue-gated.html is the working gate (disabled + reason); it is not
    // reused from "clean" because the gate control is specific to this check
    // and does not belong in the general-purpose control fixture.
    // continue-enabled.html forces the gate open — Continue present but not
    // disabled — which is exactly the failure this check exists to catch on a
    // real undecided run, produced here without touching application code.
    record(
      "continue-gated",
      "PASS",
      checkContinueGated("continue-gated", await load("continue-gated"))
    );
    record(
      "continue-enabled",
      "FAIL",
      checkContinueGated("continue-enabled", await load("continue-enabled"))
    );

    // checkRendered was the last check with no end-to-end case: both its
    // failure modes had only ever been produced by handing the function a Map
    // built by hand in checks.test.ts. That is the weakest place to leave it,
    // because checkRendered is the one check whose whole job is to notice that
    // something did NOT happen — if the drive ever returned fewer captures than
    // it should, this is the only check that would catch it, and nothing had
    // ever made a real capture go missing and watched it notice.
    //
    // So: capture the same fixture at two real widths, key the map exactly as
    // run.ts does, and assert the complete map PASSes BEFORE removing an entry.
    // Without that PASS first, a checkRendered that always returned FAIL would
    // satisfy the negative case and prove nothing.
    const renderedWidths = [720, 1024] as const;
    const renderedMap = new Map<string, ProbeDocument>();
    for (const w of renderedWidths) {
      renderedMap.set(
        `rendered-probe|${w}`,
        await captureAt(b, {
          target: "rendered-probe",
          width: w,
          url: pathToFileURL(path.join(FIXTURE_DIR, "clean.html")).toString(),
          outDir: out,
        })
      );
    }
    record(
      "rendered-complete",
      "PASS",
      checkRendered(["rendered-probe"], renderedWidths, renderedMap)
    );

    // Remove exactly one target×width entry — the shape a capture leaves
    // behind when it silently did not happen.
    renderedMap.delete("rendered-probe|1024");
    record(
      "rendered-missing",
      "FAIL",
      checkRendered(["rendered-probe"], renderedWidths, renderedMap)
    );
  } finally {
    await browser?.close();
    await fs.rm(out, { recursive: true, force: true });
  }

  return results;
}
