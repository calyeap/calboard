import { describe, it, expect } from "vitest";
import { footingChecks } from "./footing";
import { reconciliationChecks } from "./reconciliation";
import { rangeSanityChecks } from "./rangeSanity";
import { runCrossChecks, assertEveryInputReported } from "./run";
import type { CrossCheckFact } from "./types";

// ---------------------------------------------------------------------------
// THE NEGATIVE TESTS. Required by the dispatch, not optional.
//
// "Four instances in two days on this project of a check that cannot fail
// reporting success. For each cross-check family, show the case that makes it
// FAIL and confirm you watched it fail. A cross-check suite that has never
// failed is not a control, it is a formality."
//
// Each block below is a PAIR: the passing case and the failing case, built
// from the same fact with one figure moved. The pairing is the point — a test
// that only asserts FAIL could pass against a check hard-wired to fail, and a
// test that only asserts PASS is the formality this file exists to refuse.
// ---------------------------------------------------------------------------

const asOf = "2026-06-30";

describe("FOOTING — the family fails when components do not sum to the total", () => {
  const base: CrossCheckFact = {
    factId: "total-debt",
    name: "Total debt",
    value: 40_294_000_000,
    unit: "USD",
    asOfDate: asOf,
    components: [
      { name: "LongTermDebtCurrent", value: 9_227_000_000 },
      { name: "LongTermDebtNoncurrent", value: 31_067_000_000 },
    ],
  };

  it("passes on Microsoft's real FY2026 long-term debt split", () => {
    // 9,227 + 31,067 = 40,294 exactly, from the real filing.
    const [sumCheck] = footingChecks(base);
    expect(sumCheck.outcome).toBe("PASS");
  });

  it("FAILS when the noncurrent component is off by a single million", () => {
    const broken: CrossCheckFact = {
      ...base,
      components: [
        { name: "LongTermDebtCurrent", value: 9_227_000_000 },
        { name: "LongTermDebtNoncurrent", value: 31_066_000_000 },
      ],
    };
    const [sumCheck] = footingChecks(broken);
    expect(sumCheck.outcome).toBe("FAIL");
    expect(sumCheck.detail).toContain("difference");
  });

  it("FAILS when the same quantity disagrees with itself across two statements", () => {
    const broken: CrossCheckFact = {
      factId: "shares-outstanding",
      name: "Shares outstanding",
      value: 7_425_545_491,
      unit: "shares",
      asOfDate: asOf,
      alsoStatedAs: [
        // A balance-sheet count an order of magnitude out — the kind of
        // transcription error the OKLO share-count error in the caveat
        // register actually was.
        { where: "balance sheet", value: 742_700_000, toleranceFraction: 0.02 },
      ],
    };
    const results = footingChecks(broken);
    const agreement = results.find((r) => r.check.includes("agrees with itself"));
    expect(agreement?.outcome).toBe("FAIL");
  });

  it("passes the same agreement check within the cover-page/balance-sheet tolerance", () => {
    const ok: CrossCheckFact = {
      factId: "shares-outstanding",
      name: "Shares outstanding",
      value: 7_425_545_491,
      unit: "shares",
      asOfDate: asOf,
      // The real pair: cover page 23 July, balance sheet 30 June.
      alsoStatedAs: [{ where: "balance sheet", value: 7_427_000_000, toleranceFraction: 0.02 }],
    };
    const agreement = footingChecks(ok).find((r) => r.check.includes("agrees with itself"));
    expect(agreement?.outcome).toBe("PASS");
  });
});

