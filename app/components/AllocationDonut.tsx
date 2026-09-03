"use client";

import { useState } from "react";
import type { AllocationResult } from "@/lib/allocation";
import { MaskableValue } from "./MaskableValue";
import { usePrivacy } from "./PrivacyContext";

// Decorative only — allocation is never communicated through colour alone
// (every value is text in the legend). Swatches are aria-hidden. Two
// separate palettes, via CSS custom properties so dark mode (.cb-dash
// [data-theme="dark"]) swaps them automatically — deliberately excludes
// green/red/amber, reserved for gain/loss/stale.
//
// By-holding and by-asset-class are deliberately different colour families
// (control-spec §0): colour encodes rank position, not identity, so a
// shared palette would make the same hue point at different things across
// the toggle. The six-value categorical palette is for By holding; the
// four-value slate ramp is for By asset class.
const SWATCHES_HOLDING = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--a5)", "var(--a6)"];
const SWATCHES_CLASS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];

const SIZE = 160;
const STROKE = 22;
const R = (SIZE - STROKE) / 2;
const C = SIZE / 2;

// A small static, accessible donut for the populated Dashboard.
//   - allocates by holding/symbol using priced market value only;
//   - the centre shows the exact priced portfolio total (same value the
//     Dashboard shows as "Portfolio Value");
//   - the SVG is hidden from assistive tech: the <table> legend carries the
//     complete equivalent information (symbol, allocation %, USD market
//     value) for every included holding, plus the priced total.
export function AllocationDonut({
  allocation,
  allocationByAssetClass,
}: {
  allocation: AllocationResult;
  // Optional: when given, a By holding / By asset class toggle appears.
  // Both results come from the SAME computeAllocation calculation
  // (lib/allocation.ts) — only how positions were grouped before calling it
  // differs, so no allocation math lives in this component.
  allocationByAssetClass?: AllocationResult;
}) {
  const [view, setView] = useState<"holding" | "class">("holding");
  const active = view === "class" && allocationByAssetClass ? allocationByAssetClass : allocation;
  const { hidden } = usePrivacy();
  const SWATCHES = view === "class" ? SWATCHES_CLASS : SWATCHES_HOLDING;

  if (!active.hasAllocation) {
    return (
      <section className="dashboard-section allocation">
        <div className="sechead">
          <h2>Allocation</h2>
        </div>
        <p className="dashboard-note">
          Allocation isn&apos;t available yet — no holding has a usable market price.
        </p>
      </section>
    );
  }

  const { entries, totalUsd } = active;

  // Cumulative offset (in percent units) for each segment. On a
  // pathLength=100 circle the stroke starts at 3 o'clock going clockwise;
  // strokeDashoffset = 25 - offset shifts the visible dash to begin at
  // 12 o'clock and then advance per segment. Number is fine here — this is
  // geometry, not money.
  let offset = 0;

  return (
    <section className="dashboard-section allocation">
      <div className="sechead">
        <h2>Allocation</h2>
        {allocationByAssetClass && (
          <div role="group" aria-label="Allocation view" className="toggle">
            <button type="button" aria-pressed={view === "holding"} onClick={() => setView("holding")}>
              By holding
            </button>{" "}
            <button type="button" aria-pressed={view === "class"} onClick={() => setView("class")}>
              By asset class
            </button>
          </div>
        )}
      </div>
      <div className="allocation-layout">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle cx={C} cy={C} r={R} fill="none" stroke="var(--hairline)" strokeWidth={STROKE} />
          {entries.map((e, i) => {
            const seg = e.percentNumber;
            const dashoffset = 25 - offset;
            offset += seg;
            return (
              <circle
                key={e.symbol}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                stroke={SWATCHES[i % SWATCHES.length]}
                strokeWidth={STROKE}
                pathLength={100}
                strokeDasharray={`${seg} ${100 - seg}`}
                strokeDashoffset={dashoffset}
              />
            );
          })}
          <text x={C} y={C - 3} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
            US${hidden ? "••••" : totalUsd}
          </text>
          <text x={C} y={C + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">
            priced total
          </text>
        </svg>

        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.15rem 0.75rem 0.15rem 0" }}>Holding</th>
              <th style={{ textAlign: "right", padding: "0.15rem 0.75rem" }}>Allocation</th>
              <th style={{ textAlign: "right", padding: "0.15rem 0 0.15rem 0.75rem" }}>Market value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.symbol}>
                <td style={{ padding: "0.15rem 0.75rem 0.15rem 0" }}>
                  <span
                    data-swatch
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      marginRight: 6,
                      background: SWATCHES[i % SWATCHES.length],
                      verticalAlign: "middle",
                    }}
                  />
                  {e.symbol}
                </td>
                <td style={{ textAlign: "right", padding: "0.15rem 0.75rem" }}>{e.percent}%</td>
                <td style={{ textAlign: "right", padding: "0.15rem 0 0.15rem 0.75rem" }}>
                  US$<MaskableValue>{e.marketValueUsd}</MaskableValue>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
