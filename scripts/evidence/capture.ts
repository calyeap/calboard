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

  const errors: string[] = [];

  try {
    const page = await ctx.newPage();
    page.on("pageerror", (err) => errors.push(`pageerror: ${String(err)}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
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
