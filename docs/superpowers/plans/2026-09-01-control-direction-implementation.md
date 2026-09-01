# Control Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/holdings` up to the frozen control-level direction (every interactive control specified in `calboard-control-spec.md`, in both themes, all states), ride along the small set of Dashboard-side corrections the same spec calls out, and land the two approved behaviour changes — per-row Retry removed from Holdings in favour of the Dashboard's global-refresh pattern, and the `Change date` disclosure replaced by a permanently visible `Recording as of` field.

**Architecture:** Holdings gets its own scoped visual system, `.holdings-chrome` (already exists as an empty shell wrapper, `HoldingsShell`, currently only carrying a minimal dark-mode-only patch) — extended into a full parallel token/component system mirroring how `.cb-dash` was built for the Dashboard in the prior milestone, but covering **both** themes from the start, not dark-only. A new `HoldingsTopBar` (mirroring `DashboardTopBar`) replaces the shared `NavBar` on `/holdings` only — `NavBar` itself is untouched because `/accounts/new` still uses it and is explicitly out of scope. `PriceCell` loses its per-row Retry entirely; Holdings' page gets the Dashboard's existing `PriceRefreshControl` + `refreshAllPricesAction` instead. Dashboard gets four small, additive corrections (new tokens, theme-toggle bordered→bare, dark-mode segmented-control fill, dark-mode focus-ring colour) — its own markup/structure/data behaviour is otherwise untouched, verified by diff at the end.

**Tech Stack:** Next.js 15 App Router, React 18 Server + Client Components, vanilla CSS custom properties (no framework), Vitest + Testing Library, Decimal.js.

**Spec:** `calboard-control-spec.md` (Downloads, the corrected copy — see Global Constraints), `calboard-holdings-final.html` (md5 `a7f20736a101621d31502b2027f095f8`), `calboard-dashboard-final.html` (md5 `0e310e263a91b934026cb7fe498e3804`), `calboard-control-reference.html` (QA tooling only, not a requirement). All four in `Downloads`, not committed to the repo — read them directly for exact markup/CSS/copy. `DESIGN.md` and this session's CALBOARD BUILD brief (given verbatim in conversation) for constraints.

## Global Constraints

- Two routes only: `/` (Dashboard) and `/holdings`. `/accounts/new` (`SetupWizard.tsx`, `NavBar.tsx`) is explicitly DO NOT TOUCH — classified LATER — even though the control spec's rules would technically cover its controls too.
- Use the **corrected** `calboard-control-spec.md` (Downloads — the copy where §43 reads "the only radius exception is radio controls" and §53 has the pending-disabled exception; NOT the older copy where §43 says "no exceptions" and lacks that carve-out).
- Do not touch: the ~13% mask column-shift mechanism already on Dashboard (`table-layout:fixed` + explicit `col` widths in `.cb-dash table.holdings`), `/accounts/new`, the append-only ledger and its triggers, the invalid-symbol contract, average-cost basis / USD accounting / SGD-display-only, anti-momentum constraints (EOD-only, no %-change sort, no automatic/interval refresh), and **Holdings' actual row order** — see the Sort Order Decision note below.
- **Sort order decision (explicit user call, overrides the literal mock):** `calboard-holdings-final.html`'s "Sorted by weight" note and control-spec §8.2's "holdings sort by weight, fixed" do **not** apply to `/holdings`. Holdings is an editor, not a reading surface — weight is derived from quantity × price, so a weight sort would reorder rows mid-edit as the user types. Keep `getPortfolioView()`'s existing alphabetical order untouched; **omit** the "Sorted by weight" note from the Positions section entirely (do not replace it with "Sorted alphabetically" — the order is self-evident and the label adds nothing). Do not touch Dashboard's own weight sort. Note in the final report that control-spec §8.2 is factually wrong about `/holdings` and that's a spec correction for DESIGN, not something this PR fixes.
- **Icon-button border assignment (explicit resolution of a mock/spec conflict):** `calboard-holdings-final.html` renders both the privacy and theme-toggle buttons as bare icons (`class="iconbare"` on both); `calboard-dashboard-final.html` renders both as bordered (`class="ctl icononly"` on both). Neither mock actually implements the distinction control-spec §6.1/§6.2 describe. The written spec is authoritative for "control and state rules" per the stated reference precedence, is explicit and deliberate here (dedicated subsections, a named reasoning paragraph, and checklist item "Theme toggle changed from bordered to bare (§6.2)"), so **follow the spec, not the mock markup**: privacy toggle bordered (§6.1) on both routes, theme toggle bare (§6.2) on both routes. Flag this explicitly in the PR description.
- **Responsive architecture deviation (settled by an existing test, not a new decision):** `calboard-holdings-final.html`'s mobile `.stack` cards duplicate the editable Quantity/Avg cost inputs and the Remove action *outside* the table, as a second parallel markup. `HoldingsEditor.test.tsx`'s existing, passing test **T30-3** ("each editable control and row action is rendered exactly once (no duplicated narrow-width variant)") explicitly forbids this for Holdings' *interactive* elements — a deliberate, tested architectural decision from a prior milestone. Per "do not weaken or delete tests to get green," this plan achieves the same visual outcome (no horizontal scroll, Remove always reachable, readable at 420px) by restyling the **existing single-markup CSS-restack** mechanism (`.editor-table`/`.cell-label`, already used elsewhere in the app) to the control-spec's colours/spacing/typography and a 720px breakpoint, instead of adopting the mock's dual-markup `.stack` approach. Dashboard's own read-only `.stack` (no interactive elements in it) is untouched and out of scope for this deviation.
- **Test-rewrite cap:** exactly one existing test file's assertions may be rewritten in this milestone — `app/globalsCss.test.ts`'s `.holdings-chrome dark-mode regressions` block, in Task 7, per Calvin's explicit approval (it hard-asserts the mechanism of the old minimal dark-only patch Task 7 supersedes; T30-3 and every other existing test stand as binding contracts). No other task, and no fix-loop round on any task, may edit a test's assertions to make it pass — a conflicting test anywhere else means stop and ask, not rule.
- No new sections, cards, shadows, toasts or motion beyond `120ms ease-out` colour/border/outline transitions (control-spec §1).
- No `opacity`-based disabled styling anywhere (control-spec §1).
- Full `npm test` and `npx tsc --noEmit` must pass before opening the PR. Verify both themes, both routes, in a real browser — not just jsdom.
- Work on a branch. When verified: push, open the PR, then **stop**. Do not merge.

---

## File Structure

**New files:**
- `app/components/HoldingsTopBar.tsx` + `.test.tsx` — Holdings-only nav: brand, Dashboard/Holdings links, bordered privacy toggle, bare theme toggle. Mirrors `DashboardTopBar`; replaces `<NavBar/>` on `/holdings` only.
- `lib/formatCheckedAt.ts` + `.test.ts` — extracted from `app/page.tsx`'s private `formatCheckedAt`, so both `/` and `/holdings` share one "Data checked … SGT" formatter.

**Modified files:**
- `app/globals.css` — new §0 control-spec tokens added to `.cb-dash` (both themes); dark-mode segmented-control fill correction; new `.cb-dash .iconbare` bare-icon rule; dark-mode focus-ring correction; `.holdings-chrome` rebuilt from a minimal dark-only patch into a full parallel system (light + dark), all control-spec sections, 720px breakpoint.
- `app/globalsCss.test.ts` — the ONE authorized test rewrite this milestone: `.holdings-chrome dark-mode regressions` assertions replaced to match the new architecture (Task 7 — see the Global Constraints test-rewrite cap).
- `app/components/DashboardTopBar.tsx` — theme-toggle button's `className` changes from `"ctl icononly"` to `"iconbare"`; privacy toggle unchanged.
- `app/components/PriceCell.tsx` + `.test.tsx` — Retry entirely removed; simplified to a presentational marker+title price display matching `DashboardHoldingsTable`'s existing pattern; props drop to `priceStatus`/`priceUsd`/`priceDate` only.
- `app/holdings/HoldingsEditor.tsx` + `.test.tsx` — `Change date` disclosure replaced by a permanently visible `Recording as of` date field; full control-spec markup/class rewrite (buttons, inputs, select, cellinput editable cells, footnote, status placement, pending-button width reservation); `PriceCell` call site drops `assetId`/`symbol`/`assetClass` props.
- `app/holdings/page.tsx` — `NavBar` replaced by `HoldingsTopBar`; adds the "Data checked …" line + `PriceRefreshControl` (the global-refresh replacement for per-row Retry); computes `checkedAt` via the shared `lib/formatCheckedAt`.
- `app/page.tsx` — `formatCheckedAt` now imported from `lib/formatCheckedAt` instead of defined locally; no behavioural change.
- `DESIGN.md` — record Holdings' own visual pass, the Retry→global-refresh parity between routes, the icon-button border resolution, the sort-order decision, and the single-markup responsive deviation from the mock.

**Out of scope, confirmed unchanged:** `app/accounts/new/*`, `app/components/NavBar.tsx`, `app/actions/holdings.ts` (asOfDate→tradeDate mapping is already correct — this is a UI-only change), `app/actions/prices.ts` (both actions already exist and are reused as-is), `lib/portfolio.ts`'s SQL order, `.cb-dash table.holdings` column widths (the mask column-shift fix), Dashboard's own markup structure.

---

### Task 1: Shared control-spec tokens + Dashboard-side corrections

**Files:**
- Modify: `app/globals.css`
- Modify: `app/components/DashboardTopBar.tsx`
- Modify: `app/components/DashboardTopBar.test.tsx`

