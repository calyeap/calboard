import { describe, it, expect } from "vitest";
import { resolveEntry, candidateInvestmentLineItems } from "./selectTagged";
import type { CompanyFactsDocument } from "./secClient";
import type { TagMapEntry } from "./tagMap";

function doc(facts: CompanyFactsDocument["facts"]): CompanyFactsDocument {
  return { cik: 1, entityName: "Test Co", facts };
}

const instantEntry: TagMapEntry = {
  factId: "cash-and-marketable-debt-securities",
  name: "Cash and marketable debt securities",
  period: "instant",
  unit: "USD",
  candidates: [
    {
      ref: { ns: "us-gaap", tag: "CashAndCashEquivalentsAtCarryingValue" },
      plus: [{ ns: "us-gaap", tag: "ShortTermInvestments" }],
    },
  ],
  basis: "test",
};

const annualEntry: TagMapEntry = {
  factId: "current-revenue",
  name: "Revenue",
  period: "duration",
  duration: "annual",
  unit: "USD",
  candidates: [
    { ref: { ns: "us-gaap", tag: "RevenueFromContractWithCustomerExcludingAssessedTax" } },
    { ref: { ns: "us-gaap", tag: "Revenues" } },
  ],
  basis: "test",
};

const quarterEntry: TagMapEntry = {
  factId: "quarterly-burn",
  name: "Quarterly burn",
  period: "duration",
  duration: "quarter",
  unit: "USD",
  candidates: [{ ref: { ns: "us-gaap", tag: "NetCashProvidedByUsedInOperatingActivities" } }],
  basis: "test",
};

