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
 * The expected font family is declared in the analyzer root's computed stack.
 *
 * This proves the computed `font-family` declaration contains the expected
 * token — not that the webfont file actually loaded. `app/globals.css`
 * includes `"IBM Plex Sans"` as a literal fallback inside that same
 * declaration, so the token reads as present whenever the declaration
 * exists, even if the network request for the font file failed. A possible
 * future strengthening is `document.fonts.check()`, which would prove the
 * font actually loaded at a given size/weight — not added here, since it
 * risks failing a known-good build on a size/weight technicality this check
 * was never meant to judge.
 *
 * Asserted on div.cb-analyzer and nowhere else. `html` is never styled, so it
 * computes "Times New Roman" on every page and an assertion there could never
 * fail. The absence of a .cb-analyzer node is itself a FAIL rather than a
 * vacuous pass — a check with nothing to assert on has not passed.
 */
export function checkFont(target: string, d: ProbeDocument): CheckResult {
  const step = "expected font family declared on .cb-analyzer";
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
 *
 * Matched case-insensitively. `app/globals.css` uppercases the state-name span
 * via `text-transform`, and `bodyText` (`document.body.innerText`) reflects
 * that CSS — so a case-sensitive check would FAIL a known-good build. This
 * runner is explicitly forbidden from judging appearance/treatment such as a
 * `text-transform`, and hardcoding the uppercased form would just recreate the
 * same fragility the moment the design changes that transform. Do not tighten
 * this back to a case-sensitive comparison.
 */
export function checkStatesAppeared(
  target: string,
  marker: string,
  d: ProbeDocument
): CheckResult {
  const step = "every requested state appeared";
  if (d.bodyText.toLowerCase().includes(marker.toLowerCase())) return pass(step);
  return fail(step, `${target} at ${d.viewport.w}: expected marker not present — "${marker}"`);
}
