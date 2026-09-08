import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acquire } from "./acquire";
import { TAG_MAPPING_VERSION } from "./tagMap";
import { runCrossChecks, assertEveryInputReported } from "../crosschecks/run";
import { queuedFacts, exemptFacts } from "../spotCheck";
import type { CompanyFactsDocument } from "./secClient";

// ---------------------------------------------------------------------------
// Acquisition against REAL filings.
//
// The captures under ./captures are byte-exact slices of what EDGAR returned
// (see scripts/analyzer/capture-companyfacts.ts). No figure asserted below was
// written by hand: each one is checked against the filing, and several are
// checked against the frozen mock's own disclosed numbers, which is what makes
// this a test of acquisition rather than a test of a fixture.
// ---------------------------------------------------------------------------

function capture(ticker: string): CompanyFactsDocument {
  const path = join(__dirname, "captures", `${ticker.toLowerCase()}-companyfacts.json`);
  return JSON.parse(readFileSync(path, "utf8")) as CompanyFactsDocument;
}

const ACQUIRED_AT = "2026-09-08T10:00:00.000Z";

function acquireMsft() {
  return acquire({
    ticker: "MSFT",
    cik: "0000789019",
    companyName: "MICROSOFT CORP",
    companyFacts: capture("msft"),
    price: {
      value: new Decimal("510.12"),
      timestamp: "2026-09-04T21:00:00-04:00",
      source: "Yahoo Finance latest close",
    },
    acquiredAt: ACQUIRED_AT,
  });
}

function acquireOklo() {
  return acquire({
    ticker: "OKLO",
    cik: "0001849056",
    companyName: "Oklo Inc.",
    companyFacts: capture("oklo"),
    price: {
      value: new Decimal("92.44"),
      timestamp: "2026-09-04T21:00:00-04:00",
      source: "Yahoo Finance latest close",
    },
    acquiredAt: ACQUIRED_AT,
  });
}

function valueOf(result: ReturnType<typeof acquire>, factId: string): string {
  const fact = result.facts.find((f) => f.id === factId);
  if (!fact) throw new Error(`no fact ${factId}`);
  return String(fact.value);
}

describe("MSFT — the figures acquisition takes off the real filing", () => {
  const result = acquireMsft();

  it("reproduces the frozen mock's finance-lease liabilities exactly", () => {
    // mock-report-msft.html: "$66.6B of finance leases".
    expect(valueOf(result, "finance-lease-liabilities")).toBe("66594000000");
  });

  it("reproduces the frozen mock's net debt of $30.0B from its own components", () => {
    // The check that settled the "cash and marketable debt securities" mapping.
    expect(valueOf(result, "total-debt")).toBe("40294000000");
    expect(valueOf(result, "cash-and-marketable-debt-securities")).toBe("76843000000");
    expect(valueOf(result, "net-debt")).toBe("30045000000");
  });

  it("takes the cover-page share count, not the weighted-average diluted count", () => {
    // §3.5 refuses the weighted-average count in terms. 7,453,000,000 is the
    // diluted WAS and must not appear here.
    expect(valueOf(result, "shares-outstanding")).toBe("7425545491");
  });

  it("acquires treasury-method dilution as a tagged element", () => {
    expect(valueOf(result, "treasury-method-dilution")).toBe("24000000");
  });

  it("acquires the ROU-assets-obtained disclosure, not the lease-liability change", () => {
    // §3.6's worked case. The frozen spec quotes $24.6B against a $20.4B
    // liability change; this is the $24.6B.
    expect(valueOf(result, "finance-lease-rou-additions")).toBe("24608000000");
  });

  it("derives the operating margin from two acquired facts, recording both", () => {
    expect(valueOf(result, "current-revenue")).toBe("331839000000");
    expect(valueOf(result, "operating-income")).toBe("155237000000");
    const margin = result.facts.find((f) => f.id === "current-operating-margin");
    expect(new Decimal(String(margin?.value)).toFixed(4)).toBe("0.4678");
    expect(margin?.source).toContain("operating-income, current-revenue");
  });
});

