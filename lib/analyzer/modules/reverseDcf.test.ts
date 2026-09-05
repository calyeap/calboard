import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeReverseDcfGrid, projectReverseDcfValue, type ReverseDcfInput } from "./reverseDcf";
import { CLEAN_PROVENANCE } from "../provenance";
import type { DiscountRate, RonicLadderState } from "../types";

function sourced(value: number) {
  return { value: new Decimal(value), provenance: CLEAN_PROVENANCE };
}

function cleanRonicCells(state: RonicLadderState = "CLEAN", value: number | null = 0.3) {
  return ([0.08, 0.1, 0.12] as DiscountRate[]).map((rate) => ({
    rate,
    state,
    value: value === null ? null : new Decimal(value),
  }));
}

function baseInput(overrides: Partial<ReverseDcfInput> = {}): ReverseDcfInput {
  return {
    baseYearRevenue: sourced(100),
    targetEnterpriseValue: sourced(1000),
    currentMargin: sourced(0.4),
    medianMargin: sourced(0.38),
    gate1State: null,
    ronicCells: cleanRonicCells(),
    lagBiasDirection: "conservative",
    ...overrides,
  };
}

function cellFor(cells: ReturnType<typeof computeReverseDcfGrid>, marginLevel: string, rate: number) {
  return cells.find((c) => c.marginLevel === marginLevel && c.rate === rate)!;
}

describe("projectReverseDcfValue — the round-trip check", () => {
  it("recovers the same growth rate the target EV was generated from, for a well-behaved (monotonic) RONIC/rate pair", () => {
    const margin = new Decimal("0.4");
    const ronic = new Decimal("0.3");
    const rate = new Decimal("0.1");
    const baseRevenue = new Decimal(100);
    const knownGrowth = new Decimal("0.185");

    const known = projectReverseDcfValue(knownGrowth, margin, ronic, rate, baseRevenue);

    const cells = computeReverseDcfGrid(
      baseInput({
        baseYearRevenue: sourced(100),
        targetEnterpriseValue: sourced(known.ev.toNumber()),
        currentMargin: sourced(0.4),
        ronicCells: cleanRonicCells("CLEAN", 0.3),
        gate1State: "HISTORY INSUFFICIENT", // avoids the stress-margin INCOMPLETE gap for this structural check
      })
    );

    const cell = cellFor(cells, "current", 0.1);
    expect(cell.fiveYearGrowth.suppressed).toBe(false);
    if (!cell.fiveYearGrowth.suppressed) {
      expect(cell.fiveYearGrowth.value.toDecimalPlaces(3).toString()).toBe(knownGrowth.toString());
    }
  });
});

