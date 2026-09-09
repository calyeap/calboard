import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import * as calibrationInputs from "./inputs";
import {
  achievedRevenueCagr,
  comparatorRecency,
  gapPoints,
  isUsable,
  priceLocationWithinRange,
  requiredGrowthCells,
  revenueSeries,
  type WindowRecency,
} from "./inputs";
import { computedValue, suppressedValue } from "../figures";
import { CLEAN_PROVENANCE } from "../provenance";
import type { AnnualSeries } from "../acquisition/history";
import type { CompanyFactsDocument } from "../acquisition/secClient";
import type { ReverseDcfCell } from "../types";

function series(tag: string, values: [number, number][]): AnnualSeries {
  return {
    tag,
    observations: values.map(([fiscalYear, value]) => ({
      fiscalYear,
      periodStart: `${fiscalYear - 1}-07-01`,
      periodEnd: `${fiscalYear}-06-30`,
      value,
      accession: null,
    })),
  };
}

/** Eleven years compounding at exactly 10% — a CAGR with a known answer. */
function tenPercentSeries(): AnnualSeries {
  const values: [number, number][] = [];
  for (let i = 0; i <= 10; i++) values.push([2015 + i, 100 * 1.1 ** i]);
  return series("us-gaap:Revenues", values);
}

function solvedCell(marginLevel: ReverseDcfCell["marginLevel"], rate: ReverseDcfCell["rate"], five: string, ten: string): ReverseDcfCell {
  return {
    marginLevel,
    rate,
    fiveYearGrowth: computedValue(new Decimal(five), CLEAN_PROVENANCE),
    tenYearCagr: computedValue(new Decimal(ten), CLEAN_PROVENANCE),
    year10Revenue: computedValue(new Decimal(1000), CLEAN_PROVENANCE),
    ronic: computedValue(new Decimal("0.4"), CLEAN_PROVENANCE),
    lagBiasDirection: "conservative",
  };
}

function suppressedCell(marginLevel: ReverseDcfCell["marginLevel"], rate: ReverseDcfCell["rate"], state: "INCOMPLETE" | "NOT COMPUTABLE", cause: string): ReverseDcfCell {
  const figure = suppressedValue(state, cause);
  return {
    marginLevel,
    rate,
    fiveYearGrowth: figure,
    tenYearCagr: figure,
    year10Revenue: figure,
    ronic: figure,
    lagBiasDirection: "conservative",
  };
}

describe("price location within the scenario range (§10.6.2 input A)", () => {
  const scenarioValues = { bear: new Decimal(100), base: new Decimal(150), bull: new Decimal(200) };

  it("locates the price between bear and bull", () => {
    const result = priceLocationWithinRange({ scenarioValues, currentPrice: new Decimal(150), rangeSuppressedBy: null });
    expect(result.blockedBy).toEqual([]);
    expect(result.value?.toString()).toBe("0.5");
  });

  it("returns a value ABOVE 1 when price sits above the top of the range, rather than clamping", () => {
    // The case no fixture exercises and the one the milestone was told to
    // cover. Clamping to 1 would make "at the top" and "well above the top"
    // indistinguishable, which is precisely the distinction a threshold at the
    // expensive end has to make.
    const result = priceLocationWithinRange({ scenarioValues, currentPrice: new Decimal(260), rangeSuppressedBy: null });
    expect(result.value?.toString()).toBe("1.6");
    expect(result.value?.greaterThan(1)).toBe(true);
  });

  it("returns a value below 0 when price sits below the bottom of the range", () => {
    const result = priceLocationWithinRange({ scenarioValues, currentPrice: new Decimal(80), rangeSuppressedBy: null });
    expect(result.value?.toString()).toBe("-0.2");
  });

  it("yields NO input when the range is suppressed, even though the arithmetic would still work", () => {
    // The whole point of §10.6.3: a suppressed range means no position. If the
    // harness computed the fraction anyway, a threshold would end up
    // calibrated on a figure the run itself refused to publish.
    const result = priceLocationWithinRange({
      scenarioValues,
      currentPrice: new Decimal(150),
      rangeSuppressedBy: "LEVERAGE UNSUPPORTED IN v1",
    });
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("LEVERAGE UNSUPPORTED IN v1");
  });

  it("yields no input where no analyst has authored Step 7's scenarios", () => {
    const result = priceLocationWithinRange({ scenarioValues: null, currentPrice: new Decimal(150), rangeSuppressedBy: null });
    expect(result.value).toBeNull();
    expect(result.blockedBy.join(" ")).toContain("Step 7");
  });

  it("reports every blocking reason, not just the first", () => {
    const result = priceLocationWithinRange({ scenarioValues: null, currentPrice: null, rangeSuppressedBy: "LEVERAGE UNSUPPORTED IN v1" });
    expect(result.blockedBy).toHaveLength(3);
  });

  it("refuses a zero-width range rather than dividing by zero", () => {
    const flat = { bear: new Decimal(100), base: new Decimal(100), bull: new Decimal(100) };
    const result = priceLocationWithinRange({ scenarioValues: flat, currentPrice: new Decimal(100), rangeSuppressedBy: null });
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("zero width");
  });
});

