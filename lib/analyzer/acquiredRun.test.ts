import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { buildAcquiredRun, AnalystInputsUnavailableError } from "./acquiredRun";
import { __resetAcquisitionCache } from "./acquisition/provider";
import { assembleAnalysisResult } from "./assemble";
import {
  queuedFacts,
  exemptFacts,
  derivedExemptFacts,
  isSpotCheckComplete,
  applyDecisions,
} from "./spotCheck";
import { constrainedAndPassedFactIds } from "./crosschecks/run";
import { evaluateCompleteness } from "./requiredInputs";
import { boundState, NOT_COMPUTED_BINDING } from "./notComputed";

// ---------------------------------------------------------------------------
// DONE-WHEN 1 and 2, end to end: a real run acquires its own fact set from SEC
// filings, through the M7 gate, to an assembled Analysis Result.
//
// Uses the committed captures — real filing data, taken from EDGAR by
// scripts/analyzer/capture-companyfacts.ts — so the suite does not spend the
// rate budget or depend on the SEC being up.
// ---------------------------------------------------------------------------

const PRICE = {
  value: new Decimal("510.12"),
  timestamp: "2026-09-04T21:00:00-04:00",
  source: "Yahoo Finance latest close",
};

beforeEach(() => __resetAcquisitionCache());

async function msftRun(nonOp: Parameters<typeof buildAcquiredRun>[0]["nonOperatingInvestments"] = null) {
  return buildAcquiredRun({
    ticker: "MSFT",
    price: PRICE,
    source: "CAPTURE",
    acquiredAt: "2026-09-08T10:00:00.000Z",
    nonOperatingInvestments: nonOp,
    fiftyTwoWeek: { low: new Decimal("344.79"), high: new Decimal("555.45") },
  });
}

