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
