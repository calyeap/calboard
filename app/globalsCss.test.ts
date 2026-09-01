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

describe("globals.css — .holdings-chrome dark-mode regressions", () => {
  it("form controls explicitly reset color away from the dark ink value, not var(--color-text)", () => {
    // The foundation's `button, input, select, textarea { color: inherit }`
    // rule pulls whatever --color-text resolves to in scope — which
    // .holdings-chrome[data-theme="dark"] redefines to a pale colour for
    // static chrome text. Without an explicit reset here, every input,
    // select and button inside dark Holdings would render pale text on
    // their native white background: illegible. Must be a literal colour,
    // not var(--color-text) — that variable is the dark value in this
    // exact scope, so re-reading it here would silently reintroduce the bug.
    const match = css.match(
      /\.holdings-chrome\[data-theme="dark"\]\s+input,[\s\S]*?\.holdings-chrome\[data-theme="dark"\]\s+button\s*\{([^}]*)\}/
    );
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/color:\s*#1a1a1a\s*;/);
    expect(match![1]).not.toMatch(/var\(--color-text\)/);
  });

  it("redefines the shared --color-* custom properties rather than introducing a parallel token set", () => {
    const body = ruleBody('.holdings-chrome[data-theme="dark"]');
    expect(body).toMatch(/--color-text:/);
    expect(body).toMatch(/--color-page-bg:/);
    expect(body).toMatch(/--color-border:/);
  });
});
