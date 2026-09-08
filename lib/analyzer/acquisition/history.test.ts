import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  annualSeries,
  operatingMarginSeries,
  filedAnnualYearsCount,
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
