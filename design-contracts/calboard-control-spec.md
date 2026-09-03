# CALBOARD — CONTROL-LEVEL DESIGN SPECIFICATION

**Status:** Frozen and reconciled against `calboard-holdings-final.html`. Extends the page-level direction frozen in PR #10; does not modify it.

**PRECEDENCE — read this before implementing anything.**

1. `calboard-holdings-final.html` — authoritative rendered `/holdings` reference.
   `calboard-dashboard-final.html` — authoritative rendered `/` reference.
   Page layout, spacing, vertical rhythm and the 1440×900 one-screen target come from the mocks, not from this document. Both mocks are consistent with this specification for every shared control; where they differ on a page-level matter, each mock governs its own page.
2. This document — authoritative reusable control and state rules, applied across all pages.
3. `calboard-control-reference.html` — QA tooling only. Not a BUILD requirement, not a design deliverable.

All earlier `calboard-dashboard-mock-v*.html` and `calboard-holdings-mock-v*.html` files are superseded and deleted. There is exactly one reference per page.

Where a page-specific measurement in a mock differs from a general rule here, the mock wins for that page. The general rule still governs every other page.
**Scope:** Every interactive control in the app, light and dark, all states.
**Excluded by instruction:** Holdings table column layout, widths, horizontal scroll, the mask column-shift.

---

## 0. TOKENS

Existing tokens from the frozen direction, unchanged:

| Token | Light | Dark |
|---|---|---|
| `--ground` | `#F0F0ED` | `#16181A` |
| `--ink` | `#1B1D1F` | `#E9EAE7` |
| `--muted` | `#5A6067` | `#979CA1` |
| `--hairline` | `#DCDCD6` | `#2C2F33` |
| `--gain` | `#1B6B4A` | `#56B98C` |
| `--loss` | `#A3352A` | `#E27A66` |
| `--stale` | `#856713` | `#D9AB45` |

New tokens required for controls. These are additive; nothing above changes.

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--field` | `#F7F7F5` | `#1E2124` | Input and select fill |
| `--line-strong` | `#C6C6BE` | `#3C4045` | Input, select and secondary-button borders |
| `--pri-fill` | `#1B1D1F` | `#3A4046` | Primary button fill |
| `--pri-text` | `#F0F0ED` | `#E9EAE7` | Primary button text |
| `--pri-hover` | `#33373A` | `#474E55` | Primary button fill on hover |
| `--pri-off` | `#DCDCD6` | `#24272A` | Primary button fill when disabled |
| `--cell-line` | `#B0B0A6` | `#4E545B` | Editable table-cell underline |
| `--seg-fill` | `#1B1D1F` | `#33383D` | Active segment fill |
| `--seg-text` | `#F0F0ED` | `#E9EAE7` | Active segment text |

`--hairline` is for structural rules between rows and sections. `--line-strong` is for control edges. Do not substitute one for the other — a control bounded by `--hairline` disappears into the table.

**Dark-mode note on `--seg-fill` and `--pri-fill`:** neither the active segment nor the primary button uses `--ink` as its fill in dark mode. An off-white block becomes the brightest object on the page and reads as an unstyled browser button — this is the white-pill defect. Both use a lift off the ground instead. Measured in the frozen mock: `--pri-fill` dark has relative luminance 0.050 against ink text at 0.819.

`--cell-line` is deliberately stronger than `--line-strong` in both themes. It is the sole affordance that a table cell is editable, so it must survive on a dark ground where `--line-strong` would not.

---

## 1. GLOBAL RULES

These apply to every control and are not restated per control.

**Radius:** `0` on all rectangular controls and containers. The only radius exception is radio controls, which remain circular.

**Shadows:** none. No control casts a shadow in either theme.

**Focus:** `outline: 2px solid var(--ink); outline-offset: 2px;` on `:focus-visible` only.
One ring, one colour, both themes, every control including destructive. `--ink` is near-black on light and off-white on dark, so a single rule is legible in both. Do not tint the focus ring by control type — a red focus ring on Remove would be the only place the focus system varies, for no gain.

**Disabled:** text and icons drop to `--muted`; borders drop to `--hairline`; fills drop to `--hairline`; `cursor: default`; no pointer events on the control's action.
**Do not use `opacity` to express disabled.** Opacity dulls the border, text and fill by different perceptual amounts and produces a different result on each theme. Set the colours explicitly.

**Exception:** controls disabled solely because an action is pending use the Pending specification in §12, which overrides the global Disabled appearance.

**Motion:** `120ms ease-out` on `color`, `background-color`, `border-color` and `outline-color` only. No transform, no scale, no opacity transitions.

**Type:** IBM Plex Sans. Controls use two sizes only — 15px standard, 13px compact. Never uppercase, never letter-spaced.

**Heights:** 34px standard control. 30px for controls sitting inside a table row. Bare icon buttons have no box height.

**Numerals:** any control displaying or accepting a number uses `font-variant-numeric: tabular-nums`.

---

## 1.2 TYPOGRAPHY ROLES

Measured across both routes: every role that appears on both pages already matches exactly. **No value in this table is a change.** The roles are named here because unnamed values are what drift — nothing prevented a fifth size appearing tomorrow.

One family, IBM Plex Sans. Five sizes, two weights, one line-height ratio of 1.5 except the headline.

