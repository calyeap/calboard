# Runner Undecided Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The evidence runner captures Screen 2 twice per fixture — once immediately after Begin analysis, before any decision (`s2-facts-<ticker>-undecided`), and once after the queue is worked, as today (`s2-facts-<ticker>`) — and a new preflight check proves the Continue gate actually holds (disabled, with a reason) on the undecided capture.

**Architecture:** Additive changes to the existing `scripts/evidence/` runner. `driveRun` gains one capture step, taken as a fresh browser context navigating straight to the just-created run's `/facts` URL before any card is decided — the same "fresh context onto a persisted route" pattern the decided screens already use, so no state is reset to fake it. A new pure check, `checkContinueGated`, joins the other five in `preflight/checks.ts` and is invoked only against `-undecided` targets. Its negative case is proven the same way every other check's negative case is proven in this codebase: a deliberately-broken HTML fixture run through the real capture engine via `--self-test`, never by touching application code.

**Tech Stack:** TypeScript, tsx, Playwright, vitest — all already in place; no new dependencies.

**Spec:** Calvin's brief in this conversation (2026-09-08). No separate spec file — the brief is the spec, per the same ruling that governed the pilot plan (`docs/superpowers/plans/2026-09-07-evidence-runner-pilot.md`).

## Global Constraints

- **Tooling only.** Nothing under `app/`, `lib/`, `migrations/` or `docs/frozen/` may be modified. The one exception already established by precedent: none needed here — this whole change lives under `scripts/evidence/`.
- **Do not build the `.progress` counter.** Out of scope — M7 debt, routed by Command Center.
- **No check may judge appearance, spacing or copy.** `checkContinueGated` asserts only the `disabled` IDL property and the presence of a reason string — never how either looks.
- **The undecided capture must be a real run in that state**, not the decided run with something reset. It is produced by driving to the queue and stopping — never by deleting fact-decision rows or otherwise rewriting persisted state.
- **The negative test must be watched failing**, not reasoned about. Every new check gets a fixture-driven `--self-test` case exercised by `selfTest.test.ts`, exactly like the five existing checks.
- **Capture widths:** 720, 1024, 1440 (`scripts/evidence/config.ts:3`), unchanged.
- **Screen 3 still captures with nothing selected**, as it already does (`drive.ts` — Step 6 is never submitted). Not touched by this change.

---

## File Structure

```
scripts/evidence/
  config.ts                 MODIFY — two new STATE_MARKERS entries (undecided targets).
  drive.ts                  MODIFY — driveRun captures the undecided state before working the queue.
  run.ts                    MODIFY — wires checkContinueGated in for -undecided targets.
  preflight/
    checks.ts               MODIFY — new checkContinueGated, pure.
    checks.test.ts           MODIFY — unit tests, both directions.
  selfTest.ts                MODIFY — two new fixture-driven cases.
  selfTest.test.ts           MODIFY — asserts the new cases, both directions.
  fixtures/
    continue-gated.html      CREATE — Continue disabled + reason line. Must PASS.
    continue-enabled.html    CREATE — Continue NOT disabled. Must FAIL, naming the step.
```

No other file changes. `manifest.ts` derives its target list from the captured map's own keys and needs no change; `TARGETS` in `config.ts` is `Object.keys(STATE_MARKERS)` and picks up the new entries automatically.

---

### Task 1: `checkContinueGated`, pure and unit-tested

The check is the product, same as the pilot's five. Written first, with no browser, so it is proven against hand-built documents before anything real is captured.

**Files:**
- Modify: `scripts/evidence/preflight/checks.ts`
- Modify: `scripts/evidence/preflight/checks.test.ts`

**Interfaces:**
- Consumes: `ProbeDocument`, `ProbeNode`, `CheckResult` (existing, from `./types`).
- Produces: `checkContinueGated(target: string, d: ProbeDocument): CheckResult`, and the constant `CONTINUE_LABEL`. Both used by Task 4 (`run.ts`) and Task 2 (`selfTest.ts`).

