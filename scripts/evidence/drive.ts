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