**Interfaces:**
- Produces: five new CSS custom properties on `.cb-dash` (both themes) — `--field`, `--line-strong`, `--ink-hover`, `--seg-fill`, `--seg-text` (the last two already exist; only the dark-mode *usage* on the segmented control is wrong today).
- Produces: `.cb-dash .iconbare` class (bare 30×30 icon button, matches control-spec §6.2).

This task fixes four things control-spec.md identifies as pre-existing Dashboard defects, without touching Dashboard's markup structure or any behaviour:

1. **New tokens.** `.cb-dash` currently defines `--a1..--a6` plus the base palette but not the five new control-spec tokens. Add them to both theme blocks.
2. **Dark-mode segmented-control fill is wrong.** `.cb-dash .toggle button[aria-pressed="true"]` currently uses `background: var(--ink); color: var(--ground);` unconditionally — in dark mode this makes the active segment the single brightest object on the page, which control-spec §0 explicitly calls out as the reason `--seg-fill` exists (`#33383D`, "a lift off the ground, not a highlight"). Fix: use `var(--seg-fill)`/`var(--seg-text)` instead of `var(--ink)`/`var(--ground)`, and set `--seg-fill`/`--seg-text` to `--ink`/`--ground` in the **light** theme (control-spec §0 table: light active fill *is* `--ink`) and to the dedicated lifted-grey values in dark.
3. **Dark-mode focus ring is wrong.** The only `:focus-visible` rule in the whole app (`app/globals.css:62`) uses `var(--color-text)`, which is never redefined inside `.cb-dash[data-theme="dark"]` — so a focused control on the dark Dashboard gets a near-black (`#1a1a1a`) outline against a `#16181A` background, i.e. functionally invisible. Add a `.cb-dash :focus-visible { outline-color: var(--ink); }` override (dark `--ink` is `#E9EAE7`, correctly visible; light `--ink` is `#1B1D1F`, visually equivalent to the current behaviour).
4. **Theme toggle is bordered; spec says it must be bare.** `DashboardTopBar.tsx` renders both the privacy and theme buttons with `className="ctl icononly"`. Per control-spec §6.2 ("Preferences are bare; guarantees are boxed") and the Global Constraints note above, change only the theme button to `className="iconbare"`.

- [ ] **Step 1: Add the five tokens to both `.cb-dash` theme blocks**

In `app/globals.css`, inside `.cb-dash { ... }` (light theme block, currently ends `--a6: #BDA9D6;` before `display: block;`):

```css
  --a6: #BDA9D6;
  --field: #F7F7F5;
  --line-strong: #C6C6BE;
  --ink-hover: #33373A;
  --seg-fill: #1B1D1F;
  --seg-text: #F0F0ED;
```

And inside `.cb-dash[data-theme="dark"] { ... }` (currently ends `--a6: #D5C4EC;`):

```css
  --a6: #D5C4EC;
  --field: #1E2124;
  --line-strong: #3C4045;
  --ink-hover: #474E55;
  --seg-fill: #33383D;
  --seg-text: #E9EAE7;
```

- [ ] **Step 2: Fix the segmented-control active fill**

Replace:

```css
.cb-dash .toggle button[aria-pressed="true"] {
  background: var(--ink);
  color: var(--ground);
}
```

with:

```css
.cb-dash .toggle button[aria-pressed="true"] {
  background: var(--seg-fill);
  color: var(--seg-text);
}
```

- [ ] **Step 3: Fix the dark-mode focus ring**

Add immediately after the `.cb-dash .num { ... }` rule:

```css
.cb-dash :focus-visible {
  outline-color: var(--ink);
}
```

- [ ] **Step 4: Add the bare icon-button class**

Add after the existing `.cb-dash .ctl.icononly { padding: 6px 8px; }` rule:

```css
.cb-dash .iconbare {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  border-radius: 0;
  transition: color 0.12s ease-out;
}
.cb-dash .iconbare:hover {
  color: var(--ink);
}
.cb-dash .iconbare svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

- [ ] **Step 5: Switch the theme toggle's className**

In `app/components/DashboardTopBar.tsx`, the theme-toggle `<button>` (second `<button type="button" className="ctl icononly" ...>`) — change its `className` to `"iconbare"`. The privacy-toggle button (first one) is unchanged.

- [ ] **Step 6: Run existing tests to confirm nothing broke**

Run: `npx vitest run app/components/DashboardTopBar.test.tsx app/components/AllocationDonut.test.tsx`
Expected: PASS — neither test asserts `className`, only `aria-label`/`aria-pressed`/text, and the segmented-control fill fix is CSS-only.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css app/components/DashboardTopBar.tsx
git commit -m "fix: Dashboard control-spec corrections (tokens, dark segment fill, dark focus ring, bare theme toggle)"
```

---

### Task 2: `PriceCell` — remove per-row Retry, match the marker+title pattern

**Files:**
- Modify: `app/components/PriceCell.tsx`
- Modify: `app/components/PriceCell.test.tsx`

**Interfaces:**
- Produces: `PriceCell({ priceStatus, priceUsd, priceDate }: { priceStatus: PriceStatus; priceUsd: string | null; priceDate: string | null })` — a pure presentational component, no props for `assetId`/`symbol`/`assetClass`, no client state, no server action call.
- Consumes: nothing new — reuses the existing `PriceStatus` type from `@/lib/portfolio`.

This directly implements APPROVED BEHAVIOUR CHANGE #1's PriceCell half. `DashboardHoldingsTable.tsx` already renders exactly this marker+title pattern for its price cell (`className={degraded ? "num stale" : "num"} title={footnoteFor(p) ?? undefined}`) — `PriceCell` adopts the same shape so both routes show price health identically, just packaged as its own component since Holdings uses it inline inside an editable-row `<td>` rather than a read-only table.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `app/components/PriceCell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PriceCell } from "./PriceCell";

afterEach(() => {
  cleanup();
});