describe("every acquired fact carries all seven §3.2 fields", () => {
  const result = acquireMsft();

  it("populates each field separately, with source class and extraction type never collapsed", () => {
    for (const fact of result.facts) {
      expect(fact.type).toBeTruthy();
      expect(fact.source).toBeTruthy();
      expect(fact.sourceClass).toBe("PRIMARY");
      expect(fact.extractionType).toBe("DETERMINISTIC/STRUCTURED");
      expect(fact.verificationState).toBeTruthy();
      expect(fact.asOfDate).toBeTruthy();
      expect(fact.retrievalTimestamp).toBe(ACQUIRED_AT);
    }
  });

  it("identifies the source precisely enough to re-fetch", () => {
    const debt = result.facts.find((f) => f.id === "total-debt");
    expect(debt?.source).toContain("10-K");
    expect(debt?.source).toContain("accession");
    expect(debt?.source).toContain("us-gaap:LongTermDebt");
    expect(debt?.sourceUrl).toContain("sec.gov/Archives/edgar/data/789019");
  });

  it("records the mapping version on every tagged fact and on no derived one", () => {
    const tagged = result.facts.filter((f) => f.tagMappingVersion !== null);
    expect(tagged.length).toBeGreaterThan(0);
    for (const f of tagged) expect(f.tagMappingVersion).toBe(TAG_MAPPING_VERSION);

    // §3.8.1 guard 1: a deterministic parse is not a tag lookup, so a derived
    // figure carries no mapping version and is queued.
    for (const id of ["current-operating-margin", "net-debt", "cash-fcf", "price"]) {
      expect(result.facts.find((f) => f.id === id)?.tagMappingVersion).toBeNull();
    }
  });
});

describe("§3.8.1 — what is exempt and what is queued", () => {
  const result = acquireMsft();

  it("exempts tag-mapped facts from the queue and no others", () => {
    const exempt = exemptFacts(result.facts).map((f) => f.id);
    expect(exempt).toContain("total-debt");
    expect(exempt).toContain("finance-lease-liabilities");
    expect(exempt).not.toContain("price");
    expect(exempt).not.toContain("current-operating-margin");
  });

  it("queues the price despite its DETERMINISTIC/STRUCTURED label", () => {
    // Guard 1, on a real fact: a structured feed field with no mapping version
    // is queued. Absence of a recorded mapping version is not evidence of one.
    const queued = queuedFacts(result.facts).map((f) => f.id);
    expect(queued).toContain("price");
  });

  it("queues every derived figure", () => {
    const queued = queuedFacts(result.facts).map((f) => f.id);
    expect(queued).toEqual(
      expect.arrayContaining(["current-operating-margin", "net-debt", "cash-fcf"])
    );
  });
});

describe("§3.8.1 — the fallback report is a list of facts", () => {
  it("names every MSFT fallback with which of the three reasons applied", () => {
    const { fallbackReport } = acquireMsft();
    for (const record of fallbackReport.records) {
      expect(record.factId).toBeTruthy();
      expect(record.reason).toBeTruthy();
      expect(record.detail.length).toBeGreaterThan(10);
      expect(record.tagMappingVersion).toBe(TAG_MAPPING_VERSION);
      expect(record.valueAcquired).toBe(false);
    }
    // The judgment and the price are NOT fallbacks — one is §4.4's
    // classification, the other comes from a feed and is acquired.
    const ids = fallbackReport.records.map((r) => r.factId);
    expect(ids).not.toContain("price");
    expect(ids).not.toContain("non-operating-equity-investments");
  });

  it("reports OKLO's thinner filings as more fallbacks, each named", () => {
    const oklo = acquireOklo().fallbackReport;
    const msft = acquireMsft().fallbackReport;
    expect(oklo.records.length).toBeGreaterThan(msft.records.length);
    for (const record of oklo.records) {
      expect(["NO TAG EXISTS", "TAG PRESENT BUT UNMAPPED IN VERSION IN FORCE"]).toContain(
        record.reason
      );
    }
  });
});