| Role | Size / weight | Where |
|---|---|---|
| Portfolio headline | `40px` / `500`, line-height `44px` | `/` only. Never coloured — §2.1 of the page direction. |
| Wordmark | `18px` / `500`, `-0.01em` | Both. §1.1. |
| Section heading | `20px` / `500` | Both. Also serves as the page title on `/holdings`. |
| Body and supporting text | `15px` / `400` | Both. The freshness clause of the value line, nav links, table cells. |
| Primary-metric label | `15px` / `500`, ink | `/` only. `Portfolio value` in the value line. Reuses the emphasised-cell weight; introduces no new size. |
| Nav link | `15px` / `400` | Both. §1.1 — declared, never inherited. |
| Table cell, emphasised | `15px` / `500` | Both. Symbol, market value, P&L. |
| Table cell, secondary | `15px` / `400` | Both. Quantity, avg cost, price. |
| Table header | `13px` / `400`, `--muted` | Both. |
| Metadata and status | `13px` / `400` | Both. Section notes, footnotes, field labels, status messages. `/holdings` freshness line. |

`Data checked` is the one exception. On Dashboard it sits inline at the end of the value line, so it takes that line's `15px` and is separated from the market date by `--muted` rather than by size. On `/holdings` it stays at `13px` / `--muted`. See the divergence table in §1.1.

**Primary-metric label.** In `Portfolio value · Prices as of the 29 Aug 2026 close`, `Portfolio value` carries weight 500 and the freshness clause carries weight 400. Both stay at 15px in full `--ink`.

The freshness clause is **not** dropped to `--muted`. Setting the market date in full ink beside the value is a load-bearing decision from the frozen page direction — grey small text reads as "ignore me," and this date qualifies the headline number. Weight, not colour, separates label from metadata here.

**This applies to Dashboard only.** The value block is three elements: the merged label-and-freshness line, the value, the delta. `checked` is part of the first line and is held apart by `--muted`, not by size. On `/holdings` there is no headline number for the market date to qualify, so a full-ink 15px line there labels nothing and reads as a heading; that route merges at 13px `--muted` instead. See the divergence table in §1.1.

**Deliberate role collision:** the `/holdings` page title and its section headings are both `20px / 500`. They are the same role. Dashboard has no page title — it opens on the portfolio value — so a distinct page-title role would exist on one route only and be used once. Collapsing them is the smaller and more honest choice. Do not introduce a separate page-title size.

Anything needing a size outside this table is a gap in the table, not a licence to invent one. Raise it rather than adding a value locally.

---

## 1.1 SHARED CHROME — FROZEN VALUES, SINGLE SOURCE

Every value below is identical on Dashboard and `/holdings`. **Implement from this table, not by reading either mock.** Values inferred from two mocks diverge; that is what produced the nav displacement defects on `feat/holdings-control-direction`.

### Container

| Property | Value |
|---|---|
| `.wrap` max-width | `1080px` |
| `.wrap` horizontal padding, desktop | `32px` |
| `.wrap` horizontal padding, ≤720px | `20px` |
| `margin` | `0 auto` |

`.wrap` **bottom** padding is page-specific and deliberately differs — see the divergence table below.

### Top bar

| Property | Desktop | ≤720px |
|---|---|---|
| `.topbar` padding | `24px 0 0` | `24px 0 0` |
| `.topbar` display | `flex`, `align-items:center`, `justify-content:space-between` | same |
| `.topbar` gap | `24px` | `24px` |
| `.topbar` flex-wrap | not set | `wrap`, `row-gap: 12px` |
| `.topbar` border / fill | none, in either theme | none |

The top bar sits inside the content column on both pages. It never spans the viewport, never carries a bottom rule, and never carries a fill.

### Brand

| Property | Value |
|---|---|
| `font-size` | `18px` |
| `font-weight` | `500` |
| `letter-spacing` | `-0.01em` |
| `white-space` | `nowrap` |

**Wordmark option A — scale step — is selected and frozen.** The mark is 18px against 15px nav links; hierarchy comes from size alone. Nothing is added to the bar: no logo, no icon, no colour, no divider, no extra letter-spacing, and the bar height and nav positions are unchanged at 54px and y=24 on both routes.

### Nav

| Property | Desktop | ≤720px |
|---|---|---|
| `.nav` gap | `20px` | `14px` |
| `.nav` display | `flex`, `align-items:center` | same |
| `.nav a` font-size | `15px` — declared explicitly, never inherited | `15px` |
| `.nav a` font-weight | `400` | `400` |
| Inactive | `--muted`, no underline | same |
| Active | `--ink`, `1px` underline, `text-underline-offset: 5px` | same |
| Hover | `--ink`, no underline added | same |

`.nav a` font-size must be declared. Leaving it to inherit from `body` produces the same rendered size today but breaks the moment the body scale changes on one page only.

### Icon controls in the bar

Per §6.1: all bare, 30×30 hit target, no border in any state. Privacy then theme, in that order, on both pages.

### Focus

`outline: 2px solid var(--ink); outline-offset: 2px;` on `:focus-visible`, identical on both pages. Declared once, globally.

### Deliberate divergences — do not "fix" these

These differ by design. A future reader finding them should leave them alone.

| Property | Dashboard | `/holdings` | Why |
|---|---|---|---|
| Table sort order | Weight | Alphabetical | See §8.2. |
| Freshness line | One line on the value label: date at `15px` ink, `checked` clause `--muted` | One line at `13px` / `--muted` beneath the title | Both routes merge the market date and `checked` into a single line. They merge in opposite directions. On Dashboard the date qualifies the headline number directly beneath it and must stay full ink, so `checked` rises to meet it and is separated by colour. `/holdings` has no headline number, so nothing anchors the line at ink and the whole thing sits at metadata weight. See §1.2. |

Those are the only page-level divergences. Vertical rhythm is shared — see below.

### Vertical rhythm — shared, both routes

