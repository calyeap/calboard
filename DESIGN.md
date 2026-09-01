# Calboard — Design & UX Entry Point

Read this before any visual or interaction change. It **summarises and indexes** the
authoritative documents in [Deeper References](#deeper-references); it does not replace
them. Where this file and a spec disagree on intent, the spec wins and this file
should be fixed.

**Labels.** **Durable** — holds across milestones; changing it is a product decision.
**Current convention** — how the app is built today; reuse it unless there is a
concrete reason not to, then update this file. **M1-specific** — a consequence of what
V1 builds now; must not harden into a permanent rule. **Unresolved** — a known gap;
do not invent a system to close it as a side effect of other work. Conventions
**asserted by tests** (`app/page.test.tsx`, `HoldingsEditor.test.tsx`,
`SetupWizard.test.tsx`) are flagged inline — changing one is a behavioural change.

## Product and Design Intent

**What Calboard is.** A private, single-user portfolio **monitoring** tool. V1 shows
one combined portfolio of equities and selected crypto held elsewhere: value,
holdings, cost basis, unrealised gain/loss, allocation, data freshness. The user's
trading app is the system of record; Calboard never executes trades.

**How it should feel.** Calm, professional, restrained, information-focused, highly
scannable. Functional before decorative — a quiet reference instrument, not a
dashboard competing for attention. The design should let a check-in *end*, not extend
it. **Calboard describes; it never prescribes** — no suggested actions, no
buy/sell/hold framing, no causal explanation of a price move, no advice. State what is
true and stop. (`CRITICAL §0.2`.)

**Current visual direction.** Backed by `app/globals.css` (*"a foundation, not a
design system"*) and the Task 28–32 UI pass. Restrained and utilitarian: plain
background, near-black text, hairline borders, generous vertical rhythm; native
tables, short labelled sections; one accent, the solid dark `.button-link`.
System-native throughout — `system-ui` fonts, native controls, native `<table>`
semantics, **no component library and no CSS framework**. The restraint is the
design, not an unfinished state.

**Dashboard-only v2 (2026-09-01).** The Dashboard route (`/`) now runs a second,
parallel visual system, scoped entirely under a `.cb-dash` wrapper
(`DashboardShell`): IBM Plex Sans, a structural light/dark palette (`--ground`,
`--ink`, `--muted`, `--hairline`, plus `--gain`/`--loss`/`--stale` and a six-value
`--a1..--a6` allocation palette), and a manual light/dark toggle (`ThemeContext`,
same session-only shape as `PrivacyContext`). The value figure is `.value`, not
`.pv-amount`. **Holdings control-direction pass (2026-09-01).** `/holdings` now runs the
same class of parallel visual system, scoped under `.holdings-chrome`
(`HoldingsShell` + the new `HoldingsTopBar`), covering both themes from the
start. `/accounts/new` (`SetupWizard.tsx`, still on the original foundation
and suppressing nav entirely rather than rendering `NavBar` — see
`app/accounts/new/page.tsx`) remains untouched — its own pass is a later,
separately classified milestone. With `/holdings`' move off it, `NavBar.tsx`
is now unreferenced by any route (see the note near "Number-presentation
parity" below).

## Hard Product Constraints

From the specs, not taste; several are enforced in code and tests. Unless a clause
says otherwise each is **durable** — breaching one is out of scope until the product
decision is reopened deliberately.

1. **Never a trading or gamified-finance product.** No gainers/losers panel, no
   "% below 52-week high", no streaks, no engagement mechanics or nudges, no
   celebratory treatment of gains, no manufactured urgency, no "you haven't checked in"
   pull, no return-pull notifications.
2. **Price movement is never the anchor.** A day-move figure may exist as a *column*;
   never the default sort, never the largest element, never what the eye lands on
   first. The specified default position sort is **portfolio weight**, never
   percentage change. (`PRD §9`, `TDD §6.3`: "enforced, not stylistic".) The
   Dashboard now implements this: `app/page.tsx` sorts `getPortfolioView()`'s
   positions by descending market value before rendering the Holdings table and
   the allocation legend — `lib/portfolio.ts`'s own SQL order stays alphabetical
   (`/holdings`' pre-fill still reads it directly and must not reorder).
3. **Prices are pull-based, end-of-day / delayed, and freshness is shown truthfully.**
   Prohibited unless separately authorised: live streaming, tick-by-tick values,
   continuous background polling, uncontrolled repeated provider requests, and ever
   presenting a delayed price as live. Current implementation is pull-based — a
   displayed price changes because a scheduled job ran or the user refreshed.
   **On the Dashboard, per-row Retry is gone**, replaced by one global manual
   refresh control (`PriceRefreshControl` / `refreshAllPricesAction`) beside "Data
   checked" — still pull-based, still manual-only, never a timer; `/holdings` (`PriceCell`) now matches: per-row Retry is gone there too, replaced
   by the same `PriceRefreshControl` / `refreshAllPricesAction` pattern beside its
   own "Data checked" line. **Unresolved, not
   foreclosed:** a *controlled* freshness policy — one refresh attempt when the
   Dashboard is opened, freshness-aware caching, transparent degraded states. The
   durable part is the honesty rule; the wider refresh mechanism is still
   undefined. (`CRITICAL §0.2`; `TRD §3.3`: no real-time data, no websockets.)

   **Approved behaviour change #2 — `/holdings`' as-of-date field is now
   permanently visible.** The old "Change date" disclosure button — which,
   once clicked, could never be dismissed again — is gone. The as-of-date
   field, relabelled "Recording as of," is now always shown in
   `HoldingsEditor.tsx`'s save row. The underlying `asOfDate` state, its
   default to today (`localTodayIso()`), its max-today cap, and how it
   becomes `tradeDate` on Save are all unchanged — this was a UI-only
   change.
4. **No portfolio performance chart or return time series — outside M1 and M1.1, not
   forbidden forever.** V1 shows current market value, current unrealised gain/loss
   vs. cost basis, and day movement where available — nothing else. Snapshot data
   cannot honestly support MWR/TWR/IRR or a value-over-time line, and the UI must not
   appear to offer them. **This is a scope boundary, not a permanent prohibition:** a
   performance view is a future product candidate needing its own approved milestone
   and a financially credible methodology (deposits/withdrawals, snapshot gaps,
   missing or stale prices, equities and crypto, benchmark meaning, return-period
   meaning). No commitment that it will be built. (UX design §9.1 and its 2026-08-29
   supersession note.)
5. **No implementation vocabulary in the UI** ("cutover", "opening import",
   "ADJUSTMENT", "cash effect", "account", "source", "broker"). Neutral
   snapshot/portfolio language only.
6. **V1 has no user-facing cash, multi-account, broker/source or SGD.** The headline
   metric is **Portfolio Value**, never "Net Worth". (UX design §10 — settled.)
7. **Decoration must earn its place.** No decorative cards, elevation, shadows, toasts
   or motion by default; add one only where it solves a concrete hierarchy, feedback
   or interaction problem better than the restrained default. The current app uses none.
8. **No new visual identity, brand palette or illustration style.** Branding polish is
   deferred (UX design §10) — a scope decision, not a promise Calboard never has an
   identity, but never acquired incidentally.

## Durable UX Principles

- **Trust and clarity first.** Every figure is interpretable at a glance; prefer less
  shown clearly over more shown ambiguously. Nothing is added because space is
  available — empty space is an acceptable outcome.
- **Financial-data integrity.** Never silently understate a number. Disclose an
  incomplete total (e.g. a holding with no price) beside it, with a **persistent
  visible note** — not a tooltip or footnote — wherever a number structurally
  understates risk or completeness.
- **One figure, one computation.** A number shown twice is the same computed value
  passed through, never independently recomputed — two totals that can disagree
  destroy trust faster than one missing total. (The donut centre reuses the exact
  Portfolio Value.)
- **Provenance and freshness are honest; degraded is never confusable with clear.**
  Stale data renders visibly degraded (a marker dot plus muted `--stale` colour, the
  as-of date in a tooltip and named in a page-level footnote), never as fresh;
  unavailable data says so; failure is a named state, not a blank. "We couldn't get
  this" must read as distinct from "there is nothing to report". (`PRD §14 D4`.)
- **Dates are labelled by what they mean** — never conflated, never a bare timestamp:
  the **confirmation time** of the last successful Save ("Holdings last updated"), the
  **as-of date** the figures represent, and a **price date**.
- **Status is never carried by colour alone** — wording plus a non-colour cue.
- **Empty states are designed, not errors** — well-composed, one clear next action,
  neutral plain copy. Say what actually happened; if an outcome is genuinely
  uncertain, say that — never reuse "nothing was saved" for an unknown result.
- **Do not silently discard valid visible user input;** keep **staged vs. saved**
  distinguishable — drafts are disposable, entered values survive a validation
  failure. **Destructive discard is confirmed; nothing else is** — abandoning unsaved
  work asks first, ordinary saves and edits never interrupt.
- **User-effort discipline.** Pre-fill what is known; compute rather than ask; never
  ask twice; no mandatory free-text except a transaction reversal reason.
- **USD is the money of record.** Any secondary or approximate monetary figure is a
  render-time decoration: labelled approximate, visually subordinate, never able to
  block a page or raise an error by its absence. (`TRD §3.4`.)

## Hierarchy and Layout

**Current convention.**

- **Shell:** `.page-shell` — centred, `max-width: 900px`; `.page-shell--narrow`
  (`640px`) for focused single-task flows (the setup wizard, which also hides the nav).
- **Top of page:** one `<h1>` naming the screen or step, then labelled `<section>`s
  with an `<h2>` each; first-child top margin reset so screens don't jump.
- **Dashboard order** (also the narrow-screen reading order): portfolio summary +
  freshness/health → allocation → holdings detail. Change only as a deliberate
  hierarchy decision.
- **Rhythm hooks:** `.dashboard-section`, `.dashboard-note` (both still used, restyled
  under `.cb-dash` on the Dashboard; unchanged on `/holdings`). The Dashboard's value
  figure hook is now `.value` inside `.valueblock`, not `.pv-amount` (still defined in
  `globals.css` but no longer referenced — nothing currently reuses it). **Wizard:**
  `.wizard-section`, a plain-text `Step N of 2` (`.wizard-step`), `.wizard-actions`.
- **One dominant primary action per screen** — add a competing primary only where the
  workflow requires it.

**M1-specific.** Three surfaces only: Dashboard (`/`), Holdings (`/holdings`), setup
wizard (`/accounts/new`, a legacy path — nothing user-facing says "account"). The
wider IA in the specs (Transactions, Accounts, Watchlist, Events, Settings,
Data-health; a 3-zone Dashboard) is **M2+ and not yet built**.

## Typography, Spacing and Colour

**Current convention.** Reference the semantic tokens in `globals.css` (colour,
`--space-sm/md/lg`, `--radius`); do not hard-code values in components. Body
line-height `1.5`; headings `1.25`.

**Unresolved — do not invent a system to close these.** No named type scale outside
`.cb-dash` (sizes are ad-hoc per component — match nearby usage). One deliberate
hard-coded colour pair remains, neither tokenised nor contrast-audited:
`.button-link`'s `#111111`/`#ffffff`. `AllocationDonut.tsx`'s `SWATCHES` now
reference the `.cb-dash` `--a1..--a6` tokens instead of hardcoded hex — inert outside
`.cb-dash` (the custom properties don't resolve there), so `/holdings` never renders
this component today; if it ever does, it needs its own swatch source. **Dark mode now exists in two scoped systems: `.cb-dash` (Dashboard) and
`.holdings-chrome` (Holdings)** — both full token systems covering every control in
both themes, sharing the same `ThemeContext`. Only the setup wizard (`/accounts/new`)
and the shared, now-unreferenced `NavBar` remain light-only/untouched. Do not extend
dark mode elsewhere opportunistically; that's a deliberate future decision. Inline
`style={{…}}` and ad-hoc greys survive in `HoldingsEditor` and `PriceCell` — not a
pattern to expand. Prefer a
token-backed class in `globals.css` for anything new or reused.

**Number-presentation parity (found 2026-09-01, not fixed here).** `/holdings`'
Market value and Unrealised P&L columns render as bare numbers — no `$`, no
`+`/`-` sign — unlike `/`'s identical columns, which have both. Neither route
uses thousands separators on monetary values (`/`'s portfolio value reads
`US$74946.23`, not `US$74,946.23`). Both are pre-existing, not introduced by
this pass; grouped here as one deliberate follow-up (a small, separate PR),
not patched ad hoc as a side effect of unrelated work.

**`NavBar.tsx` is currently unreferenced by any route (2026-09-01).** The
Dashboard uses `DashboardTopBar`, `/holdings` uses `HoldingsTopBar`, and
`/accounts/new` (`SetupWizard.tsx`) suppresses nav entirely rather than
rendering `NavBar` — see `app/accounts/new/page.tsx`. Only `NavBar.test.tsx`
still renders it directly. It is kept only because deleting it wasn't asked
for; do not cite it as still in use by `/accounts/new` or anywhere else.

**`retryPriceFetchAction` is unreachable from any UI (2026-09-01, not fixed
here).** `app/actions/prices.ts`'s `retryPriceFetchAction` was `PriceCell`'s
per-row Retry handler before Approved Behaviour Change #1 removed that
button; nothing calls it now except its own test (`prices.test.ts`). Not
deleted — logged here for a future cleanup pass.

## Navigation, Controls and Forms

**Current convention.**

- **Nav** (`.site-nav`, `NavBar.tsx`): wordmark then plain text links, **underlined at
  rest** — the underline is the affordance (hover-only fails on touch).
- **Buttons:** primary CTA is `.button-link`; otherwise native
  `<button type="button">`, the row's main action gets `.primary` and a secondary
  action sits beside it without competing. Request-triggering buttons are **disabled
  while in flight** with progress text.
- **Feedback is inline and in place** — no toast layer, no bespoke modal/dialog layer,
  no overlays, no spinners. The one modal is a native `window.confirm` guarding
  discard of unsaved wizard input; a custom modal system is the boundary — not
  acceptable.
- **Forms:** controlled `"use client"` components that call a Server Action and render
  its **structured result** — never a throwing `<form action>`. Ticker-lookup
  resolution is announced through one `aria-live` polite/atomic region. There is no
  "Add anyway" override: identity and price are resolved separately, so a symbol whose
  identity resolves still reaches the normal Add control even if its price is
  momentarily unavailable; a symbol that never resolves cannot be added at all
  (test-asserted). Save outcomes are distinct, each with its own copy
  (`saved` / `failed` / `unknown` / `unreachable`), persisting until the next real save.
  **Entered values survive a validation failure**; staged work says so in plain words
  ("Nothing has been saved yet.").

**Durable rule.** Calboard must not silently ignore or discard valid, visible user
input. Staged and saved states must be clear.

### Unresolved UX finding — "Add" vs. page-level "Save"

In the `/holdings` editor a user filled a valid **Add a holding** form (ticker
resolved, quantity and average cost entered) but pressed the page-level **Save**
without first pressing **+ Add holding**. Save acted only on the already-added rows,
ignored the pending input, and returned to the Dashboard without the new holding —
valid, visible input silently dropped. Recorded as an **open issue**, not an
authorised change; it sits against the two durable rules above. Do not prescribe or
implement a fix as part of unrelated work.

## Tables and Financial Data

**Current convention.**

- Native `<table>`s with real `<thead>`/`<th>` on desktop. Legacy presentational
  `border`/`cellPadding` attributes remain, neutralised by the restack CSS — don't
  copy them into new markup.
- **Responsive restack (test-asserted):** wrap the table in `.editor-table`; give each
  body `<td>` a leading real-text `<span class="cell-label">Label</span>` (real DOM
  text, not CSS `::before`). Below the narrow breakpoint each row becomes a bordered
  labelled block — one DOM, one set of controls, no separate mobile table.
- **Number formatting:** quantities 4 dp, money 2 dp, percentages parenthesised; a
  detail row and its aggregate are computed and formatted identically; a missing or
  n/a value renders an em dash `—`, never blank, never `$0.00`.
- **Incomplete totals are disclosed, not hidden** — a holding with no price is excluded
  from Portfolio Value and a `.status-msg .status-warning` line names how many and says
  the true value is higher.
- **Allocation** is fully conveyed by the text legend (symbol, %, USD) plus its priced
  total; the donut SVG is `aria-hidden` and adds nothing beyond it.

**Rule — semantic financial colour (durable).** Colour may reinforce meaning but never
carry it alone. Positive/negative values may use restrained success/danger colour
where it improves scanning, provided the sign, wording or another non-colour cue
carries the same meaning. Not currently used; no colour change is being made now.

**Unresolved — currency prefix and numeric alignment.** The money prefix is
inconsistent (`US$`, `$`, or none, depending on the component) and numeric columns are
left-aligned with proportional figures, so values don't line up for down-column
comparison. Worth fixing as **one deliberate formatting decision**, not patched ad hoc.

**M1-specific.** No day-price-movement column — the provider interface exposes no
prior close, so there is nothing honest to render; when one arrives, Hard Constraint 2
governs. `getPortfolioView()`'s underlying SQL order is still **alphabetical by
symbol** (`ORDER BY primary_symbol`) — the Dashboard now sorts by portfolio weight
client-side after fetching (Hard Constraint 2), but `/holdings`' pre-fill reads the
same query directly and is still alphabetical; no user-facing sort control on either
route. No sector/historical allocation; no per-broker view.

The control-level spec (`calboard-control-spec.md` §8.2) states "holdings sort by
weight, fixed" as if this already applied everywhere — it does not on
`/holdings`, deliberately: weight is derived from quantity × price, and
resorting an editor mid-edit as the user types would be actively hostile.
This is a spec inaccuracy to correct at the source, not a behaviour this app
should adopt.

## States

Reuse these treatments; do not invent new visual language for them. `.status-msg`
carries a colour-independent left border, so a feedback line never reads as ordinary
body text even without colour.

| State | Current treatment |
|---|---|
| **Loading / pending** | In-place text on the triggering control ("Saving…", "checking…"); control disabled. No spinners or overlays. |
| **Empty** | A short line stating the situation plus one primary `.button-link` action. Deliberate, not an error. |
| **Success** | `.status-msg .status-success`, `role="status"`, plain past-tense copy ("Holdings updated."). |
| **Error** | `.status-msg .status-danger` (block) or `.status-danger` (inline in a cell), `role="alert"`; wording names the specific problem; field errors also mark the field. |
| **Stale** | Value gets a small `.marker` dot plus `--stale` colour; the reason ("Priced at DATE close") is in a `title` tooltip, never visible "(as of DATE)" text. A page-level footnote also names every affected symbol, on both routes. Refresh via the shared `PriceRefreshControl` / `refreshAllPricesAction` pattern beside each route's "Data checked" line. Never shown as current. |
| **Unavailable** | Same `.marker` + `--stale` treatment, value shown as `—`; reason ("No price available") in a `title` tooltip; excluded from totals, named in the same page-level footnote on both routes. |
| **Uncertain** | `.status-msg .status-warning`, honest "we couldn't confirm / couldn't reach the server" copy; persists until the next real attempt. |
| **Staged (pending removal)** | The row dims, inputs disable, derived figures show `—`, the action flips Remove → **Undo**. Nothing is written until Save. |

## Responsive Behaviour

**Current convention.** Read paths are mobile-first and work down to a narrow phone
width; entry paths may be desktop-optimised but must stay usable narrow (`PRD §14 D5`).
UI-pass acceptance widths: **1280 / 640 / 375 px**. At every width the page must not
scroll horizontally (`documentElement.scrollWidth <= documentElement.clientWidth`) —
long unbroken tokens wrap, they never widen the page (verified in-browser). One
breakpoint today, `@media (max-width: 640px)`, with the `.editor-table` /
`.cell-label` restack as the single responsive mechanism.

**M1-specific — not permanent law.** The number of breakpoints and the 640px value are
implementation choices; add one when a layout needs it, deliberately, and update this
file. Durable: read paths usable on mobile, one DOM not a duplicated mobile tree,
never a sideways scroll.

**Dashboard-only deviation (2026-09-01).** The Dashboard route deliberately uses its
own single `@media (max-width: 720px)` breakpoint and a dual-markup responsive
technique — a desktop `table.holdings` and a mobile `.stack` of `.hrow` cards, both
generated from one data pass in `DashboardHoldingsTable` and toggled by CSS
`display`, not the shared `.editor-table`/`.cell-label` single-DOM restack. This is a
scoped, deliberate choice for the frozen mock direction, not a change to the shared
convention `/holdings` and the wizard still use. The durable rule above (never a
sideways scroll) still holds — verified at 375 / 719 / 721 / 1280 px.

**Holdings control-direction deviation (2026-09-01).** `/holdings` also moved to
a single `@media (max-width: 720px)` breakpoint, but — unlike Dashboard —
kept the single-markup `.editor-table`/`.cell-label` restack instead of adding
a second `.stack` card markup: `HoldingsEditor.test.tsx`'s existing T30-3 test
requires exactly one DOM copy of every editable control and the Remove action,
which the authoritative mock's dual-markup approach would have duplicated.
Same outcome (no sideways scroll, Remove always reachable), different
mechanism, deliberately, because of that pre-existing test contract.

## Accessibility

Every UI change must still satisfy all of these:

- [ ] **Visible keyboard focus** on every interactive element (`:focus-visible` is
      global — do not remove it).
- [ ] **DOM order == reading order == tab order.**
- [ ] **No status by colour alone** — wording and a non-colour cue always present
      (`.status-msg`'s left border is that cue for block messages).
- [ ] **Native semantics** where they exist (`<button>`, `<label>`, `<table>`/`<th>`);
      no ARIA that duplicates native/real-text meaning.
- [ ] **Async feedback** via a polite, atomic `aria-live` region, override controls
      outside it. **Errors** use `role="alert"`; advisory notes `role="status"`.
- [ ] **Inputs labelled**; errors wired with `aria-invalid` + `aria-describedby`;
      restacked cell labels create no confusing duplicate accessible names.
- [ ] **Decorative visuals** are `aria-hidden` with a complete text/data equivalent
      nearby.
- [ ] **No horizontal overflow** at 375 / 640 / 1280 px.

## Creating or Changing UI

1. **Inspect first** (the component, `globals.css`, neighbouring patterns), then check
   the Hard Product Constraints before changing *what* is displayed rather than *how*.
2. **Check whether a test asserts the structure you are changing** (`.editor-table` /
   `.cell-label` ordering, live-region placement, status semantics) — if so it is a
   behavioural change, not a restyle.
3. **Preserve existing patterns** (tokens, shells, `.status-*`, `.editor-table`, the
   form/Server-Action shape); smallest coherent change, no drive-by restyling; invent
   no new system (type scale, component library, dark mode) without a concrete need,
   then flag it here. If a change would make Calboard feel more like a trading or
   gamified product, stop.

**Review gate.** Run the [Accessibility](#accessibility) checklist; re-check every
[Hard Product Constraint](#hard-product-constraints), [Durable UX
Principle](#durable-ux-principles) and [State](#states) the change touches; confirm
hierarchy, token-based spacing/colour, responsive behaviour and financial-data trust
still hold.

## Deeper References

- **`docs/superpowers/specs/2026-08-26-portfolio-setup-ux-design.md`** — the V1 UX
  decision log (Revision 3, final). Governs current V1: IA, nav, empty states, wizard
  flow, price/data-health states (§8), performance scope (§9.1 and its 2026-08-29
  supersession note), vocabulary; §10 lists settled decisions.
- **`docs/superpowers/plans/2026-08-26-portfolio-setup-ux.md`** — architecture
  constraints and the "UI-pass extension" appendix (Task 31 & 32 contracts).
- **`docs/spec/01-PRD-v1.2.md`** (§9 ranking, §14 provenance/error states/UX, §15–17
  budgets and acceptance) · **`00-CRITICAL-REVIEW-v1.2.md`** (§0.2 "don't become a
  trading app", §0.7 limitation notices) · **`03-TDD-v1.2.md`** (§6.3 enforced
  presentation, §13 components) · **`02-TRD-v1.2.md`** (§3.3 EOD-only / no websockets,
  §3.4 SGD decoration) · **`04-BUILD-PLAN-v1.2.md`** (M1 completion-boundary note:
  pull-based prices, manual Retry).
- **`app/globals.css`** — source of truth for token values and shared CSS (the
  original foundation, plus the `.cb-dash` Dashboard-v2 tokens appended below it).
- **`docs/superpowers/plans/2026-09-01-dashboard-visual-redesign.md`** — the
  Dashboard-only v2 redesign: frozen direction, file structure, and the
  `.cb-dash` scoping rationale summarised throughout this section.

### Spec errors found during the 2026-09-01 control-direction build

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

> **Warning — older specs describe more than the current app.** `PRD §5/§9` and
> `TDD §13` name routes, components (`ValueHeader`, `ConcentrationPanel`,
> `ProvenanceChip`, `AttentionQueue`) and a 3-zone Dashboard that are **M2+ targets,
> not built**. The app today is Dashboard + Holdings + setup wizard. Where a spec and
> the Portfolio Setup UX Revision 3 doc disagree about V1, Revision 3 governs; where a
> spec states an M2+ *behavioural* constraint (ranking, no real-time streaming, no
> prescriptive copy, limitation notices, truthful freshness), that constraint governs
> whenever the feature lands.