describe("resolveEntry — picking the right period", () => {
  it("takes the latest instant from an eligible filing", () => {
    const d = doc({
      "us-gaap": {
        CashAndCashEquivalentsAtCarryingValue: {
          units: {
            USD: [
              { end: "2025-06-30", val: 100, form: "10-K", filed: "2025-07-30" },
              { end: "2026-06-30", val: 200, form: "10-K", filed: "2026-07-30" },
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, instantEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(200);
    expect(r.value.asOfDate).toBe("2026-06-30");
  });

  it("refuses to read a quarterly duration as an annual figure", () => {
    // The 4x error that looks plausible. Only a quarter is present, and the
    // annual entry must fail rather than take it.
    const d = doc({
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { start: "2026-04-01", end: "2026-06-30", val: 25, form: "10-Q", filed: "2026-07-30" },
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("NO_PERIOD_MATCH");
  });

  it("refuses to read an annual duration as a quarterly figure", () => {
    const d = doc({
      "us-gaap": {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              { start: "2025-07-01", end: "2026-06-30", val: -400, form: "10-K", filed: "2026-07-30" },
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, quarterEntry);
    expect(r.outcome).toBe("NO_PERIOD_MATCH");
  });

  it("picks the quarter, not the year-to-date, for a quarterly entry", () => {
    const d = doc({
      "us-gaap": {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              // Six-month year-to-date — must not win a quarterly entry.
              { start: "2026-01-01", end: "2026-06-30", val: -120, form: "10-Q", filed: "2026-08-01" },
              // The quarter itself.
              { start: "2026-04-01", end: "2026-06-30", val: -65, form: "10-Q", filed: "2026-08-01" },
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, quarterEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(-65);
  });

  it("prefers the annual report over a quarterly one for the same period end", () => {
    const d = doc({
      "us-gaap": {
        CashAndCashEquivalentsAtCarryingValue: {
          units: {
            USD: [
              { end: "2026-06-30", val: 199, form: "10-Q", filed: "2026-08-01" },
              { end: "2026-06-30", val: 200, form: "10-K", filed: "2026-07-30" },
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, instantEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(200);
    expect(r.value.form).toBe("10-K");
  });
});

describe("resolveEntry — candidate order", () => {
  it("takes the first candidate that resolves and records which one", () => {
    const d = doc({
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [{ start: "2025-07-01", end: "2026-06-30", val: 331, form: "10-K", filed: "2026-07-30" }],
          },
        },
        Revenues: {
          units: {
            USD: [{ start: "2025-07-01", end: "2026-06-30", val: 999, form: "10-K", filed: "2026-07-30" }],
          },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(331);
    expect(r.value.contributingTags[0].ref.tag).toBe(
      "RevenueFromContractWithCustomerExcludingAssessedTax"
    );
  });

  it("falls through to the next candidate when the first is absent", () => {
    const d = doc({
      "us-gaap": {
        Revenues: {
          units: {
            USD: [{ start: "2025-07-01", end: "2026-06-30", val: 999, form: "10-K", filed: "2026-07-30" }],
          },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.contributingTags[0].ref.tag).toBe("Revenues");
  });

  it("distinguishes a tag that is absent from one with no matching period", () => {
    expect(resolveEntry(doc({}), annualEntry).outcome).toBe("NO_TAG_IN_FILINGS");
  });
});

describe("resolveEntry — summed components", () => {
  it("sums a component at exactly the same period", () => {
    const d = doc({
      "us-gaap": {
        CashAndCashEquivalentsAtCarryingValue: {
          units: { USD: [{ end: "2026-06-30", val: 20_935, form: "10-K", filed: "2026-07-30" }] },
        },
        ShortTermInvestments: {
          units: { USD: [{ end: "2026-06-30", val: 55_908, form: "10-K", filed: "2026-07-30" }] },
        },
      },
    });

    const r = resolveEntry(d, instantEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(76_843);
    expect(r.value.contributingTags).toHaveLength(2);
    expect(r.value.absentComponents).toHaveLength(0);
  });

  it("refuses a component from a different period and records it as absent", () => {
    // Summing this year's cash with last year's short-term investments gives a
    // figure belonging to no date that would pass any magnitude-based check.
    const d = doc({
      "us-gaap": {
        CashAndCashEquivalentsAtCarryingValue: {
          units: { USD: [{ end: "2026-06-30", val: 20_935, form: "10-K", filed: "2026-07-30" }] },
        },
        ShortTermInvestments: {
          units: { USD: [{ end: "2025-06-30", val: 70_000, form: "10-K", filed: "2025-07-30" }] },
        },
      },
    });

    const r = resolveEntry(d, instantEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(20_935);
    expect(r.value.absentComponents.map((c) => c.tag)).toEqual(["ShortTermInvestments"]);
  });

  it("records an absent component rather than summing it as zero", () => {
    const d = doc({
      "us-gaap": {
        CashAndCashEquivalentsAtCarryingValue: {
          units: { USD: [{ end: "2026-06-30", val: 1_644, form: "10-Q", filed: "2026-08-04" }] },
        },
      },
    });

    const r = resolveEntry(d, instantEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(1_644);
    expect(r.value.absentComponents.map((c) => c.tag)).toEqual(["ShortTermInvestments"]);
  });
});

describe("candidateInvestmentLineItems", () => {
  it("returns each candidate with its own book value and never picks one", () => {
    const d = doc({
      "us-gaap": {
        EquityMethodInvestments: {
          units: { USD: [{ end: "2026-06-30", val: 12_000, form: "10-K", filed: "2026-07-30" }] },
        },
        EquitySecuritiesWithoutReadilyDeterminableFairValueAmount: {
          units: { USD: [{ end: "2026-06-30", val: 12_400, form: "10-K", filed: "2026-07-30" }] },
        },
      },
    });

    const items = candidateInvestmentLineItems(d, [
      { ns: "us-gaap", tag: "EquityMethodInvestments" },
      { ns: "us-gaap", tag: "EquitySecuritiesWithoutReadilyDeterminableFairValueAmount" },
      { ns: "us-gaap", tag: "NotTagged" },
    ]);

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.value)).toEqual([12_000, 12_400]);
  });
});