| Property | Value |
|---|---|
| Top bar bottom → first content text | `56px` |
| First content block padding-top | `56px` (`.valueblock` on `/`, `.pagehead` on `/holdings`) |
| `.section` padding-top | `24px` |
| `.section + .section` padding-top | `64px` |
| `.wrap` bottom padding | `96px` desktop, `72px` ≤720px |

**These were previously recorded as deliberate divergences. That was wrong.** Holdings carried `14px`, `22px` and `12px` because it had been compacted to land on an exact 900px one-screen target, and the leftover values were then written up as intentional. Rendered side by side, Holdings read as cramped against the nav while Dashboard did not — a 42px mismatch on the first gap alone. The justification did not survive contact with the running pages.

**The exact-pixel one-screen target is withdrawn.** The requirement is now: the `/holdings` desktop workflow should fit **approximately one viewport** at 1440×900. It is a guide, not a gate. Do not trim shared rhythm values to satisfy it — cross-page consistency outranks it. Anything that cannot be met without breaking shared rhythm is a content problem, not a spacing problem.

Anything in the shared table above that differs between the two pages is a defect. Anything in this divergence table that is made to match is also a defect.

---

## 2. BUTTONS

### 2.1 Primary — `Save`, `+ Add holding`

Height 34px · padding `0 16px` · 15px / weight 500 · no border.

| State | Light | Dark |
|---|---|---|
| Default | fill `#1B1D1F`, text `#F0F0ED` | fill `#3A4046`, text `#E9EAE7` |
| Hover | fill `#33373A` | fill `#474E55` |
| Active | fill `--pri-fill`, no other change | same |
| Focus | default fill + global focus ring | same |
| Pending | fill `--pri-fill`, text `--pri-text` — see §12 | same |
| Disabled | fill `#DCDCD6`, text `--muted` | fill `#24272A`, text `--muted` |

**Never use `--ink` as the dark-mode primary fill.** Use `--pri-fill`. An off-white primary button on a dark ground is the white-pill defect and is the specific failure this specification exists to prevent. The primary button must remain clearly stronger than any secondary control and clearly weaker than body text.

There is exactly one primary button per page region. `Save` on Holdings is primary. `+ Add holding` is primary **within the Add-a-holding form only** — it is the form's submit, not a page-level action.

### 2.2 Secondary — `Change date`, step and edit buttons

Height 34px · padding `0 14px` · 15px / weight 400 · `1px solid var(--line-strong)` · fill transparent.

| State | Both themes |
|---|---|
| Default | border `--line-strong`, text `--ink` |
| Hover | border `--muted`, text `--ink` |
| Active | border `--ink` |
| Focus | border unchanged + global focus ring |
| Disabled | border `--hairline`, text `--muted` |

Secondary buttons never take a fill in any state. Hover is communicated by the border darkening only.

### 2.3 Destructive — `Remove`

Two forms. Both are destructive; the form depends on available width, not on page.

**Text form** — Setup Wizard, and Holdings below the 720px breakpoint.
Height 30px · padding `0 12px` · 13px / weight 400 · `1px solid var(--hairline)` · fill transparent.

| State | Light | Dark |
|---|---|---|
| Default | border `--hairline`, text `--ink` | border `--hairline`, text `--ink` |
| Hover | border `--loss`, text `--loss` | border `--loss`, text `--loss` |
| Active | border `--loss`, text `--loss` | same |
| Focus | default colours + global focus ring | same |
| Disabled | border `--hairline`, text `--muted` | same |

**Icon form — Holdings desktop table only.** A bare × in a 40px action column, no box in any state, 30×30 hit target, icon 16px, `stroke-width: 1.5`. Colour `--muted` at rest, `--loss` on hover and active, global focus ring on focus.

The icon form is required on the Holdings desktop table because a text button needs roughly 90px in a column that does not have it — that is what clipped `Remove` to `Remo` behind a horizontal scrollbar. Below 720px the text form returns, where there is room.

Accessibility for the icon form is not optional: each × carries a per-symbol `aria-label` and matching `title`, e.g. `Remove VOO`. An unlabelled × is not an acceptable implementation.

**Red appears on intent, not at rest,** in both forms. A filled red control repeated down every row puts six or seven red blocks on a page where red already means "this position is losing money." That dilutes the loss signal, which the frozen direction protects. The control still reads as destructive the moment the cursor lands on it, which is when the user needs to know.

Destructive actions are never primary-filled anywhere in the app.

---

## 3. TEXT INPUTS

Height 34px · padding `0 10px` · 15px / weight 400 · `1px solid var(--line-strong)` · fill `--field` · text `--ink` · placeholder `--muted`.
Inputs inside a table row: height 30px, otherwise identical.

| State | Both themes |
|---|---|
| Default | border `--line-strong`, fill `--field` |
| Hover | border `--muted` |
| Focus | border `--muted` + global focus ring |
| Disabled | border `--hairline`, fill `--ground`, text `--muted` |
| Error | border `--loss`, fill `--field` |

**Numeric inputs** (`Quantity`, `Average cost`): `appearance: none` on the spinner, `-webkit-appearance: none` on `::-webkit-outer-spin-button` and `::-webkit-inner-spin-button`. Spinner arrows are browser chrome, render differently per engine, and are the wrong affordance for a quantity you type once. Right-align numeric input text to match the columns they feed. `tabular-nums` on.

**Error message — standard form inputs:** 13px / weight 400 / `--loss`, placed directly below the input, `6px` gap. Text only — no icon, no fill, no banner.

This rule governs form inputs outside the editable Holdings table — the Add-a-holding fields, `Recording as of`, and every Setup Wizard field. **Errors inside the editable Holdings table follow §3.1 instead**, because a 13px message with a 6px gap does not fit a 48px row.