describe("RECONCILIATION — the family fails when a figure contradicts its related facts", () => {
  function facts(dilution: number): CrossCheckFact[] {
    return [
      {
        factId: "treasury-method-dilution",
        name: "Treasury-method dilution",
        value: dilution,
        unit: "shares",
        asOfDate: asOf,
      },
      {
        factId: "weighted-average-diluted-shares",
        name: "Diluted WAS",
        value: 7_453_000_000,
        unit: "shares",
        asOfDate: asOf,
      },
      {
        factId: "weighted-average-basic-shares",
        name: "Basic WAS",
        value: 7_429_000_000,
        unit: "shares",
        asOfDate: asOf,
      },
    ];
  }

  it("passes on the real figure: diluted less basic is exactly the tagged dilution", () => {
    const results = reconciliationChecks(facts(24_000_000));
    const row = results.find(
      (r) => r.factId === "treasury-method-dilution" && r.check.includes("diluted less basic")
    );
    expect(row?.outcome).toBe("PASS");
  });

  it("FAILS when the mapping has taken the wrong tag for treasury-method dilution", () => {
    // What a mis-mapped tag looks like: the diluted share COUNT picked up
    // instead of the incremental shares. Plausible in isolation, contradicted
    // by the two facts it must agree with.
    const results = reconciliationChecks(facts(7_453_000_000));
    const row = results.find(
      (r) => r.factId === "treasury-method-dilution" && r.check.includes("diluted less basic")
    );
    expect(row?.outcome).toBe("FAIL");
  });

  it("FAILS when net debt contradicts the debt and cash lines it is built from", () => {
    const results = reconciliationChecks([
      { factId: "net-debt", name: "Net debt", value: 1_000, unit: "USD", asOfDate: asOf },
      { factId: "total-debt", name: "Debt", value: 40_294, unit: "USD", asOfDate: asOf },
      {
        factId: "finance-lease-liabilities",
        name: "Finance leases",
        value: 66_594,
        unit: "USD",
        asOfDate: asOf,
      },
      {
        factId: "cash-and-marketable-debt-securities",
        name: "Cash",
        value: 76_843,
        unit: "USD",
        asOfDate: asOf,
      },
    ]);
    const row = results.find((r) => r.factId === "net-debt");
    expect(row?.outcome).toBe("FAIL");
    // The real answer is 30,045; the check reports both sides rather than
    // correcting the figure.
    expect(row?.detail).toContain("30,045");
  });

  it("FAILS a balance that is byte-identical across two different periods", () => {
    const results = reconciliationChecks([
      {
        factId: "cash-balance",
        name: "Cash",
        value: 1_644_704_000,
        unit: "USD",
        asOfDate: "2026-06-30",
        priorPeriod: { value: 1_644_704_000, asOfDate: "2026-03-31" },
      },
    ]);
    const row = results.find((r) => r.check.includes("continuity"));
    expect(row?.outcome).toBe("FAIL");
  });

  it("passes continuity when the balance actually moved", () => {
    const results = reconciliationChecks([
      {
        factId: "cash-balance",
        name: "Cash",
        value: 1_644_704_000,
        unit: "USD",
        asOfDate: "2026-06-30",
        priorPeriod: { value: 1_500_000_000, asOfDate: "2026-03-31" },
      },
    ]);
    const row = results.find((r) => r.check.includes("continuity"));
    expect(row?.outcome).toBe("PASS");
  });
});

