import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { queuedFacts, exemptFacts, derivedExemptFacts, materialityOf } from "./spotCheck";
import { runCrossChecks, constrainedAndPassedFactIds } from "./crosschecks/run";
import type { CrossCheckFact } from "./crosschecks/types";
import type { FactRecord } from "./types";

// ---------------------------------------------------------------------------
// The derived-fact queue exemption. Command Center ruling, 8 September 2026.
//
// A derived fact leaves the queue only where BOTH hold:
//   1. every component it derives from is itself exempt, AND
//   2. a §3.8.2 cross-check actually covered that fact and passed.
//
// Condition 2 is the one that matters, and the tests below are built to make
// it fail if it is ever dropped. Absence of a cross-check is not evidence of
// one — the same shape as §3.8.1 guard 1.
// ---------------------------------------------------------------------------

const MAPPING = "calboard-secmap-2026-09-1";

function tagged(id: string, value: string): FactRecord {
  return {
    id,
    name: id,
    type: "FACT",
    value: new Decimal(value),
    source: "10-K 2026-06-30 · XBRL tagged element",
    sourceUrl: null,
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "SPOT-CHECK NOT REQUIRED",
    asOfDate: "2026-06-30",
    retrievalTimestamp: "2026-09-08T10:00:00Z",
    supersedesFactId: null,
    tagMappingVersion: MAPPING,
    derivedFrom: null,
  };
}

function derived(id: string, value: string, from: string[]): FactRecord {
  return {
    ...tagged(id, value),
    name: id,
    source: `Derived deterministically from ${from.join(", ")} — inputs recorded per §3.1`,
    verificationState: "SPOT-CHECK PENDING",
    // A derived figure is never tag-mapped: the exemption it may earn is the
    // derived-fact one, not §3.8.1's.
    tagMappingVersion: null,
    derivedFrom: from,
  };
}

// Microsoft's real FY2026 figures.
const OCF = tagged("operating-cash-flow", "182935000000");
const CAPEX = tagged("capex", "115948000000");
const CASH_FCF = derived("cash-fcf", "66987000000", ["operating-cash-flow", "capex"]);

const FACTS: FactRecord[] = [OCF, CAPEX, CASH_FCF];

/** The real §3.8.2 suite, with the rule that constrains cash FCF. */
function evidenceFrom(crossCheckFacts: CrossCheckFact[]) {
  const report = runCrossChecks("MSFT", crossCheckFacts, { ranAt: "2026-09-08T10:00:00Z" });
  return {
    report,
    evidence: { crossCheckConstrainedFactIds: constrainedAndPassedFactIds(report) },
    failed: new Set(report.failedFactIds),
  };
}

const CROSS_CHECK_FACTS_PASSING: CrossCheckFact[] = [
  { factId: "operating-cash-flow", name: "OCF", value: 182_935_000_000, unit: "USD", asOfDate: "2026-06-30" },
  { factId: "capex", name: "Capex", value: 115_948_000_000, unit: "USD", asOfDate: "2026-06-30" },
  { factId: "cash-fcf", name: "Cash FCF", value: 66_987_000_000, unit: "USD", asOfDate: "2026-06-30" },
];

describe("condition 1 and 2 both hold — the fact leaves the queue", () => {
  const { evidence, failed, report } = evidenceFrom(CROSS_CHECK_FACTS_PASSING);

  it("the reconciliation rule actually ran and passed", () => {
    // Guarding the premise: if this rule stopped evaluating, every test below
    // would still pass for the wrong reason.
    const row = report.results.find(
      (r) => r.factId === "cash-fcf" && r.constrainsAgainstRelatedFacts === true
    );
    expect(row?.outcome).toBe("PASS");
    expect(constrainedAndPassedFactIds(report).has("cash-fcf")).toBe(true);
  });

  it("is not queued", () => {
    expect(queuedFacts(FACTS, failed, evidence).map((f) => f.id)).toEqual([]);
  });

  it("carries a reason distinguishable from a fact §3.8 never named", () => {
    const context = {
      exemptFactIds: new Set(["operating-cash-flow", "capex"]),
      crossCheckConstrainedFactIds: evidence.crossCheckConstrainedFactIds,
    };
    const m = materialityOf(CASH_FCF, context);
    expect(m.material).toBe(false);
    expect(m.reason).toBe("DERIVED — COMPONENTS EXEMPT AND CROSS-CHECKED");

    // Without the context it is the fail-closed default, and still material.
    expect(materialityOf(CASH_FCF).reason).toBe("UNRECOGNISED — FAIL-CLOSED");
    expect(materialityOf(CASH_FCF).material).toBe(true);
  });

  it("is shown rather than hidden, and not under the tag-mapping heading", () => {
    // §3.8.1 guard 2's principle: the exemption changes what is queued, not
    // what is carried.
    expect(derivedExemptFacts(FACTS, failed, evidence).map((f) => f.id)).toEqual(["cash-fcf"]);
    expect(exemptFacts(FACTS, failed).map((f) => f.id)).not.toContain("cash-fcf");
  });
});

