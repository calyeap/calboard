import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { assembleAnalysisResult } from "../assemble";
import { formatUsd } from "../factDisplay";
import { ALL_SUPPRESSING_STATES } from "../stateCatalogue";
import { MSFT_FIXTURE } from "../fixtures/msft";
import { OKLO_FIXTURE } from "../fixtures/oklo";
import { buildSlotCatalogue, buildFactSlotCatalogue } from "./slots";

// The catalogue is the whole of what [C] may reference. Anything absent from
// it cannot reach the page, because traceability.ts refuses an unknown slot —
// so what this file asserts is the boundary of §8.3 limit 3.

const msft = assembleAnalysisResult(MSFT_FIXTURE);
const oklo = assembleAnalysisResult(OKLO_FIXTURE);

describe("buildSlotCatalogue — H4, no uncomputed terminal share reaches [C]", () => {
  // CB-AUDIT-01 H4: assemble.ts's terminal-diagnostics fallback (fired on
  // every current run, since no fixture supplies a real terminalValuePv)
  // built a full TerminalDiagnostics literal — terminalShareOfValue: 0,
  // terminalFcfConsistencyApplied: true — that looked exactly like a real
  // computed M8 result. That fabricated 0 then reached [C]'s slot catalogue
  // as if it were a genuine "share of value sitting in the terminal period".
  // Neither MSFT nor OKLO has ever computed a real terminal share, so [C]
  // must never be handed one for either.
  it("never exposes diagnostics.terminal.terminalShareOfValue to [C], for either fixture, while no real terminal PV is supplied", () => {
    expect(MSFT_FIXTURE.terminalValuePv).toBeNull();
    expect(OKLO_FIXTURE.terminalValuePv).toBeNull();
    expect(buildSlotCatalogue(msft).has("diagnostics.terminal.terminalShareOfValue")).toBe(false);
    expect(buildSlotCatalogue(oklo).has("diagnostics.terminal.terminalShareOfValue")).toBe(false);
  });
});

