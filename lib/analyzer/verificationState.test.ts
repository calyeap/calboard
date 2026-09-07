import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "../db";
import { createRun, recordFactDecision } from "./runStore";
import { loadGateState, computeAnalysisForRun } from "./gate";
import { queuedFacts, exemptFacts, applyDecisions, deriveVerificationState } from "./spotCheck";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import type { FactRecord } from "./types";

// ---------------------------------------------------------------------------
// The invariant: a queued fact that nobody has decided must never report
// VERIFIED — not on the screen, not on the record, not in the Analysis Result.
//
// It could before. The fixtures write verificationState at acquisition time
// (MSFT's factRow hardcodes VERIFIED on every record), the card derived
// SPOT-CHECK PENDING for display, and the two disagreed. Anything reading the
// record instead of the decision — AnalyzerReport builds its provenance tokens
// straight from `f.verificationState` — got VERIFIED for a fact nobody checked.
// ---------------------------------------------------------------------------

/** Every fact reachable from a run, whatever route it took to get there. */
function statesOf(facts: readonly FactRecord[]): Record<string, string> {
  return Object.fromEntries(facts.map((f) => [f.id, f.verificationState]));
}

describe("the fixtures still carry acquisition-time labels", () => {
  // Not a complaint — this is what makes the derivation necessary, and if it
  // ever changes the rest of this file should be re-read rather than trusted.
  it("MSFT writes VERIFIED on records that are queued and undecided", () => {
    const queued = queuedFacts(MSFT_FIXTURE.facts);
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.some((f) => f.verificationState === "VERIFIED")).toBe(true);
  });
});

describe("deriveVerificationState", () => {
  const base = MSFT_FIXTURE.facts[0];

  it("never returns VERIFIED for a queued fact with no decision", () => {
    expect(deriveVerificationState(base, undefined, true)).not.toBe("VERIFIED");
  });

  it("returns the decision once one exists", () => {
    expect(deriveVerificationState(base, "CONFIRMED", true)).toBe("CONFIRMED");
    expect(deriveVerificationState(base, "NOT CONFIRMED", true)).toBe("NOT CONFIRMED");
  });

  it("marks an exempt fact SPOT-CHECK NOT REQUIRED", () => {
    expect(deriveVerificationState(base, undefined, false)).toBe("SPOT-CHECK NOT REQUIRED");
  });

  // combineProvenance ranks UNVERIFIED above SPOT-CHECK PENDING, so keeping it
  // is the fail-closed direction — the derivation must not upgrade a weaker
  // acquisition state into a tidier-looking one.
  it("keeps UNVERIFIED rather than relabelling it SPOT-CHECK PENDING", () => {
    const unverified: FactRecord = { ...base, verificationState: "UNVERIFIED" };
    expect(deriveVerificationState(unverified, undefined, true)).toBe("UNVERIFIED");
  });
});

describe("applyDecisions over the real fixtures", () => {
  it("leaves no queued, undecided fact reporting VERIFIED", () => {
    for (const fixture of [MSFT_FIXTURE, OKLO_FIXTURE]) {
      const applied = applyDecisions(fixture.facts, new Map());
      const queuedIds = new Set(queuedFacts(fixture.facts).map((f) => f.id));

      for (const fact of applied) {
        if (queuedIds.has(fact.id)) {
          expect(fact.verificationState).not.toBe("VERIFIED");
        }
      }
    }
  });

  it("marks the exempt facts SPOT-CHECK NOT REQUIRED", () => {
    const applied = applyDecisions(MSFT_FIXTURE.facts, new Map());
    const exemptIds = new Set(exemptFacts(MSFT_FIXTURE.facts).map((f) => f.id));
    for (const fact of applied) {
      if (exemptIds.has(fact.id)) {
        expect(fact.verificationState).toBe("SPOT-CHECK NOT REQUIRED");
      }
    }
  });

  it("does not mutate the fixture it was given", () => {
    const before = statesOf(MSFT_FIXTURE.facts);
    applyDecisions(MSFT_FIXTURE.facts, new Map([["capex", "NOT CONFIRMED"]]));
    expect(statesOf(MSFT_FIXTURE.facts)).toEqual(before);
  });
});

describe("a run's facts, end to end", () => {
  beforeEach(async () => {
    await getPool().query(
      "TRUNCATE analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("reports no VERIFIED anywhere on a run whose queue is untouched", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const state = await loadGateState(runId);
    const queuedIds = new Set(queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id));

    for (const fact of state.fixture.facts) {
      if (queuedIds.has(fact.id)) {
        expect(fact.verificationState).not.toBe("VERIFIED");
      }
    }
  });

  it("carries the decisions onto the records, both ways", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const [first, second] = queuedFacts(MSFT_FIXTURE.facts);
    await recordFactDecision(runId, first.id, "CONFIRMED", null);
    await recordFactDecision(runId, second.id, "NOT CONFIRMED", "NOT LOCATED");

    const state = await loadGateState(runId);
    const states = statesOf(state.fixture.facts);
    expect(states[first.id]).toBe("CONFIRMED");
    expect(states[second.id]).toBe("NOT CONFIRMED");
  });

  // The consequence that made this worth fixing: the Analysis Result is what
  // the report renders its provenance tokens from.
  it("does not report VERIFIED in the Analysis Result for a non-confirmed fact", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    for (const fact of queuedFacts(MSFT_FIXTURE.facts)) {
      await recordFactDecision(runId, fact.id, "NOT CONFIRMED", "CONTRADICTED BY SOURCE");
    }

    const result = await computeAnalysisForRun(runId);
    const queuedIds = new Set(queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id));

    for (const fact of result.facts) {
      if (queuedIds.has(fact.id)) {
        expect(fact.verificationState).toBe("NOT CONFIRMED");
      }
    }
  });

  it("reports CONFIRMED in the Analysis Result for a confirmed fact", async () => {
    const runId = await createRun("OKLO", "Oklo Inc.");
    for (const fact of queuedFacts(OKLO_FIXTURE.facts)) {
      await recordFactDecision(runId, fact.id, "CONFIRMED", null);
    }

    const result = await computeAnalysisForRun(runId);
    const queuedIds = new Set(queuedFacts(OKLO_FIXTURE.facts).map((f) => f.id));

    for (const fact of result.facts) {
      if (queuedIds.has(fact.id)) {
        expect(fact.verificationState).toBe("CONFIRMED");
      }
    }
  });

  it("keeps two runs of the same company on their own states", async () => {
    const confirmed = await createRun("MSFT", "Microsoft Corporation");
    const untouched = await createRun("MSFT", "Microsoft Corporation");
    const [first] = queuedFacts(MSFT_FIXTURE.facts);
    await recordFactDecision(confirmed, first.id, "CONFIRMED", null);

    expect(statesOf((await loadGateState(confirmed)).fixture.facts)[first.id]).toBe("CONFIRMED");
    expect(statesOf((await loadGateState(untouched)).fixture.facts)[first.id]).not.toBe(
      "CONFIRMED"
    );
    expect(statesOf((await loadGateState(untouched)).fixture.facts)[first.id]).not.toBe("VERIFIED");
  });
});
