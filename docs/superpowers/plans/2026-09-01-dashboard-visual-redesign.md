# Dashboard Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dashboard route (`/`) the frozen visual direction — dated-reading character, ranked timestamps, IBM Plex Sans, structural light/dark palette, one global manual refresh control, weight-sorted holdings, a single 720px breakpoint — while leaving `/holdings` and the setup wizard visually untouched (their redesign is a later milestone).

**Architecture:** All new visual system (tokens, fonts, dark mode) is scoped under a single wrapper class `.cb-dash`, rendered only by the Dashboard route via a new client `DashboardShell`. Old shared classes (`.site-nav`, `.editor-table`, `.button-link`, `--color-*` tokens) are untouched so `/holdings` and the wizard keep their current look. `ThemeContext` is mounted once in the root layout (same shape as `PrivacyContext`) so it is available everywhere, but only the Dashboard actually applies `data-theme` visually this milestone. Session-only React state throughout — no localStorage, no automatic timers.

**Tech Stack:** Next.js 15 App Router, React 18 Server + Client Components, vanilla CSS custom properties (no CSS framework), Vitest + Testing Library, Decimal.js.

**Spec:** The CALBOARD BUILD/CODE task brief (frozen direction + 12 DONE WHEN criteria, given verbatim in this session) and the reference mock `calboard-dashboard-mock-v7.html` (repo-root, gitignored, not committed — read it directly for exact markup/CSS/copy).

## Global Constraints

- Dashboard only. Do not touch `/holdings` visual treatment, schema, migrations, the append-only ledger, the invalid-symbol contract, or the market data provider.
- No auto-refresh, no polling, no intervals. Refresh is a manual button only.
- No localStorage / sessionStorage / cookies for privacy or theme state — plain `useState`, session-only, following the existing `PrivacyContext` shape exactly.
- Portfolio value figure itself is never coloured. Only the delta line may carry gain/loss colour, at font-weight 400.
- Semantic colour (gain/loss/stale) is reserved — never used decoratively elsewhere.
- Single breakpoint for the Dashboard: 720px. No horizontal scroll at any width.
- Six-value allocation palette, excluding green/red/amber (reserved for semantic colour).
- Full `npm test` suite and `npx tsc --noEmit` must pass before opening the PR.
- Branch + PR only — master is protected. Do not merge. Stop after opening the PR.

---

## File Structure

**New files:**
- `app/components/ThemeContext.tsx` + `.test.tsx` — light/dark session state, OS-preference initial read, mounted at root.
- `app/components/DashboardShell.tsx` + `.test.tsx` — client wrapper rendering `<div className="cb-dash" data-theme={theme}>`; the scoping boundary for every new token/class.
- `app/components/DashboardTopBar.tsx` + `.test.tsx` — Dashboard-only nav: brand, Dashboard/Holdings links, privacy icon toggle, theme icon toggle. Replaces `<NavBar/>` on `/` only.
- `app/components/PriceRefreshControl.tsx` + `.test.tsx` — "Data checked …" text + one refresh icon button with retrying/success/error state.
- `app/components/DashboardHoldingsTable.tsx` + `.test.tsx` — desktop `table.holdings` + mobile `.stack` markup from one `positions` array; footnote for stale/unavailable rows. Replaces the inline table currently in `app/page.tsx`.
- `docs/superpowers/plans/2026-09-01-dashboard-visual-redesign.md` — this file.

**Modified files:**
- `app/page.tsx` — sort positions by weight, compute the two ranked timestamps, wrap output in `DashboardShell` + `DashboardTopBar`, use `DashboardHoldingsTable`, drop the inline `<PriceCell>` table.
- `app/page.test.tsx` — rewritten to match new structure/copy while preserving the underlying guarantees (privacy masking, allocation correctness, no duplicate markup, empty-state derivation).
- `app/components/MaskableValue.tsx` + `.test.tsx` — mask digit-for-bullet instead of a fixed 6-bullet placeholder, so masked and unmasked strings are the same length (column-width fix).
- `app/components/AllocationDonut.tsx` + `.test.tsx` — swap the hardcoded 8-hex `SWATCHES` array and inline `#333`/`#eee` colours for the new 6-value `--a1..--a6` / `--ink` / `--hairline` tokens (still only resolves inside `.cb-dash`). Structure/props/class hooks (`.dashboard-section`, `.allocation`, `.allocation-layout`, `.dashboard-note`) stay so existing test hooks keep working.
- `app/actions/prices.ts` + `app/actions/prices.test.ts` — add `refreshAllPricesAction()`.
- `app/layout.tsx` — mount `ThemeProvider` alongside `PrivacyProvider`.
- `app/globals.css` — new `.cb-dash`-scoped rules (tokens, topbar, value block, sections, tables, stack, toggle, allocation, 720px breakpoint). Nothing outside `.cb-dash` changes.
- `DESIGN.md` — document the new Dashboard-only visual system, the per-row-Retry → global-refresh change, the 720px/dual-markup deviation, and the now-scoped dark mode.
- `README.md` — screenshot regenerated (dashboard.png) once the new UI is live; no text changes needed (no literal "Retry" text there — the screenshot itself is the shipped-behaviour reference).

**Out of scope, confirmed unchanged:** `app/holdings/*`, `app/components/PriceCell.tsx` (still used by `/holdings`), `app/components/NavBar.tsx` (still used by `/holdings` and the wizard), `lib/portfolio.ts`'s SQL `ORDER BY` (stays alphabetical — Dashboard sorts client-side after fetch so `/holdings`' pre-fill order is untouched).

---

### Task 1: `ThemeContext` — session-only light/dark state

**Files:**
- Create: `app/components/ThemeContext.tsx`
- Test: `app/components/ThemeContext.test.tsx`