describe("buildSlotCatalogue", () => {
  it("holds the run's price", () => {
    const catalogue = buildSlotCatalogue(msft);

    expect(catalogue.get("price")?.formatted).toBe(`$${msft.price.value.toFixed(2)}`);
  });

  it("holds every acquired fact that has a value, keyed by its fact id", () => {
    const catalogue = buildSlotCatalogue(msft);
    const factsWithValues = msft.facts.filter((f) => f.value !== null);

    expect(factsWithValues.length).toBeGreaterThan(0);
    for (const fact of factsWithValues) {
      expect(catalogue.has(`facts.${fact.id}`)).toBe(true);
    }
  });

  it("renders a fact through the same display rule the fact card uses (ruled 8 September 2026)", () => {
    const catalogue = buildSlotCatalogue(msft);
    const margin = msft.facts.find((f) => f.id === "current-operating-margin");

    // Acquisition holds the exact figure — 0.46780818408927220731 — and the
    // ruling separates that from what is shown. A [C] sentence substituting
    // the raw Decimal would put a twenty-decimal margin on the page, which is
    // the form the ruling exists to prevent, arriving through a new door.
    expect(margin).toBeDefined();
    expect(catalogue.get(`facts.${margin!.id}`)?.formatted).toBe("46.8%");
  });

  it("states a computed aggregate at the same magnitude a fact of the same size gets", () => {
    // A report cannot carry two money conventions. The first real MSFT run
    // printed "$67.0B" in a challenger finding and "$66987000000" in an
    // interpretation statement — the same quantity, because the fact slots go
    // through the 8 September display rule and the computed ones did not.
    const catalogue = buildSlotCatalogue(msft);
    const cashFcf = msft.diagnostics.fcf.cashFcf;

    expect(cashFcf.suppressed).toBe(false);
    expect(catalogue.get("diagnostics.fcf.cashFcf")?.formatted).toBe(
      formatUsd((cashFcf as { value: Decimal }).value)
    );
    // A per-share figure keeps its cents — it is read against a quote.
    expect(catalogue.get("price")?.formatted).toBe(`$${msft.price.value.toFixed(2)}`);
  });

  it("exempts only the frozen state vocabulary from the figure scan — never a company figure", () => {
    // This is what keeps traceability's scope narrowing from being a permit
    // list. The guard removes the formatted value of every SUPPRESSED slot
    // before scanning, so that set must contain nothing but state names: if a
    // suppressed slot could ever carry a company figure, exempting it would
    // hand the model a way to write one.
    //
    // ALL_SUPPRESSING_STATES is checked against the SuppressingState union in
    // both directions at compile time, so a new exempt string cannot appear
    // without a state being added to the analyzer's own vocabulary.
    for (const result of [msft, oklo]) {
      const exempt = [...buildSlotCatalogue(result).values()].filter((s) => s.suppressed);

      expect(exempt.length).toBeGreaterThan(0);
      for (const slot of exempt) {
        expect(ALL_SUPPRESSING_STATES as readonly string[]).toContain(slot.formatted);
      }
    }
  });

  it("never puts an unrounded figure into a computed money slot either", () => {
    // A real MSFT run printed the probability-weighted value as
    // "$474.99999999999999999" — the exact result of three equal weights
    // summing to one, carried straight to the page. Facts from filings are
    // integers, so the display rule had never met a value like it.
    const catalogue = buildSlotCatalogue(msft);

    expect(catalogue.get("fairValueRange.weightedValueInside")?.formatted).not.toMatch(/\.\d{3,}/);
  });

  it("never puts an unrounded figure into a fact slot, for either company", () => {
    for (const result of [msft, oklo]) {
      for (const [id, slot] of buildSlotCatalogue(result)) {
        if (!id.startsWith("facts.")) continue;
        const fraction = /\.(\d+)/.exec(slot.formatted)?.[1] ?? "";
        expect(fraction.length, `${id} rendered as ${slot.formatted}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("holds each reverse-DCF cell's implied growth, keyed by its margin level and rate", () => {
    const catalogue = buildSlotCatalogue(msft);

    for (const cell of msft.priceImplied.reverseDcfGrid) {
      expect(catalogue.has(`priceImplied.reverseDcf.${cell.marginLevel}@${cell.rate}.tenYearCagr`)).toBe(true);
    }
  });

  it("renders a suppressed figure as its state, carrying no number for [C] to describe (§8.3 limit 5)", () => {
    const catalogue = buildSlotCatalogue(msft);
    const suppressedCell = msft.priceImplied.reverseDcfGrid.find((c) => c.fiveYearGrowth.suppressed);

    // MSFT is the case the design was drawn around — four of nine cells
    // return a state rather than a number (design §11).
    expect(suppressedCell).toBeDefined();
    const slot = catalogue.get(
      `priceImplied.reverseDcf.${suppressedCell!.marginLevel}@${suppressedCell!.rate}.fiveYearGrowth`
    );
    expect(slot?.suppressed).toBe(true);
    expect(slot?.formatted).toBe(
      suppressedCell!.fiveYearGrowth.suppressed ? suppressedCell!.fiveYearGrowth.state : ""
    );
    expect(slot?.formatted).not.toMatch(/\d/);
  });

  // CB-AUDIT-FIX-01B. Neither fixture computes a ±1% rate sensitivity or a
  // rate at which the base case equals the price; [C] gets the state, never
  // a figure (the old catalogue handed it "0.0%" for the first).
  it("offers the ±1% rate sensitivity and the base-equals-price rate as their states, carrying no number", () => {
    for (const result of [msft, oklo]) {
      const catalogue = buildSlotCatalogue(result);
      for (const id of [
        "diagnostics.rateSensitivity.plusOnePoint",
        "diagnostics.rateSensitivity.minusOnePoint",
        "scenarioOutputs.rateAtWhichBaseEqualsPrice",
      ]) {
        const slot = catalogue.get(id);
        expect(slot?.suppressed).toBe(true);
        expect(slot?.formatted).not.toMatch(/\d/);
        expect(slot?.formatted).not.toMatch(/NaN/);
      }
      expect(catalogue.get("diagnostics.rateSensitivity.plusOnePoint")?.formatted).toBe("INCOMPLETE");
    }
    expect(buildSlotCatalogue(msft).get("scenarioOutputs.rateAtWhichBaseEqualsPrice")?.formatted).toBe("INCOMPLETE");
    expect(buildSlotCatalogue(oklo).get("scenarioOutputs.rateAtWhichBaseEqualsPrice")?.formatted).toBe("NO SOLUTION IN RANGE");
  });

  it("gives every slot a non-empty formatted value and a plain-English label", () => {
    for (const catalogue of [buildSlotCatalogue(msft), buildSlotCatalogue(oklo)]) {
      expect(catalogue.size).toBeGreaterThan(0);
      for (const slot of catalogue.values()) {
        expect(slot.formatted.trim()).not.toBe("");
        expect(slot.label.trim()).not.toBe("");
      }
    }
  });

  it("holds the pre-revenue distribution for the degenerate case, and the bear/bull range for the other", () => {
    expect(buildSlotCatalogue(oklo).has("fairValueRange.cashFloor")).toBe(true);
    expect(buildSlotCatalogue(msft).has("fairValueRange.bear")).toBe(true);
  });

  // CB-H3-IMPLEMENT-01. The M5 OKLO_FIXTURE's own dates are aligned (its
  // FactRecord already documents cash per share as "adjusted for burn to
  // today"), so the weight still computes and every date slot is populated.
  it("holds V_success and V_fail's own valuation dates for each success definition, on the fixture where the weight computes", () => {
    const catalogue = buildSlotCatalogue(oklo);
    expect(oklo.preRevenue!.successDefinitions.length).toBeGreaterThan(0);
    oklo.preRevenue!.successDefinitions.forEach((_, i) => {
      const key = `preRevenue.successDefinitions.${i}`;
      expect(catalogue.get(`${key}.vSuccessAsOfDate`)?.formatted).toBeTruthy();
      expect(catalogue.get(`${key}.vFailAsOfDate`)?.formatted).toBeTruthy();
    });
  });

  it("cash per share, quarterly burn and runway are exposed as ordinary figures when the acquired basis is established", () => {
    const catalogue = buildSlotCatalogue(oklo);
    expect(catalogue.get("preRevenue.cashPerShare")?.suppressed).toBe(false);
    expect(catalogue.get("preRevenue.quarterlyBurn")?.suppressed).toBe(false);
    expect(catalogue.get("preRevenue.runway")?.suppressed).toBe(false);
  });

  describe("H3 — acquired cash basis not established", () => {
    const missingBasisOklo = assembleAnalysisResult({
      ...OKLO_FIXTURE,
      preRevenue: {
        ...OKLO_FIXTURE.preRevenue!,
        cashPerShare: null,
        cashPerShareAsOfDate: null,
        cashPerShareCause: "missing REQUIRED input: acquired cash balance, shares outstanding used by the acquired run",
        quarterlyBurn: null,
        quarterlyBurnAsOfDate: null,
        quarterlyBurnCause: "missing REQUIRED input: acquired quarterly operating cash flow (burn)",
        runway: null,
        runwayCause: "missing REQUIRED input: acquired cash balance, acquired quarterly burn",
      },
    });

    it("cash per share, quarterly burn and runway carry their bound state, never a NaN or zero figure", () => {
      const catalogue = buildSlotCatalogue(missingBasisOklo);
      for (const id of ["preRevenue.cashPerShare", "preRevenue.quarterlyBurn", "preRevenue.runway"]) {
        const slot = catalogue.get(id);
        expect(slot?.suppressed).toBe(true);
        expect(slot?.formatted).toBe("INCOMPLETE");
        expect(slot?.formatted).not.toMatch(/\d/);
        expect(slot?.formatted).not.toMatch(/NaN/);
      }
    });

    it("every success definition's weight is suppressed — never a computed number built on the missing basis — and V_fail carries the same bound state rather than a NaN figure", () => {
      const catalogue = buildSlotCatalogue(missingBasisOklo);
      expect(missingBasisOklo.preRevenue!.successDefinitions.length).toBeGreaterThan(0);
      missingBasisOklo.preRevenue!.successDefinitions.forEach((row, i) => {
        expect(row.state.kind).toBe("NOT COMPUTED / SUPPRESSED");
        const key = `preRevenue.successDefinitions.${i}`;
        const weightSlot = catalogue.get(`${key}.breakEvenSuccessWeight`);
        expect(weightSlot?.suppressed).toBe(true);
        expect(weightSlot?.formatted).toBe("NOT COMPUTED / SUPPRESSED");
        expect(weightSlot?.formatted).not.toMatch(/\d/);
        const vFailSlot = catalogue.get(`${key}.vFail`);
        expect(vFailSlot?.suppressed).toBe(true);
        expect(vFailSlot?.formatted).toBe("INCOMPLETE");
      });
    });

    // H3 conformance correction. The cause is never dropped — it travels as
    // its own field, never folded into `formatted` (which feeds [C]'s prompt
    // directly and the figure-injection scan's exempt vocabulary — folding
    // free text in there would smuggle real digits, like a valuation date,
    // past that scan under cover of a "state name").
    it("carries the suppression cause as its own field on the weight slot, never inside formatted", () => {
      const catalogue = buildSlotCatalogue(missingBasisOklo);
      missingBasisOklo.preRevenue!.successDefinitions.forEach((row, i) => {
        if (row.state.kind !== "NOT COMPUTED / SUPPRESSED") return;
        const key = `preRevenue.successDefinitions.${i}`;
        const weightSlot = catalogue.get(`${key}.breakEvenSuccessWeight`);
        expect(weightSlot?.cause).toBe(row.state.cause);
        expect(weightSlot?.formatted).not.toContain(row.state.cause);
      });
    });

    it("the fair-value range itself is suppressed, never a NaN-valued cash floor reaching [C]", () => {
      const catalogue = buildSlotCatalogue(missingBasisOklo);
      expect(missingBasisOklo.fairValueRange.kind).toBe("suppressed");
      expect(catalogue.has("fairValueRange.cashFloor")).toBe(false);
      expect(catalogue.get("fairValueRange.state")?.formatted).toBe("INCOMPLETE");
    });
  });
});

describe("buildFactSlotCatalogue", () => {
  it("holds the fact set and nothing else — the challenger cites facts, never a valuation output", () => {
    const catalogue = buildFactSlotCatalogue(msft.facts);

    expect(catalogue.size).toBeGreaterThan(0);
    for (const id of catalogue.keys()) {
      expect(id.startsWith("facts.")).toBe(true);
    }
    expect(catalogue.has("fairValueRange.bear")).toBe(false);
    expect(catalogue.has("priceImplied.reverseDcf.current@0.08.tenYearCagr")).toBe(false);
  });
});