describe("RANGE SANITY — the family fails on a units or scale break", () => {
  it("passes on a real operating margin held as a fraction", () => {
    const row = rangeSanityChecks({
      factId: "current-operating-margin",
      name: "Operating margin",
      value: 0.4678,
      unit: "pure",
      asOfDate: asOf,
    })[0];
    expect(row.outcome).toBe("PASS");
  });

  it("FAILS a margin stored as a percentage where a fraction belongs", () => {
    const row = rangeSanityChecks({
      factId: "current-operating-margin",
      name: "Operating margin",
      value: 46.78,
      unit: "pure",
      asOfDate: asOf,
    })[0];
    expect(row.outcome).toBe("FAIL");
  });

  it("does NOT fail a genuinely negative margin, which is a fact about a loss-maker", () => {
    // Guarding the guard: a check that fired here would flag every pre-revenue
    // company, which is the opposite of a control.
    const row = rangeSanityChecks({
      factId: "current-operating-margin",
      name: "Operating margin",
      value: -101.5,
      unit: "pure",
      asOfDate: asOf,
    })[0];
    expect(row.outcome).toBe("PASS");
  });

  it("FAILS a thousand-fold scale break against the prior period", () => {
    const rows = rangeSanityChecks({
      factId: "cash-balance",
      name: "Cash",
      value: 1_644_704_000_000,
      unit: "USD",
      asOfDate: "2026-06-30",
      priorPeriod: { value: 1_644_704_000, asOfDate: "2026-03-31" },
    });
    const row = rows.find((r) => r.check.includes("scale break"));
    expect(row?.outcome).toBe("FAIL");
    expect(row?.detail).toContain("units error");
  });

  it("FAILS a share count moving by an order of magnitude between periods", () => {
    const rows = rangeSanityChecks({
      factId: "shares-outstanding",
      name: "Shares outstanding",
      value: 1_850_901_550,
      unit: "shares",
      asOfDate: "2026-06-30",
      priorPeriod: { value: 185_090_155, asOfDate: "2026-03-31" },
    });
    const row = rows.find((r) => r.check.includes("scale break"));
    expect(row?.outcome).toBe("FAIL");
  });

  it("does NOT fail a large but legitimate move in a monetary figure", () => {
    // Oklo's real FY2024 -> FY2025 capex: $0.35m to $33.2m as construction
    // starts. A 94x move, and a fact about the company rather than a defect.
    // The order-of-magnitude limb is scoped to share counts precisely because
    // failing this would return INCOMPLETE "until resolved by re-acquisition",
    // and re-acquiring a correct figure yields the same number — blocking the
    // output with no way out.
    const rows = rangeSanityChecks({
      factId: "capex",
      name: "Capex",
      value: 33_205_000,
      unit: "USD",
      asOfDate: "2025-12-31",
      priorPeriod: { value: 352_000, asOfDate: "2024-12-31" },
    });
    const row = rows.find((r) => r.check.includes("scale break"));
    expect(row?.outcome).toBe("PASS");
  });

  it("still FAILS a monetary figure on a 10^6 scale break", () => {
    // The limb that does cover monetary figures, and the one the spec states
    // without qualification. Narrowing the order-of-magnitude test must not
    // have left money unguarded.
    const rows = rangeSanityChecks({
      factId: "capex",
      name: "Capex",
      value: 33_205_000_000_000,
      unit: "USD",
      asOfDate: "2025-12-31",
      priorPeriod: { value: 33_205_000, asOfDate: "2024-12-31" },
    });
    const row = rows.find((r) => r.check.includes("scale break"));
    expect(row?.outcome).toBe("FAIL");
    expect(row?.detail).toContain("units error");
  });

  it("passes an ordinary period-over-period move", () => {
    const rows = rangeSanityChecks({
      factId: "shares-outstanding",
      name: "Shares outstanding",
      value: 185_090_155,
      unit: "shares",
      asOfDate: "2026-06-30",
      priorPeriod: { value: 184_000_000, asOfDate: "2026-03-31" },
    });
    const row = rows.find((r) => r.check.includes("scale break"));
    expect(row?.outcome).toBe("PASS");
  });

  it("FAILS a negative share count", () => {
    const row = rangeSanityChecks({
      factId: "shares-outstanding",
      name: "Shares outstanding",
      value: -100,
      unit: "shares",
      asOfDate: asOf,
    })[0];
    expect(row.outcome).toBe("FAIL");
  });
});

describe("the suite reports an outcome for every input in every family", () => {
  const facts: CrossCheckFact[] = [
    { factId: "capex", name: "Capex", value: 115_948, unit: "USD", asOfDate: asOf },
    { factId: "sbc", name: "SBC", value: 12_405, unit: "USD", asOfDate: asOf },
  ];

  it("covers each input three times over, even where nothing applies", () => {
    const report = runCrossChecks("MSFT", facts, { ranAt: asOf });
    expect(() => assertEveryInputReported(report)).not.toThrow();
    for (const factId of ["capex", "sbc"]) {
      const families = new Set(
        report.results.filter((r) => r.factId === factId).map((r) => r.family)
      );
      expect([...families].sort()).toEqual(["FOOTING", "RANGE SANITY", "RECONCILIATION"]);
    }
  });

  it("the coverage assertion itself FAILS when a family is missing", () => {
    // The negative test for the reporting guarantee, not just for the checks.
    // Without this, assertEveryInputReported is a function that has never said
    // no — which is the formality this file exists to refuse.
    const report = runCrossChecks("MSFT", facts, { ranAt: asOf });
    const mutilated = {
      ...report,
      results: report.results.filter((r) => !(r.factId === "sbc" && r.family === "FOOTING")),
    };
    expect(() => assertEveryInputReported(mutilated)).toThrow(/sbc\/FOOTING/);
  });

  it("collects every failing fact id so the queue can be forced", () => {
    const report = runCrossChecks(
      "MSFT",
      [
        {
          factId: "current-operating-margin",
          name: "Operating margin",
          value: 46.78,
          unit: "pure",
          asOfDate: asOf,
        },
        ...facts,
      ],
      { ranAt: asOf }
    );
    expect(report.failedFactIds).toEqual(["current-operating-margin"]);
  });
});
