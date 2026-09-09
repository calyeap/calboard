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
  it("finds no rescuing candidate where the chosen series is already current (NVDA)", () => {
    // WAS: "finds the live candidate the first-resolving-candidate rule
    // skipped". Under Defect D the comparator's job on NVDA was to notice that
    // us-gaap:Revenues sat unread beside the retired ASC 606 element and to
    // refuse. Acquisition now applies the same recency rule when it CHOOSES,
    // so there is nothing left for the comparator to rescue: the series it is
    // handed is already the live one.
    //
    // The machinery is unchanged and still has to work — the reachedBy branch
    // is exercised by the synthetic cases above, which is where it belongs now
    // that no company in the calibration set reaches it.
    const doc = capture("nvda");
    const recency = comparatorRecency(doc, revenueSeries(doc)!);

    expect(recency.currentFiscalYear).toBe(2026);
    expect(recency.reachedBy).toBeNull();
  });

  it("finds no rescuing candidate where the chosen series is already current (MSFT)", () => {
    const doc = capture("msft");
    const recency = comparatorRecency(doc, revenueSeries(doc)!);

    expect(recency.currentFiscalYear).toBe(2026);
    expect(recency.reachedBy).toBeNull();
  });
});

describe("NVDA — the defect, pinned against a real capture", () => {
  it("reads its window off the live tag, now that acquisition chooses one", () => {
    // The two halves of Defect D, both closed. The comparator half refused a
    // stale window; this pass fixed the acquisition half that chose one.
    const chosen = revenueSeries(capture("nvda"))!;
    expect(chosen.tag).toBe("us-gaap:Revenues");
    expect(chosen.observations[chosen.observations.length - 1].fiscalYear).toBe(2026);
  });

  it("returns a current five-year comparator where M8-c reported a four-year-stale 31.25%", () => {
    const doc = capture("nvda");
    const result = achievedRevenueCagr(revenueSeries(doc), 5, comparatorRecency(doc, revenueSeries(doc)!));

    expect(result.value).not.toBeNull();
    expect(result.value!.tag).toBe("us-gaap:Revenues");
    expect(result.value!.window.toFiscalYear).toBe(2026);
    expect(result.value!.window.fromFiscalYear).toBe(2021);
    // Nothing to disclose: the window reaches the filer's own current period.
    expect(result.value!.staleWindowDisclosure).toBeNull();
  });

  it("measures its ten-year window FY2016→FY2026 across the real FY2019 hole", () => {
    // The endpoint case on a real filing rather than a synthetic one.
    //
    // NVIDIA tagged FY2019 revenue only under the ASC 606 element, so
    // us-gaap:Revenues — correctly chosen since -09-2, and eighteen years long
    // — has no FY2019 row. Selecting the far endpoint by POSITION landed on
    // FY2015 and compounded eleven years of growth under a ten-year label;
    // selecting it by FISCAL YEAR lands on FY2016, which is present, and the
    // interior hole is irrelevant to a two-endpoint calculation.
    const doc = capture("nvda");
    const result = achievedRevenueCagr(revenueSeries(doc), 10, comparatorRecency(doc, revenueSeries(doc)!));

    expect(result.value).not.toBeNull();
    expect(result.value!.window.horizonYears).toBe(10);
    expect(result.value!.window.fromFiscalYear).toBe(2016);
    expect(result.value!.window.toFiscalYear).toBe(2026);
    // The window spans exactly the horizon it is labelled with.
    expect(
      result.value!.window.toFiscalYear - result.value!.window.fromFiscalYear
    ).toBe(result.value!.window.horizonYears);
    // The hole is still there — it is tolerated, not papered over.
    expect(revenueSeries(doc)!.observations.map((o) => o.fiscalYear)).not.toContain(2019);
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

// ---------------------------------------------------------------------------
// The window endpoint is a FISCAL YEAR, not an array index.
//
// Exposed by the acquisition pass (calboard-secmap-2026-09-2): once NVDA's
// series was chosen correctly it was actually read, and it has a genuine hole
// at FY2019 — NVIDIA tagged that year's revenue only under the ASC 606 element
// that us-gaap:Revenues does not carry. Taking the far endpoint by index made
// the ten-year window span ELEVEN fiscal years and compounded eleven years of
// growth over ten.
//
// A hole INSIDE the window is not a defect: a CAGR is a function of its two
// endpoints and nothing between them. A hole AT an endpoint is, because there
// is then no observation for the year the horizon asks about.
// ---------------------------------------------------------------------------

describe("the comparator window is selected by fiscal year, not by position", () => {
  it("measures a ten-year horizon from FY(to - 10), even when a year inside the window is missing", () => {
    // FY2016..FY2026 with FY2019 absent — NVDA's real shape. The endpoints are
    // FY2016 and FY2026 whatever sits between them.
    const withHole = series(
      "us-gaap:Revenues",
      [2016, 2017, 2018, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(
        (fy) => [fy, 100 * Math.pow(1.1, fy - 2016)] as [number, number]
      )
    );

    const result = achievedRevenueCagr(withHole, 10, current(2026));
    expect(result.value).not.toBeNull();
    expect(result.value!.window.fromFiscalYear).toBe(2016);
    expect(result.value!.window.toFiscalYear).toBe(2026);
    // The window now spans exactly the horizon it is labelled with.
    expect(result.value!.window.toFiscalYear - result.value!.window.fromFiscalYear).toBe(
      result.value!.window.horizonYears
    );
    expect(result.value!.cagr.toDecimalPlaces(6).toString()).toBe("0.1");
  });

  it("REFUSES where the year the horizon asks for is the missing one", () => {
    // The endpoint itself is absent. There is no ten-year comparator here, and
    // the nearest available year under a ten-year label is the horizon mismatch
    // §10.6.2 forbids — the same rule as the too-short case, a different cause.
    const missingEndpoint = series(
      "us-gaap:Revenues",
      [2015, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(
        (fy) => [fy, 100] as [number, number]
      )
    );

    const result = achievedRevenueCagr(missingEndpoint, 10, current(2026));
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("FY2016");
  });

  it("still refuses a horizon longer than the history, naming the year it wanted", () => {
    const short = series(
      "us-gaap:Revenues",
      Array.from({ length: 10 }, (_, i) => [2016 + i, 100] as [number, number])
    );
    const result = achievedRevenueCagr(short, 10, current(2025));
    expect(result.value).toBeNull();
    expect(result.blockedBy[0]).toContain("FY2015");
  });
});
