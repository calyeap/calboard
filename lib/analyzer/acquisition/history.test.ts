import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  annualSeries,
  operatingMarginSeries,
  filedAnnualYearsCount,
  latestAnnualFiscalYear,
  quarterlySeries,
} from "./history";
import { TAG_MAP } from "./tagMap";
import type { CompanyFactsDocument } from "./secClient";

function capture(ticker: string): CompanyFactsDocument {
  return JSON.parse(
    readFileSync(join(__dirname, "captures", `${ticker}-companyfacts.json`), "utf8")
  ) as CompanyFactsDocument;
}

const revenueTags = TAG_MAP.find((e) => e.factId === "current-revenue")!.candidates;
const operatingIncomeTags = TAG_MAP.find((e) => e.factId === "operating-income")!.candidates;

describe("annualSeries — one observation per fiscal year, from one tag", () => {
  const series = annualSeries(capture("msft"), revenueTags);

  it("builds a ten-year-plus revenue series from real filings", () => {
    expect(series).not.toBeNull();
    expect(series!.observations.length).toBeGreaterThanOrEqual(10);
    expect(series!.tag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("is chronological with no duplicated year", () => {
    const years = series!.observations.map((o) => o.fiscalYear);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
    expect(new Set(years).size).toBe(years.length);
  });

  it("keys off the fact's own period, not EDGAR's filing-level fy", () => {
    // The defect this test pins: EDGAR's `fy` names the FILING, so a FY2026
    // 10-K stamps fy=2026 on its FY2024 and FY2025 comparatives too. Grouping
    // by `fy` collapsed the series and put the wrong figure in its last year —
    // the current-period revenue fact and the last year of the series
    // disagreed by two margin points.
    const latest = series!.observations[series!.observations.length - 1];
    expect(latest.fiscalYear).toBe(2026);
    expect(latest.value).toBe(331_839_000_000);
    expect(latest.periodEnd).toBe("2026-06-30");
  });

  it("never mixes two revenue tags into one series", () => {
    // §3.7's mixed basis, in its easiest-to-write-by-accident form: both
    // RevenueFromContractWithCustomer and Revenues are present for Microsoft,
    // each covering part of the window.
    expect(series!.tag).not.toContain(",");
  });

  it("returns null where the filer tags no revenue at all", () => {
    expect(annualSeries(capture("oklo"), revenueTags)).toBeNull();
  });
});

describe("operatingMarginSeries — the history the triggers read", () => {
  const series = operatingMarginSeries(
    annualSeries(capture("msft"), revenueTags),
    annualSeries(capture("msft"), operatingIncomeTags)
  );

  it("agrees with the current-period fact in its most recent year", () => {
    // The series and the headline margin must be the same number. When they
    // are not, one of them is on a different basis and nobody can tell which.
    const latest = series!.years[series!.years.length - 1];
    expect(latest.fiscalYear).toBe(2026);
    expect(latest.margin).toBeCloseTo(0.4678, 4);
  });

  it("reproduces the frozen mock's stated current margin of 46.8%", () => {
    const latest = series!.years[series!.years.length - 1];
    expect((latest.margin * 100).toFixed(1)).toBe("46.8");
  });

  it("lands within a rounding step of the frozen mock's 41.8% ten-year median", () => {
    // Independent corroboration that acquisition is reading the right lines:
    // the mock's own median, computed from a hand-solved reconstruction, and
    // this series, computed from the filings, agree to 0.1pt.
    const last10 = series!.years.slice(-10).map((y) => y.margin).sort((a, b) => a - b);
    const median = (last10[4] + last10[5]) / 2;
    expect(Math.abs(median - 0.418)).toBeLessThan(0.002);
  });

  it("drops a year where one side is missing rather than interpolating", () => {
    const revenue = annualSeries(capture("msft"), revenueTags)!;
    const income = annualSeries(capture("msft"), operatingIncomeTags)!;
    const holed = {
      ...income,
      observations: income.observations.filter((o) => o.fiscalYear !== 2020),
    };
    const result = operatingMarginSeries(revenue, holed);
    expect(result!.years.map((y) => y.fiscalYear)).not.toContain(2020);
    // §5.1: never a prior period carried forward, never an interpolation.
    expect(result!.years.length).toBe(series!.years.length - 1);
  });

  it("returns null for a company with no revenue to divide into", () => {
    expect(
      operatingMarginSeries(
        annualSeries(capture("oklo"), revenueTags),
        annualSeries(capture("oklo"), operatingIncomeTags)
      )
    ).toBeNull();
  });
});

describe("filedAnnualYearsCount — Gate 1's only input", () => {
  it("counts a full history for Microsoft", () => {
    expect(filedAnnualYearsCount(capture("msft"))).toBeGreaterThanOrEqual(10);
  });

  it("counts a short history for Oklo", () => {
    // The point of running OKLO: it is genuinely young, and Gate 1 must see
    // that rather than a capture artefact.
    const count = filedAnnualYearsCount(capture("oklo"));
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });
});

describe("quarterlySeries — discrete quarters, never year-to-date", () => {
  it("returns only rows of a single quarter's duration", () => {
    for (const q of quarterlySeries(capture("msft"), revenueTags)) {
      const days = (Date.parse(q.periodEnd) - Date.parse(q.periodStart)) / 86_400_000;
      expect(days).toBeGreaterThan(60);
      expect(days).toBeLessThan(120);
    }
  });

  it("is chronological, oldest first", () => {
    const ends = quarterlySeries(capture("msft"), revenueTags).map((q) => q.periodEnd);
    expect([...ends].sort()).toEqual(ends);
  });
});

describe("latestAnnualFiscalYear — the period a comparator window is measured against", () => {
  it("is the most recent fiscal year the filer has reported an annual figure for", () => {
    expect(latestAnnualFiscalYear(capture("msft"))).toBe(2026);
    expect(latestAnnualFiscalYear(capture("oklo"))).toBe(2025);
  });

  it("reads the filer's real position independently of any one tag", () => {
    // NVDA retired RevenueFromContractWithCustomerExcludingAssessedTax after
    // its FY2022 10-K. The filer is nonetheless four years further on, and
    // this is the fact that makes the staleness visible.
    //
    // THIS TEST PREVIOUSLY PINNED THE OPPOSITE and said so: under Defect D the
    // comparator was fixed to REFUSE a stale window while acquisition still
    // CHOSE one, and the pin existed so the comparator fix could not quietly
    // become the acquisition change it was deferring. That change has now been
    // made deliberately, under its own TAG_MAPPING_VERSION bump and §3.8.1
    // review (docs/tag-mapping-version-review.md), so the series reaches FY2026
    // and the pin records the transition instead of the deferral.
    //
    // What the assertion still tests is the part that must never change:
    // latestAnnualFiscalYear is TAG-BLIND. It read 2026 when the chosen tag
    // said 2022, and it must go on reading the filer rather than the choice.
    const nvda = capture("nvda");
    expect(latestAnnualFiscalYear(nvda)).toBe(2026);
    expect(annualSeries(nvda, revenueTags)!.observations.at(-1)!.fiscalYear).toBe(2026);
    // The retired element is still there and still stops where it stopped —
    // the tag was not removed from the mapping, it was out-ranked.
    expect(
      annualSeries(nvda, [{ ref: { ns: "us-gaap", tag: "RevenueFromContractWithCustomerExcludingAssessedTax" } }])!
        .observations.at(-1)!.fiscalYear
    ).toBe(2022);
  });

  it("is never older than a series drawn from the same document", () => {
    // The invariant the guard rests on: a series' own rows are annual rows of
    // this document, so the latest annual year is at least the series' end.
    // Were that not so, staleness could not be determined from the record and
    // the defect would lie elsewhere.
    for (const ticker of ["msft", "nvda"]) {
      const doc = capture(ticker);
      const series = annualSeries(doc, revenueTags)!;
      expect(latestAnnualFiscalYear(doc)!).toBeGreaterThanOrEqual(series.observations.at(-1)!.fiscalYear);
    }
  });

  it("returns null where the filer has no annual figure at all", () => {
    expect(latestAnnualFiscalYear({ cik: 0, entityName: "Empty", facts: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The staleness rule, history half. Defect D §6.
//
// `annualSeries` shares `resolveEntry`'s precedence rule, and therefore shared
// its defect: it took the first candidate that yielded any annual observation
// and never asked whether that series was still being reported. The rule is
// the same one, for the same reason, and it is applied here so that the
// headline fact and the history that contextualises it continue to come from
// the same element — which is what the precedence rule was written to protect
// and what the staleness rule must not break.
// ---------------------------------------------------------------------------

describe("annualSeries — a retired candidate does not win over a current one", () => {
  it("builds NVDA's series from the tag that is still being reported", () => {
    // Was: the series ran FY2017→FY2022 off the retired ASC 606 element while
    // us-gaap:Revenues — candidate #2 of the same entry — ran through FY2026.
    const nvda = capture("nvda");
    const series = annualSeries(nvda, revenueTags)!;

    expect(series.tag).toBe("us-gaap:Revenues");
    expect(series.observations.at(-1)!.fiscalYear).toBe(2026);
    expect(series.observations.at(-1)!.value).toBe(215938000000);
    // And it now reaches the filer's own current period, which is the whole
    // point: the comparator no longer has a stale window to refuse.
    expect(series.observations.at(-1)!.fiscalYear).toBe(latestAnnualFiscalYear(nvda));
  });

  it("does not disturb a filer whose first candidate is current", () => {
    // MSFT's ASC 606 element runs to FY2026. §3.7's single-basis rule and the
    // mapping's most-specific-first order are both unchanged here.
    const msft = capture("msft");
    const series = annualSeries(msft, revenueTags)!;

    expect(series.tag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(series.observations.at(-1)!.fiscalYear).toBe(2026);
  });

  it("still returns a series where every candidate has stopped", () => {
    // The same boundary invariant resolveEntry keeps: a short window is a §3.7
    // disclosure, not a reason to return nothing. The comparator decides what
    // to do with it; acquisition does not withhold it.
    const doc: CompanyFactsDocument = {
      cik: 1,
      entityName: "Retired Co",
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                { start: "2020-01-01", end: "2020-12-31", val: 400, form: "10-K", filed: "2021-02-01" },
                { start: "2021-01-01", end: "2021-12-31", val: 500, form: "10-K", filed: "2022-02-01" },
              ],
            },
          },
          OperatingIncomeLoss: {
            units: {
              USD: [{ start: "2025-01-01", end: "2025-12-31", val: 90, form: "10-K", filed: "2026-02-01" }],
            },
          },
        },
      },
    };

    const series = annualSeries(doc, revenueTags)!;
    expect(series.tag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(series.observations).toHaveLength(2);
  });
});
