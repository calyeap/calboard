import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { queuedFacts, exemptFacts, isSpotCheckComplete } from "./spotCheck";
import { evaluateCompleteness, dependentsOf } from "./requiredInputs";
import { runCrossChecks } from "./crosschecks/run";
import type { CrossCheckFact } from "./crosschecks/types";
import type { FactRecord } from "./types";

// ---------------------------------------------------------------------------
// DONE-WHEN 5, demonstrated rather than asserted:
//
//   "A cross-check failure is shown forcing a fact into the queue and
//    returning INCOMPLETE for a dependent."
//
// The fact chosen is deliberately a TAG-MAPPED one. §3.8.1 would exempt it
// from the queue; §3.8.2 says a failed cross-check forces it in "whatever its
// acquisition path". If the exemption won, the compensating control the
// exemption itself rests on would be unenforceable — so this test is really
// about which of the two rules outranks the other.
// ---------------------------------------------------------------------------

function taggedFact(id: string, name: string, value: Decimal): FactRecord {
  return {
    id,
    name,
    type: "FACT",
    value,
    source: "FY2026 Form 10-K, XBRL tagged element",
    sourceUrl: null,
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "SPOT-CHECK NOT REQUIRED",
    asOfDate: "2026-06-30",
    retrievalTimestamp: "2026-09-08T10:00:00Z",
    supersedesFactId: null,
    tagMappingVersion: "calboard-secmap-2026-09-1",
  };
}

const facts: FactRecord[] = [
  taggedFact("total-debt", "Total debt", new Decimal("40294000000")),
  taggedFact("finance-lease-liabilities", "Finance lease liabilities", new Decimal("66594000000")),
];

describe("a tag-mapped fact is exempt until a cross-check fails on it", () => {
  it("is exempt and not queued while every cross-check passes", () => {
    expect(queuedFacts(facts).map((f) => f.id)).toEqual([]);
    expect(exemptFacts(facts).map((f) => f.id)).toEqual([
      "total-debt",
      "finance-lease-liabilities",
    ]);
  });

  it("is forced into the queue by a failed cross-check, despite the tag mapping", () => {
    const failed = new Set(["total-debt"]);

    expect(queuedFacts(facts, failed).map((f) => f.id)).toEqual(["total-debt"]);
    // And it leaves the exempt set in the same move — it must not be displayed
    // as SPOT-CHECK NOT REQUIRED while sitting in the queue.
    expect(exemptFacts(facts, failed).map((f) => f.id)).toEqual(["finance-lease-liabilities"]);
  });

  it("blocks Step 2 completion until the forced fact carries a decision", () => {
    const failed = new Set(["total-debt"]);
    expect(isSpotCheckComplete(facts, new Set(), failed)).toBe(false);
    expect(isSpotCheckComplete(facts, new Set(["total-debt"]), failed)).toBe(true);
  });
});

describe("a failed cross-check returns INCOMPLETE for its REQUIRED dependents", () => {
  // The whole EV input set is present and acquired — nothing is missing.
  const acquired = new Set([
    "shares-outstanding",
    "treasury-method-dilution",
    "price",
    "total-debt",
    "finance-lease-liabilities",
    "cash-and-marketable-debt-securities",
    "non-operating-equity-investments",
    "enterprise-value",
  ]);

  it("is COMPLETE when nothing has failed", () => {
    const ev = evaluateCompleteness({ availableFactIds: acquired }).find(
      (o) => o.outputId === "enterprise-value"
    );
    expect(ev?.state).toBe("COMPLETE");
  });

  it("turns INCOMPLETE when a REQUIRED input fails a cross-check, though the value exists", () => {
    const results = evaluateCompleteness({
      availableFactIds: acquired,
      crossCheckFailedFactIds: new Set(["total-debt"]),
    });

    const ev = results.find((o) => o.outputId === "enterprise-value");
    expect(ev?.state).toBe("INCOMPLETE");
    expect(ev?.blockedBy).toEqual([{ factId: "total-debt", reason: "CROSS-CHECK FAILED" }]);

    // The cascade reaches every dependent, not only the first.
    const leverage = results.find((o) => o.outputId === "leverage-precondition");
    expect(leverage?.state).toBe("INCOMPLETE");

    // And it does NOT reach outputs that do not depend on it.
    const gate1 = results.find((o) => o.outputId === "gate-1");
    expect(gate1?.blockedBy.some((b) => b.factId === "total-debt")).toBe(false);
  });

  it("names the dependents a failing fact takes down", () => {
    expect(dependentsOf("total-debt").map((g) => g.id)).toEqual([
      "enterprise-value",
      "leverage-precondition",
    ]);
  });
});

describe("end to end: a real failing figure drives both consequences", () => {
  it("fails footing, forces the queue, and returns INCOMPLETE for enterprise value", () => {
    // Microsoft's real FY2026 components, with the noncurrent portion mistyped
    // — the kind of single-figure acquisition defect §3.8.2 exists to catch.
    const crossCheckFacts: CrossCheckFact[] = [
      {
        factId: "total-debt",
        name: "Total debt",
        value: 40_294_000_000,
        unit: "USD",
        asOfDate: "2026-06-30",
        components: [
          { name: "LongTermDebtCurrent", value: 9_227_000_000 },
          { name: "LongTermDebtNoncurrent", value: 3_106_700_000 },
        ],
      },
    ];

    const report = runCrossChecks("MSFT", crossCheckFacts, { ranAt: "2026-09-08T10:00:00Z" });
    expect(report.failedFactIds).toEqual(["total-debt"]);

    const failed = new Set(report.failedFactIds);

    // Consequence 1 — the queue, despite the tag mapping.
    expect(queuedFacts(facts, failed).map((f) => f.id)).toEqual(["total-debt"]);

    // Consequence 2 — INCOMPLETE for the dependent.
    const ev = evaluateCompleteness({
      availableFactIds: new Set([...facts.map((f) => f.id), "shares-outstanding",
        "treasury-method-dilution", "price", "cash-and-marketable-debt-securities",
        "non-operating-equity-investments"]),
      crossCheckFailedFactIds: failed,
    }).find((o) => o.outputId === "enterprise-value");
    expect(ev?.state).toBe("INCOMPLETE");

    // Consequence 3 — nothing was rewritten. The acquired record is untouched.
    const totalDebt = facts.find((f) => f.id === "total-debt");
    expect(String(totalDebt?.value)).toBe("40294000000");
    expect(totalDebt?.tagMappingVersion).toBe("calboard-secmap-2026-09-1");
  });
});