**Do not use a red fill for error.** A tinted field is a panel, and the direction has no panels.

### 3.1 Editable table cells — Holdings `Quantity` and `Avg cost`

Not a box. A single underline, and nothing else.

Full width less a 20px left inset · `border-bottom: 1px solid var(--cell-line)` · no top, left or right border · fill transparent · right-aligned · `tabular-nums` · `line-height: 1.1` · padding `0 0 1px`.

| State | Both themes |
|---|---|
| Default | underline `--cell-line` |
| Hover | underline `--muted` |
| Focus | underline `--ink` + global focus ring at `outline-offset: 3px` |
| Error | underline `--loss` |
| Masked | underline `--hairline`, text `--muted`, `readonly` |

**The 20px left inset is load-bearing.** Without it the Quantity underline runs to its column edge and meets the Avg cost underline, and the two fuse into what reads as a single table rule rather than two fields. Measured separation in the frozen mock is 20px. Do not remove the inset to gain width.

Numeric spinners are suppressed as in §3. No filled input boxes appear inside a Holdings table row at any width above the breakpoint.

**Row validation message.** Rows stay 48px whether or not an error is present. The message is absolutely positioned within its own cell so it cannot change row height or shift a neighbouring column.

- 11px / weight 400 / `--loss` / `line-height: 1`
- Right edge aligned exactly with the input's underline
- `2–4px` below the underline
- Clear of the row separator

Measured in the frozen mock: underline at 33.25px from row top, message 2.25px below it, 1.5px clear of the 48px separator, right edges matched, Quantity and Avg cost sharing a top edge.

**Do not create room by growing the row, by moving the input in the errored cell only, or by moving Quantity.** Nudging one input breaks the Quantity/Avg-cost top alignment; that approach was tried, measured at a 4px offset, and rejected. The room comes from the input's own `line-height` and padding, which apply to every cell equally.

---

## 4. SELECTS — `Asset type`, and the `Change date` trigger

Box identical to a text input in every dimension, colour and state, plus:

- `appearance: none` — the native control is the single worst-looking element in the current build and must not survive.
- Right padding `32px` to clear the chevron.
- Custom chevron: inline SVG, 10px wide, `stroke: currentColor`, `stroke-width: 1.5`, `fill: none`, positioned `12px` from the right edge, vertically centred, colour `--muted`.
- Chevron follows the text colour on hover and disabled — it darkens to `--ink` on hover, drops to `--muted` on disabled.

States are exactly the text-input table in §3. There is no separate open state — see §9.

**`Change date` is not a select.** Verified against source (`app/holdings/HoldingsEditor.tsx`). It is a disclosure button that reveals a native `<input type="date">`. See §12.

---

## 5. SEGMENTED CONTROL — `By holding` / `By asset class`

Wrapper: `1px solid var(--line-strong)`, fill transparent, no radius, no gap between segments, no divider rule between segments.
Wrapper total height 30px. Segments: height 28px · padding `0 12px` · 13px / weight 400. The 28px + 1px borders = 30px total is deliberate: it matches the section title's line box so the control cannot stretch a section head (§8.3).

| Segment state | Light | Dark |
|---|---|---|
| Active | fill `--seg-fill`, text `--seg-text` | fill `--seg-fill`, text `--seg-text` |
| Inactive default | fill none, text `--muted` | fill none, text `--muted` |
| Inactive hover | text `--ink` | text `--ink` |
| Focus (either) | current colours + global focus ring, offset `2px`, permitted to overlap the wrapper border | same |
| Disabled (whole control) | border `--hairline`, all text `--muted`, active segment fill `--hairline` | same |

Exactly one segment is active at all times. There is no unselected state for the control as a whole.

---

## 6. ICON BUTTONS

**Every icon control in the app is bare.** No icon button carries a border, a box or a fill in any state, in either theme. This covers the privacy toggle, the theme toggle, the refresh control and the Holdings desktop Remove ×.

An earlier revision of this specification made the privacy toggle the sole bordered icon control, on the reasoning that a stated product guarantee should look heavier than a preference. That was superseded during the rendered Holdings review and is no longer in force. Do not reintroduce a box on any icon control.

### 6.1 Bare icon button — all icon controls

No box, no border, no fill, in any state. Icon 16px for privacy, theme and Remove; 14px for refresh. Hit target 30×30 with the visual remaining borderless.

| State | Both themes |
|---|---|
| Default | icon `--muted` |
| Hover | icon `--ink` |
| Active | icon `--ink` |
| Focus | icon `--ink` + global focus ring |
| Disabled | icon `--hairline` |

The Remove × is the one exception to the colour table above: `--muted` at rest, `--loss` on hover and active, per §2.3.

The privacy toggle is discoverable through position and state, not through a box. It sits in a fixed top-bar position identical on both pages, its glyph changes with state, and when values are hidden the masking is visible on the page itself. The page reports the state; the control does not have to carry extra visual weight to do it.

### 6.2 Icon state changes

Both toggles swap their glyph and their `aria-label` together:

- Privacy: eye ↔ eye-with-slash · `Hide values` ↔ `Show values`
- Theme: moon ↔ sun · `Switch to dark mode` ↔ `Switch to light mode`
- Refresh: circular arrow, no state swap · `Refresh prices`

`aria-pressed` on the privacy toggle only. The theme toggle is a mode switch, not a pressed state.

### 6.3 Privacy masking behaviour

Verified against `MaskableValue.tsx`. This is existing product behaviour, not a design decision, and must not be altered.