describe("NO cross-check covers the fact — it stays queued", () => {
  // Same fact, same exempt components. The ONLY difference is that no rule
  // reached it, so nothing has looked at it at all.
  it("is queued when the suite ran but no rule constrained this fact", () => {
    // Drop capex from the cross-check inputs: the cash-FCF rule then reports
    // NOT APPLICABLE rather than PASS.
    const { evidence, failed, report } = evidenceFrom([
      { factId: "operating-cash-flow", name: "OCF", value: 182_935_000_000, unit: "USD", asOfDate: "2026-06-30" },
      { factId: "cash-fcf", name: "Cash FCF", value: 66_987_000_000, unit: "USD", asOfDate: "2026-06-30" },
    ]);

    const row = report.results.find(
      (r) => r.factId === "cash-fcf" && r.family === "RECONCILIATION" && r.check.includes("cash FCF")
    );
    expect(row?.outcome).toBe("NOT APPLICABLE");
    expect(evidence.crossCheckConstrainedFactIds.has("cash-fcf")).toBe(false);

    expect(queuedFacts(FACTS, failed, evidence).map((f) => f.id)).toEqual(["cash-fcf"]);
  });

  it("is queued when no cross-check report exists at all", () => {
    // A caller with no evidence exempts nothing. Fail-closed by construction.
    expect(queuedFacts(FACTS).map((f) => f.id)).toEqual(["cash-fcf"]);
    expect(
      queuedFacts(FACTS, new Set(), { crossCheckConstrainedFactIds: new Set() }).map((f) => f.id)
    ).toEqual(["cash-fcf"]);
  });

  it("is queued when only a check that cannot fail passed", () => {
    // The precise thing condition 2 is written to refuse. A monetary figure
    // with no prior period passes a RANGE SANITY row reading "admits either
    // sign" — true of every number there has ever been. That row must not
    // count as having checked anything.
    const { report } = evidenceFrom([
      { factId: "cash-fcf", name: "Cash FCF", value: 66_987_000_000, unit: "USD", asOfDate: "2026-06-30" },
    ]);
    const rangeRow = report.results.find(
      (r) => r.factId === "cash-fcf" && r.family === "RANGE SANITY" && r.outcome === "PASS"
    );
    expect(rangeRow).toBeDefined();
    expect(rangeRow?.constrainsAgainstRelatedFacts).toBeUndefined();

    const evidence = { crossCheckConstrainedFactIds: constrainedAndPassedFactIds(report) };
    expect(queuedFacts(FACTS, new Set(), evidence).map((f) => f.id)).toEqual(["cash-fcf"]);
  });
});

describe("a FAILING cross-check keeps the fact queued — §3.8.2 is not weakened", () => {
  it("queues the fact when its own reconciliation fails", () => {
    const { evidence, failed } = evidenceFrom([
      { factId: "operating-cash-flow", name: "OCF", value: 182_935_000_000, unit: "USD", asOfDate: "2026-06-30" },
      { factId: "capex", name: "Capex", value: 115_948_000_000, unit: "USD", asOfDate: "2026-06-30" },
      // Wrong by a billion.
      { factId: "cash-fcf", name: "Cash FCF", value: 65_987_000_000, unit: "USD", asOfDate: "2026-06-30" },
    ]);

    expect(failed.has("cash-fcf")).toBe(true);
    expect(evidence.crossCheckConstrainedFactIds.has("cash-fcf")).toBe(false);
    expect(queuedFacts(FACTS, failed, evidence).map((f) => f.id)).toEqual(["cash-fcf"]);
    expect(derivedExemptFacts(FACTS, failed, evidence)).toEqual([]);
  });
});

describe("condition 1 — a queued component keeps the aggregate queued", () => {
  it("is queued when a component is not exempt", () => {
    const { evidence, failed } = evidenceFrom(CROSS_CHECK_FACTS_PASSING);
    // Capex arrives from a feed with no tag mapping, so it is queued — and the
    // aggregate over it is not settled while a human is still looking at it.
    const capexUnmapped: FactRecord = { ...CAPEX, tagMappingVersion: null };
    const facts = [OCF, capexUnmapped, CASH_FCF];

    expect(queuedFacts(facts, failed, evidence).map((f) => f.id)).toEqual(["capex", "cash-fcf"]);
  });

  it("is queued when it declares no components at all", () => {
    const { evidence, failed } = evidenceFrom(CROSS_CHECK_FACTS_PASSING);
    const undeclared: FactRecord = { ...CASH_FCF, derivedFrom: null };
    expect(queuedFacts([OCF, CAPEX, undeclared], failed, evidence).map((f) => f.id)).toEqual([
      "cash-fcf",
    ]);
  });
});

describe("§3.8 is not overruled — the exemption only refines the fail-closed default", () => {
  it("keeps current-operating-margin queued though it satisfies both conditions", () => {
    // Named in §3.8, derived, exempt components, and its reconciliation rule
    // passes. It must still queue: the exemption sits BELOW the NAMED branch,
    // and moving it above would silently drop a figure the spec names.
    const revenue = tagged("current-revenue", "331839000000");
    const operatingIncome = tagged("operating-income", "155237000000");
    const margin = derived("current-operating-margin", "0.4678", [
      "operating-income",
      "current-revenue",
    ]);

    const { evidence, failed } = evidenceFrom([
      { factId: "current-revenue", name: "Revenue", value: 331_839_000_000, unit: "USD", asOfDate: "2026-06-30" },
      { factId: "operating-income", name: "Operating income", value: 155_237_000_000, unit: "USD", asOfDate: "2026-06-30" },
      { factId: "current-operating-margin", name: "Margin", value: 155_237_000_000 / 331_839_000_000, unit: "pure", asOfDate: "2026-06-30" },
    ]);

    // The premise: it DOES satisfy condition 2.
    expect(evidence.crossCheckConstrainedFactIds.has("current-operating-margin")).toBe(true);

    // And it is queued anyway.
    const facts = [revenue, operatingIncome, margin];
    expect(queuedFacts(facts, failed, evidence).map((f) => f.id)).toEqual([
      "current-operating-margin",
    ]);
    expect(
      materialityOf(margin, {
        exemptFactIds: new Set(["current-revenue", "operating-income"]),
        crossCheckConstrainedFactIds: evidence.crossCheckConstrainedFactIds,
      }).reason
    ).toBe("NAMED IN §3.8");
  });
});