describe("a real MSFT run, from filings to an Analysis Result", () => {
  it("acquires its fact set from SEC filings, not from a fixture", async () => {
    const run = await msftRun();
    const ids = run.fixture.facts.map((f) => f.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "shares-outstanding",
        "treasury-method-dilution",
        "total-debt",
        "finance-lease-liabilities",
        "cash-and-marketable-debt-securities",
        "current-revenue",
        "capex",
        "finance-lease-rou-additions",
        "price",
      ])
    );

    // Every filing fact names the accession it came from.
    for (const fact of run.fixture.facts) {
      if (fact.tagMappingVersion === null) continue;
      expect(fact.source).toMatch(/accession/);
    }
  });

  it("runs the §3.8.2 cross-checks over every input", async () => {
    const run = await msftRun();
    expect(run.acquired.crossChecks.inputFactIds.length).toBeGreaterThan(10);
    expect(run.acquired.crossChecks.results.length).toBeGreaterThan(30);
  });

  it("assembles a real Analysis Result through the M7 gate", async () => {
    const run = await msftRun();
    const decided = new Map(
      queuedFacts(run.fixture.facts, run.acquired.crossCheckFailedFactIds).map((f) => [
        f.id,
        "CONFIRMED" as const,
      ])
    );
    const facts = applyDecisions(run.fixture.facts, decided, run.acquired.crossCheckFailedFactIds);

    expect(isSpotCheckComplete(facts, new Set(decided.keys()), run.acquired.crossCheckFailedFactIds)).toBe(
      true
    );

    const result = assembleAnalysisResult({ ...run.fixture, facts });
    expect(result.ticker).toBe("MSFT");
    expect(result.facts.length).toBeGreaterThan(10);
    // The margin history is real: eleven filed years off the tagged elements.
    expect(result.diagnostics.marginHistory.suppressed).toBe(false);
  });

  it("returns INCOMPLETE for enterprise value until the §4.4 judgment is made", async () => {
    const run = await msftRun();
    const result = assembleAnalysisResult(run.fixture);

    expect(result.diagnostics.enterpriseValue.suppressed).toBe(true);
    if (result.diagnostics.enterpriseValue.suppressed) {
      expect(result.diagnostics.enterpriseValue.state).toBe("INCOMPLETE");
      expect(result.diagnostics.enterpriseValue.cause).toContain(
        "nonOperatingEquityInvestmentsAtBook"
      );
    }
  });

  it("computes enterprise value once the analyst classifies the investments", async () => {
    // The judgment §4.4 requires, made explicitly: Microsoft's two tagged
    // equity-investment line items, carried at book.
    const run = await msftRun({
      tags: [
        "us-gaap:EquityMethodInvestments",
        "us-gaap:EquitySecuritiesWithoutReadilyDeterminableFairValueAmount",
      ],
      value: new Decimal("24400000000"),
      errorDirection: "understates",
    });

    const result = assembleAnalysisResult(run.fixture);
    expect(result.diagnostics.enterpriseValue.suppressed).toBe(false);

    if (!result.diagnostics.enterpriseValue.suppressed) {
      const bridge = result.diagnostics.enterpriseValue.value;
      // Every component is a real filing figure.
      expect(bridge.totalDebt.toString()).toBe("40294000000");
      expect(bridge.financeLeaseLiabilities.toString()).toBe("66594000000");
      expect(bridge.cashAndMarketableDebtSecurities.toString()).toBe("76843000000");
      // Market cap uses cover-page shares PLUS treasury-method dilution, never
      // the weighted-average diluted count (§3.5).
      const expectedShares = new Decimal("7425545491").plus("24000000");
      expect(bridge.marketCap.toString()).toBe(expectedShares.mul(PRICE.value).toString());
    }
  });

  it("queues price and current-operating-margin, and nothing else", async () => {
    // The 8 September ruling, on the real fact set. price is guard 1 — a feed
    // with no tag mapping. current-operating-margin is named in §3.8. Both are
    // spec requirements and the derived-fact exemption must not touch either,
    // even though the margin satisfies both its conditions.
    const run = await msftRun();
    const evidence = {
      crossCheckConstrainedFactIds: constrainedAndPassedFactIds(run.acquired.crossChecks),
    };
    const queued = queuedFacts(
      run.fixture.facts,
      run.acquired.crossCheckFailedFactIds,
      evidence
    ).map((f) => f.id);

    expect(queued.sort()).toEqual(["current-operating-margin", "price"]);
  });

  it("exempts net-debt and cash-fcf, shown but not queued", async () => {
    const run = await msftRun();
    const evidence = {
      crossCheckConstrainedFactIds: constrainedAndPassedFactIds(run.acquired.crossChecks),
    };
    const shown = derivedExemptFacts(
      run.fixture.facts,
      run.acquired.crossCheckFailedFactIds,
      evidence
    ).map((f) => f.id);

    expect(shown.sort()).toEqual(["cash-fcf", "net-debt"]);
    // Still carried, not hidden (§3.8.1 guard 2's principle).
    for (const id of shown) {
      expect(run.fixture.facts.some((f) => f.id === id)).toBe(true);
    }
  });

  it("discloses what on the run was not acquired", async () => {
    const run = await msftRun();
    const joined = run.disclosures.join(" ");

    // The substance, in the analyst's vocabulary.
    expect(joined).toContain("scenarios");
    expect(joined).toContain("NOT acquired");
    expect(joined).toMatch(/non-operating/i);
    expect(joined).toMatch(/SEC filings/);
  });

  it("puts no section reference in front of the analyst", async () => {
    // Gate-2's fix, undone by M8-a's new copy and restored here. Section
    // numbers address the contract, not the reader — the report layer already
    // strips them from its own prose, and Screen 2 must not reintroduce them.
    const run = await msftRun();
    for (const line of run.disclosures) {
      expect(line).not.toMatch(/§/);
    }
  });
});