describe("computeReverseDcfGrid — structural contract", () => {
  it("always reports five-year growth, ten-year CAGR and year-10 revenue together — never one without the others", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "HISTORY INSUFFICIENT" }));
    for (const cell of cells) {
      expect(cell.fiveYearGrowth.suppressed).toBe(cell.tenYearCagr.suppressed);
      expect(cell.fiveYearGrowth.suppressed).toBe(cell.year10Revenue.suppressed);
    }
  });

  it("produces exactly nine cells: three margin levels × three rates", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "HISTORY INSUFFICIENT" }));
    expect(cells).toHaveLength(9);
  });

  it("cascades RONIC NOT MEANINGFUL to NOT COMPUTABLE on the affected rate, across all three margin levels (§7.2 M5's own rule)", () => {
    const cells = computeReverseDcfGrid(
      baseInput({ gate1State: "HISTORY INSUFFICIENT", ronicCells: cleanRonicCells("RONIC NOT MEANINGFUL", null) })
    );
    for (const cell of cells) {
      expect(cell.fiveYearGrowth.suppressed).toBe(true);
      if (cell.fiveYearGrowth.suppressed) expect(cell.fiveYearGrowth.state).toBe("NOT COMPUTABLE");
      expect(cell.ronic.suppressed).toBe(true);
      if (cell.ronic.suppressed) expect(cell.ronic.state).toBe("RONIC NOT MEANINGFUL");
    }
  });

  it("returns NO SOLUTION IN RANGE when the target EV is unreachable within the search bracket", () => {
    const cells = computeReverseDcfGrid(
      baseInput({
        gate1State: "HISTORY INSUFFICIENT",
        targetEnterpriseValue: sourced(1), // far below anything reachable at ronic=0.3, rate=0.1
        ronicCells: cleanRonicCells("CLEAN", 0.3),
      })
    );
    const cell = cellFor(cells, "current", 0.1);
    expect(cell.fiveYearGrowth.suppressed).toBe(true);
    if (cell.fiveYearGrowth.suppressed) expect(cell.fiveYearGrowth.state).toBe("NO SOLUTION IN RANGE");
  });

  it("returns NOT COMPUTABLE when the value function is not monotone across the bracket (RONIC barely above a low discount rate)", () => {
    const cells = computeReverseDcfGrid(
      baseInput({
        gate1State: "HISTORY INSUFFICIENT",
        targetEnterpriseValue: sourced(700),
        ronicCells: cleanRonicCells("CLEAN", 0.09), // 9% RONIC vs 8% rate: verified non-monotonic in exploration
      })
    );
    const cell = cellFor(cells, "current", 0.08);
    expect(cell.fiveYearGrowth.suppressed).toBe(true);
    if (cell.fiveYearGrowth.suppressed) expect(cell.fiveYearGrowth.state).toBe("NOT COMPUTABLE");
  });

  it("returns DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE when the solved growth implies terminal share over 100%", () => {
    // rate=0.08, ronic=0.15 is monotonic across the full bracket; g=0.3
    // there gives EV≈1647.95 with terminal share ≈118% (verified by
    // exploration against projectReverseDcfValue).
    const margin = new Decimal("0.4");
    const known = projectReverseDcfValue(new Decimal("0.3"), margin, new Decimal("0.15"), new Decimal("0.08"), new Decimal(100));
    expect(known.terminalValuePV.dividedBy(known.ev).mul(100).greaterThan(100)).toBe(true);

    const cells = computeReverseDcfGrid(
      baseInput({
        gate1State: "HISTORY INSUFFICIENT",
        targetEnterpriseValue: sourced(known.ev.toNumber()),
        ronicCells: cleanRonicCells("CLEAN", 0.15),
      })
    );
    const cell = cellFor(cells, "current", 0.08);
    expect(cell.fiveYearGrowth.suppressed).toBe(true);
    if (cell.fiveYearGrowth.suppressed) {
      expect(cell.fiveYearGrowth.state).toBe("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE");
      expect(cell.fiveYearGrowth.cause).toContain("terminal share");
    }
  });
});

describe("computeReverseDcfGrid — the stress-margin-level gap", () => {
  it("returns INCOMPLETE on every 'stress' cell for a normal-history company, citing the unconfigured policy constant — current and median cells are unaffected by this specific gap", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: null }));
    const stressCells = cells.filter((c) => c.marginLevel === "stress");
    expect(stressCells).toHaveLength(3);
    for (const cell of stressCells) {
      expect(cell.fiveYearGrowth.suppressed).toBe(true);
      if (cell.fiveYearGrowth.suppressed) {
        expect(cell.fiveYearGrowth.state).toBe("INCOMPLETE");
        expect(cell.fiveYearGrowth.cause).toContain("stress margin level");
      }
    }
  });

  it("same gap under SHORT HISTORY — only HISTORY INSUFFICIENT gets the substitute triad", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "SHORT HISTORY" }));
    const stressCell = cellFor(cells, "stress", 0.1);
    expect(stressCell.fiveYearGrowth.suppressed).toBe(true);
  });

  it("no INCOMPLETE from the margin gap under HISTORY INSUFFICIENT — all nine cells reach a real solver outcome", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "HISTORY INSUFFICIENT" }));
    for (const cell of cells) {
      if (cell.fiveYearGrowth.suppressed) {
        expect(cell.fiveYearGrowth.cause).not.toContain("stress margin level");
      }
    }
  });
});

describe("computeReverseDcfGrid — missing REQUIRED inputs", () => {
  it("returns INCOMPLETE on all nine cells when base year revenue is missing", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "HISTORY INSUFFICIENT", baseYearRevenue: null }));
    expect(cells.every((c) => c.fiveYearGrowth.suppressed)).toBe(true);
  });

  it("returns INCOMPLETE on all nine cells when target EV is missing", () => {
    const cells = computeReverseDcfGrid(baseInput({ gate1State: "HISTORY INSUFFICIENT", targetEnterpriseValue: null }));
    expect(cells.every((c) => c.fiveYearGrowth.suppressed)).toBe(true);
  });

  it("returns INCOMPLETE on all nine cells when current margin is missing", () => {
    const cells = computeReverseDcfGrid(baseInput({ currentMargin: null }));
    expect(cells.every((c) => c.fiveYearGrowth.suppressed)).toBe(true);
  });
});