- Each digit is replaced by `•` (U+2022). Signs, thousands separators and decimal points are preserved, so no column changes width.
- Masked: **Quantity, Avg cost, Market value, Unrealised P&L.**
- **Never masked: Price.** It is public market data.
- Masked cell inputs become `readonly` and carry `aria-label="hidden"`.
- Icon and `aria-label` change with state: eye ↔ eye-off, `Hide values` ↔ `Show values`.

---

## 7. NAV LINKS — `Dashboard`, `Holdings`

15px / weight 400.

| State | Both themes |
|---|---|
| Inactive | text `--muted`, no underline |
| Inactive hover | text `--ink`, no underline |
| Active | text `--ink`, `1px` underline, `text-underline-offset: 5px` |
| Focus | current colours + global focus ring, offset `3px` |
| Visited | identical to inactive |

**Hover must not add an underline.** The underline is the sole carrier of "you are here"; adding it on hover makes every link look active under the cursor.

---

## 8. CONTAINER AND HEADER DECISIONS

### 8.1 Top bar — DECIDED: inside the content column

The top bar sits inside the same `1080px` max-width column as all page content, with the same `32px` gutters. It spans the content column, not the viewport.

The bar has **no bottom border and no fill** in either theme. It is separated from the content below by whitespace only.

**Holdings must be changed to match. Dashboard is already correct.**

Reasoning: a full-viewport bar is a panel, and the direction has no panels. It also breaks the alignment the whole page is built on — with a full-bleed bar, the brand sits at the viewport edge while `Portfolio value`, the table's first column and every section heading sit at the 1080px column edge. Two competing left margins on one page is the exact kind of unresolved detail this milestone exists to eliminate.

### 8.2 Table header — DECIDED: hairline label row

Column headers in **both** tables:

- 13px / weight 400 / `--muted`
- Sentence case. Not uppercase, not letter-spaced.
- No fill in any state
- No bold, no white text
- `1px solid var(--hairline)` beneath the header row
- Alignment matches the column beneath it: text columns left, numeric columns right

**Holdings must be changed to match. Dashboard is already correct.**

Reasoning: the grey block with bold white text is a filled container — again, a panel. It also inverts the hierarchy. Column headers are metadata that you read once and then stop seeing; the values are the content. Giving the headers the heaviest treatment on the page makes the labels louder than the data they label.

Header cells are not interactive and take no hover or focus state in either table. Sorting is not a user-facing control anywhere in the app.

**The two tables do not share a sort order, and this is deliberate.**

- **Dashboard** sorts by weight. Weight-default position sort is an anti-momentum constraint: it keeps the largest positions at the top and prevents the page from being reordered by price movement.
- **`/holdings` sorts alphabetically by symbol.** Holdings is an editor. Weight is derived from quantity × price, so a weight sort would reorder rows while the user is typing into them. Alphabetical order is stable under edit.

Neither order is configurable. Do not add a sort control to either table, and do not "harmonise" the two orders — they answer different requirements.

### 8.3 Section heads — one pattern, both pages

Every section head in the app is a single flex row carrying its own bottom rule. Heading on the left, optional control or note on the right, `1px solid var(--hairline)` beneath the whole row.

- The rule is a `border-bottom` on the **row**, never on the heading element and never on a sibling.
- **One rhythm, measured and shared:** `align-items: center`, `padding-bottom: 16px`. Row height 47px, section title bottom to rule 17px, identical on every section head on both routes. Verified on all four heads — `Holdings`, `Allocation`, `Positions`, `Add a holding`.
- `align-items` is `center`, not `baseline`. Baseline alignment lets a control taller than the title's line box hang below it and stretch the row, which is what made `Allocation` 3.5px taller than every other section head.
- **A control placed in a section head must not exceed the title's 30px line box.** The segmented control is sized to exactly 30px for this reason — see §5. Any future section-head control obeys the same ceiling.
- The row spans the full content column. A rule that begins after the heading text, or part-way across a table, means the rule was attached to the wrong element.
- Any control that belongs to a section — the allocation view toggle, a "sorted by" note — sits **inside** that row, not as a sibling beside it. A control placed as a sibling collapses the row to the width of its heading and the rule stops spanning.
- Totals or summary rows beneath a table follow the same principle: the rule spans the full table width, not the width of the cells that happen to carry content. **This explicitly includes Dashboard's `Total (priced)` row in the allocation legend.** A rule that begins where the first populated cell begins is the same defect as a heading rule that begins after the heading text.

This applies identically on Dashboard and `/holdings`. There is no page-specific variant.

Both frozen references implement this. Measured: `Holdings` and `Allocation` section heads on `calboard-dashboard-final.html` each span the full 1016px content width in both themes, rule present at 1px.

---

## 9. DATE CONTROL — `Change date` and the as-of date input

**Verified behaviour** (`app/holdings/HoldingsEditor.tsx`, `lib/ledger/setupAccount.ts`):

- `asOfDate` initialises to today and is capped at today (`max={localTodayIso()}`) — future dates are rejected.
- On save it is passed to `updateHoldingsAction({ asOfDate, holdings })` and becomes `tradeDate` in the ledger.
- The button is a disclosure: it reveals the date input, then unmounts itself and cannot be dismissed.
- Changing the date calls `clearSaveState()`, discarding any visible save result.

It sets the effective date of the edit being saved. It does not load or browse history. The label `Change date` describes a filter and is misleading — see §16.

**Disclosure button:** §2.2 Secondary, unchanged.

**Date input:** the §3 text-input box in every dimension, colour and state, plus:

- `appearance: none` on `::-webkit-calendar-picker-indicator` is **not** applied — the indicator is the only affordance that a calendar is available.
- Indicator colour follows `--muted`, darkening to `--ink` on hover, matching the select chevron in §4.
- The field's own text uses `tabular-nums`.
- Error state per §3, message per §13.

