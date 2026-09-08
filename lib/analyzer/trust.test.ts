import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeTrustStatus, type TrustInput } from "./trust";
import { assembleAnalysisResult, type CompanyFixture } from "./assemble";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import type { AnalysisResult, FactRecord } from "./types";

// ---------------------------------------------------------------------------
// §9.6 — trust status, the eleventh §10.0.1 member.
//
// "Derivation — evaluated in this order, first match wins. Every input is a
// state this document already computes; nothing new is measured."
//
//   1. UNUSABLE — a §9.3 suppressing state removes the fair-value range under
//      §10.3, OR a REQUIRED input of the range is INCOMPLETE
//   2. PARTIAL  — the range renders, and any of: a §9.4 qualifying flag is
//      active on the valuation path; a material fact is NOT CONFIRMED; a
//      §3.8.2 cross-check failed; a REQUIRED input of any other output is
//      INCOMPLETE
//   3. CLEAN    — the range renders and none of the above holds
//
// THE ONE-SOURCE PROPERTY, which is the point of building this beside Fix 1
// rather than after it: rule 1's condition is the condition Fix 1 already
// decided. Trust reads the OUTCOME — a suppressed range — rather than
// re-deriving the predicate, so the two cannot disagree.
// ---------------------------------------------------------------------------

/** A trust input built from an assembled result, with nothing else active. */
function inputFor(result: AnalysisResult, overrides: Partial<TrustInput> = {}): TrustInput {
  return {
    fairValueRange: result.fairValueRange,
    states: result.states,
    facts: result.facts,
    diagnostics: result.diagnostics,
    profileHumanConfirmed: true,
    crossCheckFailedFactIds: [],
    ...overrides,
  };
}

/** MSFT levered past the §6.5 threshold — the range goes, Gate 0 still passes. */
function msftLevered(): CompanyFixture {
  return {
    ...MSFT_FIXTURE,
    leverage: { ...MSFT_FIXTURE.leverage, totalDebt: new Decimal(1200) },
  };
}

/** A result with no qualifying flags and no suppressed diagnostics to find. */
function cleanish(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    states: { suppressing: [], qualifying: [] },
    facts: [],
    diagnostics: {} as AnalysisResult["diagnostics"],
  };
}

function factNotConfirmed(): FactRecord {
  return {
    id: "revenue-fy2026",
    name: "Revenue",
    type: "FACT",
    value: new Decimal(270),
    source: "FY2026 10-K",
    sourceUrl: null,
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "NOT CONFIRMED",
    asOfDate: "2026-06-30",
    retrievalTimestamp: "2026-09-08T00:00:00.000Z",
    supersedesFactId: null,
    tagMappingVersion: "v1",
    derivedFrom: null,
  };
}

describe("§9.6 rule 1 — UNUSABLE", () => {
  it("is UNUSABLE where a §9.3 state removed the fair-value range", () => {
    const result = assembleAnalysisResult(msftLevered());
    expect(result.fairValueRange.kind).toBe("suppressed");

    expect(computeTrustStatus(inputFor(result)).status).toBe("UNUSABLE");
  });

  it("names the state that determined UNUSABLE (§10.0.1 — 'with the states that determined it')", () => {
    const result = assembleAnalysisResult(msftLevered());

    const trust = computeTrustStatus(inputFor(result));
    expect(trust.determinedBy.map((d) => d.detail).join(" ")).toContain("LEVERAGE UNSUPPORTED IN v1");
  });

  it("beats every PARTIAL condition — first match wins", () => {
    // A levered run that ALSO has a qualifying flag, an unconfirmed fact and a
    // failed cross-check is still UNUSABLE, not PARTIAL.
    const result = assembleAnalysisResult(msftLevered());

    const trust = computeTrustStatus(
      inputFor(result, {
        facts: [factNotConfirmed()],
        crossCheckFailedFactIds: ["revenue-fy2026"],
        profileHumanConfirmed: false,
      })
    );
    expect(trust.status).toBe("UNUSABLE");
  });
});

