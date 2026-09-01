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

describe("globals.css — .holdings-chrome control-direction regressions", () => {
  it("defines its own parallel token set in dark mode, not the legacy --color-* tokens", () => {
    // 2026-09-0X: .holdings-chrome moved from the earlier minimal dark-only
    // patch (which redefined the legacy --color-* tokens so unstyled
    // foundation rules picked them up automatically) to a full,
    // self-contained system mirroring .cb-dash — HoldingsTopBar and the
    // rewritten HoldingsEditor no longer render any legacy-foundation class
    // (.site-nav, .page-shell, the button/input/select{color:inherit}
    // fallback) inside this wrapper, so there is nothing left for
    // --color-* to serve here. This replaces the assertion that used to
    // require the opposite ("redefines the shared --color-* custom
    // properties rather than introducing a parallel token set") — that
    // mechanism existed only to keep form controls "deliberately left
    // native/light," which is exactly the seam this milestone closes.
    const body = ruleBody('.holdings-chrome[data-theme="dark"]');
    expect(body).toMatch(/--ink:\s*#E9EAE7\s*;/);
    expect(body).toMatch(/--field:\s*#1E2124\s*;/);
    expect(body).toMatch(/--line-strong:\s*#3C4045\s*;/);
    expect(body).not.toMatch(/--color-text:/);
    expect(body).not.toMatch(/--color-page-bg:/);
    expect(body).not.toMatch(/--color-border:/);
  });

  it("form controls theme via the scoped tokens, not a hardcoded light colour", () => {
    // The old block forced every input/select/button back to a literal
    // #1a1a1a in dark mode. That seam is closed: .inp and .cellinput read
    // var(--ink)/var(--field), which the dark block above already
    // redefines — no separate dark-mode override is needed, and no
    // hardcoded colour literal survives on either class.
    const inp = ruleBody(".holdings-chrome .inp");
    expect(inp).toMatch(/color:\s*var\(--ink\)\s*;/);
    expect(inp).toMatch(/background-color:\s*var\(--field\)\s*;/);
    expect(inp).not.toMatch(/#1a1a1a/i);
    const cellinput = ruleBody(".holdings-chrome .cellinput");
    expect(cellinput).toMatch(/color:\s*var\(--ink\)\s*;/);
    expect(cellinput).not.toMatch(/#1a1a1a/i);
  });
});
