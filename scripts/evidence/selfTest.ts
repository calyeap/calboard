// scripts/evidence/selfTest.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { captureAt } from "./capture";
import {
  checkConsoleErrors,
  checkFont,
  checkOverflow,
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
 * checkFont, checkConsoleErrors, checkStatesAppeared (both directions), and
 * the dead-port limb of verifyAppReachable. It does not cover checkRendered,
 * verifyFrozenArtefacts or verifyDatabaseReady — those have their own unit
 * tests instead.
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
  } finally {
    await browser?.close();
    await fs.rm(out, { recursive: true, force: true });
  }

  return results;
}
