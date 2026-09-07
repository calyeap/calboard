# Evidence Runner Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command produces a DESIGN-ready evidence archive — the runner creates its own analyzer runs, captures them at three widths, runs mechanical preflight checks, and packages the result — with Calvin copying no URLs, editing no script, and zipping nothing.

**Architecture:** A standalone TypeScript CLI under `scripts/evidence/`, run with the existing `tsx` devDependency and driving the real application UI with Playwright. The pure preflight checks take a probe document and return a verdict, so they are unit-testable with no browser. The runner attaches to an already-running dev server and STOPs if it cannot reach one — it never starts, configures, or otherwise changes the environment it is measuring.

**Tech Stack:** TypeScript, tsx, Playwright (Chromium 1243 already present at `~/AppData/Local/ms-playwright`), vitest.

**Spec:** Calvin's CALBOARD PILOT brief (this conversation) plus the design approved 2026-09-07. No separate spec file — ruled by Calvin: the brief is the spec.

## Global Constraints

- **Tooling only.** No application code, no frozen artefact, no migration, no Notion, no product scope. Nothing under `app/`, `lib/`, `migrations/` or `docs/frozen/` may be modified by this work.
- **It never fixes anything it finds.** It reports and stops.
- **It never declares a design question resolved.** Only checks with an objective right answer.
- **It does NOT compare anything against the mock,** and does not judge appearance, spacing, hierarchy, copy or treatment. Adding mock comparison later requires a Command Center ruling.
- **Database:** may create analyzer runs through the real UI. Must not touch any portfolio table, must not run migrations, and must not delete or modify runs it did not create. Per Calvin's ruling of 2026-09-07 it also does not delete the runs it *did* create — it records their runIds in the manifest and leaves them.
- **Baseline:** `master` at `6ce172f` (PR #32, M7 merged). Verified green: 79 test files, 876 tests passing.
- **UNKNOWN is a real outcome,** not a rounding of FAIL. A state that could not be reached is different from a state that rendered wrongly.
- **Frozen artefact hashes (SHA-256, byte-exact).** A missing artefact is a STOP, never a hash:
  - `16e601522aa6f8e128e39e31216827106db40ec976463d0b1f53baf129347174  calboard-stock-analyzer-v1-spec.md`
  - `5625ca48c0cfd631b637b36c6fbbadae02f3065397bab7c4d7da6a1dca925016  calboard-stock-analyzer-v1-design.md`
  - `217eb87fab3eb9deb33e51180ca83ebf09df26525fefd9455e5fa05202df5bdc  mock-screen1-entry.html`
  - `2f9e741bb770c7ee2dca5c68315e1a64e5ed9b9c4287e1b5de422f1f55dd6f1c  mock-human-steps.html`
  - `35f382a109ffbeb9b048b8f6d532564e80fc26c00b8c1d6ea8345b7e17fbf870  mock-report-msft.html`
  - `fc6de075e6c84f4ba2b720d669985b4f43534f4a7ae77e658c725122d4d9476f  mock-report-oklo.html`
- **Capture widths:** 720, 1024, 1440. Full page, `deviceScaleFactor: 2`, a fresh browser context per width.
- **The source instrument:** `C:\Users\Calvin\m7gate\capture-m7-gate.js` is the capture script
  Calvin has been running by hand, and the one DESIGN's readings were taken with. The probe and
  the capture loop are ports of it — its node selector, its half-pixel overflow tolerance, its
  field names, its caps. Read it before writing either. This runner replaces the manual round
  trip around the instrument, not the instrument itself: a probe that measures something else
  produces an archive DESIGN has not been reading. It is outside the repo — never import from
  it, never modify it.
- **Font assertion target:** `div.cb-analyzer`, whose declared stack is
  `var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif`
  (`app/globals.css:1451`). Never `html` — nothing styles `html`, so it computes `"Times New Roman"` on every page and an assertion there can never fail.
- **Screen 1 UNAVAILABLE is out of scope for this pilot.** Reported UNKNOWN with the reason. Every route to it requires either changing `MARKET_DATA_PROVIDER`/`EODHD_API_KEY` (the runner reconfiguring the environment it measures) or a test seam in `app/actions/analyzer.ts` (application code, outside authority).

---

## File Structure

```
scripts/evidence/
  run.ts                    CLI entry point. Arg parsing, orchestration, exit codes.
  config.ts                 Widths, target list, frozen hashes, state markers, base URL.
  gates.ts                  Pre-capture STOP gates: frozen hashes, app reachable, DB ready.
  probe.ts                  The in-page computed-style probe. Serialised into the browser.
  capture.ts                Playwright: viewport, full-page screenshot, probe, error collection.
  drive.ts                  Playwright: Screen 1 states, run creation, fact decisions, stop at Step 6.
  selfTest.ts               --self-test: the engine run against deliberately broken fixtures.
  manifest.ts               Manifest assembly (existing shape + preflight block + runIds).
  archive.ts                Zip packaging.
  preflight/
    types.ts                ProbeNode, ProbeDocument, CheckResult, CheckStatus.
    checks.ts               The six mechanical checks. Pure: probe in, CheckResult out.
    checks.test.ts          Unit tests for each check, both directions.
    verdict.ts              Aggregation to PASS / FAIL / UNKNOWN + failing step.
    verdict.test.ts         Unit tests for aggregation precedence.
  fixtures/
    clean.html              Must PASS every check. The control.
    overflow.html           A card wider than its container. Must FAIL overflow.
    missing-font.html       No Plex declaration on .cb-analyzer. Must FAIL font.
    console-error.html      Throws on load. Must FAIL console errors.
```

`vitest` picks up `scripts/**/*.test.ts` automatically — `vitest.config.ts` excludes only `node_modules`, `.git` and `.claude/worktrees`. The `@` alias resolves to the repo root.

---

### Task 1: The six mechanical checks, pure and unit-tested

The checks are the product. They are written first, with no browser and no app, so each one is proven to fail before anything is captured.

**Files:**
- Create: `scripts/evidence/preflight/types.ts`
- Create: `scripts/evidence/preflight/checks.ts`
- Test: `scripts/evidence/preflight/checks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProbeNode`, `ProbeDocument`, `CheckResult`, `CheckStatus`; and the check functions
  `checkRendered(targets, widths, captured)`, `checkOverflow(target, doc)`, `checkFont(target, doc)`,
  `checkConsoleErrors(target, doc)`, `checkStatesAppeared(target, marker, doc)` — each returning `CheckResult`.

- [ ] **Step 1: Write `types.ts`**

```typescript
// scripts/evidence/preflight/types.ts

/**
 * One captured node, field-for-field the shape `capture-m7-gate.js` emits.
 *
 * `cls` is nullable because the existing probe writes
 * `getAttribute("class") || null` — an unclassed element carries null, not "".
 */
export interface ProbeNode {
  i: number;
  tag: string;
  cls: string | null;
  type: string | null;
  checked: boolean | null;
  disabled: boolean | null;
  ariaExpanded: string | null;
  offsetTop: number;
  scrollOverflow: boolean;
  clientW: number;
  scrollW: number;
  text: string;
  box: { x: number; y: number; w: number; h: number; right: number };
  style: Record<string, string>;
}

/** One captured page at one width. */
export interface ProbeDocument {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  docOverflow: boolean;
  bodyText: string;
  nodes: ProbeNode[];
  /** Console and page errors seen while this page loaded. */
  errors: string[];
}

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface CheckResult {
  /** The step name reported when this check decides the verdict. */
  step: string;
  status: CheckStatus;
  /** Why. Always populated for FAIL and UNKNOWN. */
  detail: string;
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// scripts/evidence/preflight/checks.test.ts
import { describe, it, expect } from "vitest";
import {
  checkRendered,
  checkOverflow,
  checkFont,
  checkConsoleErrors,
  checkStatesAppeared,
} from "./checks";
import type { ProbeDocument, ProbeNode } from "./types";

function node(over: Partial<ProbeNode> = {}): ProbeNode {
  return {
    i: 0, tag: "div", cls: null, type: null, checked: null, disabled: null,
    ariaExpanded: null, offsetTop: 0, scrollOverflow: false, clientW: 700,
    scrollW: 700, text: "", box: { x: 0, y: 0, w: 700, h: 10, right: 700 },
    style: {}, ...over,
  };
}

function doc(over: Partial<ProbeDocument> = {}): ProbeDocument {
  return {
    url: "http://127.0.0.1:3000/analyzer", title: "Calboard",
    viewport: { w: 720, h: 1200 }, docOverflow: false, bodyText: "",
    nodes: [node()], errors: [], ...over,
  };
}

const PLEX =
  'var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

describe("checkRendered", () => {
  it("PASSes when every requested target has a document at every width", () => {
    const captured = new Map([["s1-resolved|720", doc()], ["s1-resolved|1024", doc()]]);
    expect(checkRendered(["s1-resolved"], [720, 1024], captured).status).toBe("PASS");
  });

  it("FAILs naming the target and width that is missing", () => {
    const captured = new Map([["s1-resolved|720", doc()]]);
    const r = checkRendered(["s1-resolved"], [720, 1024], captured);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("s1-resolved");
    expect(r.detail).toContain("1024");
  });

  it("FAILs when a document rendered but carries no nodes", () => {
    const captured = new Map([["s1-resolved|720", doc({ nodes: [] })]]);
    expect(checkRendered(["s1-resolved"], [720], captured).status).toBe("FAIL");
  });
});

describe("checkOverflow", () => {
  it("PASSes when the document and every node fit", () => {
    expect(checkOverflow("s1-resolved", doc()).status).toBe("PASS");
  });

  it("FAILs on document overflow", () => {
    const r = checkOverflow("s1-resolved", doc({ docOverflow: true }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("document");
  });

  it("FAILs on a node whose scrollWidth exceeds its clientWidth", () => {
    const wide = node({ cls: "factcard", clientW: 700, scrollW: 880, scrollOverflow: true });
    const r = checkOverflow("s2-facts-msft", doc({ nodes: [wide] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("factcard");
    expect(r.detail).toContain("880");
  });

  it("does not fire on sub-pixel rounding the probe already tolerated", () => {
    // The probe applies a half-pixel tolerance, so a node 0.4px over reports
    // scrollOverflow false. The check must trust that verdict rather than
    // recomputing strictly and manufacturing a FAIL the layout does not have.
    const hair = node({ cls: "wrap", clientW: 657, scrollW: 657.4, scrollOverflow: false });
    expect(checkOverflow("s1-resolved", doc({ nodes: [hair] })).status).toBe("PASS");
  });

  it("names an unclassed node by its tag rather than printing null", () => {
    const bare = node({ cls: null, tag: "table", scrollOverflow: true, clientW: 600, scrollW: 900 });
    const r = checkOverflow("s2-facts-msft", doc({ nodes: [bare] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("table");
    expect(r.detail).not.toContain("null");
  });
});

describe("checkFont", () => {
  it("PASSes when .cb-analyzer declares the Plex stack", () => {
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [root] })).status).toBe("PASS");
  });

  it("FAILs when .cb-analyzer computes the system stack instead", () => {
    // The real pre-1ceb2f5 regression, reproduced from the 17:27 manual capture.
    const root = node({ cls: "cb-analyzer", style: { fontFamily: SYSTEM } });
    const r = checkFont("s1-resolved", doc({ nodes: [root] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("IBM Plex Sans");
  });

  it("FAILs rather than passing vacuously when no .cb-analyzer node exists", () => {
    const r = checkFont("s1-resolved", doc({ nodes: [node({ cls: "wrap" })] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("cb-analyzer");
  });

  it("ignores html, which is never styled and always computes Times New Roman", () => {
    const html = node({ tag: "html", style: { fontFamily: '"Times New Roman"' } });
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [html, root] })).status).toBe("PASS");
  });

  it("matches cb-analyzer as a whole class token, not a substring", () => {
    const decoy = node({ cls: "cb-analyzer-footer", style: { fontFamily: SYSTEM } });
    const root = node({ cls: "cb-analyzer", style: { fontFamily: PLEX } });
    expect(checkFont("s1-resolved", doc({ nodes: [decoy, root] })).status).toBe("PASS");
  });
});

describe("checkConsoleErrors", () => {
  it("PASSes on a clean page", () => {
    expect(checkConsoleErrors("s1-resolved", doc()).status).toBe("PASS");
  });

  it("FAILs and quotes the first error", () => {
    const r = checkConsoleErrors("s1-resolved", doc({ errors: ["TypeError: x is not a function"] }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("TypeError");
  });
});

describe("checkStatesAppeared", () => {
  it("PASSes when the expected marker is in the body text", () => {
    const d = doc({ bodyText: "Unsupported — not an operating company" });
    const r = checkStatesAppeared("s1-unsupported", "Unsupported — not an operating company", d);
    expect(r.status).toBe("PASS");
  });

  it("FAILs when the page loaded but the state never appeared", () => {
    const d = doc({ bodyText: "Step 1 — Ticker entry and identity resolution" });
    const r = checkStatesAppeared("s1-unsupported", "Unsupported — not an operating company", d);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("Unsupported");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run scripts/evidence/preflight/checks.test.ts`
Expected: FAIL with `Failed to resolve import "./checks"`.

- [ ] **Step 4: Write `checks.ts`**

```typescript
// scripts/evidence/preflight/checks.ts
import type { CheckResult, ProbeDocument } from "./types";

const pass = (step: string, detail = ""): CheckResult => ({ step, status: "PASS", detail });
const fail = (step: string, detail: string): CheckResult => ({ step, status: "FAIL", detail });

/** The family token the analyzer root must declare (app/globals.css:1451). */
export const EXPECTED_FONT_TOKEN = "IBM Plex Sans";

/** The class the Plex stack is declared on. */
export const FONT_ROOT_CLASS = "cb-analyzer";

/**
 * Every requested target rendered at every requested width.
 *
 * A document with zero nodes counts as not rendered. Capturing a blank page is
 * the failure family this runner exists to make impossible, so "the navigation
 * returned" is deliberately not the test.
 */
export function checkRendered(
  targets: readonly string[],
  widths: readonly number[],
  captured: ReadonlyMap<string, ProbeDocument>
): CheckResult {
  const step = "every requested target rendered at every width";
  const missing: string[] = [];
  for (const target of targets) {
    for (const width of widths) {
      const d = captured.get(`${target}|${width}`);
      if (d === undefined) missing.push(`${target} at ${width} (not captured)`);
      else if (d.nodes.length === 0) missing.push(`${target} at ${width} (captured, zero nodes)`);
    }
  }
  return missing.length === 0 ? pass(step) : fail(step, missing.join("; "));
}

/**
 * Document overflow, and any node whose content is wider than its box.
 *
 * Both limbs are reported because they are different faults: the document
 * overflowing is a layout that does not fit the viewport; a node overflowing is
 * a card that does not fit its own container.
 *
 * Reads the probe's own `scrollOverflow` verdict rather than recomputing
 * `scrollW > clientW` here. The probe applies a half-pixel tolerance, and it
 * must: sub-pixel layout rounding otherwise reports overflow that does not
 * exist, which would FAIL a known-good baseline and make the runner the thing
 * that is wrong.
 */
export function checkOverflow(target: string, d: ProbeDocument): CheckResult {
  const step = "no document or card overflow";
  const faults: string[] = [];
  if (d.docOverflow) faults.push(`${target} at ${d.viewport.w}: document overflows`);
  for (const n of d.nodes) {
    if (n.scrollOverflow) {
      const name = n.cls ? `${n.tag}.${n.cls}` : n.tag;
      faults.push(
        `${target} at ${d.viewport.w}: ${name} scrollW ${n.scrollW} > clientW ${n.clientW}`
      );
    }
  }
  return faults.length === 0 ? pass(step) : fail(step, faults.join("; "));
}

/**
 * The expected font family resolves in the analyzer root's computed stack.
 *
 * Asserted on div.cb-analyzer and nowhere else. `html` is never styled, so it
 * computes "Times New Roman" on every page and an assertion there could never
 * fail. The absence of a .cb-analyzer node is itself a FAIL rather than a
 * vacuous pass — a check with nothing to assert on has not passed.
 */
export function checkFont(target: string, d: ProbeDocument): CheckResult {
  const step = "expected font family resolves on .cb-analyzer";
  const roots = d.nodes.filter((n) => (n.cls ?? "").split(/\s+/).includes(FONT_ROOT_CLASS));
  if (roots.length === 0) {
    return fail(step, `${target} at ${d.viewport.w}: no div.${FONT_ROOT_CLASS} node in the capture`);
  }
  const bad = roots.filter((n) => !(n.style.fontFamily ?? "").includes(EXPECTED_FONT_TOKEN));
  if (bad.length === 0) return pass(step);
  return fail(
    step,
    `${target} at ${d.viewport.w}: .${FONT_ROOT_CLASS} computed ` +
      `"${bad[0].style.fontFamily ?? "(none)"}" which does not contain "${EXPECTED_FONT_TOKEN}"`
  );
}

/** Console errors and uncaught page errors seen while the page loaded. */
export function checkConsoleErrors(target: string, d: ProbeDocument): CheckResult {
  const step = "no console or page errors";
  if (d.errors.length === 0) return pass(step);
  return fail(
    step,
    `${target} at ${d.viewport.w}: ${d.errors.length} error(s), first: ${d.errors[0]}`
  );
}

/**
 * The requested state actually appeared, rather than being silently skipped.
 *
 * The marker is a string the application itself renders for that state, so a
 * page that loads without reaching the state fails here rather than being
 * captured as though it had.
 */
export function checkStatesAppeared(
  target: string,
  marker: string,
  d: ProbeDocument
): CheckResult {
  const step = "every requested state appeared";
  if (d.bodyText.includes(marker)) return pass(step);
  return fail(step, `${target} at ${d.viewport.w}: expected marker not present — "${marker}"`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/evidence/preflight/checks.test.ts`
Expected: PASS, 17 tests (checkRendered 3, checkOverflow 5, checkFont 5, checkConsoleErrors 2, checkStatesAppeared 2).

- [ ] **Step 6: Commit**

```bash
git add scripts/evidence/preflight/types.ts scripts/evidence/preflight/checks.ts scripts/evidence/preflight/checks.test.ts
git commit -m "feat(evidence): the six mechanical preflight checks, proven in both directions"
```

---

### Task 2: Verdict aggregation, with UNKNOWN kept distinct from FAIL

**Files:**
- Create: `scripts/evidence/preflight/verdict.ts`
- Test: `scripts/evidence/preflight/verdict.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `CheckStatus` from `./types`.
- Produces: `Verdict { status: CheckStatus; failingStep: string | null; results: CheckResult[] }`
  and `aggregate(results: CheckResult[]): Verdict`.

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/evidence/preflight/verdict.test.ts
import { describe, it, expect } from "vitest";
import { aggregate } from "./verdict";
import type { CheckResult } from "./types";

const r = (step: string, status: CheckResult["status"], detail = ""): CheckResult => ({
  step,
  status,
  detail,
});

describe("aggregate", () => {
  it("is PASS when every check passed", () => {
    const v = aggregate([r("a", "PASS"), r("b", "PASS")]);
    expect(v.status).toBe("PASS");
    expect(v.failingStep).toBeNull();
  });

  it("is FAIL naming the first failing step", () => {
    const v = aggregate([r("a", "PASS"), r("b", "FAIL", "broke"), r("c", "FAIL", "also broke")]);
    expect(v.status).toBe("FAIL");
    expect(v.failingStep).toBe("b");
  });

  it("is UNKNOWN when nothing failed but something could not be reached", () => {
    const v = aggregate([r("a", "PASS"), r("b", "UNKNOWN", "state not reachable")]);
    expect(v.status).toBe("UNKNOWN");
    expect(v.failingStep).toBe("b");
  });

  it("reports FAIL over UNKNOWN — a wrong render outranks an unreached state", () => {
    const v = aggregate([r("a", "UNKNOWN", "not reachable"), r("b", "FAIL", "broke")]);
    expect(v.status).toBe("FAIL");
    expect(v.failingStep).toBe("b");
  });

  it("is UNKNOWN, not PASS, when there were no checks to run", () => {
    expect(aggregate([]).status).toBe("UNKNOWN");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/evidence/preflight/verdict.test.ts`
Expected: FAIL with `Failed to resolve import "./verdict"`.

- [ ] **Step 3: Write `verdict.ts`**

```typescript
// scripts/evidence/preflight/verdict.ts
import type { CheckResult, CheckStatus } from "./types";

export interface Verdict {
  status: CheckStatus;
  /** The step named in the report. Null only when everything passed. */
  failingStep: string | null;
  results: CheckResult[];
}

/**
 * Rolls the individual checks into one verdict.
 *
 * FAIL outranks UNKNOWN deliberately. They are different outcomes — a state
 * that could not be reached is not a state that rendered wrongly — but when
 * both are present the wrong render is the one that needs acting on, so it is
 * the one named. An empty result set is UNKNOWN rather than PASS: a preflight
 * that checked nothing has not passed.
 */
export function aggregate(results: CheckResult[]): Verdict {
  if (results.length === 0) {
    return { status: "UNKNOWN", failingStep: "preflight ran no checks", results };
  }
  const firstFail = results.find((x) => x.status === "FAIL");
  if (firstFail) return { status: "FAIL", failingStep: firstFail.step, results };

  const firstUnknown = results.find((x) => x.status === "UNKNOWN");
  if (firstUnknown) return { status: "UNKNOWN", failingStep: firstUnknown.step, results };

  return { status: "PASS", failingStep: null, results };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/evidence/preflight/verdict.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/evidence/preflight/verdict.ts scripts/evidence/preflight/verdict.test.ts
git commit -m "feat(evidence): verdict aggregation, UNKNOWN kept distinct from FAIL"
```

---

### Task 3: Config, and the STOP gates that run before any capture

**Files:**
- Create: `scripts/evidence/config.ts`
- Create: `scripts/evidence/gates.ts`
- Test: `scripts/evidence/gates.test.ts`

**Interfaces:**
- Consumes: `CheckResult` from `./preflight/types`.
- Produces: `WIDTHS`, `DEFAULT_BASE_URL`, `FROZEN_HASHES`, `STATE_MARKERS`, `TARGETS`, `TICKERS`,
  `SCREEN1_MARKUP_MARKER`; and `verifyFrozenArtefacts(repoRoot)`, `verifyAppReachable(baseUrl)`,
  `verifyDatabaseReady()` — each `Promise<CheckResult>`.

- [ ] **Step 1: Write `config.ts`**

```typescript
// scripts/evidence/config.ts

export const WIDTHS = [720, 1024, 1440] as const;

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

/** Frozen artefacts, byte-exact. A missing file is a STOP, never a hash. */
export const FROZEN_HASHES: Readonly<Record<string, string>> = {
  "calboard-stock-analyzer-v1-spec.md":
    "16e601522aa6f8e128e39e31216827106db40ec976463d0b1f53baf129347174",
  "calboard-stock-analyzer-v1-design.md":
    "5625ca48c0cfd631b637b36c6fbbadae02f3065397bab7c4d7da6a1dca925016",
  "mock-screen1-entry.html":
    "217eb87fab3eb9deb33e51180ca83ebf09df26525fefd9455e5fa05202df5bdc",
  "mock-human-steps.html":
    "2f9e741bb770c7ee2dca5c68315e1a64e5ed9b9c4287e1b5de422f1f55dd6f1c",
  "mock-report-msft.html":
    "35f382a109ffbeb9b048b8f6d532564e80fc26c00b8c1d6ea8345b7e17fbf870",
  "mock-report-oklo.html":
    "fc6de075e6c84f4ba2b720d669985b4f43534f4a7ae77e658c725122d4d9476f",
};

/** Proves the reachability gate got Screen 1 and not merely a 200. */
export const SCREEN1_MARKUP_MARKER = "Ticker entry and identity resolution";

/**
 * The marker each target must show for its state to count as reached.
 *
 * These strings are the application's own words — `stateNameFor` in
 * app/components/AnalyzerEntry.tsx and the Step 2 / Step 6 section heads — so a
 * page that loads without reaching the state fails rather than being captured
 * as though it had.
 */
export const STATE_MARKERS: Readonly<Record<string, string>> = {
  "s1-resolved": "Listed operating company",
  "s1-unknown": "Unknown — no provider evidence for ZXQY",
  "s1-unsupported": "Unsupported — not an operating company",
  "s2-facts-msft": "Fact acquisition and spot-check",
  "s3-profile-msft": "PROFILE CONFIRMATION",
  "s2-facts-oklo": "Fact acquisition and spot-check",
  "s3-profile-oklo": "PROFILE CONFIRMATION",
};

export const TARGETS: readonly string[] = Object.keys(STATE_MARKERS);

/** Screen 1 tickers, matching the manual capture this runner replaces. */
export const TICKERS = { resolved: "MSFT", unknown: "ZXQY", unsupported: "SPY" } as const;
```

- [ ] **Step 2: Write the failing tests**

```typescript
// scripts/evidence/gates.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { verifyFrozenArtefacts, verifyAppReachable } from "./gates";

const REPO_ROOT = path.resolve(__dirname, "../..");

async function frozenCopy(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-gate-"));
  const dest = path.join(tmp, "docs", "frozen");
  await fs.mkdir(dest, { recursive: true });
  const src = path.join(REPO_ROOT, "docs", "frozen");
  for (const name of await fs.readdir(src)) {
    await fs.copyFile(path.join(src, name), path.join(dest, name));
  }
  return tmp;
}

describe("verifyFrozenArtefacts", () => {
  it("PASSes against the real docs/frozen on this baseline", async () => {
    expect((await verifyFrozenArtefacts(REPO_ROOT)).status).toBe("PASS");
  });

  it("FAILs naming the artefact whose bytes changed", async () => {
    const tmp = await frozenCopy();
    await fs.appendFile(path.join(tmp, "docs/frozen/mock-report-oklo.html"), "\n<!-- tampered -->");
    const r = await verifyFrozenArtefacts(tmp);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("mock-report-oklo.html");
  });

  it("STOPs with 'absent', not a hash mismatch, when an artefact is missing", async () => {
    const tmp = await frozenCopy();
    await fs.rm(path.join(tmp, "docs/frozen/mock-screen1-entry.html"));
    const r = await verifyFrozenArtefacts(tmp);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("mock-screen1-entry.html: absent");
  });
});

describe("verifyAppReachable", () => {
  it("FAILs on a dead port", async () => {
    const r = await verifyAppReachable("http://127.0.0.1:59999");
    expect(r.status).toBe("FAIL");
    expect(r.step).toContain("reachable");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run scripts/evidence/gates.test.ts`
Expected: FAIL with `Failed to resolve import "./gates"`.

- [ ] **Step 4: Write `gates.ts`**

```typescript
// scripts/evidence/gates.ts
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FROZEN_HASHES, SCREEN1_MARKUP_MARKER } from "./config";
import type { CheckResult } from "./preflight/types";

/**
 * Frozen artefacts, byte-exact.
 *
 * An absent artefact is reported as absent and never as a hash mismatch. They
 * are different situations — a file that changed versus a file that is not
 * there — and collapsing them hides the second inside the first.
 */
export async function verifyFrozenArtefacts(repoRoot: string): Promise<CheckResult> {
  const step = "frozen artefacts match their SHA-256";
  const faults: string[] = [];
  for (const [name, expected] of Object.entries(FROZEN_HASHES)) {
    const file = path.join(repoRoot, "docs", "frozen", name);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file);
    } catch {
      faults.push(`${name}: absent`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) faults.push(`${name}: expected ${expected}, got ${actual}`);
  }
  return faults.length === 0
    ? { step, status: "PASS", detail: "" }
    : { step, status: "FAIL", detail: faults.join("; ") };
}

/**
 * The app is reachable AND serving Screen 1.
 *
 * Deliberately not a socket check. "The port answered" is compatible with a
 * server returning a 500 or an empty shell, and capturing blank pages is the
 * failure family that cost the most time on M7.
 */
export async function verifyAppReachable(baseUrl: string): Promise<CheckResult> {
  const step = "app reachable and serving Screen 1";
  const url = new URL("/analyzer", baseUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return { step, status: "FAIL", detail: `${url}: ${(err as Error).message}` };
  }
  if (!res.ok) return { step, status: "FAIL", detail: `${url}: HTTP ${res.status}` };
  const body = await res.text();
  if (!body.includes(SCREEN1_MARKUP_MARKER)) {
    return { step, status: "FAIL", detail: `${url}: HTTP 200, but Screen 1 markup is absent` };
  }
  return { step, status: "PASS", detail: "" };
}

/**
 * The analyzer run table exists.
 *
 * The runner never migrates — an absent table is a STOP, because creating it
 * would be the runner changing the schema it is measuring against.
 */
export async function verifyDatabaseReady(): Promise<CheckResult> {
  const step = "analyzer run tables present";
  try {
    const { getPool } = await import("@/lib/db");
    const res = await getPool().query<{ present: string | null }>(
      "SELECT to_regclass('public.analyzer_runs')::text AS present"
    );
    if (res.rows[0]?.present === null) {
      return {
        step,
        status: "FAIL",
        detail:
          "analyzer_runs is absent — apply migration 002 yourself; the runner does not migrate",
      };
    }
    return { step, status: "PASS", detail: "" };
  } catch (err) {
    return { step, status: "FAIL", detail: `database unreachable: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run scripts/evidence/gates.test.ts`
Expected: PASS, 4 tests. The first asserts the real `docs/frozen` still matches all six hashes.

- [ ] **Step 6: Commit**

```bash
git add scripts/evidence/config.ts scripts/evidence/gates.ts scripts/evidence/gates.test.ts
git commit -m "feat(evidence): config and the STOP gates that run before any capture"
```

---

### Task 4: Fault fixtures and the capture engine

The fixtures come first so the capture engine has something to be proven against that is not the app.

**Files:**
- Create: `scripts/evidence/fixtures/clean.html`
- Create: `scripts/evidence/fixtures/overflow.html`
- Create: `scripts/evidence/fixtures/missing-font.html`
- Create: `scripts/evidence/fixtures/console-error.html`
- Create: `scripts/evidence/probe.ts`
- Create: `scripts/evidence/capture.ts`
- Modify: `package.json` (add `playwright` devDependency)

**Interfaces:**
- Consumes: `ProbeDocument` from `./preflight/types`.
- Produces: `probeInPage(): unknown`; and
  `captureAt(browser: Browser, args: { target: string; width: number; url: string; outDir: string; prepare?: (page: Page) => Promise<void> }): Promise<ProbeDocument>`.

- [ ] **Step 1: Install Playwright as a devDependency**

Pin **1.63.0** exactly. The Chromium already on this machine is build 1243, which is
1.63.0's — `C:\Users\Calvin\m7gate\node_modules\playwright-core` is 1.63.0 and owns the
link in `~/AppData/Local/ms-playwright/.links/`. A different minor expects a different
Chromium build and would download one.

```bash
npm install --save-dev playwright@1.63.0
```

Confirm no browser download was triggered:

```bash
npx playwright install --dry-run chromium
```

Expected: it reports chromium already installed at the `chromium-1243` path.

- [ ] **Step 2: Write the four fault fixtures**

Each mimics the analyzer's own structure — a `div.cb-analyzer` root — so the checks apply unchanged.

`scripts/evidence/fixtures/clean.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>clean</title>
<style>
  body { margin: 0; }
  .cb-analyzer {
    font-family: var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: 100%; box-sizing: border-box; padding: 12px; }
</style></head>
<body><div class="cb-analyzer"><div class="card">Fact acquisition and spot-check</div></div></body></html>
```

`scripts/evidence/fixtures/overflow.html` — identical but with a card wider than its container:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>overflow</title>
<style>
  body { margin: 0; }
  .cb-analyzer {
    font-family: var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    width: 100%; overflow-x: auto;
  }
  .card { width: 3000px; padding: 12px; }
</style></head>
<body><div class="cb-analyzer"><div class="card">Fact acquisition and spot-check</div></div></body></html>
```

`scripts/evidence/fixtures/missing-font.html` — the exact pre-`1ceb2f5` regression:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>missing-font</title>
<style>
  body { margin: 0; }
  .cb-analyzer {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .card { width: 100%; box-sizing: border-box; padding: 12px; }
</style></head>
<body><div class="cb-analyzer"><div class="card">Fact acquisition and spot-check</div></div></body></html>
```

`scripts/evidence/fixtures/console-error.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>console-error</title>
<style>
  body { margin: 0; }
  .cb-analyzer {
    font-family: var(--font-ibm-plex-sans), "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: 100%; box-sizing: border-box; padding: 12px; }
</style></head>
<body><div class="cb-analyzer"><div class="card">Fact acquisition and spot-check</div></div>
<script>console.error("EVIDENCE FIXTURE: deliberate console error");</script></body></html>
```

- [ ] **Step 3: Write `probe.ts`**

This is a **port of the PROBE constant in `C:\Users\Calvin\m7gate\capture-m7-gate.js`**, not a
fresh design. Read that file before writing this one. Every detail below is load-bearing and
was taken from it:

- The selector is an explicit list, **not `*`**. `*` would emit hundreds of nodes per page
  instead of the ~35 the existing archives carry, changing the artefact DESIGN reads.
  `[class]` in that list is what captures `html`, `div.cb-analyzer` and every styled element.
- Nodes with zero width **and** zero height are skipped — not rendered.
- Overflow carries a **half-pixel tolerance** on both limbs. Sub-pixel layout rounding
  otherwise reports overflow that does not exist.
- `cls` is `getAttribute("class") || null`.
- Box numbers round to 1 decimal place.
- `text` prefers `innerText`, capped at 200 chars; `bodyText` prefers `innerText`, capped at
  6000.
- `docOverflow` compares against `innerWidth`, not `clientWidth`.

```typescript
// scripts/evidence/probe.ts

/**
 * The in-page probe, evaluated in the browser.
 *
 * A port of the PROBE in C:\Users\Calvin\m7gate\capture-m7-gate.js — the
 * instrument DESIGN's readings have been taken with. The field names, the node
 * selector, the tolerances and the caps are all that script's, deliberately:
 * this runner replaces the manual round trip around the instrument, not the
 * instrument. Extending the shape is safe; changing what it measures is not.
 *
 * Serialised into the page by Playwright, so it must close over nothing.
 */
export function probeInPage(): unknown {
  const PROPS = [
    "display", "flexWrap", "flexDirection", "gap", "columnGap", "rowGap",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing",
    "textTransform", "color", "backgroundColor", "borderStyle", "borderWidth",
    "borderColor", "borderLeftStyle", "borderLeftWidth", "borderLeftColor",
    "padding", "margin", "maxWidth", "width", "height", "opacity", "cursor",
    "textDecorationLine",
  ];

  // Deliberately not "*". This is the existing instrument's selector: the
  // controls that carry state, the headings that carry structure, and anything
  // with a class — which is what picks up html, .cb-analyzer and every styled
  // container. Widening it to "*" would change every archive DESIGN reads.
  const SEL = [
    "fieldset", "legend", "label", "input", "select", "button", "details", "summary",
    "table", "th", "h1", "h2", "h3", "h4", "[class]",
  ].join(",");

  const nodes: unknown[] = [];
  const seen = new Set<Element>();

  document.querySelectorAll(SEL).forEach((raw, i) => {
    if (seen.has(raw)) return;
    seen.add(raw);

    const el = raw as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // not rendered

    const cs = getComputedStyle(el);
    const style: Record<string, string> = {};
    for (const p of PROPS) style[p] = (cs as unknown as Record<string, string>)[p];

    const input = el as HTMLInputElement;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

    nodes.push({
      i,
      tag: el.tagName.toLowerCase(),
      cls: el.getAttribute("class") || null,
      type: el.getAttribute("type"),
      checked: el.tagName === "INPUT" ? input.checked : null,
      disabled: input.disabled === undefined ? null : input.disabled,
      ariaExpanded: el.getAttribute("aria-expanded"),
      offsetTop: el.offsetTop,
      // Half-pixel tolerance, both here and on docOverflow below. Without it,
      // sub-pixel layout rounding reports overflow the layout does not have —
      // which would FAIL a known-good baseline and make the runner the thing
      // that is wrong.
      scrollOverflow: el.scrollWidth > el.clientWidth + 0.5,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      text: text.slice(0, 200),
      box: {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1),
        h: +r.height.toFixed(1), right: +r.right.toFixed(1),
      },
      style,
    });
  });

  return {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docOverflow: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000),
    nodes,
  };
}
```

- [ ] **Step 4: Write `capture.ts`**

Like the probe, this mirrors `capture-m7-gate.js`: **a fresh browser context per width, at
`deviceScaleFactor: 2`**, rather than resizing one page. The 2x screenshots are what DESIGN
has been reading, and a fresh context keeps each width's console errors its own.

`captureAt` takes a `prepare` callback that lands the page on the state to capture. Screen 1
needs typing; the fact and profile screens only need a URL, because once a run exists its
screens are URL-addressable — which is exactly how the existing script captured them.

```typescript
// scripts/evidence/capture.ts
import path from "node:path";
import fs from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { probeInPage } from "./probe";
import type { ProbeDocument } from "./preflight/types";

/**
 * Captures one target at one width in its own browser context.
 *
 * `prepare` receives a page already loaded at `url` and lands it on the state
 * to capture — typing a ticker, waiting for a result. It returns nothing; the
 * screenshot and probe follow whatever it leaves on screen.
 *
 * The error collector is attached before navigating, because errors thrown
 * during load are the ones worth catching and a collector attached afterwards
 * misses them.
 */
export async function captureAt(
  browser: Browser,
  args: {
    target: string;
    width: number;
    url: string;
    outDir: string;
    prepare?: (page: Page) => Promise<void>;
  }
): Promise<ProbeDocument> {
  const { target, width, url, outDir, prepare } = args;

  // deviceScaleFactor 2 matches the existing instrument — DESIGN reads 2x
  // screenshots, and halving them silently would change the evidence.
  const ctx = await browser.newContext({
    viewport: { width, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    if (prepare) await prepare(page);
    // Settle, as the existing script does — layout and fonts after the last
    // network event.
    await page.waitForTimeout(400);

    await page.screenshot({
      path: path.join(outDir, `${target}-${width}.png`),
      fullPage: true,
    });

    const probed = (await page.evaluate(probeInPage)) as Omit<ProbeDocument, "errors">;
    const doc: ProbeDocument = { ...probed, errors };

    await fs.writeFile(
      path.join(outDir, `${target}-${width}.json`),
      JSON.stringify(doc, null, 1),
      "utf8"
    );
    return doc;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/evidence/fixtures scripts/evidence/probe.ts scripts/evidence/capture.ts
git commit -m "feat(evidence): fault fixtures and the capture engine"
```

---

### Task 5: `--self-test` — prove every check FAILs

This is DONE WHEN #2. A preflight that has never failed is a check that cannot fail.

**Files:**
- Create: `scripts/evidence/selfTest.ts`
- Test: `scripts/evidence/selfTest.test.ts`

**Interfaces:**
- Consumes: `captureAt` (Task 4); `checkOverflow`, `checkFont`, `checkConsoleErrors` (Task 1);
  `verifyAppReachable` (Task 3).
- Produces: `SelfTestResult { name; expected; actual; step; ok }` and `runSelfTest(): Promise<SelfTestResult[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/evidence/selfTest.test.ts
import { describe, it, expect } from "vitest";
import { runSelfTest } from "./selfTest";

describe("runSelfTest", () => {
  it("shows every check failing against its fault fixture", async () => {
    const results = await runSelfTest();
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get("clean")?.actual).toBe("PASS");
    expect(byName.get("overflow")?.actual).toBe("FAIL");
    expect(byName.get("missing-font")?.actual).toBe("FAIL");
    expect(byName.get("console-error")?.actual).toBe("FAIL");
    expect(byName.get("dead-port")?.actual).toBe("FAIL");

    for (const r of results) expect(r.ok).toBe(true);
  }, 180_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/evidence/selfTest.test.ts`
Expected: FAIL with `Failed to resolve import "./selfTest"`.

- [ ] **Step 3: Write `selfTest.ts`**

```typescript
// scripts/evidence/selfTest.ts
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { captureAt } from "./capture";
import { checkConsoleErrors, checkFont, checkOverflow } from "./preflight/checks";
import { verifyAppReachable } from "./gates";
import type { CheckResult, ProbeDocument } from "./preflight/types";

export interface SelfTestResult {
  name: string;
  /** The status this fixture is supposed to produce. */
  expected: "PASS" | "FAIL";
  actual: string;
  /** The step the check named, so a FAIL for the wrong reason stays visible. */
  step: string;
  ok: boolean;
}

const FIXTURE_DIR = path.join(__dirname, "fixtures");

/**
 * Runs the real capture engine and the real checks against fixtures that are
 * deliberately broken, and asserts each produces a FAIL naming the right step.
 *
 * Fixtures rather than temporary edits to app/globals.css: breaking the
 * application to test the instrument would be the runner changing the thing it
 * measures, which is the same objection that keeps Screen 1 UNAVAILABLE out of
 * this pilot. These also stay re-runnable, so the checks are re-proven on every
 * suite run rather than once, in a transcript.
 */
export async function runSelfTest(): Promise<SelfTestResult[]> {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-selftest-"));
  const browser = await chromium.launch();
  const results: SelfTestResult[] = [];

  const record = (name: string, expected: "PASS" | "FAIL", r: CheckResult): void => {
    results.push({ name, expected, actual: r.status, step: r.step, ok: r.status === expected });
  };

  try {
    const load = (fixture: string): Promise<ProbeDocument> =>
      captureAt(browser, {
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
      step: cleanBad ? `${cleanBad.step}: ${cleanBad.detail}` : "",
      ok: cleanBad === undefined,
    });

    record("overflow", "FAIL", checkOverflow("overflow", await load("overflow")));
    record("missing-font", "FAIL", checkFont("missing-font", await load("missing-font")));
    record("console-error", "FAIL", checkConsoleErrors("console-error", await load("console-error")));
    record("dead-port", "FAIL", await verifyAppReachable("http://127.0.0.1:59999"));
  } finally {
    await browser.close();
    await fs.rm(out, { recursive: true, force: true });
  }

  return results;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/evidence/selfTest.test.ts`
Expected: PASS.

If `missing-font` reports PASS, the font check is pointed at the wrong node — fix `checkFont`, never the fixture. If `clean` reports FAIL, a check is over-firing and must be fixed before any FAIL below is trustworthy.

- [ ] **Step 5: Commit**

```bash
git add scripts/evidence/selfTest.ts scripts/evidence/selfTest.test.ts
git commit -m "test(evidence): negative test — every check proven to fail against a fault fixture"
```

---

### Task 6: Drive the app — Screen 1 states, run creation, fact decisions

Driving is by the server-action contract — `name="runId"`, `name="factId"`, hidden `name="decision"`, `name="reasonCode"`, and radios `name="decision-<factId>"` with values `CONFIRMED` / `NOT CONFIRMED` (`app/components/FactCard.tsx:117-190`). Those names are the action's API and cannot change without changing behaviour, whereas the copy, spacing and colour DESIGN churns between gates never touch them.

**Files:**
- Create: `scripts/evidence/drive.ts`

**Interfaces:**
- Consumes: `WIDTHS`, `TICKERS` (config); `captureAt` (capture);
  `queuedFacts` from `@/lib/analyzer/spotCheck`; `MSFT_FIXTURE`, `OKLO_FIXTURE`.
- Produces: `resolveTicker(page, ticker): Promise<void>`;
  `driveScreen1(browser, baseUrl, outDir): Promise<Map<string, ProbeDocument>>`;
  `driveRun(browser, baseUrl, ticker, outDir, opts): Promise<{ runId: string; captured: Map<string, ProbeDocument> }>`.

Two structural points, both from the existing instrument:

- **The run is created once, then captured by URL.** `driveRun` opens one page, resolves the
  ticker, begins the run, answers the queue, and stops. Only then does it capture — three
  widths for the facts screen and three for the profile screen — by navigating fresh contexts
  to `/analyzer/<runId>/facts` and `/analyzer/<runId>/profile`. The decisions live in the
  database, so the URL reproduces the state; this is exactly what `capture-m7-gate.js` did
  with its hand-pasted URLs, and it is what lets every capture run at 2x in its own context.
- **Resolution waits on the DOM, not on the network.** Screen 1's resolution is a React
  server action that updates in place without navigating, so `networkidle` can settle before
  the result renders. Wait for `.result` to appear. (The existing script slept 2500ms; waiting
  on the element is deterministic and strictly better.)

- [ ] **Step 1: Write `drive.ts`**

```typescript
// scripts/evidence/drive.ts
import type { Browser, Page } from "playwright";
import { captureAt } from "./capture";
import { WIDTHS, TICKERS } from "./config";
import type { ProbeDocument } from "./preflight/types";
import { queuedFacts } from "@/lib/analyzer/spotCheck";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { OKLO_FIXTURE } from "@/lib/analyzer/fixtures/oklo";

const FIXTURES = { MSFT: MSFT_FIXTURE, OKLO: OKLO_FIXTURE } as const;

/**
 * Types a ticker into Screen 1 and waits for the resolution to render.
 *
 * Resolution fires on blur — there is deliberately no Resolve button — and it
 * is a server action that updates in place without navigating, so waiting for
 * the network to go idle can return before the result exists. Waiting for the
 * result element is the deterministic form of the same wait.
 */
export async function resolveTicker(page: Page, ticker: string): Promise<void> {
  await page.fill('input[name="ticker"]', ticker);
  await page.locator('input[name="ticker"]').blur();
  await page.waitForSelector(".result", { timeout: 30_000 });
}

/**
 * Screen 1's three reachable states, each captured at every width.
 *
 * UNAVAILABLE is absent by design: every route to it changes the environment
 * under measurement. The caller reports it UNKNOWN with that reason.
 */
export async function driveScreen1(
  browser: Browser,
  baseUrl: string,
  outDir: string
): Promise<Map<string, ProbeDocument>> {
  const captured = new Map<string, ProbeDocument>();
  const url = new URL("/analyzer", baseUrl).toString();
  const cases = [
    ["s1-resolved", TICKERS.resolved],
    ["s1-unknown", TICKERS.unknown],
    ["s1-unsupported", TICKERS.unsupported],
  ] as const;

  for (const [target, ticker] of cases) {
    for (const width of WIDTHS) {
      const doc = await captureAt(browser, {
        target,
        width,
        url,
        outDir,
        prepare: (page) => resolveTicker(page, ticker),
      });
      captured.set(`${target}|${width}`, doc);
    }
  }
  return captured;
}

/**
 * Creates one run through the real UI, answers its queue, stops before Step 6,
 * then captures the two screens at every width.
 *
 * Every decision goes through the form the analyst uses, so the gate, the
 * server actions and the redirects are all exercised. Seeding decisions into
 * the database instead would let this capture a profile screen no human could
 * have reached, which is exactly what the evidence must not contain.
 *
 * Driving happens once, on one page; capture then navigates fresh contexts to
 * the run's URLs. The decisions are persisted, so the URL reproduces the state
 * — and each capture gets its own context at 2x, as the existing instrument does.
 */
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
      await page.waitForLoadState("networkidle");
    }

    // Step 2 must actually be complete, or the profile screen is not reachable
    // and the capture below would silently record the wrong screen.
    await page.waitForSelector('a:has-text("Continue to gates")', { timeout: 30_000 });
  } finally {
    await ctx.close();
  }

  // Step 6 is never submitted. The profile screen therefore captures with
  // nothing selected — the state §6.3 requires and the one DESIGN needs to see.
  const captured = new Map<string, ProbeDocument>();
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

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/evidence/drive.ts
git commit -m "feat(evidence): drive Screen 1's states and both runs through the real UI"
```

---

### Task 7: Manifest, archive, and the one command

**Files:**
- Create: `scripts/evidence/manifest.ts`
- Create: `scripts/evidence/archive.ts`
- Create: `scripts/evidence/run.ts`
- Modify: `package.json` (add the `evidence` script)
- Modify: `.gitignore` (ignore `.evidence/`)
- Modify: `README.md` (document the command)

**Interfaces:**
- Consumes: everything above.
- Produces: `buildManifest(args)`, `zipDirectory(dir, zipPath)`, and the `npm run evidence` command.

- [ ] **Step 1: Write `manifest.ts`**

```typescript
// scripts/evidence/manifest.ts
import { WIDTHS } from "./config";
import type { ProbeDocument } from "./preflight/types";
import type { Verdict } from "./preflight/verdict";

export interface ManifestArgs {
  baseUrl: string;
  captured: ReadonlyMap<string, ProbeDocument>;
  verdict: Verdict;
  runIds: Record<string, string>;
  unknowns: { target: string; reason: string }[];
}

/**
 * The manifest, additive to the shape DESIGN already reads.
 *
 * `base`, `captured`, `widths` and `targets` keep their existing names and
 * meaning, so nothing about how the archive is read has to change. `preflight`
 * and `runs` are new.
 */
export function buildManifest(args: ManifestArgs): unknown {
  const targets: Record<string, unknown> = {};
  const names = new Set([...args.captured.keys()].map((k) => k.split("|")[0]));

  for (const target of names) {
    const widths: Record<string, unknown> = {};
    for (const w of WIDTHS) {
      const d = args.captured.get(`${target}|${w}`);
      if (d === undefined) continue;
      widths[String(w)] = {
        screenshot: `${target}-${w}.png`,
        nodes: d.nodes.length,
        errors: d.errors,
      };
    }
    targets[target] = { widths };
  }
  for (const u of args.unknowns) targets[u.target] = { skipped: u.reason };

  return {
    base: args.baseUrl,
    captured: new Date().toISOString(),
    widths: [...WIDTHS],
    preflight: {
      verdict: args.verdict.status,
      failingStep: args.verdict.failingStep,
      checks: args.verdict.results,
    },
    // Recorded, never deleted. Runs are disposable by R7; these are listed so
    // clearing them stays Calvin's decision and not the runner's.
    runs: args.runIds,
    targets,
  };
}
```

- [ ] **Step 2: Write `archive.ts`**

```typescript
// scripts/evidence/archive.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Zips the capture directory.
 *
 * PowerShell's Compress-Archive rather than an archiver dependency: it is
 * present on this platform, and the archive is a delivery detail rather than
 * something worth adding a package for.
 */
export async function zipDirectory(dir: string, zipPath: string): Promise<void> {
  await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zipPath}' -Force`,
  ]);
}
```

- [ ] **Step 3: Write `run.ts`**

```typescript
// scripts/evidence/run.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { config as loadEnv } from "dotenv";
import { DEFAULT_BASE_URL, STATE_MARKERS, TARGETS, WIDTHS } from "./config";
import { verifyAppReachable, verifyDatabaseReady, verifyFrozenArtefacts } from "./gates";
import { driveRun, driveScreen1 } from "./drive";
import {
  checkConsoleErrors,
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

/** Prints a gate's result and exits non-zero when it stopped the run. */
function stopOn(r: CheckResult): void {
  if (r.status === "PASS") {
    console.log(`  ok   ${r.step}`);
    return;
  }
  console.error(`\nSTOP — ${r.step}\n  ${r.detail}\n`);
  process.exit(1);
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
  stopOn(await verifyFrozenArtefacts(REPO_ROOT));
  stopOn(await verifyAppReachable(baseUrl));
  stopOn(await verifyDatabaseReady());

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
  }
  results.push(await verifyFrozenArtefacts(REPO_ROOT));
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

  const zipPath = `${outDir}.zip`;
  await zipDirectory(outDir, zipPath);

  console.log(`\nPreflight: ${verdict.status}`);
  if (verdict.failingStep) console.log(`  step: ${verdict.failingStep}`);
  for (const r of verdict.results.filter((x) => x.status !== "PASS")) {
    console.log(`  ${r.status}  ${r.step} — ${r.detail}`);
  }
  console.log(`\nArchive: ${zipPath}`);

  // FAIL is the only non-zero outcome. UNKNOWN is a real result, not an error.
  process.exit(verdict.status === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nSTOP — runner error\n  ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Add the command and ignore the output directory**

In `package.json`, add to `scripts`:

```json
"evidence": "tsx scripts/evidence/run.ts"
```

Append to `.gitignore`:

```
# Design evidence archives — regenerated by `npm run evidence`, never committed
.evidence/
```

- [ ] **Step 5: Prove the negative test, then the real run**

```bash
npm run evidence -- --self-test
```

Expected: every line `ok`, exit 0.

Then, with `npm run dev` running in another terminal (note the port — pass `EVIDENCE_BASE_URL` if it is not 3000):

```bash
npm run evidence
```

Expected: three gates pass; Screen 1 and both runs drive; `Preflight: UNKNOWN` with `Screen 1 UNAVAILABLE captured` as the only non-PASS; archive written to `.evidence/`.

Any FAIL here is the runner being wrong, not the app — this baseline is known good.

- [ ] **Step 6: Full verification**

```bash
npm test
```

Expected: 83 test files, all passing (79 baseline + `checks`, `verdict`, `gates`, `selfTest`).

```bash
npx tsc --noEmit
```

Expected: no output.

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 7: Document and commit**

Add a "Design evidence runner" section to `README.md` covering: start the dev server first; run `npm run evidence`; what the archive contains; what PASS / FAIL / UNKNOWN mean; that the runner never fixes anything it finds and never deletes runs; and that Screen 1 UNAVAILABLE is captured separately.

```bash
git add scripts/evidence/manifest.ts scripts/evidence/archive.ts scripts/evidence/run.ts package.json .gitignore README.md
git commit -m "feat(evidence): one-command archive with manifest, preflight verdict and packaging"
```

---

## Self-Review

**Spec coverage.** Brief item 1 (app reachable) → Task 3 `verifyAppReachable`, asserting Screen 1 markup rather than an open socket. Item 2 (creates its own runs, both tickers, stops before Step 6, three Screen 1 states, MSFT Cannot-verify with a reason code) → Task 6. Item 3 (720/1024/1440, full page, screenshots plus the computed-style probe in the existing script's shape) → Task 4. Item 4 (mechanical preflight, PASS/FAIL/UNKNOWN, exact failing step named) → Tasks 1, 2, 7. Item 5 (packaged archive, no manual zipping) → Task 7. DONE WHEN 1 → Task 7 Step 5. DONE WHEN 2 → Task 5. DONE WHEN 3 → Task 7 Step 5. DONE WHEN 4 → Task 7 Step 6. DONE WHEN 5 → handoff: pushed to a branch, PR open, not merged.

**Authority.** No task modifies `app/`, `lib/`, `migrations/` or `docs/frozen/`. `package.json`, `.gitignore` and `README.md` are the only existing files touched, all tooling concerns. No migration is run — `verifyDatabaseReady` refuses rather than creating. No run is deleted. No mock comparison anywhere.

**Placeholders.** None. Every code step carries the actual code; every command step carries its expected output.

**Type consistency.** `ProbeNode` / `ProbeDocument` / `CheckResult` / `CheckStatus` are defined once in `preflight/types.ts` and imported everywhere. `Verdict` is defined in `verdict.ts` and imported by `manifest.ts` and `run.ts`. The check functions keep the signatures declared in Task 1's Interfaces block throughout. `capturePage` takes `errors` in every call site.

**Known risks, both to confirm at Task 7 Step 5.**

1. `checkFont` asserts on `div.cb-analyzer`. If the current build renders the analyzer screens without that root, the check FAILs on a known-good baseline — which under DONE WHEN 3 means the runner is wrong, not the app. Fix by widening the assertion to the element `app/globals.css` actually declares the Plex stack on. Do **not** weaken it to "any node mentions Plex", which restores the vacuous pass.

2. `checkOverflow` runs against every node. Sub-pixel rounding is already handled — the probe's
   half-pixel tolerance is carried over from the existing instrument — but a component that
   *legitimately* scrolls its own content (a deliberate `overflow-x: auto` container) would
   still report as a fault. If the known-good baseline produces such a FAIL, the correct fix is
   an explicit, named allowlist of intentionally-scrollable classes in `config.ts`, never
   removing the node-level limb. Record each allowlist entry with the reason it is intentional,
   so the exemption is visible rather than silent.

3. The plan's first draft reconstructed the probe from the *output* of `capture-m7-gate.js`
   rather than from the script, and got the node selector, the overflow tolerance, the `cls`
   nullability and the screenshot scale wrong. Two of those would have produced FAILs on a
   known-good baseline; one would have changed the artefact DESIGN reads. If any later question
   arises about what the probe should emit, the answer is in that file, not in a sample of its
   output.