**Interfaces:**
- Produces: `ThemeProvider({ children }: { children: ReactNode })`, `useTheme(): { theme: "light" | "dark"; toggle: () => void }`.
- Default context value (no provider ancestor): `{ theme: "light", toggle: () => {} }` — same escape hatch `PrivacyContext` uses for isolated component tests.

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/ThemeContext.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe("ThemeContext", () => {
  it("defaults to light before mount effects settle, with no provider", () => {
    render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("light");
  });

  it("adopts the OS dark preference on mount", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByRole("button").textContent).toBe("dark");
  });

  it("stays light when the OS prefers light", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByRole("button").textContent).toBe("light");
  });

  it("toggle flips the theme regardless of OS preference, for the session", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("dark");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("light");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run app/components/ThemeContext.test.tsx` — fails with "Cannot find module './ThemeContext'".

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/ThemeContext.tsx
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => {},
});

// Session-only, same shape as PrivacyProvider: plain useState, mounted once
// in the root layout, no persistence. Server-rendered/first paint is always
// "light" (matchMedia doesn't exist on the server); a mount effect then
// reads the OS preference once. A brief light->dark flash for dark-OS users
// on first load is the accepted trade-off for keeping this as simple as
// PrivacyContext (no blocking inline script, no localStorage).
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  const toggle = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run app/components/ThemeContext.test.tsx`.

- [ ] **Step 5: Wire into the root layout**

Edit `app/layout.tsx`:

```tsx
import "./globals.css";
import { PrivacyProvider } from "./components/PrivacyContext";
import { ThemeProvider } from "./components/ThemeContext";

export const metadata = {
  title: "Calboard",
  description: "Private portfolio tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <PrivacyProvider>{children}</PrivacyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add app/components/ThemeContext.tsx app/components/ThemeContext.test.tsx app/layout.tsx
git commit -m "feat: add session-only ThemeContext (OS preference + manual toggle)"
```

---

### Task 2: `MaskableValue` — digit-for-bullet masking (column-width fix)

**Files:**
- Modify: `app/components/MaskableValue.tsx`
- Modify: `app/components/MaskableValue.test.tsx`

**Interfaces:** unchanged — `MaskableValue({ children, placeholder? })`. Behavioural change only: when `placeholder` is not explicitly passed, mask by replacing each ASCII digit in the string form of `children` with `•`, preserving every other character (so length — and column width — never changes). An explicit `placeholder` prop still wins outright (existing "accepts a custom placeholder" behaviour).

- [ ] **Step 1: Update the test to the new default masking behaviour**

```tsx
// app/components/MaskableValue.test.tsx — replace the second `it` block:
  it("masks by replacing each digit with a bullet, preserving length and punctuation (no column-width shift)", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue>1234.56</MaskableValue>
      </PrivacyProvider>
    );
    expect(screen.getByText("1234.56")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.queryByText("1234.56")).toBeNull();
    const masked = screen.getByText("••••.••");
    expect(masked).toBeInTheDocument();
    expect(masked.textContent).toHaveLength("1234.56".length);
  });

  it("masks a negative/thousands-separated value digit-for-digit, keeping the sign and separators", () => {
    render(
      <PrivacyProvider>
        <ToggleButton />
        <MaskableValue>-12,345.60</MaskableValue>
      </PrivacyProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("-••,•••.••")).toBeInTheDocument();
  });
```

(Keep the "renders its children when not hidden" and "accepts a custom placeholder" tests as-is.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/components/MaskableValue.test.tsx`.

- [ ] **Step 3: Implement**

```tsx
// app/components/MaskableValue.tsx
"use client";

import type { ReactNode } from "react";
import { usePrivacy } from "./PrivacyContext";

// Digit-for-bullet: preserves the string's length (and every non-digit
// character — sign, thousands separators, decimal point) so a masked value
// occupies exactly the same width as the value it replaces. A fixed-length
// placeholder ("••••••" for every value) was the M1.5 regression this fixes:
// numeric table columns visibly shifted width when privacy was toggled.
function maskDigits(value: ReactNode): string {
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[0-9]/g, "•");
}

export function MaskableValue({
  children,
  placeholder,
}: {
  children: ReactNode;
  placeholder?: string;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return <span aria-label="hidden">{placeholder ?? maskDigits(children)}</span>;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run app/components/MaskableValue.test.tsx`.

- [ ] **Step 5: Run the full suite once to catch any other test asserting the old fixed placeholder**

```bash
npx vitest run
```

Fix any other test (e.g. in `AllocationDonut.test.tsx`, `app/page.test.tsx`, `HoldingsEditor.test.tsx`) that literally asserts `"••••••"` for a masked numeric value — update it to the digit-for-digit equivalent of that test's fixture value.

- [ ] **Step 6: Commit**

```bash
git add app/components/MaskableValue.tsx app/components/MaskableValue.test.tsx
git commit -m "fix: mask values digit-for-digit so masking never shifts column width"
```

---

### Task 3: `refreshAllPricesAction` — one global manual refresh

**Files:**
- Modify: `app/actions/prices.ts`
- Modify: `app/actions/prices.test.ts`

**Interfaces:**
- Consumes: `getAllHoldings()` (`lib/holdings.ts`), `getPortfolioView()` (`lib/portfolio.ts`), `upsertLatestPrice(assetId, symbol, assetClass)` (`lib/marketdata`).
- Produces: `refreshAllPricesAction(): Promise<{ ok: boolean; changed: boolean; message?: string }>` — `ok: false` only if every holding failed; `changed` is true iff any position's `(priceDate, latestPriceUsd)` pair differs before vs. after; a partial failure still returns `ok: true` with a `message` naming how many holdings couldn't be refreshed, so a single bad symbol never blocks the rest (manual global action, not the single-symbol Retry path).

- [ ] **Step 1: Write the failing tests**

```ts
// append to app/actions/prices.test.ts
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";
import { refreshAllPricesAction } from "./prices";
import Decimal from "decimal.js";

vi.mock("@/lib/holdings", () => ({ getAllHoldings: vi.fn() }));
vi.mock("@/lib/portfolio", () => ({ getPortfolioView: vi.fn() }));

const getAllHoldingsMock = vi.mocked(getAllHoldings);
const getPortfolioViewMock = vi.mocked(getPortfolioView);

function pos(over: { assetId: string; priceDate: string | null; price: string | null }) {
  return {
    accountId: 1, accountName: "x", assetId: over.assetId, symbol: over.assetId,
    assetName: over.assetId, assetClass: "equity" as const, quantity: new Decimal(1),
    avgCostUsd: new Decimal(1), costBasisUsd: new Decimal(1),
    latestPriceUsd: over.price ? new Decimal(over.price) : null,
    priceDate: over.priceDate, priceSourceId: 1,
    priceStatus: over.price ? ("current" as const) : ("unavailable" as const),
    marketValueUsd: over.price ? new Decimal(over.price) : null, unrealisedPlUsd: null,
  };
}

function portfolioOf(positions: ReturnType<typeof pos>[]) {
  return {
    positions, totalCashUsd: new Decimal(0), totalMarketValueUsd: new Decimal(0),
    totalPortfolioValueUsd: new Decimal(0), excludedFromTotalSymbols: [],
    totalUnrealisedPlUsd: new Decimal(0), totalUnrealisedPlPct: null,
  };
}

describe("refreshAllPricesAction", () => {
  beforeEach(() => {
    getAllHoldingsMock.mockReset();
    getPortfolioViewMock.mockReset();
  });

  it("no holdings: ok, unchanged, nothing fetched", async () => {
    getAllHoldingsMock.mockResolvedValue([]);
    getPortfolioViewMock.mockResolvedValue(portfolioOf([]));

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: false });
    expect(upsertLatestPriceMock).not.toHaveBeenCalled();
  });

  it("every holding refreshes but the close is unchanged: ok, changed = false", async () => {
    getAllHoldingsMock.mockResolvedValue([{ assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) }]);
    getPortfolioViewMock
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "300" })]))
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "300" })]));
    upsertLatestPriceMock.mockResolvedValue({ fromCache: true, provider: "YAHOO" });

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: false });
  });

  it("a holding's price date advances: ok, changed = true", async () => {
    getAllHoldingsMock.mockResolvedValue([{ assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) }]);
    getPortfolioViewMock
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-28", price: "300" })]))
      .mockResolvedValueOnce(portfolioOf([pos({ assetId: "1", priceDate: "2026-08-29", price: "305" })]));
    upsertLatestPriceMock.mockResolvedValue({ fromCache: false, provider: "YAHOO" });

    const result = await refreshAllPricesAction();

    expect(result).toEqual({ ok: true, changed: true });
  });

  it("every holding fails: ok = false with a message, revalidates nothing", async () => {
    getAllHoldingsMock.mockResolvedValue([{ assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) }]);
    getPortfolioViewMock.mockResolvedValue(portfolioOf([pos({ assetId: "1", priceDate: null, price: null })]));
    upsertLatestPriceMock.mockRejectedValue(new Error("provider down"));

    const result = await refreshAllPricesAction();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/every holding/i);
  });

  it("one of two holdings fails: still ok, message names the count, revalidates", async () => {
    getAllHoldingsMock.mockResolvedValue([
      { assetId: "1", symbol: "AAPL", assetClass: "equity", quantity: new Decimal(1) },
      { assetId: "2", symbol: "BAD", assetClass: "equity", quantity: new Decimal(1) },
    ]);
    getPortfolioViewMock
      .mockResolvedValueOnce(portfolioOf([
        pos({ assetId: "1", priceDate: "2026-08-28", price: "300" }),
        pos({ assetId: "2", priceDate: null, price: null }),
      ]))
      .mockResolvedValueOnce(portfolioOf([
        pos({ assetId: "1", priceDate: "2026-08-29", price: "305" }),
        pos({ assetId: "2", priceDate: null, price: null }),
      ]));
    upsertLatestPriceMock
      .mockResolvedValueOnce({ fromCache: false, provider: "YAHOO" })
      .mockRejectedValueOnce(new Error("provider down"));

    const result = await refreshAllPricesAction();

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.message).toMatch(/1 of 2/i);
    const revalidated = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(revalidated).toContain("/");
    expect(revalidated).toContain("/holdings");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/actions/prices.test.ts`.

- [ ] **Step 3: Implement**

```ts
// append to app/actions/prices.ts
import { getAllHoldings } from "@/lib/holdings";
import { getPortfolioView } from "@/lib/portfolio";

function priceKey(priceDate: string | null, priceUsd: import("decimal.js").default | null): string {
  return `${priceDate ?? ""}|${priceUsd?.toString() ?? ""}`;
}

// The Dashboard's ONE global refresh control (spec: per-holding Retry is
// gone from the Dashboard). Manual only — never called on a timer or on
// mount. Refreshes every holding, tolerating individual failures so one bad
// symbol never blocks the rest; `changed` lets the caller show an honest
// "checked, nothing changed" state instead of implying something happened
// when an EOD refresh (as most are) finds nothing new.
export async function refreshAllPricesAction(): Promise<{
  ok: boolean;
  changed: boolean;
  message?: string;
}> {
  const holdings = await getAllHoldings();
  if (holdings.length === 0) {
    return { ok: true, changed: false };
  }

  const before = await getPortfolioView();
  const beforeKeys = new Map(before.positions.map((p) => [p.assetId, priceKey(p.priceDate, p.latestPriceUsd)]));

  const results = await Promise.allSettled(
    holdings.map((h) => upsertLatestPrice(h.assetId, h.symbol, h.assetClass))
  );
  const failures = results.filter((r) => r.status === "rejected").length;

  if (failures === holdings.length) {
    return { ok: false, changed: false, message: "Price refresh failed for every holding." };
  }

  revalidatePath("/");
  revalidatePath("/holdings");

  const after = await getPortfolioView();
  const changed = after.positions.some(
    (p) => beforeKeys.get(p.assetId) !== priceKey(p.priceDate, p.latestPriceUsd)
  );

  return failures > 0
    ? { ok: true, changed, message: `${failures} of ${holdings.length} holdings couldn't be refreshed.` }
    : { ok: true, changed };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run app/actions/prices.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/actions/prices.ts app/actions/prices.test.ts
git commit -m "feat: add refreshAllPricesAction for the Dashboard's global refresh control"
```

---

### Task 4: `PriceRefreshControl` — "Data checked …" + refresh button with success state

**Files:**
- Create: `app/components/PriceRefreshControl.tsx`
- Test: `app/components/PriceRefreshControl.test.tsx`

**Interfaces:**
- Consumes: `refreshAllPricesAction()` (Task 3).
- Produces: `PriceRefreshControl({ checkedAt: string })` — `checkedAt` is a pre-formatted string ("29 Aug, 21:04 SGT") computed server-side by `app/page.tsx` at render time (the Dashboard is `force-dynamic`, so every render — including the one `router.refresh()` triggers post-refresh — recomputes "now").

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/PriceRefreshControl.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { refreshAllPricesAction } from "@/app/actions/prices";
import { PriceRefreshControl } from "./PriceRefreshControl";

vi.mock("@/app/actions/prices", () => ({ refreshAllPricesAction: vi.fn() }));
const refreshMock = vi.mocked(refreshAllPricesAction);
const refreshRouter = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshRouter }) }));

afterEach(cleanup);
beforeEach(() => {
  refreshMock.mockReset();
  refreshRouter.mockReset();
});

describe("PriceRefreshControl", () => {
  it("shows the checked-at text and a refresh control", () => {
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);
    expect(screen.getByText(/data checked 29 aug, 21:04 sgt/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh prices/i })).toBeInTheDocument();
  });

  it("on click, disables the button, then shows an 'unchanged' success state and refreshes the router", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: false });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));
    expect(screen.getByRole("button", { name: /refresh prices/i })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/up to date/i));
    expect(refreshRouter).toHaveBeenCalledTimes(1);
  });

  it("on click, when data changed, shows an 'updated' success state", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: true });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated/i));
  });

  it("on failure, shows an alert and does not refresh the router", async () => {
    refreshMock.mockResolvedValue({ ok: false, changed: false, message: "Price refresh failed for every holding." });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/price refresh failed/i));
    expect(refreshRouter).not.toHaveBeenCalled();
  });

  it("a partial failure still shows the (muted) success state text alongside the warning", async () => {
    refreshMock.mockResolvedValue({ ok: true, changed: true, message: "1 of 2 holdings couldn't be refreshed." });
    render(<PriceRefreshControl checkedAt="29 Aug, 21:04 SGT" />);

    fireEvent.click(screen.getByRole("button", { name: /refresh prices/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/updated/i));
    expect(screen.getByText(/1 of 2 holdings couldn't be refreshed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run app/components/PriceRefreshControl.test.tsx`.

- [ ] **Step 3: Implement**

```tsx
// app/components/PriceRefreshControl.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refreshAllPricesAction } from "@/app/actions/prices";

// The Dashboard's ONE manual refresh control (spec: never automatic, never
// interval-based). Most clicks change nothing — EOD data updates once a day
// — so an explicit "Up to date" / "Updated" state is required: silence
// after a click reads as broken, not as "nothing to do".
export function PriceRefreshControl({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "done"; changed: boolean; message?: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handleRefresh() {
    setState({ kind: "pending" });
    const result = await refreshAllPricesAction();
    if (!result.ok) {
      setState({ kind: "error", message: result.message ?? "Price refresh failed." });
      return;
    }
    setState({ kind: "done", changed: result.changed, message: result.message });
    router.refresh();
  }

  return (
    <div className="checked">
      Data checked {checkedAt}
      <button
        type="button"
        className="refresh"
        aria-label="Refresh prices"
        title="Refresh prices"
        onClick={handleRefresh}
        disabled={state.kind === "pending"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 4v5h-5" />
        </svg>
      </button>
      {state.kind === "done" && (
        <span role="status" className="refresh-status">
          {" "}
          {state.changed ? "Updated" : "Up to date"}
        </span>
      )}
      {state.kind === "done" && state.message && (
        <span className="refresh-status status-warning"> {state.message}</span>
      )}
      {state.kind === "error" && (
        <span role="alert" className="refresh-status status-danger">
          {" "}
          {state.message}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run app/components/PriceRefreshControl.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/components/PriceRefreshControl.tsx app/components/PriceRefreshControl.test.tsx
git commit -m "feat: add PriceRefreshControl with an explicit unchanged/updated success state"
```

---

### Task 5: `DashboardShell` + `DashboardTopBar`

**Files:**
- Create: `app/components/DashboardShell.tsx`, `app/components/DashboardTopBar.tsx`
- Test: `app/components/DashboardShell.test.tsx`, `app/components/DashboardTopBar.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` (Task 1), `usePrivacy()` (existing).
- Produces: `DashboardShell({ children })` → `<div className="cb-dash" data-theme={theme}>{children}</div>`. `DashboardTopBar()` → brand + nav + icon toggles.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/DashboardShell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ThemeProvider } from "./ThemeContext";
import { DashboardShell } from "./DashboardShell";

afterEach(cleanup);

describe("DashboardShell", () => {
  it("renders the .cb-dash wrapper with data-theme matching the current theme", () => {
    const { container } = render(
      <ThemeProvider>
        <DashboardShell>
          <p>content</p>
        </DashboardShell>
      </ThemeProvider>
    );
    const wrapper = container.querySelector(".cb-dash")!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-theme")).toBe("light");
    expect(wrapper.textContent).toContain("content");
  });
});
```

```tsx
// app/components/DashboardTopBar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PrivacyProvider, usePrivacy } from "./PrivacyContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { DashboardTopBar } from "./DashboardTopBar";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PrivacyProvider>{children}</PrivacyProvider>
    </ThemeProvider>
  );
}