- [ ] **Step 1: Write the failing unit tests**

Append to `scripts/evidence/preflight/checks.test.ts` (after the `checkStatesAppeared` describe block, end of file):

```typescript
describe("checkContinueGated", () => {
  it("PASSes when Continue is disabled and a reason line is present", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: true });
    const reason = node({
      tag: "span",
      cls: "reason",
      text: "1 material fact still undecided — Continue is unavailable until every fact carries a decision.",
    });
    const d = doc({ nodes: [button, reason] });
    expect(checkContinueGated("s2-facts-msft-undecided", d).status).toBe("PASS");
  });

  it("FAILs naming the step when Continue is enabled on an undecided capture", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: false });
    const d = doc({ nodes: [button] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.step).toBe("Continue to gates disabled with a reason on the undecided capture");
    expect(r.detail).toContain("enabled");
  });

  it("FAILs when no Continue control is present in the capture", () => {
    const d = doc({ nodes: [node({ tag: "div", text: "something else" })] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no");
    expect(r.detail).toContain("Continue to gates");
  });

  it("FAILs when Continue is disabled but no reason line accompanies it", () => {
    const button = node({ tag: "button", cls: "act", text: "Continue to gates", disabled: true });
    const d = doc({ nodes: [button] });
    const r = checkContinueGated("s2-facts-msft-undecided", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no reason line");
  });

  it("is not fooled by the decided screen's enabled Continue link carrying the same label", () => {
    // The decided screen's control is an <a>, not a <button> — the probe's
    // `disabled` read (`el.disabled`) is `undefined` on an anchor, which the
    // probe already normalises to `null`. A check that treated null as
    // "not disabled === true, so FAIL" would be correct by accident; this
    // proves the FAIL is for the right reason on a button, not a coincidence
    // of node shape.
    const link = node({ tag: "a", cls: "act", text: "Continue to gates", disabled: null });
    const r = checkContinueGated("s2-facts-msft-undecided", doc({ nodes: [link] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("no");
  });
});
```

Add `checkContinueGated` to the existing import at the top of the file:

```typescript
import {
  checkRendered,
  checkOverflow,
  checkFont,
  checkConsoleErrors,
  checkStatesAppeared,
  checkContinueGated,
} from "./checks";
```

- [ ] **Step 2: Run the tests and confirm they fail on the missing export**

