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

// ---------------------------------------------------------------------------
// The staleness rule. Defect D, acquisition half.
//
// `resolveEntry` took the first candidate that yielded anything and never
// asked whether the series it had just chosen was still being reported. NVDA
// retired RevenueFromContractWithCustomerExcludingAssessedTax after its FY2022
// 10-K, so a §3.8 material fact — the headline current-period revenue —
// resolved to $26.9bn as of January 2022 against a real FY2026 $215.9bn, and
// nothing said so.
//
// The rule added below is deliberately narrow. It DISQUALIFIES a retired
// candidate only where another candidate is current; it never refuses to
// resolve. That bound is load-bearing rather than cautious: refusing would
// move the fact off the §3.8.1 exempt side of the line and into the
// spot-check queue, which changes WHICH facts are exempt rather than only
// which values they carry — a Command Center decision, not an acquisition fix.
// ---------------------------------------------------------------------------

/** A 10-K annual row, written the way EDGAR emits one. */
function annual(start: string, end: string, val: number, filed: string) {
  return { start, end, val, form: "10-K", filed };
}

describe("resolveEntry — a retired candidate does not win over a current one", () => {
  it("skips the first candidate where its series has stopped and a later one is current", () => {
    // NVDA's shape exactly: candidate #1 ends four years before the filer does.
    const d = doc({
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              annual("2020-01-27", "2021-01-31", 16675, "2021-02-26"),
              annual("2021-02-01", "2022-01-30", 26914, "2022-03-18"),
            ],
          },
        },
        Revenues: {
          units: {
            USD: [
              annual("2021-02-01", "2022-01-30", 26914, "2022-03-18"),
              annual("2025-01-27", "2026-01-25", 215938, "2026-02-25"),
            ],
          },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.value).toBe(215938);
    expect(r.value.asOfDate).toBe("2026-01-25");
    expect(r.value.contributingTags[0].ref.tag).toBe("Revenues");
  });

  it("leaves a healthy series alone — mapping order still decides", () => {
    // The eight companies Defect D showed were current. Both candidates reach
    // the filer's latest year, so the mapping's own most-specific-first order
    // is what chooses, exactly as before.
    const d = doc({
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [annual("2025-07-01", "2026-06-30", 331839, "2026-07-30")] },
        },
        Revenues: {
          units: { USD: [annual("2025-07-01", "2026-06-30", 999999, "2026-07-30")] },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.contributingTags[0].ref.tag).toBe(
      "RevenueFromContractWithCustomerExcludingAssessedTax"
    );
    expect(r.value.value).toBe(331839);
  });

  it("still resolves where EVERY candidate is stale, and does not move the fact off the exempt path", () => {
    // THE §3.8.1 BOUNDARY INVARIANT. A filer whose revenue tags all stopped
    // is still a filer whose revenue fact was acquired through the mapping.
    // Refusing here would silently re-queue a material fact — the one outcome
    // this fix may not have.
    const d = doc({
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: { USD: [annual("2021-01-01", "2021-12-31", 500, "2022-02-01")] },
        },
        Revenues: {
          units: { USD: [annual("2020-01-01", "2020-12-31", 400, "2021-02-01")] },
        },
        // The filer itself is four years further on, under some other element.
        OperatingIncomeLoss: {
          units: { USD: [annual("2025-01-01", "2025-12-31", 90, "2026-02-01")] },
        },
      },
    });

    const r = resolveEntry(d, annualEntry);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.contributingTags[0].ref.tag).toBe(
      "RevenueFromContractWithCustomerExcludingAssessedTax"
    );
    expect(r.value.value).toBe(500);
  });

  it("is inert where the filer has filed no annual figure at all", () => {
    // Nothing to measure staleness against, so the rule cannot fire and
    // mapping order is untouched. Fail-safe, not fail-closed: there is no
    // evidence of retirement here, only absence of evidence.
    const d = doc({
      "us-gaap": {
        Revenues: {
          units: {
            USD: [{ start: "2026-04-01", end: "2026-06-30", val: 42, form: "10-Q", filed: "2026-07-30" }],
          },
        },
      },
    });

    expect(resolveEntry(d, annualEntry).outcome).toBe("NO_PERIOD_MATCH");
  });

  it("applies to instants too — a balance-sheet element a filer stopped tagging", () => {
    // COST stopped tagging us-gaap:LongTermDebt in 2022 while continuing to
    // report debt; the mapping's second candidate is the one still alive.
    const instantTwoCandidates: TagMapEntry = {
      factId: "total-debt",
      name: "Total debt",
      period: "instant",
      unit: "USD",
      candidates: [
        { ref: { ns: "us-gaap", tag: "LongTermDebt" } },
        { ref: { ns: "us-gaap", tag: "DebtLongtermAndShorttermCombinedAmount" } },
      ],
      basis: "test",
    };

    const d = doc({
      "us-gaap": {
        LongTermDebt: { units: { USD: [{ end: "2022-05-08", val: 6618, form: "10-Q", filed: "2022-06-01" }] } },
        DebtLongtermAndShorttermCombinedAmount: {
          units: { USD: [{ end: "2026-05-10", val: 5670, form: "10-Q", filed: "2026-06-01" }] },
        },
        Revenues: { units: { USD: [annual("2025-09-01", "2026-08-30", 275235, "2026-10-01")] } },
      },
    });

    const r = resolveEntry(d, instantTwoCandidates);
    expect(r.outcome).toBe("RESOLVED");
    if (r.outcome !== "RESOLVED") return;
    expect(r.value.contributingTags[0].ref.tag).toBe("DebtLongtermAndShorttermCombinedAmount");
  });
});