describe("DashboardTopBar", () => {
  it("marks Dashboard as the active link and links to Holdings", () => {
    render(<Providers><DashboardTopBar /></Providers>);
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveClass("on");
    expect(screen.getByRole("link", { name: /^holdings$/i })).toHaveAttribute("href", "/holdings");
  });

  it("privacy toggle button shares state with usePrivacy() consumers", () => {
    function Probe() {
      const { hidden } = usePrivacy();
      return <span data-testid="hidden">{String(hidden)}</span>;
    }
    render(<Providers><DashboardTopBar /><Probe /></Providers>);

    fireEvent.click(screen.getByRole("button", { name: /hide values/i }));
    expect(screen.getByTestId("hidden").textContent).toBe("true");
    expect(screen.getByRole("button", { name: /show values/i })).toBeInTheDocument();
  });

  it("theme toggle button shares state with useTheme() consumers", () => {
    function Probe() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }
    render(<Providers><DashboardTopBar /><Probe /></Providers>);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify both fail.**

- [ ] **Step 3: Implement**

```tsx
// app/components/DashboardShell.tsx
"use client";

import type { ReactNode } from "react";
import { useTheme } from "./ThemeContext";

// The scoping boundary for the whole redesigned visual system (tokens,
// IBM Plex Sans, the six-value allocation palette, dark mode). Everything
// outside this wrapper — /holdings, the setup wizard, NavBar — is
// deliberately untouched this milestone.
export function DashboardShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="cb-dash" data-theme={theme}>
      {children}
    </div>
  );
}
```

```tsx
// app/components/DashboardTopBar.tsx
"use client";

import Link from "next/link";
import { usePrivacy } from "./PrivacyContext";
import { useTheme } from "./ThemeContext";

export function DashboardTopBar() {
  const { hidden, toggle: togglePrivacy } = usePrivacy();
  const { theme, toggle: toggleTheme } = useTheme();

  return (
    <div className="topbar">
      <div className="brand">Calboard</div>
      <div className="nav">
        <Link href="/" className="on">Dashboard</Link>
        <Link href="/holdings">Holdings</Link>
        <button
          type="button"
          className="ctl icononly"
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
          className="ctl icononly"
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

- [ ] **Step 4: Run to verify both pass.**

- [ ] **Step 5: Commit**

```bash
git add app/components/DashboardShell.tsx app/components/DashboardShell.test.tsx app/components/DashboardTopBar.tsx app/components/DashboardTopBar.test.tsx
git commit -m "feat: add Dashboard-only shell and top bar (privacy + theme icon toggles)"
```

---

### Task 6: `DashboardHoldingsTable` — desktop table + mobile stack, footnote

**Files:**
- Create: `app/components/DashboardHoldingsTable.tsx`
- Test: `app/components/DashboardHoldingsTable.test.tsx`

**Interfaces:**
- Consumes: `PositionView[]` (already weight-sorted by the caller — this component does not sort), `formatAssetClass` (`lib/assets`), `MaskableValue`.
- Produces: `DashboardHoldingsTable({ positions: PositionView[] })`. Renders BOTH `table.holdings` (hidden ≤720px via CSS) and `.stack` (hidden >720px via CSS) from the same data, plus one `<tfoot>`/footnote line naming every stale/unavailable symbol and its reason — no per-row Retry button.

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/DashboardHoldingsTable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import Decimal from "decimal.js";
import type { PositionView } from "@/lib/portfolio";
import { DashboardHoldingsTable } from "./DashboardHoldingsTable";

afterEach(cleanup);

function position(over: Partial<PositionView> & Pick<PositionView, "symbol">): PositionView {
  const quantity = over.quantity ?? new Decimal("10");
  return {
    accountId: 1, accountName: "x", assetId: over.symbol, symbol: over.symbol,
    assetName: over.symbol, assetClass: over.assetClass ?? "equity", quantity,
    avgCostUsd: over.avgCostUsd ?? new Decimal("100"),
    costBasisUsd: new Decimal("1000"),
    latestPriceUsd: "latestPriceUsd" in over ? over.latestPriceUsd! : new Decimal("120"),
    priceDate: over.priceDate ?? "2026-08-29",
    priceSourceId: 1,
    priceStatus: over.priceStatus ?? "current",
    marketValueUsd: "marketValueUsd" in over ? over.marketValueUsd! : quantity.mul(new Decimal("120")),
    unrealisedPlUsd: over.unrealisedPlUsd ?? new Decimal("200"),
  };
}

describe("DashboardHoldingsTable", () => {
  it("renders one row per position in both the desktop table and the mobile stack, no Retry button anywhere", () => {
    const positions = [
      position({ symbol: "AAPL" }),
      position({ symbol: "STL", priceStatus: "stale", priceDate: "2026-06-01" }),
      position({ symbol: "NOPX", priceStatus: "unavailable", latestPriceUsd: null, marketValueUsd: null, unrealisedPlUsd: null }),
    ];
    const { container } = render(<DashboardHoldingsTable positions={positions} />);

    const desktopTable = container.querySelector("table.holdings")!;
    expect(within(desktopTable).getAllByRole("row").length).toBe(4); // header + 3
    const stack = container.querySelector(".stack")!;
    expect(stack.querySelectorAll(".hrow").length).toBe(3);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("names stale and unavailable symbols with their reason in one footnote line", () => {
    const positions = [
      position({ symbol: "NVDA", priceStatus: "stale", priceDate: "2026-08-27" }),
      position({ symbol: "SCHD", priceStatus: "unavailable", latestPriceUsd: null, marketValueUsd: null, unrealisedPlUsd: null }),
    ];
    render(<DashboardHoldingsTable positions={positions} />);

    expect(screen.getByText(/NVDA is priced at 2026-08-27 close/i)).toBeInTheDocument();
    expect(screen.getByText(/SCHD has no price and is excluded/i)).toBeInTheDocument();
  });

  it("no stale or unavailable holdings: no footnote renders", () => {
    render(<DashboardHoldingsTable positions={[position({ symbol: "AAPL" })]} />);
    expect(screen.queryByText(/is priced at/i)).toBeNull();
    expect(screen.queryByText(/has no price/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** (read `calboard-dashboard-mock-v7.html`'s `table.holdings` / `.stack` block for the exact class names — `sym`, `dim`, `num`, `strong`, `gain`, `loss`, `stale`, `marker` — and reuse them so Task 7's CSS lines up.)

```tsx
// app/components/DashboardHoldingsTable.tsx
import Decimal from "decimal.js";
import type { PositionView } from "@/lib/portfolio";
import { formatAssetClass } from "@/lib/assets";
import { MaskableValue } from "./MaskableValue";

function plOf(p: PositionView): { usd: Decimal; pct: Decimal | null } | null {
  if (!p.latestPriceUsd || !p.avgCostUsd) return null;
  const usd = p.latestPriceUsd.sub(p.avgCostUsd).mul(p.quantity);
  const basis = p.avgCostUsd.mul(p.quantity);
  const pct = basis.isZero() ? null : usd.div(basis).mul(100);
  return { usd, pct };
}

function signed(d: Decimal): string {
  return d.isNegative() ? `−$${d.abs().toFixed(2)}` : `+$${d.toFixed(2)}`;
}

function footnoteFor(p: PositionView): string | null {
  if (p.priceStatus === "stale") return `${p.symbol} is priced at ${p.priceDate} close.`;
  if (p.priceStatus === "unavailable") {
    return `${p.symbol} has no price and is excluded from portfolio value, allocation and P&L.`;
  }
  return null;
}

export function DashboardHoldingsTable({ positions }: { positions: PositionView[] }) {
  const footnotes = positions.map(footnoteFor).filter((f): f is string => f !== null);

  return (
    <>
      <div className="editor-table">
        <table className="holdings">
          <thead>
            <tr>
              <th>Symbol</th><th>Type</th><th>Quantity</th><th>Avg cost</th>
              <th>Price</th><th>Market value</th><th>Unrealised P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pl = plOf(p);
              const degraded = p.priceStatus !== "current";
              return (
                <tr key={p.assetId}>
                  <td className="sym">{p.symbol}</td>
                  <td className="dim">{formatAssetClass(p.assetClass)}</td>
                  <td className="num dim"><MaskableValue>{p.quantity.toFixed(4)}</MaskableValue></td>
                  <td className="num dim">{p.avgCostUsd ? <MaskableValue>${p.avgCostUsd.toFixed(2)}</MaskableValue> : "—"}</td>
                  <td className={degraded ? "num stale" : "num"} title={footnoteFor(p) ?? undefined}>
                    {degraded && <span className="marker" aria-hidden="true" />}
                    {p.latestPriceUsd ? `$${p.latestPriceUsd.toFixed(2)}` : "—"}
                  </td>
                  <td className="num strong">
                    {p.marketValueUsd ? <MaskableValue>${p.marketValueUsd.toFixed(2)}</MaskableValue> : "—"}
                  </td>
                  <td className={`num strong${pl ? (pl.usd.isNegative() ? " loss" : " gain") : ""}`}>
                    {pl ? <MaskableValue>{signed(pl.usd)}</MaskableValue> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {footnotes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7}>{footnotes.join(" ")}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="stack">
        {positions.map((p) => {
          const pl = plOf(p);
          const note = footnoteFor(p);
          return (
            <div className="hrow" key={p.assetId}>
              <div className="line1">
                <span className="sym">{p.symbol}</span>
              </div>
              <div className="mv num">
                {p.marketValueUsd ? <MaskableValue>${p.marketValueUsd.toFixed(2)}</MaskableValue> : "No price"}
              </div>
              <div className="meta num">
                <MaskableValue>{p.quantity.toFixed(4)}</MaskableValue> &times; ${p.avgCostUsd?.toFixed(2) ?? "—"} avg &middot; {formatAssetClass(p.assetClass)}
              </div>
              {note && (
                <div className="meta stale">
                  <span className="marker" aria-hidden="true" />
                  {note}
                </div>
              )}
              {pl && (
                <div className={`pl num${pl.usd.isNegative() ? " loss" : " gain"}`}>
                  <MaskableValue>{signed(pl.usd)}</MaskableValue>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add app/components/DashboardHoldingsTable.tsx app/components/DashboardHoldingsTable.test.tsx
git commit -m "feat: add DashboardHoldingsTable (desktop table + mobile stack, no per-row Retry)"
```

---

### Task 7: `AllocationDonut` — new palette tokens, still inside `.cb-dash` only

**Files:**
- Modify: `app/components/AllocationDonut.tsx`
- Modify: `app/components/AllocationDonut.test.tsx`

- [ ] **Step 1:** Existing tests already avoid asserting specific colours — no test changes needed unless a test asserts the literal 8-hex `SWATCHES` values (none do, per the read-through in this plan's research). Skip straight to implementation; re-run the existing suite after.

- [ ] **Step 2: Implement** — replace:

```tsx
const SWATCHES = [
  "#4e79a7", "#f28e2b", "#59a14f", "#e15759",
  "#b07aa1", "#76b7b2", "#edc948", "#9c755f",
];
```

with the frozen six-value palette (CSS custom properties so dark mode swaps them automatically):

```tsx
const SWATCHES = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--a5)", "var(--a6)"];
```

And replace the hardcoded track/text colours:

```tsx
<circle cx={C} cy={C} r={R} fill="none" stroke="var(--hairline)" strokeWidth={STROKE} />
...
<text x={C} y={C - 3} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
  US${hidden ? "••••" : totalUsd}
</text>
<text x={C} y={C + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">
  priced total
</text>
```

Leave every prop, class hook (`dashboard-section`, `allocation`, `allocation-layout`, `dashboard-note`) and the by-holding/by-class toggle logic untouched — Task 8's CSS will restyle those class hooks under `.cb-dash` without needing new markup.

- [ ] **Step 3: Run the full AllocationDonut suite** — `npx vitest run app/components/AllocationDonut.test.tsx` — confirm still green (CSS custom properties resolve to nothing meaningful in jsdom, which is fine — tests assert structure/text, not computed colour).

- [ ] **Step 4: Commit**

```bash
git add app/components/AllocationDonut.tsx
git commit -m "style: allocation donut uses the frozen six-value palette via CSS tokens"
```

---

### Task 8: `app/globals.css` — the `.cb-dash` visual system

**Files:**
- Modify: `app/globals.css`

Append a new section (do not touch anything above it). Port the tokens, topbar, value block, section/table/stack, toggle and 720px-breakpoint rules from `calboard-dashboard-mock-v7.html`'s `<style>` block verbatim where the class names match Tasks 5–7's markup, all nested/prefixed under `.cb-dash` so nothing leaks to `/holdings` or the wizard. Concretely:

- [ ] **Step 1:** Add the IBM Plex Sans font `<link>` tags to `app/page.tsx` (Task 9), not `globals.css` — Next.js hoists `<link>` tags rendered anywhere in the tree into `<head>`, deduped, and this keeps the font request scoped to when the Dashboard route is actually visited.

- [ ] **Step 2:** Append to `app/globals.css`:

```css
/* --- Dashboard v2 (2026-09-01 redesign) ---------------------------------
   Scoped entirely under .cb-dash — /holdings and the setup wizard keep the
   original foundation above unchanged. See DESIGN.md for why these are a
   second, parallel token set instead of replacing --color-*. */
.cb-dash {
  --ground: #F0F0ED; --ink: #1B1D1F; --muted: #5A6067; --hairline: #DCDCD6;
  --gain: #1B6B4A; --loss: #A3352A; --stale: #856713;
  --a1: #0F3357; --a2: #7FD4CE; --a3: #5B4B8A; --a4: #6FA8DC; --a5: #2C7A87; --a6: #BDA9D6;

  background: var(--ground);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.5;
  font-variant-numeric: tabular-nums;
  margin: calc(-1 * var(--space-lg));
  padding: 0 32px 96px;
}
.cb-dash[data-theme="dark"] {
  --ground: #16181A; --ink: #E9EAE7; --muted: #979CA1; --hairline: #2C2F33;
  --gain: #56B98C; --loss: #E27A66; --stale: #D9AB45;
  --a1: #5C9FE0; --a2: #7FE3DB; --a3: #A98FE0; --a4: #3E7BA8; --a5: #4FC2C9; --a6: #D5C4EC;
}
.cb-dash .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

.cb-dash .topbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 0 0; }
.cb-dash .brand { font-size: 15px; font-weight: 500; letter-spacing: -0.01em; }
.cb-dash .nav { display: flex; align-items: center; gap: 20px; }
.cb-dash .nav a { color: var(--muted); text-decoration: none; font-size: 15px; }
.cb-dash .nav a.on { color: var(--ink); text-decoration: underline; text-underline-offset: 5px; text-decoration-thickness: 1px; }
.cb-dash .ctl {
  display: inline-flex; align-items: center; gap: 7px;
  font: inherit; font-size: 13px; color: var(--ink);
  background: none; border: 1px solid var(--hairline);
  padding: 6px 11px; cursor: pointer; border-radius: 0;
}
.cb-dash .ctl:hover { border-color: var(--muted); }
.cb-dash .ctl svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.cb-dash .ctl.icononly { padding: 6px 8px; }

.cb-dash .valueblock { padding: 56px 0 40px; }
.cb-dash .asof { font-size: 15px; color: var(--ink); margin-bottom: 10px; }
.cb-dash .value { font-size: 40px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1; }
.cb-dash .delta { font-size: 15px; font-weight: 400; margin-top: 10px; }
.cb-dash .checked { font-size: 13px; color: var(--muted); margin-top: 6px; }
.cb-dash .gain { color: var(--gain); }
.cb-dash .loss { color: var(--loss); }
.cb-dash .refresh { background: none; border: 0; padding: 0; margin-left: 8px; cursor: pointer; color: var(--muted); vertical-align: -2px; line-height: 0; }
.cb-dash .refresh:hover { color: var(--ink); }
.cb-dash .refresh svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.cb-dash .refresh-status { font-size: 13px; }
.cb-dash .refresh-status.status-warning { color: var(--stale); }
.cb-dash .refresh-status.status-danger { color: var(--loss); }

.cb-dash .dashboard-section { padding-top: 24px; }
.cb-dash .dashboard-section + .dashboard-section { padding-top: 64px; }
.cb-dash .dashboard-section > h2 { font-size: 20px; font-weight: 500; letter-spacing: -0.01em; padding-bottom: 14px; border-bottom: 1px solid var(--hairline); margin: 0; }
.cb-dash .dashboard-note { font-size: 13px; color: var(--muted); }

.cb-dash table.holdings { width: 100%; border-collapse: collapse; margin-top: 14px; }
.cb-dash table.holdings thead th { font-size: 13px; font-weight: 400; color: var(--muted); text-align: right; padding: 14px 0 12px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.cb-dash table.holdings thead th:first-child, .cb-dash table.holdings thead th:nth-child(2) { text-align: left; }
.cb-dash table.holdings tbody td { padding: 0; height: 48px; text-align: right; border-bottom: 1px solid var(--hairline); vertical-align: middle; white-space: nowrap; }
.cb-dash table.holdings tbody td:first-child, .cb-dash table.holdings tbody td:nth-child(2) { text-align: left; }
.cb-dash .sym { font-weight: 500; }
.cb-dash .strong { font-weight: 500; }
.cb-dash .dim { color: var(--muted); font-weight: 400; }
.cb-dash .stale { color: var(--stale); }
.cb-dash .marker { display: inline-block; width: 5px; height: 5px; background: var(--stale); vertical-align: 2px; margin-right: 6px; }
.cb-dash table.holdings tfoot td { padding-top: 16px; font-size: 13px; color: var(--muted); text-align: left; }
.cb-dash .stack { display: none; }

.cb-dash .toggle { display: flex; border: 1px solid var(--hairline); }
.cb-dash .toggle button { font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer; border: 0; background: none; color: var(--muted); border-radius: 0; }
.cb-dash .toggle button[aria-pressed="true"] { background: var(--ink); color: var(--ground); }
.cb-dash .allocation-layout { display: flex; gap: 56px; align-items: flex-start; padding-top: 28px; flex-wrap: wrap; }
.cb-dash .allocation-layout table { border-collapse: collapse; width: 100%; }
.cb-dash .allocation-layout td { height: 36px; border-bottom: 1px solid var(--hairline); font-size: 15px; }

@media (max-width: 720px) {
  .cb-dash { padding: 0 20px 72px; }
  .cb-dash .value { font-size: 32px; }
  .cb-dash .valueblock { padding: 40px 0 32px; }
  .cb-dash .dashboard-section + .dashboard-section { padding-top: 48px; }
  .cb-dash table.holdings { display: none; }
  .cb-dash .stack { display: block; }
  .cb-dash .hrow { padding: 18px 0; border-bottom: 1px solid var(--hairline); }
  .cb-dash .hrow .line1 { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .cb-dash .hrow .mv { font-size: 20px; font-weight: 500; margin-top: 6px; }
  .cb-dash .hrow .meta { font-size: 13px; color: var(--muted); margin-top: 4px; }
  .cb-dash .hrow .pl { font-size: 15px; font-weight: 500; margin-top: 6px; }
  .cb-dash .allocation-layout { flex-direction: column; gap: 28px; }
  .cb-dash .nav { gap: 14px; }
  .cb-dash .topbar { flex-wrap: wrap; row-gap: 12px; }
}
```

Note the `.stack .hrow` rules are declared globally (not only inside the media query) as done above, matching the mock — `.stack { display: none }` at the base and only flips to `display: block` under 720px, so `.hrow` styling can live at either scope; keep it consistent with what's written above (both blocks shown for clarity — when implementing, don't duplicate `.hrow` rules that already work at base scope).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: add the .cb-dash scoped token system and layout rules"
```

---

### Task 9: Wire it all into `app/page.tsx`, update `app/page.test.tsx`

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/page.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–8, plus existing `listAccounts`, `getPortfolioView`, `getLastSnapshotConfirmation`, `computeAllocation`, `groupByAssetClass`.

- [ ] **Step 1: Implement `app/page.tsx`**

Key changes from the current file:
1. Add the Google Fonts `<link>` tags (Next.js hoists them to `<head>`) — `preconnect` ×2 + the stylesheet link for `IBM+Plex+Sans:wght@400;500`.
2. After `getPortfolioView()`, build `sortedPositions = [...portfolio.positions].sort((a, b) => (b.marketValueUsd?.toNumber() ?? -1) - (a.marketValueUsd?.toNumber() ?? -1))` and use it for both `DashboardHoldingsTable` and the allocation inputs — `/holdings`' pre-fill keeps using `getPortfolioView()` directly (unsorted), so this sort is Dashboard-local and does not touch `lib/portfolio.ts`.
3. Compute the two ranked timestamps:
   - `latestPriceDate = sortedPositions.reduce((max, p) => p.priceDate && (!max || p.priceDate > max) ? p.priceDate : max, null as string | null)`, formatted "D MMM YYYY" (e.g. "29 Aug 2026").
   - `checkedAt` = `new Date()` formatted in `Asia/Singapore`, "D MMM, HH:MM" + literal " SGT" suffix (Singapore has no DST, fixed UTC+8 — safe to hardcode the abbreviation).
4. Wrap the whole return value in `<DashboardShell><DashboardTopBar />...</DashboardShell>` (both the empty-state and populated branches, so the chrome is consistent).
5. Replace the value block's markup with `.valueblock` / `.asof` / `.value` / `.delta` / `<PriceRefreshControl checkedAt={checkedAt} />`, keeping `totalUnrealisedPlUsd` and its percentage (append `(±X.XX%)` after "since cost" — the mock's copy is illustrative, the percentage stays for the existing trust/data-integrity guarantee and the existing privacy test). Portfolio value itself (`.value`) carries no colour class; the delta line gets `.gain`/`.loss`.
6. Keep the existing "Holdings last updated: …" confirmation line (from `getLastSnapshotConfirmation`) as a third, still-more-muted line below `.checked` — it is a distinct, already-tested concept (Save confirmation, not price freshness) and nothing in the brief asks to remove it.
7. Replace the inline `<table>` in the Holdings section with `<DashboardHoldingsTable positions={sortedPositions} />`.
8. Pass `sortedPositions`-derived allocation into `<AllocationDonut>` exactly as today (just fed from `sortedPositions` instead of `portfolio.positions`).
9. Section markup: `<section className="dashboard-section"><h2>Holdings</h2><div className="dashboard-note">Sorted by weight</div>...` — mirror the mock's `.sechead` (flex row: heading + note) using a small wrapper div.

```tsx
// app/page.tsx (full replacement)
import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { getPortfolioView } from "@/lib/portfolio";
import { getLastSnapshotConfirmation } from "@/lib/holdings";
import { computeAllocation, groupByAssetClass } from "@/lib/allocation";
import { DashboardShell } from "./components/DashboardShell";
import { DashboardTopBar } from "./components/DashboardTopBar";
import { DashboardHoldingsTable } from "./components/DashboardHoldingsTable";
import { AllocationDonut } from "./components/AllocationDonut";
import { PriceRefreshControl } from "./components/PriceRefreshControl";
import { MaskableValue } from "./components/MaskableValue";

export const dynamic = "force-dynamic";

function formatConfirmedAt(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// "Prices as of DATE close" — the latest EOD date behind the value figure.
function formatAsOfDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "Data checked TIME SGT" — Singapore has no DST (fixed UTC+8), so the
// abbreviation is safe to hardcode rather than trust Intl's zone-name output.
function formatCheckedAt(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} SGT`;
}

export default async function DashboardPage() {
  const accounts = await listAccounts();
  const portfolio = accounts.length > 0 ? await getPortfolioView() : null;
  const hasHoldings = portfolio !== null && portfolio.positions.length > 0;

  const lastConfirmation =
    accounts.length === 1 ? await getLastSnapshotConfirmation(accounts[0].id) : null;

  const sortedPositions = portfolio
    ? [...portfolio.positions].sort(
        (a, b) => (b.marketValueUsd?.toNumber() ?? -1) - (a.marketValueUsd?.toNumber() ?? -1)
      )
    : [];

  const allocation = portfolio
    ? computeAllocation(
        sortedPositions.map((p) => ({ symbol: p.symbol, marketValueUsd: p.marketValueUsd })),
        portfolio.totalMarketValueUsd
      )
    : null;

  const allocationByAssetClass = portfolio
    ? computeAllocation(
        groupByAssetClass(
          sortedPositions.map((p) => ({ symbol: p.symbol, assetClass: p.assetClass, marketValueUsd: p.marketValueUsd }))
        ),
        portfolio.totalMarketValueUsd
      )
    : null;

  const latestPriceDate = sortedPositions.reduce<string | null>(
    (max, p) => (p.priceDate && (!max || p.priceDate > max) ? p.priceDate : max),
    null
  );
  const checkedAt = formatCheckedAt(new Date());

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet" />
      <DashboardShell>
        <DashboardTopBar />
        <main>
          {!hasHoldings ? (
            <section className="dashboard-section">
              <p>No holdings yet.</p>
              <Link href="/accounts/new" className="button-link">Add your holdings</Link>
            </section>
          ) : (
            <>
              <div className="valueblock">
                <div className="asof">
                  Portfolio value{latestPriceDate && ` · Prices as of ${formatAsOfDate(latestPriceDate)} close`}
                </div>
                <div className="value num">
                  US$<MaskableValue>{portfolio!.totalMarketValueUsd.toFixed(2)}</MaskableValue>
                </div>
                <div className={`delta num${portfolio!.totalUnrealisedPlUsd.isNegative() ? " loss" : " gain"}`}>
                  {portfolio!.totalUnrealisedPlUsd.isNegative() ? "−" : "+"}US$
                  <MaskableValue>{portfolio!.totalUnrealisedPlUsd.abs().toFixed(2)}</MaskableValue> since cost
                  {portfolio!.totalUnrealisedPlPct !== null && <> ({portfolio!.totalUnrealisedPlPct.toFixed(2)}%)</>}
                </div>
                <PriceRefreshControl checkedAt={checkedAt} />
                <div className="dashboard-note">
                  {lastConfirmation
                    ? `Holdings last updated: ${formatConfirmedAt(lastConfirmation.confirmedAt)}`
                    : "Holdings last updated: —"}
                </div>
                {portfolio!.excludedFromTotalSymbols.length > 0 && (
                  <p className="status-msg status-warning">
                    Portfolio total excludes {portfolio!.excludedFromTotalSymbols.length} holding
                    {portfolio!.excludedFromTotalSymbols.length === 1 ? "" : "s"} with no price yet (
                    {portfolio!.excludedFromTotalSymbols.join(", ")}) — true value is higher.
                  </p>
                )}
              </div>

              {allocation && (
                <AllocationDonut allocation={allocation} allocationByAssetClass={allocationByAssetClass ?? undefined} />
              )}

              <section className="dashboard-section">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <h2>Holdings</h2>
                  <div className="dashboard-note">Sorted by weight</div>
                </div>
                <DashboardHoldingsTable positions={sortedPositions} />
              </section>
            </>
          )}
        </main>
      </DashboardShell>
    </>
  );
}
```

Notes for the implementer:
- `portfolio!` non-null assertions are safe because they only appear inside the `hasHoldings` branch, which already guards `portfolio !== null`.
- Keep the `AllocationDonut` heading/section exactly as Task 7 left it (no markup change there — only its internal colours changed).

- [ ] **Step 2: Rewrite `app/page.test.tsx`**

Update in place, preserving every existing guarantee:
- Wrap renders needing `ThemeProvider` too (`DashboardShell` requires it) — add `vi.mock("@/app/components/PriceRefreshControl", ...)` is NOT needed (it's a real client component, fine under jsdom) but DO wrap all `render(...)` calls' trees with both `<ThemeProvider>` and `<PrivacyProvider>` where the test doesn't already supply one — since `DashboardShell`/`DashboardTopBar` need `useTheme()`/`usePrivacy()`, and both contexts have safe no-provider defaults, tests that don't care about theme/privacy can render `DashboardPage()` bare exactly as before (the default context values keep them working, matching how `PrivacyProvider`-less rendering already works today).
- `retryPriceFetchAction` mock (`vi.mock("@/app/actions/prices", ...)`) must now also export `refreshAllPricesAction: vi.fn()` (mocked to resolve `{ ok: true, changed: false }` by default in `beforeEach`) since `PriceRefreshControl` calls it.
- Mock `next/navigation`'s `useRouter` (already present) is reused by `PriceRefreshControl`.
- "Retry appears for the stale and unavailable holding" test (`T31-4`) — update to assert the OPPOSITE: zero Retry buttons render, since Dashboard no longer has per-holding Retry (`DashboardHoldingsTable`, Task 6, has no Retry control at all).
- Heading text: `"Portfolio Value"` heading no longer exists as an `<h2>` — replace those queries with the new structure, e.g. locate the value block by `screen.getByText(/portfolio value/i)` → now `screen.getByText(/^portfolio value/i)` matching the `.asof` div's leading text, or scope directly via `container.querySelector(".valueblock")`. Any assertion keyed off `getByRole("heading", { name: "Portfolio Value" })` must change to a `.valueblock` query — update every such reference (allocation and hierarchy tests included) to `container.querySelector(".valueblock")` / `.closest(".valueblock")` in place of the old heading-based scoping, since the new design intentionally does not repeat "Portfolio Value" as a heading (the mock's `.asof` line carries that label instead).
- `US$4000.00` assertions largely still hold (value block still prints `US$` + the total) — keep them.
- `.pv-amount` class hook → replace with `.value` class hook (T31-5 equivalent).
- `.dashboard-note` hook for "Holdings last updated" → unchanged, still present verbatim.
- Empty-state test: still renders `.button-link` CTA — now inside `DashboardShell`/`DashboardTopBar`; `screen.getByText(/no holdings yet/i)` still resolves the same way. Add an assertion that `DashboardTopBar`'s chrome (e.g. the brand text "Calboard") still renders in the empty state, since Step 1 wraps both branches in the shell.
- Section order test (`T31-1`) — `.valueblock` element must precede the Allocation heading, which must precede the Holdings heading; rewrite using `compareDocumentPosition` against `container.querySelector(".valueblock")` instead of the old "Portfolio Value" heading.
- `.editor-table` wrapper test (`T31-2`) — `DashboardHoldingsTable` still wraps `table.holdings` in `.editor-table` (Task 6 keeps that class for the desktop-table container even though the internal cell markup changed) — update the query to `container.querySelector("table.holdings")` in place of the old borderless `<table>` query, and drop the `.cell-label` assertion (`T31-3`) since the new table uses real `<thead><th>` labels on desktop and separate `.stack .hrow .meta` text on mobile, not the old cell-label restack mechanism — replace T31-3 with an assertion that each mobile `.hrow` contains the symbol, quantity, avg cost and asset class as visible text (already covered by Task 6's own component test; keep a thin integration check here that `DashboardHoldingsTable` actually receives `sortedPositions`).
- Add one new integration test: **weight sort** — three positions with market values 100, 500, 200 render in the desktop table in the order STL(500) → AAPL... i.e. descending order, verifying `app/page.tsx`'s sort is wired correctly (this is the one true "new behaviour" integration point Task 6's own unit test can't cover, since that component trusts its caller's ordering).
- Privacy-toggle tests: still valid conceptually (dollar figures hidden, percentages visible) — update string assertions where formatting changed (e.g. the delta line's exact copy) but keep the masking assertions themselves; add `ThemeProvider` to the wrapping tree alongside the existing `PrivacyProvider` (`DashboardTopBar`/`DashboardShell` need it — default context value works even without it, so this is optional but recommended for realism).

- [ ] **Step 3: Run the full suite**

```bash
npx vitest run
```

Iterate on `app/page.test.tsx` until green. Do not weaken an assertion's intent (e.g. "percentage stays visible under masking") to make it pass — fix the component or the query instead.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/page.test.tsx
git commit -m "feat: wire the redesigned Dashboard (value block, weight sort, new holdings table)"
```

---

### Task 10: `DESIGN.md` updates

**Files:**
- Modify: `DESIGN.md`

DESIGN.md's own rule ("invent no new system — type scale, component library, dark mode — without a concrete need, then flag it here") is being triggered by this milestone. Update, in place:

- [ ] **Step 1:** In "Product and Design Intent → Current visual direction", add a sentence: the Dashboard route now runs a second, parallel visual system (`.cb-dash`: IBM Plex Sans, a structural light/dark palette, dark mode) scoped entirely to `/`; `/holdings` and the setup wizard remain on the original `globals.css` foundation described below until their own redesign milestone.
- [ ] **Step 2:** In "Typography, Spacing and Colour → Unresolved", replace the blanket "Dark mode is not addressed — the palette is light-background only; do not add it opportunistically" with: dark mode now exists, but only inside `.cb-dash` (Dashboard route) via `ThemeContext`; the rest of the app is still light-only pending the wider redesign.
- [ ] **Step 3:** In "States", split the Stale/Unavailable rows to note the Dashboard shows no per-row Retry — one global manual refresh control instead (`PriceRefreshControl`) — while `/holdings` (`PriceCell`) still offers per-row Retry, unchanged.
- [ ] **Step 4:** In "Hard Product Constraints" item 3, append a clause: the Dashboard's pull-based refresh is now one global manual control rather than a per-row Retry button; the underlying rule (pull-based, manual, no auto-refresh, honest freshness) is unchanged.
- [ ] **Step 5:** In "Responsive Behaviour", add a note that the Dashboard route deliberately uses its own single 720px breakpoint and a dual-markup (desktop `table` + mobile `.stack`) responsive technique instead of the shared `.editor-table`/`.cell-label` single-DOM restack — a scoped, deliberate deviation for this milestone, not a change to the shared convention used elsewhere.
- [ ] **Step 6:** In "Deeper References", tweak the `04-BUILD-PLAN-v1.2.md` bullet's "manual Retry" phrase to "manual refresh" if it now reads misleadingly in context (only if it does — leave sentence structure otherwise intact).
- [ ] **Step 7: Commit**

```bash
git add DESIGN.md
git commit -m "docs: record the Dashboard-only visual redesign in DESIGN.md"
```

---

### Task 11: README screenshot + full verification pass

**Files:**
- Modify: `docs/images/dashboard.png` (regenerated)
- No text changes expected in `README.md` (it has no literal "Retry" copy — only the screenshot shows the old per-row control, which is what needs updating).

- [ ] **Step 1:** Start the dev server (`npm run dev`, via the `run` skill / Browser pane — never Bash for a long-running server) with representative demo data (reuse whatever seed/demo data produced the existing `docs/images/dashboard.png`, or seed a small multi-holding portfolio with at least one stale and one unavailable price so the footnote/marker states are visible in the screenshot, matching what the original screenshot documented).

- [ ] **Step 2: Verify against all 12 DONE WHEN criteria**, in-browser:
  1. Frozen direction implemented (visual comparison against the mock).
  2. Semantic colour only on gain/loss/stale; `.value` never coloured; `.delta` colour at weight 400 (inspect computed style).
  3. Hierarchy reads value block → holdings (via Allocation, per existing section order) → allocation recedes visually.
  4. Both timestamps present, correctly ranked (`.asof` full-ink above `.checked` muted).
  5. Zero per-row Retry buttons; one refresh control; click it twice in a row and confirm the second click's "Up to date" status is visible (not silent).
  6. Toggle a holding stale/unavailable (existing scripts under `docs/superpowers/plans/2026-08-26-portfolio-setup-ux.md` describe how) and confirm the marker + muted colour + footnote all render, distinctly from current.
  7. Resize to 375px, 719px, 721px, 1280px — confirm `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at each, and the table/stack swap exactly at 720px.
  8. Toggle OS dark mode (browser emulation) before load — confirm it's picked up; use the manual toggle — confirm it flips instantly; refresh the page — confirm it resets to OS preference (no persistence).
  9. Toggle privacy on both `/` and `/holdings`; on `/`, screenshot/measure a numeric column's width before and after toggling to confirm no shift (Task 2's fix).
  10. (Handled by Task 10.)
  11. `npm test` and `npx tsc --noEmit` both clean (re-run here as the final gate, not just per-task).
  12. Confirm branch is not yet merged (still to come — Task 12).

- [ ] **Step 3:** Screenshot the populated Dashboard at desktop width in light mode, save over `docs/images/dashboard.png` (same crop/aspect convention as the existing file — check its current dimensions first with a quick image read before overwriting).

- [ ] **Step 4: Commit**

```bash
git add docs/images/dashboard.png
git commit -m "docs: refresh the Dashboard screenshot for the visual redesign"
```

---

### Task 12: Branch, push, open PR — STOP before merge

- [ ] **Step 1:** Confirm all work so far happened on a feature branch off `master` (create one now if Task 1 was accidentally started on `master`: `git checkout -b feat/dashboard-visual-redesign`).
- [ ] **Step 2:** Final full-suite run: `npm test` and `npx tsc --noEmit`, both clean.
- [ ] **Step 3:** Confirm `calboard-dashboard-mock-v7.html` is NOT staged/committed (it's gitignored per the existing `.gitignore` entry — verify with `git status`).
- [ ] **Step 4:** Push the branch: `git push -u origin feat/dashboard-visual-redesign`.
- [ ] **Step 5:** Open the PR (`gh pr create`) with a summary covering the 12 DONE WHEN criteria and a test plan checklist matching Task 11 Step 2.
- [ ] **Step 6: STOP.** Do not merge. Report the PR URL and a PASS/FAIL/UNCERTAIN line against each of the 12 DONE WHEN criteria, with evidence, back to the user. Wait for explicit approval before any merge action.

---

## Self-Review Notes

- **Spec coverage:** All 12 DONE WHEN items map to a task — 1 (Tasks 5–9), 2 (Task 8 CSS + Task 9 markup), 3 (Task 9 section order, inherited from existing `T31-1`), 4 (Task 9), 5 (Tasks 3–4), 6 (Task 6), 7 (Task 8's 720px block + Task 11 Step 2.7), 8 (Task 1 + Task 5), 9 (Task 2 + Task 11 Step 2.9), 10 (Task 10), 11 (every task's own test-run step + Task 11 Step 2.11), 12 (Task 12).
- **DO NOT TOUCH coverage:** schema/migrations/ledger untouched (no task modifies `migrations/` or `lib/holdings.ts`/`lib/portfolio.ts` beyond reading); invalid-symbol contract and market data provider untouched (Task 3 only adds a new caller of the existing `upsertLatestPrice`); weight-default sort is implemented (Task 9) without touching `lib/portfolio.ts`'s SQL, so it can't regress `/holdings`; EOD-only/no widgets/no auto-refresh all preserved by construction (no timers anywhere in this plan).
- **NOT IN THIS MILESTONE coverage:** `/holdings` visual treatment is untouched — verified file-by-file in "Out of scope, confirmed unchanged" above; the only shared files touched (`MaskableValue`, `globals.css` append-only, `layout.tsx` provider nesting) are additive/bugfix and don't change `/holdings`' rendered output beyond the digit-masking width fix, which DONE WHEN #9 explicitly asks to verify on both pages.