Run: `npx vitest run scripts/evidence/preflight/checks.test.ts`
Expected: FAIL — `checkContinueGated is not a function` (or a TS error naming the missing export, if `tsx`/vitest's esbuild transform surfaces it as a resolution failure instead — either is the correct failure for this step).

- [ ] **Step 3: Implement `checkContinueGated`**

Append to `scripts/evidence/preflight/checks.ts` (after `checkStatesAppeared`, end of file):

```typescript
/** The button text the Step 2 gate control carries in both its states. */
export const CONTINUE_LABEL = "Continue to gates";

/**
 * On the undecided capture, Continue to gates is disabled and carries a
 * reason — proof the gate is holding, not merely that the control exists.
 *
 * Only meaningful against an "-undecided" capture; run.ts decides when to
 * call this, the same way it alone decides which marker checkStatesAppeared
 * checks against — this function has no target-name logic of its own.
 *
 * Matched by tag + label rather than by class, because the decided screen's
 * control is an `<a>` carrying the same "act" class and the same label —
 * matching on class alone would let that control satisfy this check by
 * accident. A `<button>` is also the only element on this screen whose
 * `disabled` the probe can read as a real boolean rather than `null`.
 *
 * Judges only two objective facts: the `disabled` IDL property Playwright's
 * probe already reads off the live DOM element, and whether a reason string
 * is present alongside it. Never appearance, spacing or copy — a check that
 * graded the build against the mock would be BUILD grading its own work.
 */
export function checkContinueGated(target: string, d: ProbeDocument): CheckResult {
  const step = "Continue to gates disabled with a reason on the undecided capture";
  const label = CONTINUE_LABEL.toLowerCase();
  const button = d.nodes.find((n) => n.tag === "button" && n.text.toLowerCase().includes(label));

  if (button === undefined) {
    return fail(step, `${target} at ${d.viewport.w}: no "${CONTINUE_LABEL}" button in the capture`);
  }
  if (button.disabled !== true) {
    return fail(
      step,
      `${target} at ${d.viewport.w}: "${CONTINUE_LABEL}" is enabled — the gate is not holding`
    );
  }

  const hasReason = d.nodes.some(
    (n) => n !== button && n.text.toLowerCase().includes("still undecided")
  );
  if (!hasReason) {
    return fail(
      step,
      `${target} at ${d.viewport.w}: "${CONTINUE_LABEL}" is disabled but no reason line is present`
    );
  }
  return pass(step);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run scripts/evidence/preflight/checks.test.ts`
Expected: PASS, all tests including the five pre-existing describe blocks.

- [ ] **Step 5: Commit**

```bash
git add scripts/evidence/preflight/checks.ts scripts/evidence/preflight/checks.test.ts
git commit -m "feat(evidence): add checkContinueGated for the undecided Step 2 capture"
```

---

### Task 2: Fixtures and the self-test proof — watch the negative case fail

This is the required negative test. It reuses the established pattern (`selfTest.ts`'s doc comment explains why: breaking the application to test the instrument would be the runner changing the thing it measures) — a deliberately-broken fixture run through the real capture engine, not a hand-built literal.

**Files:**
- Create: `scripts/evidence/fixtures/continue-gated.html`
- Create: `scripts/evidence/fixtures/continue-enabled.html`
- Modify: `scripts/evidence/selfTest.ts`
- Modify: `scripts/evidence/selfTest.test.ts`

**Interfaces:**
- Consumes: `checkContinueGated` (Task 1), `captureAt` (existing).
- Produces: two new entries in `SelfTestResult[]` under names `"continue-gated"` and `"continue-enabled"`, consumed by `selfTest.test.ts` and by `npm run evidence -- --self-test`'s console output.

- [ ] **Step 1: Create the PASS fixture**

Create `scripts/evidence/fixtures/continue-gated.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>continue-gated</title>
<style>
  :root { --font-ibm-plex-sans: "IBM Plex Sans"; }
  body { margin: 0; }
  .cb-analyzer {
    font-family: var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
</style></head>
<body><div class="cb-analyzer">
  <div class="continue">
    <button class="act" type="button" disabled>Continue to gates</button>
    <span class="reason">
      1 material fact still undecided — Continue is unavailable until every fact carries a decision.
    </span>
  </div>
</div></body></html>
```

- [ ] **Step 2: Create the FAIL fixture — the forced-broken gate**

Create `scripts/evidence/fixtures/continue-enabled.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>continue-enabled</title>
<style>
  :root { --font-ibm-plex-sans: "IBM Plex Sans"; }
  body { margin: 0; }
  .cb-analyzer {
    font-family: var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
</style></head>
<body><div class="cb-analyzer">
  <div class="continue">
    <!-- Deliberately not disabled — stands in for the gate failing to hold
         on an undecided run. The real, working disabled state is proven
         separately by continue-gated.html. -->
    <button class="act" type="button">Continue to gates</button>
  </div>
</div></body></html>
```

- [ ] **Step 3: Write the failing self-test assertions**

In `scripts/evidence/selfTest.test.ts`, add inside the existing `it(...)` block, after the `states-appeared-fail` assertions and before the `rendered-complete` assertions:

```typescript
    expect(byName.get("continue-gated")?.actual).toBe("PASS");
    expect(byName.get("continue-enabled")?.actual).toBe("FAIL");
```

And near the bottom, alongside the other detail/step assertions (after the `states-appeared-fail` detail assertion, before the `rendered-complete` block):

```typescript
    expect(byName.get("continue-gated")?.detail).toBe("");

    expect(byName.get("continue-enabled")?.step).toBe(
      "Continue to gates disabled with a reason on the undecided capture"
    );
    expect(byName.get("continue-enabled")?.detail).toContain("enabled");
    expect(byName.get("continue-enabled")?.detail).toContain("gate is not holding");
```

Also update the `describe` block's title (first argument to `it`) to add `checkContinueGated` to the list of what is proven, and add both names to the `for (const r of results) expect(r.ok).toBe(true);` coverage (already covers every entry in `results`, so no change needed there — only the title needs the new check named).

- [ ] **Step 4: Run and confirm it fails**

Run: `npx vitest run scripts/evidence/selfTest.test.ts`
Expected: FAIL — `byName.get("continue-gated")` and `byName.get("continue-enabled")` are `undefined` (no such self-test case exists yet), so `.actual` reads `undefined`, not `"PASS"`/`"FAIL"`.

- [ ] **Step 5: Wire the two fixtures into `runSelfTest`**

In `scripts/evidence/selfTest.ts`, add `checkContinueGated` to the import from `./preflight/checks`:

```typescript
import {
  checkConsoleErrors,
  checkContinueGated,
  checkFont,
  checkOverflow,
  checkRendered,
  checkStatesAppeared,
} from "./preflight/checks";
```

Add two `record(...)` calls after the `states-appeared-fail` block and before the `checkRendered` section (i.e. right after the `record("states-appeared-fail", ...)` call, line ~129 in the current file):

```typescript
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
```

Also update the function's leading doc comment (the `/** Runs the real capture engine... */` block, lines 32–55) to add `checkContinueGated` to the first sentence of the "Covers" list — e.g. `Covers checkOverflow (...), checkFont, checkConsoleErrors, checkStatesAppeared (...), checkRendered (...), checkContinueGated (both directions), and the dead-port limb of verifyAppReachable.`

- [ ] **Step 6: Run and confirm the self-test proof passes**

Run: `npx vitest run scripts/evidence/selfTest.test.ts`
Expected: PASS. This run is the "watch it fail" requirement being discharged for real — `runSelfTest()` drives an actual headless Chromium load of `continue-enabled.html` through the actual `checkContinueGated`, and the test asserts that produced a FAIL naming the right step, not a reasoned-about one.

Also run directly for the human-readable console proof:

Run: `npx tsx scripts/evidence/run.ts --self-test`
Expected: a `BAD` or `ok` line per case; confirm `ok   continue-gated: expected PASS, got PASS` and `ok   continue-enabled: expected FAIL, got FAIL  [Continue to gates disabled with a reason on the undecided capture]`, and the process exits 0 (every case's `actual` matched its `expected` — the self-test suite passing is not the same claim as the underlying check passing).

- [ ] **Step 7: Commit**

```bash
git add scripts/evidence/fixtures/continue-gated.html scripts/evidence/fixtures/continue-enabled.html scripts/evidence/selfTest.ts scripts/evidence/selfTest.test.ts
git commit -m "test(evidence): prove checkContinueGated FAILs a forced-open gate"
```

---

### Task 3: Capture the undecided state for real

`driveRun` gains one capture step: immediately after the run is created (Begin analysis clicked, `runId` known) and before any queue card is decided, capture `s2-facts-<ticker>-undecided` at all three widths. No decision is made, reset, or undone to produce it — it is simply captured before the loop that makes decisions runs.

**Files:**
- Modify: `scripts/evidence/config.ts`
- Modify: `scripts/evidence/drive.ts`

**Interfaces:**
- Consumes: `captureAt` (existing, `./capture`), `WIDTHS` (existing, `./config`).
- Produces: `captured` map entries keyed `s2-facts-<ticker>-undecided|<width>`, consumed by Task 4 (`run.ts`)'s check loop and by `manifest.ts` (unchanged — it derives targets from map keys).

- [ ] **Step 1: Add the two new STATE_MARKERS entries**

In `scripts/evidence/config.ts`, replace the `STATE_MARKERS` block (lines 34–42):

```typescript
export const STATE_MARKERS: Readonly<Record<string, string>> = {
  "s1-resolved": "Listed operating company",
  "s1-unknown": "Unknown — no provider evidence for ZXQY",
  "s1-unsupported": "Unsupported — not an operating company",
  "s2-facts-msft-undecided": "Fact acquisition and spot-check",
  "s2-facts-msft": "Fact acquisition and spot-check",
  "s3-profile-msft": "PROFILE CONFIRMATION",
  "s2-facts-oklo-undecided": "Fact acquisition and spot-check",
  "s2-facts-oklo": "Fact acquisition and spot-check",
  "s3-profile-oklo": "PROFILE CONFIRMATION",
};
```

(Same marker as the decided screen — it is the same Step 2 heading, present whether or not any card has been decided yet.)

- [ ] **Step 2: Capture the undecided state inside `driveRun`**

In `scripts/evidence/drive.ts`, replace the whole `driveRun` function (lines 73–153) with:

```typescript
export async function driveRun(
  browser: Browser,
  baseUrl: string,
  ticker: "MSFT" | "OKLO",
  outDir: string,
  opts: { cannotVerifyFirstFact: boolean }
): Promise<{ runId: string; captured: Map<string, ProbeDocument> }> {
  const slug = ticker.toLowerCase();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  const captured = new Map<string, ProbeDocument>();
  let runId: string;

  try {
    await page.goto(new URL("/analyzer", baseUrl).toString(), { waitUntil: "networkidle" });
    await resolveTicker(page, ticker);
    await page.click('button:has-text("Begin analysis")');
    await page.waitForURL(/\/analyzer\/[0-9a-f-]{36}\/facts$/, { timeout: 30_000 });

    const match = page.url().match(/\/analyzer\/([0-9a-f-]{36})\/facts/);
    if (match === null) throw new Error(`${ticker}: no runId in ${page.url()}`);
    runId = match[1];

    // The queue is derived, never hardcoded: a fact that should be queued but
    // has no card in the DOM surfaces as a failure rather than as a card nobody
    // looked for.
    const queue = queuedFacts(FIXTURES[ticker].facts);
    if (queue.length === 0) throw new Error(`${ticker}: the spot-check queue is empty`);

    // Captured here — immediately after Begin analysis, before this run's
    // queue carries a single decision. A fresh context navigating straight to
    // the persisted, still-undecided run, exactly as the decided screens below
    // navigate fresh contexts to the persisted, worked run: this is a real run
    // in the undecided state, not the decided run with something reset.
    const factsUrl = new URL(`/analyzer/${runId}/facts`, baseUrl).toString();
    for (const width of WIDTHS) {
      const undecidedDoc = await captureAt(browser, {
        target: `s2-facts-${slug}-undecided`,
        width,
        url: factsUrl,
        outDir,
      });
      captured.set(`s2-facts-${slug}-undecided|${width}`, undecidedDoc);
    }

    for (const [index, fact] of queue.entries()) {
      const card = page.locator(`form:has(input[name="factId"][value="${fact.id}"])`);
      if ((await card.count()) === 0) {
        throw new Error(`Queued fact "${fact.id}" has no card on the ${ticker} facts screen`);
      }

      // §3.8.4's fixed two-option select renders only under NOT CONFIRMED,
      // which is why one MSFT fact must take this branch — without it the
      // control never appears in the evidence at all.
      const cannotVerify = opts.cannotVerifyFirstFact && index === 0;
      const value = cannotVerify ? "NOT CONFIRMED" : "CONFIRMED";

      await card.locator(`input[name="decision-${fact.id}"][value="${value}"]`).check();
      if (cannotVerify) {
        await card.locator('select[name="reasonCode"]').selectOption("CONTRADICTED BY SOURCE");
      }
      await card.locator('button[type="submit"]').click();
      // Deterministic per-card wait, not networkidle: this is an in-place
      // server action (see resolveTicker's doc comment above), and several
      // cards are on screen, so the wait is scoped to this card's own submit
      // button re-rendering "Change decision" (FactCard.tsx:192).
      await card.locator('button[type="submit"]:has-text("Change decision")').waitFor();
    }

    // Step 2 must actually be complete, or the profile screen is not reachable
    // and the capture below would silently record the wrong screen.
    await page.waitForSelector('a:has-text("Continue to gates")', { timeout: 30_000 });
  } finally {
    await ctx.close();
  }

  // Step 6 is never submitted. The profile screen therefore captures with
  // nothing selected — the state §6.3 requires and the one DESIGN needs to see.
  const screens = [
    [`s2-facts-${slug}`, `/analyzer/${runId}/facts`],
    [`s3-profile-${slug}`, `/analyzer/${runId}/profile`],
  ] as const;

  for (const [target, route] of screens) {
    for (const width of WIDTHS) {
      const doc = await captureAt(browser, {
        target,
        width,
        url: new URL(route, baseUrl).toString(),
        outDir,
      });
      captured.set(`${target}|${width}`, doc);
    }
  }

  return { runId, captured };
}
```

The only structural changes from the current function: `captured` is declared once, before the `try` block, instead of being built fresh afterward; and the new undecided-capture loop sits between deriving `queue` and the `for (const [index, fact] of queue.entries())` loop that decides it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (This task adds no new types and calls only existing functions, so this is a sanity check, not expected to catch anything — but it is cheap and confirms the rewritten function still compiles before the slower end-to-end task.)

- [ ] **Step 4: Commit**

```bash
git add scripts/evidence/config.ts scripts/evidence/drive.ts
git commit -m "feat(evidence): drive and capture Screen 2's undecided state before the queue is worked"
```

---

### Task 4: Wire the check into the real run and verify end-to-end

**Files:**
- Modify: `scripts/evidence/run.ts`

**Interfaces:**
- Consumes: `checkContinueGated` (Task 1), `captured` map entries keyed `*-undecided` (Task 3).
- Produces: nothing new consumed elsewhere — this is the terminal wiring task.

- [ ] **Step 1: Wire `checkContinueGated` into the per-capture check loop**

In `scripts/evidence/run.ts`, add `checkContinueGated` to the import (lines 9–15):

```typescript
import {
  checkConsoleErrors,
  checkContinueGated,
  checkFont,
  checkOverflow,
  checkRendered,
  checkStatesAppeared,
} from "./preflight/checks";
```

Replace the per-capture loop (lines 99–106):

```typescript
  const results: CheckResult[] = [checkRendered(TARGETS, WIDTHS, captured)];
  for (const [key, doc] of captured) {
    const target = key.split("|")[0];
    results.push(checkOverflow(target, doc));
    results.push(checkFont(target, doc));
    results.push(checkConsoleErrors(target, doc));
    results.push(checkStatesAppeared(target, STATE_MARKERS[target], doc));
    if (target.endsWith("-undecided")) {
      results.push(checkContinueGated(target, doc));
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full unit/vitest suite**

Run: `npx vitest run`
Expected: PASS, all files — the pre-change baseline was 83 files / 911 tests; this task adds test cases to two existing files (`checks.test.ts`, `selfTest.test.ts`) and two new fixture files, so the count should read 83 files / 921 tests (five new `checkContinueGated` unit tests + two new self-test assertions folded into the existing `selfTest.test.ts` `it` block, plus four already-committed in Task 1/2 — confirm the actual delta rather than assuming it, since the exact count depends on how the shared `it` block in `selfTest.test.ts` was structured).

- [ ] **Step 4: Run `--self-test` directly and confirm exit 0**

Run: `npx tsx scripts/evidence/run.ts --self-test; echo "exit: $?"`
Expected: `exit: 0`, with `ok   continue-gated` and `ok   continue-enabled` lines present among the output (this is the same command as Task 2 Step 6 — repeated here as part of the full-suite gate, not a new assertion).

- [ ] **Step 5: Ensure a dev server and database are reachable**

Confirm Postgres is running:

Run: `docker ps --filter name=calboard-postgres --format "{{.Names}} {{.Status}}"`
Expected: one line showing the container `Up`.

Start the dev server in the background if it is not already running:

Run: `npm run dev`
(background — start it, then poll `http://127.0.0.1:3000/analyzer` until it responds 200 before proceeding, rather than sleeping a fixed duration)

- [ ] **Step 6: Run the real evidence capture end-to-end**

Run: `npm run evidence`
Expected: exits 0 (or non-zero only for a reason unrelated to this change — read the printed verdict before deciding). The console output must show, among the driving lines, both MSFT and OKLO runs completing, and the printed manifest must be inspected (not just the exit code) to confirm:
- `s2-facts-msft-undecided` and `s2-facts-msft` both present, each with `.png`/`.json` at 720, 1024, 1440.
- `s2-facts-oklo-undecided` and `s2-facts-oklo` both present, same widths.
- The preflight results include a `Continue to gates disabled with a reason on the undecided capture` entry with `status: "PASS"` for both undecided targets.
- Overall verdict `PASS` (or `UNKNOWN` only for the pre-existing, out-of-scope `s1-unavailable` reason — never a new `FAIL`).

Inspect the manifest directly rather than trusting the console summary alone:

Run: `cat .evidence/m7-gate-capture-*/manifest.json` (most recent one, by the timestamp in its directory name) and check the `targets` and `preflight.checks` keys for the above.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: clean build, no errors. (The runner is a standalone script under `scripts/`, outside the Next.js build's own source tree, but `tsc`/Next's type-checking during build can still surface a break if `@/lib/analyzer/spotCheck` or similar shared imports were affected — this is the DONE WHEN criterion's own wording, run literally.)

- [ ] **Step 8: Commit**

```bash
git add scripts/evidence/run.ts
git commit -m "feat(evidence): gate the undecided capture's Continue control in the real run"
```

---

### Task 5: Push and open the PR

**Files:** none — delivery only.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin tooling/runner-undecided-capture`

- [ ] **Step 2: Open the PR (not merged)**

No `gh` CLI in this environment (per prior session's finding) — construct the compare URL and hand it to Calvin to open, rather than attempting `gh pr create`:

`https://github.com/<owner>/<repo>/compare/master...tooling/runner-undecided-capture?expand=1`

(Confirm `<owner>/<repo>` from `git remote get-url origin` before handing over the link.) Draft a PR title and body summarizing: what changed (undecided capture + gate check), why (DESIGN's three UNCERTAINs), and the DONE WHEN checklist as a test-plan checklist, each item checked off against what Task 4 actually observed — not asserted from memory.

---

## Self-Review Notes

**Spec coverage:**
- Capture `s2-facts-<ticker>-undecided` before any decision, `s2-facts-<ticker>` after, unchanged Screen 3 — Task 3.
- New preflight check, objective, disabled + reason only — Task 1.
- No appearance/spacing/copy check added — Task 1's doc comment states this explicitly; the check body only reads `.disabled` and a text substring.
- Negative test, watched failing, no application code touched — Task 2, via the established fixture/self-test pattern.
- Runner only, no app/frozen/product/Notion changes — confirmed: every file touched is under `scripts/evidence/`.
- `.progress` counter not built — never introduced anywhere in this plan.
- One command produces the full archive, both Screen 2 states × 3 fixtures... — two fixtures (MSFT, OKLO), both states, three widths — Task 4 Step 6 is the end-to-end proof.
- Preflight check watched failing, suite passes, typecheck and build clean — Task 4 Steps 2–7.
- Push to a branch, PR open, not merged — Task 5.

**Placeholder scan:** none found — every step has literal code or a literal command with a stated expected result.

**Type consistency:** `checkContinueGated(target: string, d: ProbeDocument): CheckResult` is the same signature shape as the other five checks in `checks.ts`; `CONTINUE_LABEL` is a plain exported string constant, used identically in `checks.ts` and referenced only informally (not imported) elsewhere. `captured: Map<string, ProbeDocument>` in the rewritten `driveRun` matches the return type already declared in its signature — unchanged from the original.