**APPROVED: the disclosure button is deleted and the date input is permanently visible.**

Implement as a labelled `Recording as of` field sitting beside `Save`, per `calboard-holdings-final.html`. The `Change date` disclosure button is removed from `/holdings` entirely.

Reasoning on record: the button's only job was to reveal another control, it was a one-way door with no way back, and `asOfDate` is load-bearing on every save — a value that always affects the outcome should always be visible. The label `Change date` also described a filter, which is not what the control does.

The §2.2 Secondary treatment remains in force for `Change date` wherever the disclosure pattern still exists outside `/holdings`.

---

## 10. ADD A HOLDING — form section — DECIDED

The browser-default `fieldset` and notched `legend` are removed entirely.

- No container border, no background fill, no radius, no shadow, no `<legend>` visual.
- `Add a holding` becomes a section heading: 20px / weight 500 / `--ink`, matching `Holdings` and `Allocation`.
- Section spacing on `/holdings` is taken from `calboard-holdings-final.html`, which is authoritative for that page and for the 1440×900 one-screen target. **Do not implement a 64px gap on `/holdings`** — the frozen mock uses tighter measured values to meet the one-screen target without shrinking type or row height. The 64px rhythm remains the default for pages the mock does not cover.
- A single `1px solid var(--hairline)` rule beneath the heading, matching §8.2 — this is the existing hairline language, not a new device.
- Field labels: 13px / weight 400 / `--muted`, `6px` above their input, left-aligned to the input's left edge.
- Vertical gap between fields: 16px. Between the last field and its submit button: 24px.
- Fields are left-aligned to the page column, not centred, not full-width. Input width is set by content type, not by container.

The markup may remain a `fieldset` for grouping semantics. Only its default visual language is removed.

**Disabled fieldset:** `SetupWizard` disables an entire `fieldset` (`modeLocked`). When a fieldset is disabled, every control inside it takes its own §1 disabled treatment. The group itself gains no additional indicator — no fill, no border change, no overlay.

---

## 11. STATUS MESSAGES — DECIDED

Source uses four variants (`status-msg`, `status-success`, `status-danger`, `status-warning`) with `role="status"`, `role="alert"` and `aria-live` already in place. The accessibility layer exists; only the appearance is unspecified.

All four are text only. **No container, no toast, no banner, no fill, no icon, no border.**

| Variant | Colour | Role in source | Persistence |
|---|---|---|---|
| Success | `--gain` | `role="status"` | Until the next edit clears it |
| Danger | `--loss` | `role="alert"` | Until resolved or another attempt |
| Warning | `--stale` | `role="status"` / `role="alert"` | Until the condition clears |
| Neutral | `--muted` | `role="status"` | Transient |

Shared: 13px / weight 400 / `6px` gap from the element it describes.

**Placement is by association, not by page position:**

- **Save feedback** sits immediately below the `Save` button, left-aligned to it. Not above, not beside, not at page top.
- **Field errors** sit immediately below their input (§3).
- **Row-level notes** sit inside the row they concern.

Success is quiet by design — same size and weight as a field label, distinguished only by colour. A save that worked does not need to announce itself; it needs to be confirmable.

Danger persists. It does not fade, auto-dismiss, or clear on a timer. The source already clears it on the next edit or attempt via `clearSaveState()`, which is the correct trigger.

**No new notification system.** Nothing here introduces a component that did not already exist in markup.

---

## 12. PENDING STATE — buttons

Source has two: `{saving ? "Saving…" : "Save"}` and `{retrying ? "Retrying…" : "Retry"}`. Neither had a visual specification.

While pending, a button:

- keeps its default fill, border and text colour — it does **not** take the disabled treatment
- is `disabled` in markup to block a second submit
- shows its own pending label with a horizontal ellipsis character (`…`, U+2026), not three periods
- shows no spinner, no progress bar, no animation

**Pending is not disabled.** A greyed button says "you cannot do this." A pending button says "this is happening." Applying `--muted` to a button the user just pressed reads as rejection.

Buttons must not resize between states. Reserve the pending label's width so `Save` → `Saving…` does not shift the layout.

---

## 13. RADIO GROUP — `How are you entering cost?`

Found in `SetupWizard`. Absent from the supplied inventory and from every prior design session.

Control: 16×16px · `appearance: none` · `border-radius: 50%` — the only radius exception in the system, because a square radio is unreadable as a radio.

| State | Both themes |
|---|---|
| Unchecked | `1px solid var(--line-strong)`, fill `--field` |
| Unchecked hover | border `--muted` |
| Checked | border `--ink`, fill `--field`, centred 8px `--ink` dot |
| Focus | current colours + global focus ring, offset `2px` |
| Disabled unchecked | border `--hairline`, fill `--ground` |
| Disabled checked | border `--hairline`, dot `--muted` |

Label: 15px / weight 400 / `--ink`, `8px` from the control, vertically centred, wrapped in `<label>` so the text is clickable. Disabled label drops to `--muted`.

Options stack vertically with a 10px gap. They do not sit inline — the current inline arrangement makes the association between control and label ambiguous when labels differ in length.

---

## 14. CONTROLS FOUND IN SOURCE THAT WERE NOT IN THE INVENTORY

Verified by inspecting every `.tsx` file under `app/`. Three routes exist: `/`, `/holdings`, `/accounts/new`.