describe("achieved revenue CAGR (§10.6.2's comparator fact)", () => {
  it("computes the CAGR over the requested horizon and names the single tag it came from", () => {
    const result = achievedRevenueCagr(tenPercentSeries(), 10, current(2025));
    expect(result.value?.cagr.toDecimalPlaces(6).toString()).toBe("0.1");
    expect(result.value?.tag).toBe("us-gaap:Revenues");
    expect(result.value?.window.fromFiscalYear).toBe(2015);
    expect(result.value?.window.toFiscalYear).toBe(2025);
  });

  it("takes the horizon off the END of the series, so the comparator is the most recent window", () => {
    const result = achievedRevenueCagr(tenPercentSeries(), 5, current(2025));
    expect(result.value?.window.fromFiscalYear).toBe(2020);
    expect(result.value?.window.toFiscalYear).toBe(2025);
  });

  it("REFUSES to shorten the horizon when history is too short", () => {
    // §10.6.2: the achieved figure must be on the same horizon as the implied
    // figure "or it is not compared at all". Returning a nine-year CAGR under a
    // ten-year label is the horizon mismatch that rule exists to forbid, and it
    // would be invisible in the output.
    const nineYears = series("us-gaap:Revenues", Array.from({ length: 10 }, (_, i) => [2016 + i, 100] as [number, number]));
    const result = achievedRevenueCagr(nineYears, 10, current(2025));
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("needs 11");
  });

  it("refuses a CAGR from a zero or negative base rather than returning the number the formula produces", () => {
    const fromZero = series("us-gaap:Revenues", [[2020, 0], [2021, 10], [2022, 20], [2023, 30], [2024, 40], [2025, 50]]);
    const result = achievedRevenueCagr(fromZero, 5, current(2025));
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("non-positive");
  });

  it("yields nothing where no single-tag series exists at all (§3.7)", () => {
    const result = achievedRevenueCagr(null, 10, current(2025));
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("single-tag");
  });
});

describe("required growth, read off M7's grid (§10.6.2 input B)", () => {
  it("returns every solved cell without reducing the grid to one figure", () => {
    // Which of the nine cells the position's required figure comes from is not
    // settled by §10.6.2. Collapsing the grid here would make that ruling
    // silently, so all solved cells survive.
    const grid = [
      solvedCell("current", 0.08, "0.14", "0.11"),
      solvedCell("median", 0.1, "0.16", "0.12"),
      solvedCell("stress", 0.12, "0.19", "0.14"),
    ];
    const result = requiredGrowthCells(grid);
    expect(result.value).toHaveLength(3);
    expect(result.value?.map((c) => c.marginLevel)).toEqual(["current", "median", "stress"]);
  });

  it("yields no input when every cell is suppressed, and says what suppressed them", () => {
    const grid = [
      suppressedCell("current", 0.08, "INCOMPLETE", "missing REQUIRED input(s): targetEnterpriseValue"),
      suppressedCell("median", 0.1, "INCOMPLETE", "missing REQUIRED input(s): targetEnterpriseValue"),
    ];
    const result = requiredGrowthCells(grid);
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("targetEnterpriseValue");
  });

  it("keeps the solved cells when only some are suppressed", () => {
    const grid = [
      solvedCell("current", 0.08, "0.14", "0.11"),
      suppressedCell("stress", 0.12, "NOT COMPUTABLE", "RONIC not meaningful"),
    ];
    const result = requiredGrowthCells(grid);
    expect(result.value).toHaveLength(1);
    expect(result.blockedBy).toEqual([]);
  });
});

