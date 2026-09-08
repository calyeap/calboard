import { describe, it, expect } from "vitest";
import { assembleAnalysisResult } from "../assemble";
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