describe("PriceCell", () => {
  it("a current price renders plainly, with no marker and no title", () => {
    const { container } = render(
      <PriceCell priceStatus="current" priceUsd="199.99" priceDate="2026-08-26" />
    );
    expect(screen.getByText("$199.99")).toBeInTheDocument();
    expect(container.querySelector(".marker")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("a stale price shows the marker, the price, and the date only in the title tooltip", () => {
    const { container } = render(
      <PriceCell priceStatus="stale" priceUsd="199.99" priceDate="2026-07-01" />
    );
    expect(screen.getByText("$199.99")).toBeInTheDocument();
    expect(container.querySelector(".marker")).not.toBeNull();
    expect(container.querySelector('[title="Priced at 2026-07-01 close"]')).not.toBeNull();
    expect(screen.queryByText(/as of/i)).toBeNull();
  });

  it("an unavailable price shows the marker, an em dash, and 'No price available' in the title", () => {
    const { container } = render(
      <PriceCell priceStatus="unavailable" priceUsd={null} priceDate={null} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector(".marker")).not.toBeNull();
    expect(container.querySelector('[title="No price available"]')).not.toBeNull();
  });

  it("renders no Retry control in any state", () => {
    const { rerender } = render(
      <PriceCell priceStatus="current" priceUsd="199.99" priceDate="2026-08-26" />
    );
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    rerender(<PriceCell priceStatus="stale" priceUsd="199.99" priceDate="2026-07-01" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    rerender(<PriceCell priceStatus="unavailable" priceUsd={null} priceDate={null} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/components/PriceCell.test.tsx`
Expected: FAIL — current `PriceCell` still renders Retry buttons, "(as of DATE)" text, and requires `assetId`/`symbol`/`assetClass` props (TypeScript errors on the new call sites too, expected at this point).

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `app/components/PriceCell.tsx`:

```tsx
import type { PriceStatus } from "@/lib/portfolio";

// Presentational only — no Retry (APPROVED BEHAVIOUR CHANGE #1: Holdings uses
// the page-level global refresh instead, same as the Dashboard). Mirrors
// DashboardHoldingsTable's price-cell pattern exactly: a stale or
// unavailable price gets a small marker dot and the reason in a `title`
// tooltip, never inline text, so both routes read price health identically.
export function PriceCell({
  priceStatus,
  priceUsd,
  priceDate,
}: {
  priceStatus: PriceStatus;
  priceUsd: string | null;
  priceDate: string | null;
}) {
  const degraded = priceStatus !== "current";
  const title =
    priceStatus === "stale"
      ? `Priced at ${priceDate} close`
      : priceStatus === "unavailable"
        ? "No price available"
        : undefined;

  return (
    <span className={degraded ? "stale" : undefined} title={title}>
      {degraded && <span className="marker" aria-hidden="true" />}
      {priceUsd ? `$${priceUsd}` : "—"}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/components/PriceCell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/PriceCell.tsx app/components/PriceCell.test.tsx
git commit -m "feat: remove per-row Retry from PriceCell, match Dashboard's marker+title price pattern"
```

*(`HoldingsEditor.tsx`'s call site and its own tests referencing `PriceCell`/Retry are updated in Task 6, since `HoldingsEditor` won't compile against the new `PriceCell` signature until then — that's expected and fine; Task 2's own test file is fully self-contained.)*

---

### Task 3: Shared `formatCheckedAt` + `HoldingsTopBar`

**Files:**
- Create: `lib/formatCheckedAt.ts`
- Create: `lib/formatCheckedAt.test.ts`
- Create: `app/components/HoldingsTopBar.tsx`
- Create: `app/components/HoldingsTopBar.test.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `formatCheckedAt(now: Date): string` — `"29 Aug, 21:04 SGT"` format, timezone-fixed to `Asia/Singapore`.
- Produces: `HoldingsTopBar()` — no props; reads `usePrivacy()` and `useTheme()` directly, same shape as `DashboardTopBar`.

- [ ] **Step 1: Write the failing test for the extracted formatter**

Create `lib/formatCheckedAt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCheckedAt } from "./formatCheckedAt";

describe("formatCheckedAt", () => {
  it("formats as 'D Mon, HH:MM SGT' in the Singapore timezone", () => {
    // 2026-08-29T13:04:00Z = 2026-08-29 21:04 SGT (UTC+8, no DST)
    const result = formatCheckedAt(new Date("2026-08-29T13:04:00Z"));
    expect(result).toBe("29 Aug, 21:04 SGT");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/formatCheckedAt.test.ts`
Expected: FAIL with "Cannot find module './formatCheckedAt'"

- [ ] **Step 3: Extract the implementation**

Create `lib/formatCheckedAt.ts` (moved verbatim from `app/page.tsx`'s private helper):

```ts
// "Data checked TIME SGT" — Singapore has no DST (fixed UTC+8), so the
// abbreviation is safe to hardcode rather than trust Intl's zone-name output.
// Shared by both `/` and `/holdings` — both routes show the same "Data
// checked" line beside the same global PriceRefreshControl.
export function formatCheckedAt(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} SGT`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/formatCheckedAt.test.ts`
Expected: PASS

- [ ] **Step 5: Point `app/page.tsx` at the shared helper**

In `app/page.tsx`, delete the local `formatCheckedAt` function definition (lines 38-51) and add to the imports at the top:

```ts
import { formatCheckedAt } from "@/lib/formatCheckedAt";
```

- [ ] **Step 6: Run the Dashboard's own test to confirm no regression**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS (identical output, just re-imported)

- [ ] **Step 7: Write the failing test for `HoldingsTopBar`**

Create `app/components/HoldingsTopBar.test.tsx` (directly modelled on `DashboardTopBar.test.tsx`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { HoldingsTopBar } from "./HoldingsTopBar";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PrivacyProvider>{children}</PrivacyProvider>
    </ThemeProvider>
  );
}

describe("HoldingsTopBar", () => {
  it("marks Holdings as the active link and links to Dashboard", () => {
    render(
      <Providers>
        <HoldingsTopBar />
      </Providers>
    );
    expect(screen.getByRole("link", { name: /^holdings$/i })).toHaveClass("on");
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/");
  });

  it("privacy toggle button shares state with usePrivacy() consumers", () => {
    function Probe() {
      const { hidden } = usePrivacy();
      return <span data-testid="hidden">{String(hidden)}</span>;
    }
    render(
      <Providers>
        <HoldingsTopBar />
        <Probe />
      </Providers>
    );

    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
    expect(screen.getByTestId("hidden").textContent).toBe("true");
    expect(screen.getByRole("button", { name: /show values/i })).toBeInTheDocument();
  });

  it("theme toggle button shares state with useTheme() consumers", () => {
    function Probe() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }
    render(
      <Providers>
        <HoldingsTopBar />
        <Probe />
      </Providers>
    );

    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run app/components/HoldingsTopBar.test.tsx`
Expected: FAIL with "Cannot find module './HoldingsTopBar'"

- [ ] **Step 9: Write `HoldingsTopBar`**

Create `app/components/HoldingsTopBar.tsx` (mirrors `DashboardTopBar.tsx`, Holdings active instead of Dashboard, privacy toggle bordered per §6.1, theme toggle bare per §6.2):

```tsx
"use client";

import Link from "next/link";
import { usePrivacy } from "./PrivacyContext";
import { useTheme } from "./ThemeContext";

// Holdings-only nav — replaces <NavBar/> on /holdings, mirroring
// DashboardTopBar exactly. /accounts/new keeps the shared NavBar unchanged
// (its redesign is a later, DO-NOT-TOUCH milestone). Privacy and theme
// controls read/write the same root-mounted contexts DashboardTopBar uses,
// so state stays in sync across routes.
export function HoldingsTopBar() {
  const { hidden, toggle: togglePrivacy } = usePrivacy();
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="topbar">
      <div className="brand">Calboard</div>
      <div className="nav">
        <Link href="/">Dashboard</Link>
        <Link href="/holdings" className="on">
          Holdings
        </Link>
        <button
          type="button"
          className="iconbtn"
          aria-pressed={hidden}
          aria-label={hidden ? "Show values" : "Hide values"}
          title={hidden ? "Show values" : "Hide values"}
          onClick={togglePrivacy}
        >
          {hidden ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.6 6.7A9.9 9.9 0 0 1 12 6.6c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.3 7.8A17 17 0 0 0 2 13.1s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.3-1M3 3l18 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="iconbare"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npx vitest run app/components/HoldingsTopBar.test.tsx`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add lib/formatCheckedAt.ts lib/formatCheckedAt.test.ts app/page.tsx app/components/HoldingsTopBar.tsx app/components/HoldingsTopBar.test.tsx
git commit -m "feat: extract shared formatCheckedAt, add HoldingsTopBar"
```

---

### Task 4: Wire `HoldingsTopBar` + global refresh into `/holdings`

**Files:**
- Modify: `app/holdings/page.tsx`

**Interfaces:**
- Consumes: `HoldingsTopBar` (Task 3), `formatCheckedAt` (Task 3), the existing `PriceRefreshControl` (`app/components/PriceRefreshControl.tsx` — unchanged, already generic).

This is the page-level half of APPROVED BEHAVIOUR CHANGE #1: the per-row Retry Task 2 removed is replaced by the same global "Data checked … [refresh icon]" control the Dashboard already has, reusing the exact same component and server action (`refreshAllPricesAction`) — no new success-state logic to write, `PriceRefreshControl` already implements the required "Updated" / "Up to date" distinction (never silent, never implies prices moved when nothing changed).

- [ ] **Step 1: Update `app/holdings/page.tsx`**

Replace the full contents:

```tsx
import Link from "next/link";
import { HoldingsTopBar } from "../components/HoldingsTopBar";
import { HoldingsShell } from "../components/HoldingsShell";
import { PriceRefreshControl } from "../components/PriceRefreshControl";
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import { formatCheckedAt } from "@/lib/formatCheckedAt";
import { HoldingsEditor, type EditorInitialRow } from "./HoldingsEditor";

// Always render dynamically — see app/page.tsx (Task 3) for why.
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Prices as of DATE close" — the latest EOD date behind the priced rows.
// Mirrors app/page.tsx's identical helper; not worth sharing since Holdings
// derives it from a differently-shaped source (raw rows, not sorted positions).
function formatAsOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// /holdings IS the editor for the existing portfolio snapshot — there is no
// read-only recap table before it. Zero holdings falls back to the wizard CTA.
export default async function HoldingsPage() {
  const holdings = await getAllHoldings();

  return (
    <HoldingsShell>
      <HoldingsTopBar />
      <main>
        {holdings.length === 0 ? (
          <section>
            <p>No holdings yet.</p>
            <Link href="/accounts/new" className="button-link">
              Add your holdings
            </Link>
          </section>
        ) : (
          <HoldingsPageBody />
        )}
      </main>
    </HoldingsShell>
  );
}

async function HoldingsPageBody() {
  const portfolio = await getPortfolioView();
  const initial = buildInitialRows(portfolio.positions);
  const latestPriceDate = initial.reduce<string | null>(
    (max, p) => (p.priceDate && (!max || p.priceDate > max) ? p.priceDate : max),
    null
  );
  const checkedAt = formatCheckedAt(new Date());

  return (
    <>
      <div className="pagehead">
        <h2>Holdings</h2>
        <div className="lede">Edit quantities and average costs to match what you hold, then save.</div>
        {latestPriceDate && <div className="asof">Prices as of {formatAsOfDate(latestPriceDate)} close</div>}
        <PriceRefreshControl checkedAt={checkedAt} />
      </div>
      <HoldingsEditor initial={initial} />
    </>
  );
}

// Current holdings pre-fill with per-row price health. getPortfolioView's
// positions carry the average cost, latest price, and price date; every
// value crossing to the client component is serialized to a plain string
// first. Market value and unrealised P&L are NOT passed — the editor
// derives them live from each row's edited quantity / average cost.
function buildInitialRows(positions: Awaited<ReturnType<typeof getPortfolioView>>["positions"]): EditorInitialRow[] {
  return positions.map((p) => ({
    assetId: p.assetId,
    symbol: p.symbol,
    assetClass: p.assetClass,
    quantity: p.quantity.toString(),
    avgCostUsd: p.avgCostUsd ? p.avgCostUsd.toString() : "0",
    priceUsd: p.latestPriceUsd ? p.latestPriceUsd.toFixed(2) : null,
    priceStatus: p.priceStatus,
    priceDate: p.priceDate,
  }));
}
```

Note: `PriceRefreshControl` is a `"use client"` component and can be rendered directly from an `async` Server Component body (`HoldingsPageBody`) exactly as `app/page.tsx` already does — no new client boundary needed.

- [ ] **Step 2: Run the Holdings page-adjacent test suites**

Run: `npx vitest run app/holdings`
Expected: `HoldingsEditor.test.tsx` will show failures at this point (it still renders `<HoldingsEditor>` directly, unaffected by the page change, so most pass; any that reference `PriceCell`'s old props via HoldingsEditor's internals will already be broken from Task 2 — expected, fixed in Task 6). There is currently no dedicated `app/holdings/page.test.tsx`, so no direct page-level test exists to check here.

- [ ] **Step 3: Commit**

```bash
git add app/holdings/page.tsx
git commit -m "feat: /holdings gets HoldingsTopBar + global price-refresh, replacing per-row Retry at the page level"
```

---

### Task 5: `HoldingsEditor` — permanently visible `Recording as of` field

**Files:**
- Modify: `app/holdings/HoldingsEditor.tsx`
- Modify: `app/holdings/HoldingsEditor.test.tsx`

**Interfaces:**
- No prop/type changes — `asOfDate` state and `handleSave` logic are unchanged; only the disclosure UI (`datePickerOpen` state, the `Change date` button) is removed.

This implements APPROVED BEHAVIOUR CHANGE #2 exactly as specified: `asOfDate` still defaults to today, is still capped at today, still becomes `tradeDate` unchanged — only the disclosure wrapper is deleted and the date input renders unconditionally, relabelled `Recording as of`.

- [ ] **Step 1: Update the two tests that assert the disclosure exists**

In `app/holdings/HoldingsEditor.test.tsx`, the first test ("pre-fills an editable row…") currently asserts:

```ts
expect(screen.getByText(new RegExp(`as of ${localTodayIso()}`, "i"))).toBeInTheDocument();
expect(screen.queryByLabelText("As-of date")).toBeNull();
```

Change to:

```ts
expect((screen.getByLabelText("As-of date") as HTMLInputElement).value).toBe(localTodayIso());
```

The N4 test ("the as-of-date error is programmatically associated…") and T29-5 both currently open the disclosure first:

```ts
fireEvent.click(screen.getByRole("button", { name: /change date/i }));
fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
```

Change both occurrences (one per test) to drop the now-nonexistent disclosure click:

```ts
fireEvent.change(screen.getByLabelText("As-of date"), { target: { value: "2099-01-01" } });
```

- [ ] **Step 2: Run the affected tests to verify they fail against current code**

Run: `npx vitest run app/holdings/HoldingsEditor.test.tsx -t "pre-fills an editable row"`
Expected: FAIL — `getByLabelText("As-of date")` finds nothing yet, since the disclosure is still gating it.

- [ ] **Step 3: Remove the disclosure from `HoldingsEditor.tsx`**

Delete the `datePickerOpen` state:

```tsx
  const [datePickerOpen, setDatePickerOpen] = useState(false);
```

Replace the pagehead block:

```tsx
      <p style={{ color: "#555" }}>
        As of {asOfDate}.{" "}
        {!datePickerOpen && (
          <button type="button" onClick={() => setDatePickerOpen(true)}>
            Change date
          </button>
        )}
      </p>
      {datePickerOpen && (
        <p>
          <label htmlFor="holdings-as-of-date">As of </label>
          <input
            id="holdings-as-of-date"
            type="date"
            aria-label="As-of date"
            aria-invalid={errors.asOfDate ? true : undefined}
            aria-describedby={errors.asOfDate ? "as-of-date-err" : undefined}
            value={asOfDate}
            max={localTodayIso()}
            onChange={(e) => {
              clearSaveState();
              setAsOfDate(e.target.value);
            }}
          />
        </p>
      )}
      {errors.asOfDate && (
        <p id="as-of-date-err" role="alert" className="status-msg status-danger">
          {errors.asOfDate}
        </p>
      )}
```

with a permanently visible field (this block moves into the save row markup in Task 6 — for this task alone, keep it in place but unconditional, to isolate the behaviour change from the visual rewrite):

```tsx
      <p>
        <label htmlFor="holdings-as-of-date">Recording as of</label>
        <br />
        <input
          id="holdings-as-of-date"
          type="date"
          aria-label="As-of date"
          aria-invalid={errors.asOfDate ? true : undefined}
          aria-describedby={errors.asOfDate ? "as-of-date-err" : undefined}
          value={asOfDate}
          max={localTodayIso()}
          onChange={(e) => {
            clearSaveState();
            setAsOfDate(e.target.value);
          }}
        />
      </p>
      {errors.asOfDate && (
        <p id="as-of-date-err" role="alert" className="status-msg status-danger">
          {errors.asOfDate}
        </p>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/holdings/HoldingsEditor.test.tsx`
Expected: Every test that touched the date disclosure now passes. Tests unrelated to the date field or to Retry (Task 6's job) should still pass. Tests still failing at this point are exactly the ones Task 6 fixes (E, N1b, and anything relying on `PriceCell`'s old prop shape) — confirm the failures are limited to those before moving on.

- [ ] **Step 5: Commit**

```bash
git add app/holdings/HoldingsEditor.tsx app/holdings/HoldingsEditor.test.tsx
git commit -m "feat: replace the Change date disclosure with a permanently visible Recording as of field"
```

---

### Task 6: `HoldingsEditor` — full control-spec markup and class rewrite

**Files:**
- Modify: `app/holdings/HoldingsEditor.tsx`
- Modify: `app/holdings/HoldingsEditor.test.tsx`

**Interfaces:**
- Consumes: the simplified `PriceCell` from Task 2 (`priceStatus`/`priceUsd`/`priceDate` only).
- No changes to `EditorInitialRow`, `Row`, `SaveState`, `handleSave`, `patchRow`, `removeRow`, `undoRemove`, `addRow`, `resolveFor` — this task is markup/class only, all state and logic are untouched.

This is the largest task: every control inside `HoldingsEditor` gets its control-spec className (`btn`/`btn2`/`iconbare`/`cellinput`/`inp`/`rowerr`/`status-*`), the table gets a `colgroup` and `position:relative` cells so errors don't grow row height, the Add-a-holding `<fieldset>` loses its default browser chrome via CSS (Task 7) while keeping its markup for grouping semantics, the price cells drop their retry-related props, and the save row carries the (now permanently visible, from Task 5) `Recording as of` field beside `Save`. A page-level footnote for stale/unavailable holdings is added, matching `DashboardHoldingsTable`'s existing pattern (excluding removed rows).

- [ ] **Step 1: Update the tests that assert Retry / old copy**

In `app/holdings/HoldingsEditor.test.tsx`:

Test **E** ("a stale price is visibly distinct from a current one") currently asserts a Retry button and "(as of DATE)" text. Replace its body:

```tsx
  it("E: a stale price is visibly distinct from a current one", () => {
    const initial: EditorInitialRow[] = [
      row({ assetId: "1", symbol: "AAPL", priceUsd: "199.99", priceStatus: "stale", priceDate: "2026-07-01" }),
      row({ assetId: "2", symbol: "MSFT", priceUsd: "310.00", priceStatus: "current", priceDate: "2026-08-26" }),
    ];
    const { container } = render(<HoldingsEditor initial={initial} />);

    expect(container.querySelector('[title="Priced at 2026-07-01 close"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getByText("$310.00")).toBeInTheDocument();
  });
```

Delete test **N1b** entirely ("PriceCell Retry calls retryPriceFetchAction…") — the behaviour it tested no longer exists (Task 2 already removed it from `PriceCell` directly; this was `HoldingsEditor`'s integration copy of the same assertion).

`retryPriceFetchActionMock` and its `vi.mock("@/app/actions/prices", ...)` block, plus the `beforeEach` reset for it, are now unused — remove all three:

```ts
import { retryPriceFetchAction } from "@/app/actions/prices";
...
vi.mock("@/app/actions/prices", () => ({ retryPriceFetchAction: vi.fn() }));
...
const retryPriceFetchActionMock = vi.mocked(retryPriceFetchAction);
...
  retryPriceFetchActionMock.mockReset();
```

- [ ] **Step 2: Run tests to confirm the expected, isolated failures**

Run: `npx vitest run app/holdings/HoldingsEditor.test.tsx`
Expected: FAIL only on test E (container query won't match yet) — N1b no longer exists to fail. Everything else from Task 5 stays green. This confirms the remaining work is scoped correctly before the rewrite.

- [ ] **Step 3: Rewrite `HoldingsEditor.tsx`'s render output**

Keep every function above the `return (` statement (lines 1–341) byte-for-byte unchanged. Replace the entire JSX return block. **Note the lede/subtitle line ("Edit quantities and average costs...") is NOT repeated here** — it already lives in `app/holdings/page.tsx`'s `.pagehead` (Task 4); `HoldingsEditor` itself starts directly with the Positions section, matching the mock's DOM (`.pagehead` and the `.section` blocks are siblings inside `<main>`, not nested):

```tsx
  return (
    <>
      <div className="section">
        <div className="sechead">
          <h2>Positions</h2>
        </div>

        <div className="editor-table">
          <table className="holdings">
            <colgroup>
              <col className="c-sym" /><col className="c-type" /><col className="c-qty" /><col className="c-avg" />
              <col className="c-price" /><col className="c-mv" /><col className="c-pl" /><col className="c-act" />
            </colgroup>
            <thead>
              <tr>
                <th className="l">Symbol</th>
                <th className="l">Type</th>
                <th>Quantity</th>
                <th>Average cost</th>
                <th>Price</th>
                <th>Market value</th>
                <th>Unrealised P&amp;L</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const note = avgCostNote(r);
                const d = r.removed ? { mv: "—", pl: "—" } : derived(r);
                const qtyErr = errors[`holdings.${i}.quantity`];
                const avgErr = errors[`holdings.${i}.avgCostUsd`];
                const qtyErrId = `qty-${r.assetId}-err`;
                const avgErrId = `avg-${r.assetId}-err`;
                const noteId = `avg-${r.assetId}-note`;
                const avgDescribedBy =
                  [avgErr ? avgErrId : null, note ? noteId : null].filter(Boolean).join(" ") || undefined;
                return (
                  <tr key={r.assetId}>
                    <td className="l sym">
                      <span className="cell-label">Symbol</span>
                      {r.symbol}
                    </td>
                    <td className="l dim">
                      <span className="cell-label">Type</span>
                      {formatAssetClass(r.assetClass)}
                    </td>
                    <td>
                      <span className="cell-label">Quantity</span>
                      <input
                        id={`qty-${r.assetId}`}
                        className={`cellinput num${qtyErr ? " err" : ""}`}
                        type={hidden ? "password" : "text"}
                        autoComplete="off"
                        aria-label={`Quantity for ${r.symbol}`}
                        aria-invalid={qtyErr ? true : undefined}
                        aria-describedby={qtyErr ? qtyErrId : undefined}
                        value={r.quantity}
                        disabled={r.removed}
                        onChange={(e) => patchRow(i, { quantity: e.target.value })}
                      />
                      {qtyErr && (
                        <span id={qtyErrId} role="alert" className="rowerr">
                          {qtyErr}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="cell-label">Average cost</span>
                      <input
                        id={`avg-${r.assetId}`}
                        className={`cellinput num${avgErr ? " err" : ""}`}
                        type={hidden ? "password" : "text"}
                        autoComplete="off"
                        aria-label={`Average cost for ${r.symbol}`}
                        aria-invalid={avgErr ? true : undefined}
                        aria-describedby={avgDescribedBy}
                        value={r.avgCostUsd}
                        disabled={r.removed}
                        onChange={(e) => patchRow(i, { avgCostUsd: e.target.value })}
                      />
                      {avgErr && (
                        <span id={avgErrId} role="alert" className="rowerr">
                          {avgErr}
                        </span>
                      )}
                      {note && (
                        <div id={noteId} role="status" className="status-warning" style={{ fontSize: "0.85em" }}>
                          {note}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <span className="cell-label">Price</span>
                      {r.removed ? (
                        "—"
                      ) : (
                        <PriceCell priceStatus={r.priceStatus} priceUsd={r.priceUsd} priceDate={r.priceDate} />
                      )}
                    </td>
                    <td className="num strong">
                      <span className="cell-label">Market value</span>
                      {d.mv === "—" ? d.mv : <MaskableValue>{d.mv}</MaskableValue>}
                    </td>
                    <td className={`num strong${r.removed ? "" : d.pl.startsWith("-") ? " loss" : ""}`}>
                      <span className="cell-label">Unrealised P&amp;L</span>
                      {d.pl === "—" ? d.pl : <MaskableValue>{d.pl}</MaskableValue>}
                    </td>
                    <td>
                      {r.removed ? (
                        <button type="button" className="btn2" style={{ height: 30, fontSize: 13 }} onClick={() => undoRemove(i)}>
                          Undo
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="iconbare rmv"
                          aria-label={`Remove ${r.symbol}`}
                          onClick={() => removeRow(i)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {footnote && <div className="footnote">{footnote}</div>}
      </div>

      <div className="section">
        <div className="sechead">
          <h2>Add a holding</h2>
        </div>
        <fieldset className="add-holding-fieldset">
          <legend>Add a holding</legend>
          <div className="formrow">
            <div className="field">
              <label htmlFor="add-ticker">Ticker symbol</label>
              <input
                id="add-ticker"
                className="inp w150"
                aria-label="Ticker symbol"
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  setAddError(null);
                  clearSaveState();
                  resolveSeq.current++;
                  clearResolution();
                }}
                onBlur={() => void resolveFor(tickerInput, assetType)}
              />
            </div>
            <div className="field">
              <label htmlFor="add-type">Asset type</label>
              <select
                id="add-type"
                className="inp w140"
                aria-label="Asset type"
                value={assetType}
                onChange={(e) => {
                  const next = e.target.value as AssetClass;
                  setAssetType(next);
                  setAddError(null);
                  clearSaveState();
                  if (tickerInput.trim()) {
                    void resolveFor(tickerInput, next);
                  } else {
                    resolveSeq.current++;
                    clearResolution();
                  }
                }}
              >
                <option value="equity">Equity</option>
                <option value="etf">ETF</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="add-qty">Quantity</label>
              <input
                id="add-qty"
                className="inp n w120"
                type={hidden ? "password" : "text"}
                autoComplete="off"
                aria-label="New holding quantity"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="add-cost">Average cost (USD)</label>
              <input
                id="add-cost"
                className="inp n w150"
                type={hidden ? "password" : "text"}
                autoComplete="off"
                aria-label="New holding average cost"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
              />
            </div>
            <button type="button" className="btn" onClick={addRow}>
              + Add holding
            </button>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {resolving && <span className="status-neutral">checking…</span>}
            {resolution && resolution.ok && (
              <span className="status-success">
                ✓ Resolved — last price ${resolution.priceUsd} ({resolution.priceDate})
              </span>
            )}
            {resolution && !resolution.ok && <span className="status-warning">{resolution.message}</span>}
          </div>
          {addError && <div className="status-msg status-danger">{addError}</div>}
        </fieldset>

        <div className="saverow">
          <div className="field">
            <label htmlFor="holdings-as-of-date">Recording as of</label>
            <input
              id="holdings-as-of-date"
              className={`inp w170${errors.asOfDate ? " err" : ""}`}
              type="date"
              aria-label="As-of date"
              aria-invalid={errors.asOfDate ? true : undefined}
              aria-describedby={errors.asOfDate ? "as-of-date-err" : undefined}
              value={asOfDate}
              max={localTodayIso()}
              onChange={(e) => {
                clearSaveState();
                setAsOfDate(e.target.value);
              }}
            />
          </div>
          <div>
            <button type="button" className="btn" onClick={handleSave} disabled={saving}>
              <span style={{ visibility: saving ? "hidden" : "visible", display: "inline-block" }}>Save</span>
              {saving && <span style={{ position: "absolute" }}>Saving…</span>}
            </button>
          </div>
        </div>
        {errors.asOfDate && (
          <p id="as-of-date-err" role="alert" className="status-danger">
            {errors.asOfDate}
          </p>
        )}

        {save.kind === "saved" && (
          <p className="status s-ok" role="status">
            Holdings updated.
          </p>
        )}
        {save.kind === "failed" && errors.form && (
          <p className="status s-bad" role="alert">
            {errors.form}
          </p>
        )}
        {save.kind === "failed" && !errors.form && hasFieldErrors && (
          <p className="status s-bad" role="alert">
            Fix the highlighted errors before saving.
          </p>
        )}
        {save.kind === "unknown" && (
          <p className="status s-warn" role="alert">
            {save.message}
          </p>
        )}
        {save.kind === "unreachable" && (
          <p className="status s-warn" role="alert">
            We couldn&apos;t reach the server, so we don&apos;t know whether your changes saved. Check the
            Dashboard before trying again.
          </p>
        )}
      </div>
    </>
  );
}
```

Add one small helper above the component's `return` (with the other derived values, near `const errors = ...`), computing the page-level footnote the same way `DashboardHoldingsTable.tsx`'s `footnoteFor` does, but scoped to non-removed rows only:

```tsx
  const footnote =
    rows
      .filter((r) => !r.removed)
      .map((r) =>
        r.priceStatus === "stale"
          ? `${r.symbol} is priced at ${r.priceDate} close.`
          : r.priceStatus === "unavailable"
            ? `${r.symbol} has no price and is excluded from market value and P&L.`
            : null
      )
      .filter((f): f is string => f !== null)
      .join(" ") || null;
```

Note on the pending-Save button markup above: control-spec §12 requires the button to "not resize between states" by reserving the pending label's width. The `<span style={{visibility:...}}>Save</span>` plus an absolutely-positioned `Saving…` span keeps the button's intrinsic width fixed to whichever label is wider (`Saving…`) while only one is ever visible — verify this visually in Task 9 and adjust the inline approach to a small CSS rule in Task 7 if the reserved width looks wrong in the browser (e.g. `min-width` set from the longer label, which is simpler and equally correct — prefer that if the inline visibility trick looks awkward once rendered).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/holdings/HoldingsEditor.test.tsx`
Expected: PASS across the board. Pay particular attention to:
- T30-1 / T30-4 (`.cell-label` text and ordering) — unchanged, still real DOM text.
- T30-2 (`.editor-table` wrapper class) — still present.
- T30-3 (no duplicated narrow-width variant) — still true, this rewrite adds no second markup.
- C ("field errors render under the correct row…") — now expects `.rowerr` `role="alert"` spans instead of `<div className="status-danger">`; confirm the existing assertions (`document.getElementById(...)?.textContent`) still pass unchanged since only the wrapping element/class changed, not the id scheme.

If any test fails on wording or DOM shape you didn't anticipate, fix the JSX to match the test's existing assertion (the tests encode already-agreed behaviour) rather than editing the test, unless the test is one you already deliberately updated in Steps 1 or in Task 5.

- [ ] **Step 5: Commit**

```bash
git add app/holdings/HoldingsEditor.tsx app/holdings/HoldingsEditor.test.tsx
git commit -m "feat: rewrite HoldingsEditor markup to the control-spec class language"
```

---

### Task 7: `.holdings-chrome` full CSS build-out

**Files:**
- Modify: `app/globals.css`
- Modify: `app/globalsCss.test.ts`

**Authorized test rewrite (the only one in this milestone — see below):** `app/globalsCss.test.ts`'s `.holdings-chrome dark-mode regressions` describe block hard-asserts the mechanism of the OLD minimal dark-only patch this task deletes (form-control colour forced to a literal `#1a1a1a`; the wrapper redefines the *legacy* `--color-text`/`--color-page-bg`/`--color-border` tokens rather than a parallel set). This build gives `.holdings-chrome` its own self-contained token system exactly like `.cb-dash` — closing the "form controls deliberately left native/light" seam that test's own subject was protecting, which is precisely what this milestone is commissioned to do. Ruled and approved by Calvin before this task was dispatched. **No other test in this plan may be rewritten** — if any other existing test conflicts with this task's CSS, stop and report it (do not rule on it, do not edit it).

This replaces the entire minimal, dark-only `.holdings-chrome` block (the section headed `/* --- Holdings dark-mode chrome (minimal, 2026-09-01) --- */`, currently ~45 lines) with a full parallel system covering both themes and every control now rendered by `HoldingsTopBar` (Task 3) and the rewritten `HoldingsEditor` (Task 6) — mirroring how `.cb-dash` is structured, using the exact token values from `calboard-holdings-final.html` (the authoritative reference) plus the five shared control-spec tokens from Task 1, and a `--cell-line` token specific to Holdings' editable-cell underline (present in the authoritative mock, not in control-spec's own token table, but required to render the cell input border correctly — noted in the PR description as taken directly from the authoritative file).

**Sizing/breakpoint note:** per the Global Constraints "Responsive architecture deviation," this CSS restacks the *existing single* `<table>` at 720px (à la the legacy `.editor-table`/`.cell-label` mechanism, restyled) rather than adding a second `.stack` markup — there is no `.holdings-chrome .stack` rule in this task, unlike `.cb-dash`.

- [ ] **Step 1: Delete the old minimal block**

Remove the entire section in `app/globals.css` from the comment `/* --- Holdings dark-mode chrome (minimal, 2026-09-01) --- */` through the closing `}` of `.holdings-chrome[data-theme="dark"] input, ... { color: #1a1a1a; }`.

- [ ] **Step 2: Add the full replacement**

Add at the end of `app/globals.css`:

```css
/* --- Holdings control-direction chrome (2026-09-0X) ---------------------
   Full parallel visual system for /holdings, mirroring .cb-dash's structure
   but covering both themes from the start (the prior milestone's dark-only
   patch is fully superseded). Scoped to .holdings-chrome (HoldingsShell,
   /holdings only) — nothing outside it changes; /accounts/new keeps NavBar
   and the original foundation untouched.

   Responsive note: unlike .cb-dash, there is no dual .stack markup here —
   HoldingsEditor.test.tsx's T30-3 requires exactly one DOM copy of every
   editable control, so the 720px breakpoint below restacks the SAME
   table cells (the existing .editor-table/.cell-label mechanism), restyled
   to this control language, instead of hiding the table for a second card
   markup the way Dashboard's read-only table does. */
.holdings-chrome {
  --ground: #F0F0ED;
  --ink: #1B1D1F;
  --muted: #5A6067;
  --hairline: #DCDCD6;
  --gain: #1B6B4A;
  --loss: #A3352A;
  --stale: #856713;
  --field: #F7F7F5;
  --line-strong: #C6C6BE;
  --ink-hover: #33373A;
  --cell-line: #B0B0A6;

  display: block;
  background: var(--ground);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  min-height: 100vh;
}
.holdings-chrome[data-theme="dark"] {
  --ground: #16181A;
  --ink: #E9EAE7;
  --muted: #979CA1;
  --hairline: #2C2F33;
  --gain: #56B98C;
  --loss: #E27A66;
  --stale: #D9AB45;
  --field: #1E2124;
  --line-strong: #3C4045;
  --ink-hover: #474E55;
  --cell-line: #4E545B;
}
.holdings-chrome :focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.holdings-chrome .num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
.holdings-chrome > .topbar,
.holdings-chrome > main {
  max-width: 1080px;
  margin-inline: auto;
  padding-inline: 32px;
}
.holdings-chrome > main {
  padding-bottom: 20px;
}

/* --- top bar (§8.1: inside the content column, no border, no fill) --- */
.holdings-chrome .topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0 0;
}
.holdings-chrome .brand {
  font-size: 16px;
  font-weight: 500;
}
.holdings-chrome .nav {
  display: flex;
  align-items: center;
  gap: 18px;
}
.holdings-chrome .nav a {
  color: var(--muted);
  text-decoration: none;
}
.holdings-chrome .nav a:hover {
  color: var(--ink);
}
.holdings-chrome .nav a.on {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 5px;
  text-decoration-thickness: 1px;
}
.holdings-chrome .nav a:focus-visible {
  outline-offset: 3px;
}

/* --- icon buttons (§6): bordered = privacy guarantee, bare = preference --- */
.holdings-chrome .iconbtn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  background: none;
  color: var(--ink);
  cursor: pointer;
  padding: 0;
  border-radius: 0;
  transition: border-color 0.12s ease-out, color 0.12s ease-out;
}
.holdings-chrome .iconbtn:hover {
  border-color: var(--muted);
}
.holdings-chrome .iconbtn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.holdings-chrome .iconbare {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  border-radius: 0;
  transition: color 0.12s ease-out;
}
.holdings-chrome .iconbare:hover {
  color: var(--ink);
}
.holdings-chrome .iconbare svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.holdings-chrome .iconbare.sm {
  width: 22px;
  height: 22px;
}
.holdings-chrome .iconbare.sm svg {
  width: 14px;
  height: 14px;
}
.holdings-chrome .iconbare:disabled {
  color: var(--hairline);
  cursor: default;
}
.holdings-chrome .iconbare.rmv {
  color: var(--muted);
}
.holdings-chrome .iconbare.rmv:hover {
  color: var(--loss);
}

/* --- refresh control ("Data checked …") --- */
.holdings-chrome .checked {
  font-size: 13px;
  color: var(--muted);
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.holdings-chrome .refresh {
  background: none;
  border: 0;
  padding: 0;
  margin-left: 8px;
  cursor: pointer;
  color: var(--muted);
  vertical-align: -2px;
  line-height: 0;
  transition: color 0.12s ease-out;
}
.holdings-chrome .refresh:hover {
  color: var(--ink);
}
.holdings-chrome .refresh svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.holdings-chrome .refresh-status {
  font-size: 13px;
}
.holdings-chrome .refresh-status.status-warning {
  color: var(--stale);
}
.holdings-chrome .refresh-status.status-danger {
  color: var(--loss);
}

/* --- page head --- */
.holdings-chrome .pagehead {
  padding: 14px 0 0;
}
.holdings-chrome h2 {
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.01em;
  margin: 0;
}
.holdings-chrome .lede {
  color: var(--muted);
  margin-top: 4px;
}
.holdings-chrome .asof {
  margin-top: 10px;
  font-size: 15px;
}
.holdings-chrome .section {
  padding-top: 22px;
}
.holdings-chrome .section + .section {
  padding-top: 64px;
}
.holdings-chrome .sechead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--hairline);
}
.holdings-chrome .footnote {
  font-size: 13px;
  color: var(--muted);
  margin-top: 9px;
}

/* --- buttons (§2) --- */
.holdings-chrome .btn {
  height: 34px;
  padding: 0 16px;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  border: 0;
  border-radius: 0;
  background-color: var(--ink);
  color: var(--ground);
  cursor: pointer;
  position: relative;
  transition: background-color 0.12s ease-out, color 0.12s ease-out;
}
.holdings-chrome .btn:hover {
  background-color: var(--ink-hover);
}
.holdings-chrome .btn:disabled {
  background-color: var(--hairline);
  color: var(--muted);
  cursor: default;
}
.holdings-chrome .btn2 {
  height: 34px;
  padding: 0 14px;
  font: inherit;
  font-size: 15px;
  font-weight: 400;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: none;
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.12s ease-out, color 0.12s ease-out;
}
.holdings-chrome .btn2:hover {
  border-color: var(--muted);
}
.holdings-chrome .btn2:disabled {
  border-color: var(--hairline);
  color: var(--muted);
  cursor: default;
}

/* --- table (§8.2 header, §3 cell inputs) --- */
.holdings-chrome .editor-table {
  overflow-x: visible;
}
.holdings-chrome table.holdings {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-top: 14px;
}
.holdings-chrome table.holdings col.c-sym { width: 9%; }
.holdings-chrome table.holdings col.c-type { width: 9%; }
.holdings-chrome table.holdings col.c-qty { width: 13%; }
.holdings-chrome table.holdings col.c-avg { width: 15%; }
.holdings-chrome table.holdings col.c-price { width: 14%; }
.holdings-chrome table.holdings col.c-mv { width: 16%; }
.holdings-chrome table.holdings col.c-pl { width: 16%; }
.holdings-chrome table.holdings col.c-act { width: 40px; }
.holdings-chrome table.holdings thead th {
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
  text-align: right;
  padding: 9px 0 8px;
  border-bottom: 1px solid var(--hairline);
  white-space: nowrap;
}
.holdings-chrome table.holdings thead th.l {
  text-align: left;
}
.holdings-chrome table.holdings tbody td {
  height: 48px;
  text-align: right;
  border-bottom: 1px solid var(--hairline);
  vertical-align: middle;
  white-space: nowrap;
  position: relative;
}
.holdings-chrome table.holdings tbody td.l {
  text-align: left;
}
.holdings-chrome .sym {
  font-weight: 500;
}
.holdings-chrome .strong {
  font-weight: 500;
}
.holdings-chrome .dim {
  color: var(--muted);
}
.holdings-chrome .gain {
  color: var(--gain);
}
.holdings-chrome .loss {
  color: var(--loss);
}
.holdings-chrome .stale {
  color: var(--stale);
}
.holdings-chrome .marker {
  display: inline-block;
  width: 5px;
  height: 5px;
  background: var(--stale);
  vertical-align: 2px;
  margin-right: 6px;
}
.holdings-chrome .editor-table .cell-label {
  display: none;
}

.holdings-chrome .cellinput {
  width: calc(100% - 20px);
  margin-left: 20px;
  display: block;
  font: inherit;
  font-size: 15px;
  color: var(--ink);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--cell-line);
  border-radius: 0;
  padding: 0 0 1px;
  line-height: 1.1;
  text-align: right;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.12s ease-out;
}
.holdings-chrome .cellinput:hover {
  border-bottom-color: var(--muted);
}
.holdings-chrome .cellinput:focus {
  border-bottom-color: var(--ink);
  outline: 2px solid var(--ink);
  outline-offset: 3px;
}
.holdings-chrome .cellinput:disabled {
  color: var(--muted);
  border-bottom-color: var(--hairline);
  cursor: default;
}
.holdings-chrome .cellinput.err {
  border-bottom-color: var(--loss);
}
.holdings-chrome .cellinput::-webkit-outer-spin-button,
.holdings-chrome .cellinput::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.holdings-chrome .cellinput {
  -moz-appearance: textfield;
}
.holdings-chrome .rowerr {
  position: absolute;
  right: 0;
  bottom: 1px;
  font-size: 11px;
  line-height: 1;
  color: var(--loss);
  pointer-events: none;
}

/* --- Add-a-holding fieldset (§10): default fieldset/legend chrome removed --- */
.holdings-chrome .add-holding-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-inline-size: 0;
}
.holdings-chrome .add-holding-fieldset > legend {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.holdings-chrome .add-holding-fieldset:disabled .inp,
.holdings-chrome .add-holding-fieldset:disabled .btn {
  color: var(--muted);
}
.holdings-chrome .formrow {
  display: flex;
  gap: 18px;
  align-items: flex-end;
  flex-wrap: wrap;
  padding-top: 14px;
}
.holdings-chrome .field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.holdings-chrome .field label {
  font-size: 13px;
  color: var(--muted);
}
.holdings-chrome .inp {
  height: 34px;
  padding: 0 10px;
  font: inherit;
  font-size: 15px;
  color: var(--ink);
  background-color: var(--field);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  transition: border-color 0.12s ease-out;
}
.holdings-chrome .inp::placeholder {
  color: var(--muted);
}
.holdings-chrome .inp:hover {
  border-color: var(--muted);
}
.holdings-chrome .inp:disabled {
  background-color: var(--ground);
  border-color: var(--hairline);
  color: var(--muted);
  cursor: default;
}
.holdings-chrome .inp.err {
  border-color: var(--loss);
}
.holdings-chrome .inp.n {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.holdings-chrome .inp::-webkit-outer-spin-button,
.holdings-chrome .inp::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.holdings-chrome .w150 { width: 150px; }
.holdings-chrome .w140 { width: 140px; }
.holdings-chrome .w120 { width: 120px; }
.holdings-chrome .w170 { width: 170px; }
.holdings-chrome select.inp {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  padding-right: 32px;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235A6067' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 11px center;
  background-size: 12px;
}
.holdings-chrome[data-theme="dark"] select.inp {
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23979CA1' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");
}

/* --- date input (§9): calendar indicator retained, tabular-nums text --- */
.holdings-chrome input[type="date"].inp {
  font-variant-numeric: tabular-nums;
}
.holdings-chrome input[type="date"].inp::-webkit-calendar-picker-indicator {
  filter: none;
  opacity: 0.6;
}
.holdings-chrome input[type="date"].inp:hover::-webkit-calendar-picker-indicator {
  opacity: 1;
}

/* --- save row + status (§11, §12) --- */
.holdings-chrome .saverow {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding-top: 14px;
  flex-wrap: wrap;
}
.holdings-chrome .status {
  font-size: 13px;
  margin-top: 6px;
}
.holdings-chrome .s-ok { color: var(--gain); }
.holdings-chrome .s-bad { color: var(--loss); }
.holdings-chrome .s-warn { color: var(--stale); }
.holdings-chrome .status-neutral { color: var(--muted); font-size: 13px; }
.holdings-chrome .status-warning { color: var(--stale); font-size: 13px; }
.holdings-chrome .status-success { color: var(--gain); font-size: 13px; }
.holdings-chrome .status-danger { color: var(--loss); font-size: 13px; }
.holdings-chrome .status-msg {
  display: block;
  font-size: 13px;
  margin-top: 6px;
}
/* Pending Save (§12): reserve "Saving…"'s width via min-width so the button
   never resizes between its two labels; keeps default fill/text (not the
   disabled treatment) while `disabled` blocks a second submit. */
.holdings-chrome .btn {
  min-width: 74px;
}

/* --- 720px breakpoint: restack the SAME table cells (see file-header note) --- */
@media (max-width: 720px) {
  .holdings-chrome > .topbar,
  .holdings-chrome > main {
    padding-inline: 20px;
  }
  .holdings-chrome > main {
    padding-bottom: 56px;
  }
  .holdings-chrome .editor-table > table,
  .holdings-chrome .editor-table thead,
  .holdings-chrome .editor-table tbody,
  .holdings-chrome .editor-table tr,
  .holdings-chrome .editor-table td {
    display: block;
    width: 100%;
  }
  .holdings-chrome .editor-table thead {
    display: none;
  }
  .holdings-chrome .editor-table tr {
    border: 1px solid var(--hairline);
    margin-block: 12px;
    padding: 12px;
    position: relative;
  }
  .holdings-chrome .editor-table td {
    border: 0;
    height: auto;
    padding: 6px 0;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .holdings-chrome .editor-table .cell-label {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 2px;
  }
  .holdings-chrome .cellinput {
    width: 100%;
    margin-left: 0;
    text-align: left;
  }
  .holdings-chrome .rowerr {
    position: static;
    display: block;
    margin-top: 2px;
  }
  /* Quantity + Avg cost grouped side-by-side on the restacked card, matching
     the mock's .edits row — everything else (Symbol, Type, Price, MV, P&L,
     Action) stays one-per-line. Column order in HoldingsEditor's <tr> is
     fixed (Symbol, Type, Quantity, Avg cost, Price, MV, P&L, Action), so
     nth-child(3)/(4) reliably target these two cells. */
  .holdings-chrome .editor-table td:nth-child(3),
  .holdings-chrome .editor-table td:nth-child(4) {
    display: inline-block;
    width: calc(50% - 9px);
    vertical-align: top;
  }
  .holdings-chrome .editor-table td:nth-child(3) {
    margin-right: 18px;
  }
  .holdings-chrome .formrow .field,
  .holdings-chrome .formrow .inp,
  .holdings-chrome .saverow .field,
  .holdings-chrome .saverow .inp,
  .holdings-chrome .w150,
  .holdings-chrome .w140,
  .holdings-chrome .w120,
  .holdings-chrome .w170 {
    width: 100%;
  }
}
```

- [ ] **Step 3: Replace the obsolete `.holdings-chrome dark-mode regressions` describe block**

In `app/globalsCss.test.ts`, replace this entire block:

```ts
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
```

with:

```ts
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
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. jsdom does not evaluate media queries, so the CSS-only parts of this task should not change any other test's outcome — it exists to make Task 6's markup render correctly, which the browser check in Task 9 confirms visually.

- [ ] **Step 5: Commit — state the test rewrite plainly, not as routine churn**

```bash
git add app/globals.css app/globalsCss.test.ts
git commit -m "$(cat <<'EOF'
feat: full .holdings-chrome control-spec CSS, both themes, 720px breakpoint

Replaces app/globalsCss.test.ts's ".holdings-chrome dark-mode regressions"
assertions: they hard-coded the mechanism of the prior minimal dark-only
patch (form controls forced to a literal light colour; the wrapper
redefining the legacy --color-* tokens instead of its own set). This task
gives Holdings a full, self-contained token system mirroring .cb-dash,
closing the "form controls deliberately left native/light" seam that patch
existed to protect — which is this milestone's job. Ruled and approved
before implementation; see the plan's Task 7 for the full before/after.
EOF
)"
```

---

### Task 8: `npx tsc --noEmit` and full-suite check

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Watch specifically for: `HoldingsEditor.tsx`'s `PriceCell` call site (must match the Task 2 signature), `app/holdings/page.tsx`'s new `buildInitialRows` parameter type, and `HoldingsTopBar.tsx`'s import paths.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass, including everything untouched by this plan (`app/actions/*.test.ts`, `lib/**/*.test.ts`, `app/accounts/new/**`, `app/page.test.tsx`, `DashboardHoldingsTable.test.tsx`, `AllocationDonut.test.tsx`, `ThemeContext.test.tsx`, `HoldingsShell.test.tsx`, `DashboardShell.test.tsx`).

- [ ] **Step 3: Fix and re-run if anything fails**

If a failure surfaces outside the files this plan touches, stop and diagnose before continuing — it means a change had a wider blast radius than planned (most likely: the `.holdings-chrome` selector accidentally matching something in `SetupWizard.tsx` if it somehow shares a class name, or the `PriceCell` prop-shape change reaching a caller this plan didn't account for). Do not silence or delete a failing test to get green.

- [ ] **Step 4: Commit only if Steps 1–3 required source changes**

```bash
git add -A
git commit -m "fix: address type-check / test-suite fallout from the control-direction rewrite"
```

(Skip this step — no empty commit — if Steps 1–3 were already clean.)

---

### Task 9: Browser verification — both routes, both themes, 420px

**Files:** none (verification only, using the Browser pane / dev server)

- [ ] **Step 1: Start the dev server and open `/holdings`**

Use `preview_start` with the project's dev command, navigate to `/holdings`.

- [ ] **Step 2: Light-mode desktop checks**

Confirm against `calboard-holdings-final.html` and control-spec.md:
- Top bar sits inside the 1080px column, no border/fill, brand + nav + bordered privacy icon + bare theme icon.
- "Data checked … [refresh icon]" line renders, clicking it shows "Updated" or "Up to date" (not silence).
- Table header is a hairline row, muted 13px text, sentence case, no fill.
- Quantity/Avg cost cells are underline-style inputs, right-aligned, tabular numerals, no spinner arrows.
- A stale/unavailable price shows the marker dot; hovering it shows the tooltip; no visible Retry button anywhere on the page.
- Add a holding: no visible fieldset border/legend box; "Add a holding" reads as a plain section heading.
- Recording as of date field is visible without any click; defaults to today; cannot be set past today.
- Save button: click it, confirm the label swaps to "Saving…" without the button changing width, then to the success state text below the button (not at page top).
- Remove: icon button in the desktop table turns `--loss` red only on hover, not at rest.

- [ ] **Step 3: Dark-mode desktop checks**

Toggle the theme button, repeat Step 2's checks, additionally confirming: keyboard-tab to each control and confirm the focus ring is visible (`--ink` = light off-white against the dark background, not the old near-invisible one this plan fixes on Dashboard too).

- [ ] **Step 4: 420px checks**

Use `resize_window` to 420×800. Confirm:
- No horizontal scroll (`document.documentElement.scrollWidth <= document.documentElement.clientWidth` via `javascript_tool`).
- The Remove control for every row is reachable without any sideways scrolling.
- Add a holding's fields stack to full width, still usable.
- Quantity and Avg cost sit side-by-side within each restacked row (the Task 7 `nth-child(3)/(4)` grouping); every other field is one-per-line. No weight-% figure anywhere on the card — confirmed intentional (Calvin's call: out of scope, not a dropped requirement).

- [ ] **Step 5: Dashboard diff-verification**

Open `/`, both themes. Confirm: page-level structure, section order, copy, and layout are pixel-identical to before this plan (only the four Task 1 corrections should be visible — bare theme-toggle icon, correct dark-mode segment fill on the Allocation view toggle, and a visible dark-mode focus ring; nothing else moved). This satisfies DONE WHEN #6 ("Dashboard page-level direction unchanged — verify by diff").

- [ ] **Step 6: Screenshot both routes, both themes for the PR description**

Take four screenshots (`computer` `screenshot` action) — `/holdings` light, `/holdings` dark, `/` light, `/` dark — to attach to the PR.

---

### Task 10: Update `DESIGN.md`

**Files:**
- Modify: `DESIGN.md`

Record what changed as durable/current-convention documentation, following the file's existing "Labels" convention (Durable / Current convention / M1-specific / Unresolved).

- [ ] **Step 1: Update the "Dashboard-only v2" paragraph**

In the **Product and Design Intent** section, the paragraph starting "**Dashboard-only v2 (2026-09-01).**" — replace its final two sentences (`/holdings` and the setup wizard are deliberately untouched... this is a Dashboard-only milestone) with:

```markdown
**Holdings control-direction pass (2026-09-0X).** `/holdings` now runs the
same class of parallel visual system, scoped under `.holdings-chrome`
(`HoldingsShell` + the new `HoldingsTopBar`), covering both themes from the
start. `/accounts/new` (`SetupWizard.tsx`, still on the shared `NavBar` and
the original foundation) remains untouched — its own pass is a later,
separately classified milestone.
```

- [ ] **Step 2: Update Hard Product Constraint #3 (pull-based prices)**

Replace the sentence "`/holdings` (`PriceCell`) is unchanged and still offers per-row Retry." with:

```markdown
`/holdings` (`PriceCell`) now matches: per-row Retry is gone there too, replaced
by the same `PriceRefreshControl` / `refreshAllPricesAction` pattern beside its
own "Data checked" line.
```

- [ ] **Step 3: Update the States table**

In the **States** table, the "Stale" and "Unavailable" rows currently describe `/holdings` as having a per-row Retry and visible "(as of DATE)" text. Update both rows to describe the new shared marker+title pattern used identically on both routes (no more `/holdings`-specific behaviour to call out — collapse the two routes into one description per row, noting only the presentational difference of the page-level refresh control's placement).

- [ ] **Step 4: Add a note on the responsive deviation**

Under **Responsive Behaviour**, add a short paragraph after the existing "Dashboard-only deviation (2026-09-01)" one:

```markdown
**Holdings control-direction deviation (2026-09-0X).** `/holdings` also moved to
a single `@media (max-width: 720px)` breakpoint, but — unlike Dashboard —
kept the single-markup `.editor-table`/`.cell-label` restack instead of adding
a second `.stack` card markup: `HoldingsEditor.test.tsx`'s existing T30-3 test
requires exactly one DOM copy of every editable control and the Remove action,
which the authoritative mock's dual-markup approach would have duplicated.
Same outcome (no sideways scroll, Remove always reachable), different
mechanism, deliberately, because of that pre-existing test contract.
```

- [ ] **Step 5: Add a note on the sort-order spec discrepancy**

Under **Tables and Financial Data**, in the **M1-specific** paragraph (which already documents `getPortfolioView()`'s alphabetical order), append:

```markdown
The control-level spec (`calboard-control-spec.md` §8.2) states "holdings sort by
weight, fixed" as if this already applied everywhere — it does not on
`/holdings`, deliberately: weight is derived from quantity × price, and
resorting an editor mid-edit as the user types would be actively hostile.
This is a spec inaccuracy to correct at the source, not a behaviour this app
should adopt.
```

- [ ] **Step 6: Log both spec errors found during this build, for DESIGN to correct — not fixed here**

Add a new subsection at the end of the **Deeper References** section (do not edit the two source reference files themselves — they live in Downloads, are not committed, and are DESIGN's artifacts to correct, not this branch's):

```markdown
### Spec errors found during the 2026-09-0X control-direction build

Two errors in the frozen references, found while implementing against them.
Both were resolved by following the more authoritative source per the
stated reference precedence, not by editing the mocks — flagged here for
DESIGN to correct at the source:

1. **Icon-button border assignment.** `calboard-holdings-final.html` renders
   both the privacy and theme-toggle buttons bare (no border). 
   `calboard-dashboard-final.html` renders both bordered. The two "final"
   mocks contradict each other and neither matches `calboard-control-spec.md`
   §6.1/§6.2, which is explicit that privacy is bordered (a product
   guarantee) and theme is bare (a preference). Implemented per the written
   spec on both routes; the mocks need a corrective re-export.
2. **Holdings sort order.** `calboard-control-spec.md` §8.2 states "holdings
   sort by weight, fixed" as an existing fact, and
   `calboard-holdings-final.html` labels its Positions section "Sorted by
   weight" to match. `/holdings` is an editor, not a reading surface — weight
   is derived from quantity × price, so sorting by it would reorder rows out
   from under the user mid-edit as they type. Implemented as: `/holdings`
   keeps `getPortfolioView()`'s existing alphabetical order; the "Sorted by
   weight" note is omitted rather than replaced with false or restated text.
   §8.2 needs correcting to describe Dashboard only.
```

- [ ] **Step 7: Commit**

```bash
git add DESIGN.md
git commit -m "docs: record the Holdings control-direction pass in DESIGN.md"
```

---

### Task 11: Branch, push, open the PR — then stop

**Files:** none

- [ ] **Step 1: Confirm all work is on a feature branch, not `master`**

Run: `git status` and `git branch --show-current`
Expected: a feature branch (e.g. `feat/holdings-control-direction`), not `master`. If Task 1's first commit was accidentally made on `master`, create the branch now and confirm the commits carried over correctly — do not force anything.

- [ ] **Step 2: Final full verification**

Run: `npm test && npx tsc --noEmit`
Expected: both clean, immediately before pushing.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin HEAD
```

Open the PR with `gh pr create` (or, if `gh` is unavailable in this environment, prepare the branch and hand the compare link to Calvin — confirm which applies before this step, since `gh` has been unavailable in this environment in prior sessions). PR description should cover, plainly and not buried: the two approved behaviour changes; the four Dashboard-side corrections from Task 1; the three explicit deviations from the literal mock (icon-button border assignment, sort-order, responsive dual-markup) with their rationale; **the `app/globalsCss.test.ts` test rewrite in Task 7 — state that assertions were replaced and why (the old block tested the prior minimal dark-only patch's mechanism, which this milestone supersedes) so it cannot read as silent test churn to a future reader of the diff**; the two spec errors logged for DESIGN (icon-button-border mock contradiction, §8.2 sort-order); and the SGD diagnostic finding from earlier in this session (report only, no code change).

- [ ] **Step 4: Stop**

Do not merge. Wait for Calvin's explicit approval, per the milestone brief's GIT instructions.

---

## Self-Review Notes

**Spec coverage:** Every control-spec.md §2–§13 item that appears on `/holdings` or `/` is covered — buttons (Task 6/7), text inputs + numeric spinners (Task 6/7), select (Task 6/7), icon buttons bordered/bare (Tasks 1/3/7), nav links (Tasks 3/7), top bar + table header container decisions (Task 7), date control (Tasks 5/6/7), Add-a-holding fieldset (Task 6/7), status messages (Task 6/7), pending state (Task 6/7). §5 (segmented control) and §13 (radio group) don't appear on either in-scope route (segmented control is Dashboard-only and already exists — only its dark-mode fill needed fixing, Task 1; radio group is `SetupWizard`-only, out of scope). §15's two OS-controlled items and the SetupWizard page-level gap are correctly left alone.

**Placeholder scan:** No task step describes an action without showing the exact code/CSS/command; every new file's full contents are given.

**Type consistency:** `PriceCell`'s new signature (`priceStatus`/`priceUsd`/`priceDate`) is used identically in Task 2's test, Task 6's `HoldingsEditor` call site, and there is no other caller anywhere in the codebase (confirmed during research — `DashboardHoldingsTable` renders price inline, doesn't use `PriceCell`). `formatCheckedAt(now: Date): string` matches its one call site's usage in both `app/page.tsx` (Task 3) and `app/holdings/page.tsx` (Task 4).
