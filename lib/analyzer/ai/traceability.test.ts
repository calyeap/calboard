import { describe, it, expect } from "vitest";
import {
  traceText,
  renderText,
  slotIdsIn,
  UntraceableFigureError,
  type SlotCatalogue,
  type FigureSlot,
} from "./traceability";

// §8.3 limit 3 — "Any figure in [C] output that is not traceable to the
// acquired fact set is a defect" — and §10.7 rule 3 — "[A [C] call] may
// reference a number by its result-object slot; it may not emit a numeral, and
// a numeral emitted by [C] is a defect rather than a value to be checked."
//
// These tests are the mechanical control. They are written against a
// hand-built catalogue rather than a whole AnalysisResult so the rule itself
// is under test, not the catalogue builder.

function slot(id: string, formatted: string, extra: Partial<FigureSlot> = {}): FigureSlot {
  return { id, label: id, formatted, suppressed: false, ...extra };
}

function catalogueOf(...slots: FigureSlot[]): SlotCatalogue {
  return new Map(slots.map((s) => [s.id, s]));
}

describe("traceText", () => {
  it("accepts prose whose every figure is a slot reference that resolves", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    expect(traceText("The price is {{price}}.", catalogue)).toEqual([]);
  });

  it("reports a slot the Analysis Result does not contain", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("The ten-year CAGR is {{priceImplied.tenYearCagr}}.", catalogue);

    expect(defects).toEqual([
      { kind: "UNKNOWN SLOT", detail: "priceImplied.tenYearCagr" },
    ]);
  });

  it("reports a bare numeral — the figure the model wrote rather than referenced", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("The price is 499.70 a share.", catalogue);

    expect(defects).toMatchObject([{ kind: "NUMERAL FROM MODEL", detail: "499.70" }]);
  });

  it("does not mistake digits inside a slot id for a numeral the model emitted", () => {
    const catalogue = catalogueOf(slot("reverseDcf.current@0.08.tenYearCagr", "12.4%"));

    expect(traceText("Ten-year CAGR of {{reverseDcf.current@0.08.tenYearCagr}}.", catalogue)).toEqual([]);
  });

  it("reports a spelled-out quantity — the evasion a digit rule alone would miss", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("Software companies of this kind typically grow at fifteen percent.", catalogue);

    expect(defects).toMatchObject([{ kind: "SPELLED-OUT QUANTITY", detail: "fifteen percent" }]);
  });

  it("leaves the hyphenated horizon adjective alone — it names a window, it does not count one", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    // "the ten-year CAGR" and "the five-year horizon" are the methodology's own
    // vocabulary for WHICH figure is meant, not a quantity being asserted. A
    // rule that refused them would leave [C] unable to say which cell it was
    // talking about — so the prompts steer to this form, and this test is what
    // makes that steer safe to give.
    expect(traceText("Over the ten-year horizon the five-year growth path dominates.", catalogue)).toEqual([]);
  });

  it("still refuses the counted form, which asserts a quantity", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    expect(traceText("The company has compounded for thirteen years.", catalogue)).toMatchObject([
      { kind: "SPELLED-OUT QUANTITY", detail: "thirteen years" },
    ]);
  });

  it("leaves ordinary counting words alone — they are prose, not figures", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    expect(traceText("One or more cells return a state, and the third is the clearest.", catalogue)).toEqual([]);
  });

  it("collects every defect in one pass rather than stopping at the first", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("Growth of 14% against {{missing.slot}}.", catalogue);

    expect(defects).toHaveLength(2);
    expect(defects.map((d) => d.kind).sort()).toEqual(["NUMERAL FROM MODEL", "UNKNOWN SLOT"]);
  });
});

describe("UntraceableFigureError", () => {
  // The refusal message reaches the SCREEN (reportAnalysis carries it into
  // Section I). If it quoted the figure the model invented, the report would
  // carry a number with no field behind it — §10.0.2 rule 3 — smuggled in as
  // the reason for refusing that very thing.
  it("names what failed and where, without reproducing the figure the model wrote", () => {
    const err = new UntraceableFigureError("interpretation statement 1", [
      { kind: "NUMERAL FROM MODEL", detail: "14.2%" },
      { kind: "NUMERAL FROM MODEL", detail: "0" },
      { kind: "UNKNOWN SLOT", detail: "made.up.slot" },
    ]);

    expect(err.message).toContain("interpretation statement 1");
    expect(err.message).toContain("NUMERAL FROM MODEL");
    expect(err.message).not.toContain("14.2%");
    expect(err.message).not.toContain("made.up.slot");
  });

  it("carries the surrounding words in the diagnostic, so a bare digit can be found", () => {
    // A real MSFT run refused on NUMERAL FROM MODEL ("1") — true, and useless
    // on its own. A "1" could be a footnote marker, a quarter, or a fabricated
    // figure, and only the third is the failure this check exists for.
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("The debt is disclosed in Note 1 of the filing.", catalogue);

    expect(defects[0].kind).toBe("NUMERAL FROM MODEL");
    expect(defects[0].context).toContain("Note 1");
  });

  it("keeps the offending text on the error for the log and the command line, where it belongs", () => {
    const err = new UntraceableFigureError("challenger finding 7 evidence", [
      { kind: "NUMERAL FROM MODEL", detail: "0" },
    ]);

    expect(err.diagnostic).toContain("0");
    expect(err.defects).toEqual([{ kind: "NUMERAL FROM MODEL", detail: "0" }]);
  });
});

describe("slotIdsIn", () => {
  it("lists the slots a sentence cites, in the order it cites them", () => {
    expect(slotIdsIn("At {{price}} the price implies {{cagr}}.")).toEqual(["price", "cagr"]);
  });

  it("reads a reference written with inner spaces, exactly as the validator and the renderer do", () => {
    // The three must agree. A reference the renderer substitutes but the
    // provenance list omits would leave a figure on the page with no recorded
    // field behind it — §10.0.1's "each statement referencing the values it
    // rests on", quietly incomplete.
    expect(slotIdsIn("At {{ price }} today.")).toEqual(["price"]);
  });

  it("lists a repeated slot once", () => {
    expect(slotIdsIn("{{price}} against {{price}}.")).toEqual(["price"]);
  });
});

describe("renderText", () => {
  it("substitutes each slot with the figure held in the Analysis Result", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"), slot("cagr", "12.4%"));

    expect(renderText("At {{price}} the price implies {{cagr}}.", catalogue)).toBe(
      "At $499.70 the price implies 12.4%."
    );
  });

  it("renders a suppressed slot as its state, so [C] cannot describe a number that was never produced (§8.3 limit 5)", () => {
    const catalogue = catalogueOf(
      slot("reverseDcf.stress@0.12.tenYearCagr", "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE", {
        suppressed: true,
      })
    );

    expect(renderText("The stress cell returns {{reverseDcf.stress@0.12.tenYearCagr}}.", catalogue)).toBe(
      "The stress cell returns DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE."
    );
  });

  it("refuses to render an unknown slot rather than leaving the braces on the page", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    expect(() => renderText("{{not.a.slot}}", catalogue)).toThrow(UntraceableFigureError);
    // The invented id is model-authored text, so it stays out of the message
    // that reaches the screen and lives on the diagnostic instead.
    try {
      renderText("{{not.a.slot}}", catalogue);
    } catch (err) {
      expect((err as UntraceableFigureError).message).not.toContain("not.a.slot");
      expect((err as UntraceableFigureError).diagnostic).toContain("not.a.slot");
    }
  });
});