| # | Control | Location | Status |
|---|---|---|---|
| 1 | Nav links | `NavBar.tsx` | Specified §7 |
| 2 | Bare icon button — privacy toggle | `DashboardTopBar.tsx`, `HoldingsTopBar.tsx` | Specified §6.1 — shipped |
| 3 | Bare icon button | `PriceRefreshControl.tsx` | Specified §6.2 |
| 4 | Numeric input spinners | Holdings, SetupWizard | Specified §3 |
| 5 | Inline error message | Throughout | Specified §11 |
| 6 | Date disclosure + date input | Holdings, SetupWizard | Specified §9 |
| 7 | Add-a-holding fieldset | Holdings, SetupWizard | Specified §10 |
| 8 | Four-variant status messages | Holdings | Specified §11 |
| 9 | Pending button state | `Save`, `Retry` | Specified §12 |
| 10 | Radio group | `SetupWizard.tsx` | Specified §13 |
| 11 | Disabled fieldset | `SetupWizard.tsx` | Specified §10 |
| 12 | Retry button | `PriceCell.tsx` | **Removed from `/holdings` — approved.** Replaced by the global refresh control |
| 13 | Step navigation buttons | `SetupWizard.tsx` | §2.2 Secondary |
| 14 | Per-holding Edit button | `SetupWizard.tsx` | §2.2 Secondary |
| 15 | Per-holding Remove button | `SetupWizard.tsx` | §2.3 Destructive |

**Two findings that go beyond styling:**

**A third page exists.** `/accounts/new` (`SetupWizard.tsx`) holds 11 buttons, 6 inputs, a select, a radio group and a fieldset. It has appeared in no design session and has no page-level direction. Every control on it is now covered by this specification, so it can be styled consistently — but its layout, hierarchy and step structure are undecided. See §15.

**The privacy toggle is a shipped icon control.** It is implemented in the active top bars — `DashboardTopBar.tsx` on `/` and `HoldingsTopBar.tsx` on `/holdings`. The eye / eye-off glyph treatment described in §6.1 and §6.2 is current shipped behaviour, not a proposal: the glyph swaps with state, `aria-label` and `title` swap alongside it, and `aria-pressed` is present and required. The bare-icon zero-border rule in §6.1 applies to it in full, on both routes, in both themes, in every state.

`NavBar.tsx` is **not** the active implementation. Its `Show values` / `Hide values` text button is dead code, unreferenced by any route, and is queued for removal. Do not treat it as the shipped privacy control.

*Corrected at source. An earlier revision of this section described the toggle as text and the icon as proposal-only. That text was contradicted by both frozen mocks and by the verified state of `feat/holdings-control-direction`, and it caused a scope ruling that briefly excluded the privacy toggle from zero-border verification.*

---

## 15. REMAINING UNDECIDED — with honest classification

**Genuinely OS or browser controlled — not Calboard decisions:**

1. **Native select dropdown list.** Once open, the option list is drawn by the operating system. Not stylable from CSS. A styled alternative means building a custom listbox, which is a component decision with real accessibility cost, not a styling choice.
2. **Native date-picker calendar panel.** Same constraint. The trigger and field are specified; the popup is not ours.

**Not OS-controlled, and I am naming them rather than filing them as browser limitations:**

3. **Setup wizard page-level direction — classified LATER.** Every control on `/accounts/new` is specified, so no implementer has to invent a control appearance. Its layout, step hierarchy and section rhythm remain undecided. This is a classified backlog item, not a pending decision and not a blocker for the Holdings milestone.
4. **Invalid-symbol message copy** for `resolved` / `unknown` / `unsupported` / `unavailable`. Product copy governed by the invalid-symbol contract, not a design decision. Not blocking — §11 specifies the treatment; only the words are open.
5. **Nothing.** The two behaviour changes previously listed here — per-row Retry removal and the permanently visible `Recording as of` field — are both approved and specified in §9 and §14. Neither is pending.

---

## 16. CONFIRMATIONS REQUESTED

**Every interactive control found in the app is covered — CONFIRMED.**
Verified by enumerating every `<button>`, `<input>`, `<select>`, `<label>`, `<fieldset>`, `<legend>` and link across all three routes and every component under `app/`. Fifteen distinct controls, all specified. Eleven were absent from the supplied inventory.

**Nothing requiring implementation-level design judgement remains — CONFIRMED WITH ONE EXCEPTION.**
Every control has a defined appearance in both themes with all states. The exception is the setup wizard's page-level layout (§15.3), which is outside a control-level milestone by your own scope boundary. Flagging it rather than silently claiming completeness.

**Remaining undecided items are genuinely OS/browser-controlled — PARTIALLY CONFIRMED.**
Two are (§15.1, §15.2). Two are not, and are named explicitly rather than disguised as browser limitations: the Setup Wizard's page direction, classified LATER, and the invalid-symbol copy, which is product copy rather than design. Neither blocks implementation. There are no pending behaviour decisions.

---

## 17. IMPLEMENTATION CHECKLIST