describe("§9.6 rule 2 — PARTIAL", () => {
  it("is PARTIAL where the range renders and a §9.4 qualifying flag is active", () => {
    // MSFT fires trigger A, so MARGIN AT HISTORICAL HIGH is active on the
    // valuation path while the range renders (V4).
    const result = assembleAnalysisResult(MSFT_FIXTURE);
    expect(result.fairValueRange.kind).toBe("range");
    expect(result.states.qualifying.some((q) => q.flag === "MARGIN AT HISTORICAL HIGH")).toBe(true);

    expect(computeTrustStatus(inputFor(result)).status).toBe("PARTIAL");
  });

  it("is PARTIAL where a material fact is NOT CONFIRMED", () => {
    const result = cleanish(assembleAnalysisResult(MSFT_FIXTURE));

    const trust = computeTrustStatus(inputFor(result, { facts: [factNotConfirmed()] }));
    expect(trust.status).toBe("PARTIAL");
    expect(trust.determinedBy.map((d) => d.detail).join(" ")).toContain("Revenue");
  });

  it("is PARTIAL where a §3.8.2 cross-check failed", () => {
    const result = cleanish(assembleAnalysisResult(MSFT_FIXTURE));

    const trust = computeTrustStatus(inputFor(result, { crossCheckFailedFactIds: ["shares-outstanding"] }));
    expect(trust.status).toBe("PARTIAL");
  });

  it("is PARTIAL where the profile is not human-confirmed (§6.3)", () => {
    // §6.3: "Trust status falls to PARTIAL on the §9.4 flag and the fair-value
    // range still renders."
    const result = cleanish(assembleAnalysisResult(MSFT_FIXTURE));

    const trust = computeTrustStatus(inputFor(result, { profileHumanConfirmed: false }));
    expect(trust.status).toBe("PARTIAL");
    expect(trust.determinedBy.map((d) => d.detail).join(" ")).toContain("PROFILE NOT CONFIRMED");
  });

  it("is PARTIAL where a REQUIRED input of some other output is INCOMPLETE", () => {
    // OKLO's reverse-DCF cells are INCOMPLETE while its distribution summary
    // renders — the range stands and named parts of the analysis do not, which
    // is exactly what PARTIAL says.
    const result = assembleAnalysisResult(OKLO_FIXTURE);
    expect(result.fairValueRange.kind).toBe("pre-revenue-distribution");

    expect(computeTrustStatus(inputFor(result)).status).toBe("PARTIAL");
  });
});

describe("§9.6 rule 3 — CLEAN", () => {
  it("is CLEAN where the range renders and nothing qualifies it", () => {
    const result = cleanish(assembleAnalysisResult(MSFT_FIXTURE));

    const trust = computeTrustStatus(inputFor(result));
    expect(trust.status).toBe("CLEAN");
    expect(trust.determinedBy).toEqual([]);
  });
});

describe("§10.0.1 — trust is a member of the Analysis Result", () => {
  it("is carried on the assembled result, not computed by the renderer", () => {
    // §10.0.2 rule 3: "No figure appears in the rendered report that is not in
    // the result object." A trust status the page worked out for itself is the
    // same defect as a figure the renderer invented.
    const result = assembleAnalysisResult(MSFT_FIXTURE);

    expect(result.trust.status).toBe("PARTIAL");
  });

  it("is UNUSABLE on the assembled result where the range was suppressed", () => {
    const result = assembleAnalysisResult(msftLevered());

    expect(result.trust.status).toBe("UNUSABLE");
    expect(result.trust.determinedBy.map((d) => d.detail).join(" ")).toContain(
      "LEVERAGE UNSUPPORTED IN v1"
    );
  });
});

describe("the one-source property — trust and the range cannot disagree", () => {
  it("is UNUSABLE exactly when the fair-value range is suppressed", () => {
    // The reason Fix 1 and Fix 2 are one job. If trust ever re-derived §10.3
    // instead of reading its outcome, this is the test that would catch the
    // two drifting apart.
    const fixtures: CompanyFixture[] = [
      MSFT_FIXTURE,
      OKLO_FIXTURE,
      msftLevered(),
      { ...MSFT_FIXTURE, gate0: { ...MSFT_FIXTURE.gate0, sectorClassification: "Financials" } },
      { ...MSFT_FIXTURE, gate0: { ...MSFT_FIXTURE.gate0, sectorClassification: null, industryClassification: null } },
    ];

    for (const fixture of fixtures) {
      const result = assembleAnalysisResult(fixture);
      const trust = computeTrustStatus(inputFor(result));

      expect(trust.status === "UNUSABLE").toBe(result.fairValueRange.kind === "suppressed");
    }
  });
});
