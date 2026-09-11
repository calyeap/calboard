import { describe, it, expect } from "vitest";
import {
  materialityOf,
  isExemptFromQueue,
  queuedFacts,
  exemptFacts,
  isSpotCheckComplete,
  undecidedFacts,
} from "./spotCheck";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import type { FactRecord } from "./types";
import Decimal from "decimal.js";

function fact(over: Partial<FactRecord> = {}): FactRecord {
  return {
    id: "some-fact",
    name: "Some fact",
    type: "FACT",
    value: new Decimal(1),
    source: "10-K",
    sourceUrl: null,
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "SPOT-CHECK PENDING",
    asOfDate: "FY2026",
    retrievalTimestamp: "2026-09-04T21:04:00-04:00",
    supersedesFactId: null,
    tagMappingVersion: null,
    derivedFrom: null,
    ...over,
  };
}

describe("materialityOf", () => {
  it("recognises §3.8's named categories by fact id", () => {
    expect(materialityOf(fact({ id: "capex" })).reason).toBe("NAMED IN §3.8");
    expect(materialityOf(fact({ id: "total-debt" })).reason).toBe("NAMED IN §3.8");
    expect(materialityOf(fact({ id: "quarterly-burn" })).reason).toBe("NAMED IN §3.8");
  });

  // Two limbs, not three: §3.8's "any figure classified UNVERIFIED" limb has no
  // carrier on a FactRecord since M7 moved UNVERIFIED to the §5.1 propagation
  // state. A fact that would have matched it is queued by the fail-closed
  // default instead.
  it("recognises the classification limbs whatever the fact id", () => {
    expect(materialityOf(fact({ id: "obscure", sourceClass: "SECONDARY" })).reason).toBe(
      "CLASSIFIED SECONDARY"
    );
    expect(materialityOf(fact({ id: "obscure", extractionType: "AI-EXTRACTED" })).reason).toBe(
      "CLASSIFIED AI-EXTRACTED"
    );
  });

  // The ruling of 7 September 2026: an unrecognised fact staying in the queue
  // costs a spot-check; one skipping it costs the thing the queue exists for.
  it("fails closed on a fact nothing recognises, and says so", () => {
    const unknown = fact({ id: "a-figure-nobody-mapped" });
    const result = materialityOf(unknown);
    expect(result.material).toBe(true);
    expect(result.reason).toBe("UNRECOGNISED — FAIL-CLOSED");
  });
});

describe("isExemptFromQueue", () => {
  it("exempts a fact carrying a real tag-mapping version", () => {
    expect(isExemptFromQueue(fact({ tagMappingVersion: "us-gaap-2026" }))).toBe(true);
  });

  it("queues a fact with no mapping version, however deterministic its label", () => {
    expect(
      isExemptFromQueue(fact({ extractionType: "DETERMINISTIC/STRUCTURED", tagMappingVersion: null }))
    ).toBe(false);
  });

  // §3.8.1 guard 1, stated as a test because the label is the tempting test
  // and the spec explicitly refuses it.
  it("never grants the exemption on extraction type alone", () => {
    const structuredButUnmapped = fact({
      id: "aggregator-field",
      extractionType: "DETERMINISTIC/STRUCTURED",
      tagMappingVersion: null,
    });
    expect(isExemptFromQueue(structuredButUnmapped)).toBe(false);
    expect(queuedFacts([structuredButUnmapped])).toHaveLength(1);
  });

  // The concrete shape of the OKLO regression: an unsound `as FactRecord[]`
  // assertion left this field undefined at runtime while the type claimed
  // string|null. A `!== null` test would have read undefined as a mapping
  // version and skipped the fact entirely.
  it("treats a missing field as queued, not exempt, when the type has been lied to", () => {
    const lying = { ...fact(), tagMappingVersion: undefined } as unknown as FactRecord;
    expect(isExemptFromQueue(lying)).toBe(false);
  });

  it("treats an empty-string mapping version as no mapping version", () => {
    expect(isExemptFromQueue(fact({ tagMappingVersion: "" }))).toBe(false);
  });
});

describe("the queue over the real fixtures", () => {
  it("queues MSFT's AI-extracted and aggregator facts, exempting only the tagged ones", () => {
    const queued = queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id);
    const exempt = exemptFacts(MSFT_FIXTURE.facts).map((f) => f.id);

    expect(queued).toEqual(["finance-lease-rou-additions", "current-operating-margin"]);
    expect(exempt).toEqual(["finance-lease-liabilities", "operating-lease-liabilities"]);
  });

  it("queues OKLO's one real pre-revenue fact — no quarterly-burn FactRecord, since no acquired figure for it exists (CB-AUDIT-01 H3)", () => {
    const queued = queuedFacts(OKLO_FIXTURE.facts).map((f) => f.id);
    expect(queued).toEqual(["cash-per-share"]);
    expect(exemptFacts(OKLO_FIXTURE.facts)).toHaveLength(0);
  });

  it("shows exempt facts rather than hiding them — every fact is accounted for", () => {
    for (const fixture of [MSFT_FIXTURE, OKLO_FIXTURE]) {
      const total = queuedFacts(fixture.facts).length + exemptFacts(fixture.facts).length;
      expect(total).toBe(fixture.facts.length);
    }
  });

  it("keeps the queue in fact-set order, so a resumed run presents the same sequence", () => {
    const once = queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id);
    const twice = queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id);
    expect(once).toEqual(twice);
  });
});

describe("isSpotCheckComplete", () => {
  const facts = MSFT_FIXTURE.facts;
  const queuedIds = queuedFacts(facts).map((f) => f.id);

  it("is false with nothing decided", () => {
    expect(isSpotCheckComplete(facts, new Set())).toBe(false);
  });

  it("is false with the queue only partly decided", () => {
    expect(isSpotCheckComplete(facts, new Set([queuedIds[0]]))).toBe(false);
  });

  it("is true once every queued fact carries a decision", () => {
    expect(isSpotCheckComplete(facts, new Set(queuedIds))).toBe(true);
  });

  // §3.8.3: the two decisions count identically toward completion. Cannot
  // verify blocks dependents through §5, not through the gate.
  it("does not care which decision was taken, only that one was", () => {
    // The predicate is given only ids; a queue answered entirely with Cannot
    // verify presents here exactly as one answered with Confirm.
    expect(isSpotCheckComplete(facts, new Set(queuedIds))).toBe(true);
  });

  it("is not satisfied by decisions on exempt facts standing in for queued ones", () => {
    const exemptIds = exemptFacts(facts).map((f) => f.id);
    expect(isSpotCheckComplete(facts, new Set(exemptIds))).toBe(false);
  });

  it("is not satisfied by decisions on facts that are not in this run at all", () => {
    expect(isSpotCheckComplete(facts, new Set(["not-a-fact", "also-not-a-fact"]))).toBe(false);
  });
});

describe("undecidedFacts", () => {
  it("returns the queue in order, minus what has been decided", () => {
    const facts = MSFT_FIXTURE.facts;
    const [first] = queuedFacts(facts);
    const remaining = undecidedFacts(facts, new Set([first.id]));
    expect(remaining.map((f) => f.id)).toEqual(["current-operating-margin"]);
  });

  it("is empty exactly when the spot-check is complete", () => {
    const facts = OKLO_FIXTURE.facts;
    const all = new Set(queuedFacts(facts).map((f) => f.id));
    expect(undecidedFacts(facts, all)).toHaveLength(0);
    expect(isSpotCheckComplete(facts, all)).toBe(true);
  });
});