describe("a real OKLO run — pre-revenue, thinner filings", () => {
  async function oklo() {
    return buildAcquiredRun({
      ticker: "OKLO",
      price: { value: new Decimal("92.44"), timestamp: "2026-09-04T21:00:00-04:00", source: "Yahoo Finance latest close" },
      source: "CAPTURE",
      acquiredAt: "2026-09-08T10:00:00.000Z",
    });
  }

  it("acquires the pre-revenue limb and assembles a result", async () => {
    const run = await oklo();
    const ids = run.fixture.facts.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["cash-balance", "quarterly-burn", "shares-outstanding"]));

    const result = assembleAnalysisResult(run.fixture);
    expect(result.ticker).toBe("OKLO");
  });

  // CB-AUDIT-FIX-01B / CB-AUDIT-01 H4c and H2. The validation set has no
  // growth, margin or reinvestment drivers for OKLO (it carries 0 as a
  // placeholder for all nine) and no revaluation of the base case at other
  // rates (it carries a constant $31). A live run carries neither.
  it("carries no placeholder scenario drivers and no placeholder revaluation — both report INCOMPLETE", async () => {
    const run = await oklo();
    for (const s of ["bear", "base", "bull"] as const) {
      const d = run.fixture.scenarios[s];
      expect(d.revenueGrowthOrPath).toBeNull();
      expect(d.operatingMargin).toBeNull();
      expect(d.reinvestmentCapitalIntensity).toBeNull();
      expect(d.writtenAnchor.length).toBeGreaterThan(0);
    }
    expect(run.fixture.revalueBaseCaseAtRate).toBeNull();

    const result = assembleAnalysisResult(run.fixture);
    expect(boundState(result.states, NOT_COMPUTED_BINDING.scenarioDrivers("base"))?.state).toBe("INCOMPLETE");
    expect(boundState(result.states, NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice)?.state).toBe("INCOMPLETE");
    expect(run.disclosures.join(" ")).toMatch(/OKLO/);
  });

  it("reports more absent inputs than Microsoft, and names each", async () => {
    const oklo_ = await oklo();
    __resetAcquisitionCache();
    const msft = await msftRun();
    expect(oklo_.absentInputs.length).toBeGreaterThan(msft.absentInputs.length);
    for (const name of oklo_.absentInputs) expect(name.length).toBeGreaterThan(2);
  });

  it("returns INCOMPLETE across the FCF definitions rather than defaulting a lease field to zero", async () => {
    // §5.4's cascade, on the company that actually triggers it. Oklo tags no
    // finance-lease ROU additions, so unlevered FCF and FCF after
    // lease-funded capacity lose a REQUIRED input.
    const run = await oklo();
    const completeness = evaluateCompleteness({
      availableFactIds: new Set(run.fixture.facts.map((f) => f.id)),
    });
    const fcf = completeness.find((o) => o.outputId === "fcf-definitions");
    expect(fcf?.state).toBe("INCOMPLETE");
    expect(fcf?.blockedBy.map((b) => b.factId)).toContain("finance-lease-rou-additions");
  });

  it("keeps every tag-mapped fact exempt and every derived one queued", async () => {
    const run = await oklo();
    const exempt = exemptFacts(run.fixture.facts, run.acquired.crossCheckFailedFactIds);
    for (const fact of exempt) expect(fact.tagMappingVersion).not.toBeNull();

    const queued = queuedFacts(run.fixture.facts, run.acquired.crossCheckFailedFactIds);
    for (const fact of queued) {
      // A queued fact is queued because it has no mapping version, or because
      // a cross-check failed on it. Never for any other reason.
      const forced = run.acquired.crossCheckFailedFactIds.has(fact.id);
      expect(fact.tagMappingVersion === null || forced).toBe(true);
    }
  });
});

describe("a company with no analyst input bundle", () => {
  it("refuses rather than inventing scenarios", async () => {
    await expect(
      buildAcquiredRun({ ticker: "NVDA", price: PRICE, source: "CAPTURE" })
    ).rejects.toBeInstanceOf(AnalystInputsUnavailableError);
  });
});