- [ ] Nine control tokens per theme, including `--pri-fill` and `--cell-line` (§0)
- [ ] `:focus-visible` ring applied globally, no per-control variants (§1)
- [ ] No `opacity`-based disabled states anywhere (§1)
- [ ] `Save` and `+ Add holding` primary; step and edit buttons secondary (§2)
- [ ] Dark primary uses `--pri-fill` `#3A4046`, never `--ink` (§2.1)
- [ ] `Remove` red on hover only, never at rest — bare × with per-symbol label on Holdings desktop, text form below 720px (§2.3)
- [ ] Editable cells are 20px-inset underlines; row errors 11px, 2–4px below the underline, rows stay 48px (§3.1)
- [ ] Spinner arrows suppressed on all numeric inputs (§3)
- [ ] `appearance: none` on `Asset type` with custom chevron (§4)
- [ ] Segmented control active fill differs by theme (§5)
- [ ] Every icon control bare — no box on the privacy toggle (§6.1)
- [ ] Privacy masks Quantity, Avg cost, Market value and P&L; Price never masked (§6.3)
- [ ] `Change date` disclosure deleted, `Recording as of` permanently visible beside Save (§9)
- [ ] Per-row Retry removed from `/holdings`, global refresh control in its place (§14)
- [ ] `/holdings` spacing taken from `calboard-holdings-final.html`, not the 64px default (§10)
- [ ] Nav hover does not add an underline (§7)
- [ ] Holdings top bar moved inside the 1080px content column (§8.1)
- [ ] Holdings table header changed from grey block to hairline label row (§8.2)
- [ ] Calendar indicator retained on date inputs (§9)
- [ ] Fieldset and legend visuals removed on both Holdings and SetupWizard (§10)
- [ ] Four status variants styled as text only, placed by association (§11)
- [ ] Pending buttons keep default colours and reserve their label width (§12)
- [ ] Radio group restyled, stacked vertically (§13)
- [ ] SetupWizard controls restyled to match — page layout unchanged, classified LATER (§14, §15.3)

Nothing in this checklist touches Holdings column layout, widths or horizontal scroll.

---

## 18. POST-IMPLEMENTATION VISUAL VERIFICATION — DESIGN GATE

Scoped to `feat/holdings-control-direction`. This gate does not reopen any item classified LATER.

### Ownership

After BUILD implements the corrected files and before Calvin's browser review, the implementation returns to **DESIGN** for visual verification against the frozen contract.

Calvin's manual review is the final product sanity check. It is not where routine visual defects should first surface. Anything measurable against this specification is DESIGN's to catch.

### The frozen contract

Verification is against these three files and nothing else:

- `calboard-holdings-final.html`
- `calboard-dashboard-final.html`
- `calboard-control-spec.md`

**No md5 is printed here for any of the three.** The spec's own hash cannot be, because printing it changes it. The two mocks' hashes are omitted for a related reason: a mock is corrected at source whenever this gate returns DESIGN contract drift, so any hash printed here is guaranteed to go stale — and a stale hash inside the section that enforces hash discipline is worse than no hash at all. That has already happened once.

Command Center records the delivered md5 of all three files when it routes the set. BUILD and DESIGN confirm against that record, not against a hash printed inside the file they are hashing.

If BUILD's implementation was made against different md5s, verification stops and reports that before anything else.

### What DESIGN needs to perform it

DESIGN cannot reach a local dev server. Verification requires one of:

- computed-style and bounding-box measurements captured from the running branch at the widths below, or
- screenshots at each width and theme, plus the rendered CSS for the shared-chrome selectors.

**Screenshots alone are not sufficient** for shared chrome, section rules or masking. Those are sub-pixel and behavioural. If only screenshots arrive, DESIGN reports what it can verify and names what it could not, rather than inferring a PASS.

### Coverage — both routes, both themes, three widths

Routes: `/` and `/holdings`. Themes: light and dark. Widths: **1440** desktop, **720** breakpoint boundary, **390** narrow.

That is 12 combinations. Every item below is checked in each where applicable.

**Shared chrome** — against §1.1, measured, not eyeballed. `.topbar` padding, `.nav` gap at both breakpoints, `.nav a` font-size declared not inherited, brand size/weight/letter-spacing, `.wrap` max-width and horizontal padding, `.topbar` wrap and row-gap at ≤720px. Nav top edge and brand left edge must be identical across the two routes at the same width.

**Deliberate divergences** — against the §1.1 divergence table. These must still differ. A build that made them match is a defect in the opposite direction.

**Section rules** — against §8.3. Every section head rule spans the full content column; every totals rule spans the full table width, including Dashboard's `Total (priced)`.

**Controls** — against §2 to §7 and §12 to §13. Primary fill by theme, never `--ink` in dark. Segmented active fill lifted in dark, never off-white. All icon controls bare, zero border in every state. Remove red on hover only. Editable cells inset underlines, never boxes. Focus ring identical everywhere on `:focus-visible`.

**Masking** — against §6.3. Quantity, Avg cost, Market value and P&L masked; **Price visible**. Signs and separators preserved. Icon and `aria-label` swap with state.

**Holdings-specific** — 48px rows with and without a validation error, Quantity and Avg cost sharing a top edge, row error 2–4px below the underline and clear of the separator, no horizontal scroll at 390px. The one-screen target is approximate and is **not** a gate condition; do not FAIL on page height.

### Return format

**PASS** — implementation matches the approved design. State what was measured and at which widths.

**FAIL** — one entry per mismatch:

- **Item** — the property or behaviour
- **Expected** — the value in the contract, with its section reference
- **Actual** — the measured value, with route, theme and width
- **Classification** — one of:
  - **BUILD implementation drift** — the contract is correct and the build deviates. Goes back to BUILD.
  - **DESIGN contract drift** — the contract is wrong, ambiguous, or silent on something the build had to decide. Goes back to DESIGN, and the spec or a mock is corrected at source before BUILD touches it again.

The classification is required on every entry. "It looks wrong" without a contract reference is not a finding — it is either a contract gap, which is DESIGN's, or a LATER item, which is out of scope for this gate.

### Out of scope for this gate

Wordmark selection. Bar composition below the measured 404–416px minimum. Donut colour split and the position-4 palette swap. `Total (priced)` redesign — rule behaviour only. Setup Wizard layout. Holdings column layout and widths. The mask column-shift. All are LATER and must not be raised as FAIL entries here.
