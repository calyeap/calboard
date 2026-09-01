import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// CSS-source assertions for rules jsdom can't verify through component
// rendering (no real layout engine) — a lightweight guard against
// regressing a specific, previously-shipped visual bug.
const css = readFileSync(path.resolve(__dirname, "globals.css"), "utf-8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No CSS rule found for selector: ${selector}`);
  return match[1];
}

describe("globals.css — .cb-dash regressions", () => {
  it(".toggle sizes to its own content (inline-flex), not the full section width", () => {
    // display: flex on a plain block <div> still stretches to 100% of its
    // parent's width, same as any block box — the "By holding / By asset
    // class" toggle rendered as a full-width bordered bar instead of a
    // compact segmented control until this was inline-flex.
    expect(ruleBody(".cb-dash .toggle")).toMatch(/display:\s*inline-flex\s*;/);
  });
});
