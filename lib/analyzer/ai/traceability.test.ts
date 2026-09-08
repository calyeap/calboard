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

  // --- system-owned vocabulary is not authored text -----------------------
  //
  // A live MSFT run refused on NUMERAL FROM MODEL ("1"): the prose said
  // LEVERAGE UNSUPPORTED IN v1, and the guard read the version token as a
  // figure the model had written.
  //
  // The fix narrows WHAT IS SCANNED rather than permitting anything. A state
  // name is not authored — it is a token out of a closed vocabulary the system
  // owns, and this run's own catalogue is where the guard learns which ones
  // exist. That is the slot design applied to states: the only text exempt
  // from the scan is text the system itself would have substituted.

  function withState(state: string): SlotCatalogue {
    return catalogueOf(slot("price", "$499.70"), slot("priceImplied.steadyStateEv", state, { suppressed: true }));
  }

  it("does not read a state name's version token as a figure the model wrote", () => {
    const catalogue = withState("LEVERAGE UNSUPPORTED IN v1");

    expect(traceText("Every rate-dependent output reads LEVERAGE UNSUPPORTED IN v1.", catalogue)).toEqual([]);
  });

  it("STILL refuses a genuine numeral written beside a state name", () => {
    // The exact case a scope change could open: exempting the state must not
    // exempt its neighbours.
    const catalogue = withState("LEVERAGE UNSUPPORTED IN v1");

    const defects = traceText(
      "Every rate-dependent output reads LEVERAGE UNSUPPORTED IN v1, though growth of 14% is implied.",
      catalogue
    );

    expect(defects).toMatchObject([{ kind: "NUMERAL FROM MODEL", detail: "14%" }]);
  });

  it("exempts nothing on a run whose catalogue does not carry that state", () => {
    // The exemption is derived from THIS run's Analysis Result, not from a
    // list of strings the guard permits. A state this run never produced is
    // not system-owned vocabulary here, and its digits are refused.
    const catalogue = catalogueOf(slot("price", "$499.70"));

    expect(traceText("Everything reads LEVERAGE UNSUPPORTED IN v1.", catalogue)).toMatchObject([
      { kind: "NUMERAL FROM MODEL", detail: "1" },
    ]);
  });

  it("refuses a numeral the model appended to a state name it did carry", () => {
    const catalogue = withState("LEVERAGE UNSUPPORTED IN v1");

    expect(traceText("It reads LEVERAGE UNSUPPORTED IN v12.", catalogue)).toMatchObject([
      { kind: "NUMERAL FROM MODEL", detail: "2" },
    ]);
  });

  it("REFUSES a gate identifier — the exemption was not widened to cover it (ruled)", () => {
    // "Gate 1" is a genuine refusal, not a false positive to be exempted. The
    // state-name exemption is safe because state names derive from a closed
    // set checked against a union at compile time; gate identifiers have no
    // such property, and widening the exemption a third time is how an
    // exception surface grows. The model writes around it instead — "the
    // history-sufficiency gate" — which reads better anyway.
    const catalogue = catalogueOf(slot("price", "$499.70"), slot("gates.gate1.filedYearsCount", "13"));

    expect(traceText("Gate 1 returned SHORT HISTORY.", catalogue)).toMatchObject([
      { kind: "NUMERAL FROM MODEL", detail: "1" },
    ]);
  });

  it("accepts the same point written by what the gate tests", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"), slot("gates.gate1.filedYearsCount", "13"));

    expect(traceText("The history-sufficiency gate returned SHORT HISTORY.", catalogue)).toEqual([]);
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

describe("an unknown slot names its nearest match", () => {
  it("points at the id the model probably meant", () => {
    // A live MSFT run refused on facts.operating-operating-cash-flow — the
    // model doubled a token. The refusal is correct and stays: a figure with
    // no field behind it does not reach the page. But the regeneration is
    // told what failed, and "unknown slot" alone leaves it guessing at which
    // of a hundred ids was intended.
    const catalogue = catalogueOf(slot("facts.operating-cash-flow", "$182.9B"), slot("price", "$499.70"));

    const defects = traceText("Cash generation reads {{facts.operating-operating-cash-flow}}.", catalogue);

    expect(defects).toMatchObject([{ kind: "UNKNOWN SLOT", detail: "facts.operating-operating-cash-flow" }]);
    expect(defects[0].context).toContain("facts.operating-cash-flow");
  });

  it("offers nothing when nothing is close, rather than pointing somewhere wrong", () => {
    const catalogue = catalogueOf(slot("price", "$499.70"));

    const defects = traceText("It reads {{completely.unrelated.identifier.here}}.", catalogue);

    expect(defects[0].kind).toBe("UNKNOWN SLOT");
    expect(defects[0].context).toBeUndefined();
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