describe("§4.4 — non-operating investments are candidates, never a mapping", () => {
  it("presents MSFT's tagged equity-investment line items without choosing one", () => {
    const { candidateNonOperatingInvestments, facts } = acquireMsft();
    const tags = candidateNonOperatingInvestments.map((c) => c.tag);
    expect(tags).toContain("us-gaap:EquityMethodInvestments");
    expect(tags).toContain("us-gaap:EquitySecuritiesWithoutReadilyDeterminableFairValueAmount");

    // And nothing was acquired as the fact itself.
    expect(facts.find((f) => f.id === "non-operating-equity-investments")).toBeUndefined();
  });
});

describe("OKLO — pre-revenue, and the filings are thinner", () => {
  const result = acquireOklo();

  it("acquires the pre-revenue limb's cash balance and share count", () => {
    expect(valueOf(result, "cash-balance")).toBe("1644704000");
    expect(valueOf(result, "shares-outstanding")).toBe("186017650");
  });

  it("takes quarterly burn as a single quarter, never a year-to-date figure", () => {
    const burn = result.facts.find((f) => f.id === "quarterly-burn");
    expect(burn).toBeDefined();
    const asOf = String(burn?.asOfDate);
    const [start, end] = asOf.split(" to ");
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    expect(days).toBeLessThan(120);
    expect(days).toBeGreaterThan(60);
  });

  it("acquires no revenue, because there is none to acquire", () => {
    expect(result.facts.find((f) => f.id === "current-revenue")).toBeUndefined();
    expect(result.fallbackReport.records.map((r) => r.factId)).toContain("current-revenue");
  });

  it("records no ROU additions rather than defaulting the field to zero", () => {
    // §5.4's worked case, on the company that actually lacks it. Oklo DOES tag
    // a finance-lease LIABILITY ($187k), and tags no ROU-assets-obtained
    // disclosure at all — so the liability is acquired and the additions fall
    // back. An engineer tempted to default the additions to zero, or to derive
    // them from the liability, should read §3.6 and §5.4 again: the change in
    // the liability nets off principal repayments and is a different quantity.
    expect(valueOf(result, "finance-lease-liabilities")).toBe("187000");
    expect(result.facts.find((f) => f.id === "finance-lease-rou-additions")).toBeUndefined();
    expect(result.fallbackReport.records.map((r) => r.factId)).toContain(
      "finance-lease-rou-additions"
    );
  });
});

describe("the cross-check suite runs on every acquired input", () => {
  it("covers every MSFT input in all three families", () => {
    const { crossCheckFacts } = acquireMsft();
    const report = runCrossChecks("MSFT", crossCheckFacts, { ranAt: ACQUIRED_AT });
    expect(() => assertEveryInputReported(report)).not.toThrow();
    expect(report.inputFactIds.length).toBeGreaterThan(10);
  });

  it("covers every OKLO input in all three families", () => {
    const { crossCheckFacts } = acquireOklo();
    const report = runCrossChecks("OKLO", crossCheckFacts, { ranAt: ACQUIRED_AT });
    expect(() => assertEveryInputReported(report)).not.toThrow();
  });

  it("foots MSFT's real long-term debt against its current/noncurrent split", () => {
    const { crossCheckFacts } = acquireMsft();
    const report = runCrossChecks("MSFT", crossCheckFacts, { ranAt: ACQUIRED_AT });
    const footing = report.results.find(
      (r) => r.factId === "total-debt" && r.family === "FOOTING" && r.check.includes("sum")
    );
    expect(footing?.outcome).toBe("PASS");
    expect(footing?.detail).toContain("9,227,000,000");
    expect(footing?.detail).toContain("31,067,000,000");
  });

  it("reconciles MSFT's treasury-method dilution against diluted less basic", () => {
    const { crossCheckFacts } = acquireMsft();
    const report = runCrossChecks("MSFT", crossCheckFacts, { ranAt: ACQUIRED_AT });
    const row = report.results.find(
      (r) => r.factId === "treasury-method-dilution" && r.family === "RECONCILIATION"
    );
    expect(row?.outcome).toBe("PASS");
  });
});