describe("the gap, and what counts as a usable observation", () => {
  it("is positive when the price requires more growth than the company has delivered", () => {
    const achieved = achievedRevenueCagr(tenPercentSeries(), 10, current(2025)).value!;
    expect(gapPoints(new Decimal("0.14"), achieved).toDecimalPlaces(4).toString()).toBe("0.04");
  });

  it("is negative when the price requires less than the company has delivered", () => {
    const achieved = achievedRevenueCagr(tenPercentSeries(), 10, current(2025)).value!;
    expect(gapPoints(new Decimal("0.06"), achieved).isNegative()).toBe(true);
  });

  it("counts a company as usable only where BOTH inputs are present", () => {
    // §10.6.2 rule 2 requires positive agreement from both inputs, so one
    // input alone supports no position and therefore contributes no
    // calibration observation. A set counted on "at least one input" would
    // overstate how much evidence a threshold rests on.
    const achieved = achievedRevenueCagr(tenPercentSeries(), 10, current(2025));
    const required = requiredGrowthCells([solvedCell("current", 0.08, "0.14", "0.11")]);
    const location = priceLocationWithinRange({
      scenarioValues: { bear: new Decimal(100), base: new Decimal(150), bull: new Decimal(200) },
      currentPrice: new Decimal(150),
      rangeSuppressedBy: null,
    });

    expect(isUsable({ ticker: "T", shape: "s", priceLocation: location, achievedTenYear: achieved, achievedFiveYear: achieved, required })).toBe(true);

    const noLocation = priceLocationWithinRange({ scenarioValues: null, currentPrice: null, rangeSuppressedBy: "LEVERAGE UNSUPPORTED IN v1" });
    expect(isUsable({ ticker: "T", shape: "s", priceLocation: noLocation, achievedTenYear: achieved, achievedFiveYear: achieved, required })).toBe(false);

    const noRequired = requiredGrowthCells([suppressedCell("current", 0.08, "INCOMPLETE", "missing")]);
    expect(isUsable({ ticker: "T", shape: "s", priceLocation: location, achievedTenYear: achieved, achievedFiveYear: achieved, required: noRequired })).toBe(false);
  });
});

describe("what this module deliberately does not do", () => {
  it("exports no threshold, no band and no classifier", () => {
    // The guard the milestone turns on. If a later session adds a cut-point
    // here, this test is what should stop it: the thresholds are Calvin's
    // ruling and inventing them in code is the Appendix B failure repeating.
    const names = Object.keys(calibrationInputs);
    expect(names.some((n) => /threshold|band|cutpoint|cutPoint|classify|position/i.test(n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defect D — the comparator window's recency.
//
// M8-c returned NVDA at a 31.25% five-year CAGR measured FY2017→FY2022, four
// years before the price it would have been read against, with nothing in the
// output saying so. These tests pin the rule that replaced it. The rule is
// about window recency, not about NVDA: every case below except the last two
// is synthetic, and NVDA is one instance of it.
// ---------------------------------------------------------------------------

function capture(ticker: string): CompanyFactsDocument {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "acquisition", "captures", `${ticker}-companyfacts.json`), "utf8")
  ) as CompanyFactsDocument;
}

/** A window that reaches the filer's latest reported year. Nothing to disclose. */
function current(year: number): WindowRecency {
  return { currentFiscalYear: year, reachedBy: null };
}

describe("the comparator window must reach the current period (§10.6.2, defect D)", () => {
  it("does NOT return a bare figure when the window ends before the current period", () => {
    // The defect in one line: a plausible number answering a different
    // question than the one asked. The figure may still travel, but never
    // without the window it was measured over.
    const stale = series("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      Array.from({ length: 6 }, (_, i) => [2017 + i, 100 * 1.2 ** i] as [number, number]));

    const result = achievedRevenueCagr(stale, 5, current(2026));

    expect(result.value).not.toBeNull();
    expect(result.value?.window.yearsStale).toBe(4);
    expect(result.value?.staleWindowDisclosure).not.toBeNull();
    expect(result.value?.staleWindowDisclosure).toContain("FY2022");
    expect(result.value?.staleWindowDisclosure).toContain("FY2026");
  });

  it("returns normally on a series that IS current — the guard must not fire on a healthy company", () => {
    const result = achievedRevenueCagr(tenPercentSeries(), 10, current(2025));

    expect(result.blockedBy).toEqual([]);
    expect(result.value?.cagr.toDecimalPlaces(6).toString()).toBe("0.1");
    expect(result.value?.window.yearsStale).toBe(0);
    expect(result.value?.staleWindowDisclosure).toBeNull();
  });

  it("returns INCOMPLETE rather than a labelled figure when another mapped candidate DOES reach the current period", () => {
    // §10.6.2's split. A truncated series that is all the filer has is a
    // shortened window (§3.7) and may travel labelled. A truncated series
    // chosen while a live one sat unread in the same mapping entry is not
    // stale — it is wrong, and a label would dress it as a judgment call.
    const stale = series("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      Array.from({ length: 6 }, (_, i) => [2017 + i, 100 * 1.2 ** i] as [number, number]));

    const result = achievedRevenueCagr(stale, 5, {
      currentFiscalYear: 2026,
      reachedBy: { tag: "us-gaap:Revenues", throughFiscalYear: 2026, observations: 18 },
    });

    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("us-gaap:Revenues");
    expect(result.blockedBy[0]).toContain("FY2026");
  });

  it("says nothing about the length of a superseded series", () => {
    // "Only 6 observations" is true of the wrong tag and would read as a
    // finding about the company's history, which has 18 years in it.
    const stale = series("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      Array.from({ length: 6 }, (_, i) => [2017 + i, 100 * 1.2 ** i] as [number, number]));

    const result = achievedRevenueCagr(stale, 10, {
      currentFiscalYear: 2026,
      reachedBy: { tag: "us-gaap:Revenues", throughFiscalYear: 2026, observations: 18 },
    });

    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0]).not.toContain("needs 11");
  });

  it("carries the disclosure exactly when the window is stale, never otherwise", () => {
    for (const [currentYear, expectStale] of [[2025, false], [2026, true], [2030, true]] as const) {
      const result = achievedRevenueCagr(tenPercentSeries(), 10, current(currentYear));
      expect((result.value?.staleWindowDisclosure !== null)).toBe(expectStale);
      expect(result.value!.window.yearsStale > 0).toBe(expectStale);
    }
  });

  it("carries the horizon in the same record that carries the window", () => {
    // The mechanism the 8 September horizon ruling extends rather than
    // replaces: one travelling record naming both the horizon a figure was
    // measured on and the window it covered.
    const result = achievedRevenueCagr(tenPercentSeries(), 5, current(2025));
    expect(result.value?.window.horizonYears).toBe(5);
    expect(result.value?.window.fromFiscalYear).toBe(2020);
    expect(result.value?.window.toFiscalYear).toBe(2025);
    expect(result.value?.window.currentFiscalYear).toBe(2025);
  });
});

describe("comparatorRecency — read off the filings, not asserted", () => {
  it("finds the live candidate the first-resolving-candidate rule skipped (NVDA)", () => {
    const doc = capture("nvda");
    const recency = comparatorRecency(doc, revenueSeries(doc)!);

    expect(recency.currentFiscalYear).toBe(2026);
    expect(recency.reachedBy?.tag).toBe("us-gaap:Revenues");
    expect(recency.reachedBy?.throughFiscalYear).toBe(2026);
  });

  it("finds no rescuing candidate where the chosen series is already current (MSFT)", () => {
    const doc = capture("msft");
    const recency = comparatorRecency(doc, revenueSeries(doc)!);

    expect(recency.currentFiscalYear).toBe(2026);
    expect(recency.reachedBy).toBeNull();
  });
});

describe("NVDA — the defect, pinned against a real capture", () => {
  it("no longer returns the 31.25% five-year figure M8-c reported", () => {
    const doc = capture("nvda");
    const result = achievedRevenueCagr(revenueSeries(doc), 5, comparatorRecency(doc, revenueSeries(doc)!));

    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("us-gaap:Revenues");
    expect(result.blockedBy[0]).toContain("FY2026");
  });

  it("still reads its window off the retired tag, because acquisition's candidate choice is not this fix", () => {
    // The comparator refuses; it does not re-choose the tag. Changing which
    // candidate resolves re-resolves every previously acquired fact (§3.8.1)
    // and belongs to the acquisition pass.
    const chosen = revenueSeries(capture("nvda"))!;
    expect(chosen.tag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(chosen.observations[chosen.observations.length - 1].fiscalYear).toBe(2022);
  });
});

describe("MSFT — a healthy comparator is untouched by the guard", () => {
  it("returns its ten-year CAGR with nothing to disclose", () => {
    const doc = capture("msft");
    const result = achievedRevenueCagr(revenueSeries(doc), 10, comparatorRecency(doc, revenueSeries(doc)!));

    expect(result.blockedBy).toEqual([]);
    expect(result.value?.staleWindowDisclosure).toBeNull();
    expect(result.value?.window.toFiscalYear).toBe(2026);
    expect(result.value?.window.fromFiscalYear).toBe(2016);
  });
});
