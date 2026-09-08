import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "../db";
import { createRun, recordFactDecision } from "./runStore";
import { loadGateState, computeAnalysisForRun } from "./gate";

/**
 * The facts THIS RUN actually queues.
 *
 * Since M8-a the fact set is acquired from SEC filings per run, so the queue
 * belongs to the run rather than to a fixture constant. Asking the gate also
 * exercises the same queue the route enforces.
 */
async function queuedIdsForRun(runId: string): Promise<string[]> {
  return (await loadGateState(runId)).outstandingFactIds;
}

import { queuedFacts, exemptFacts, applyDecisions, deriveVerificationState } from "./spotCheck";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import { VERIFICATION_STATES, type FactRecord } from "./types";

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

describe("the fixtures carry acquisition-time labels", () => {
  // The fixtures no longer write VERIFIED — that value left the union when §3.2
  // was collapsed to four. They still write an acquisition-time state that says
  // nothing about this run, which is what keeps the derivation necessary.
  it("writes an acquisition-time state on records that are queued", () => {
    const queued = queuedFacts(MSFT_FIXTURE.facts);
    expect(queued.length).toBeGreaterThan(0);
    for (const f of queued) {
      expect(VERIFICATION_STATES).toContain(f.verificationState);
    }
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

  // §3.2 as amended by M7: the four M7 states REPLACED VERIFIED and UNVERIFIED
  // on this field, and "UNVERIFIED now means only the §5.1 propagation state".
  // A queued, undecided fact is SPOT-CHECK PENDING whatever the fixture wrote.
  it("reports SPOT-CHECK PENDING even where acquisition wrote UNVERIFIED", () => {
    // There is no longer an UNVERIFIED to preserve: it left this field with the
    // §3.2 collapse. A queued, undecided fact is SPOT-CHECK PENDING whatever
    // acquisition wrote.
    expect(deriveVerificationState(base, undefined, true)).toBe("SPOT-CHECK PENDING");
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
    const [first, second] = await queuedIdsForRun(runId);
    await recordFactDecision(runId, first, "CONFIRMED", null);
    await recordFactDecision(runId, second, "NOT CONFIRMED", "NOT LOCATED");

    const state = await loadGateState(runId);
    const states = statesOf(state.fixture.facts);
    expect(states[first]).toBe("CONFIRMED");
    expect(states[second]).toBe("NOT CONFIRMED");
  });

  // The consequence that made this worth fixing: the Analysis Result is what
  // the report renders its provenance tokens from.
  it("does not report VERIFIED in the Analysis Result for a non-confirmed fact", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const queued = await queuedIdsForRun(runId);
    for (const factId of queued) {
      await recordFactDecision(runId, factId, "NOT CONFIRMED", "CONTRADICTED BY SOURCE");
    }

    const result = await computeAnalysisForRun(runId);
    const queuedIds = new Set(queued);

    for (const fact of result.facts) {
      if (queuedIds.has(fact.id)) {
        expect(fact.verificationState).toBe("NOT CONFIRMED");
      }
    }
  });

  it("reports CONFIRMED in the Analysis Result for a confirmed fact", async () => {
    const runId = await createRun("OKLO", "Oklo Inc.");
    const queued = await queuedIdsForRun(runId);
    for (const factId of queued) {
      await recordFactDecision(runId, factId, "CONFIRMED", null);
    }

    const result = await computeAnalysisForRun(runId);
    const queuedIds = new Set(queued);

    for (const fact of result.facts) {
      if (queuedIds.has(fact.id)) {
        expect(fact.verificationState).toBe("CONFIRMED");
      }
    }
  });

  it("keeps two runs of the same company on their own states", async () => {
    const confirmed = await createRun("MSFT", "Microsoft Corporation");
    const untouched = await createRun("MSFT", "Microsoft Corporation");
    const [first] = await queuedIdsForRun(confirmed);
    await recordFactDecision(confirmed, first, "CONFIRMED", null);

    expect(statesOf((await loadGateState(confirmed)).fixture.facts)[first]).toBe("CONFIRMED");
    expect(statesOf((await loadGateState(untouched)).fixture.facts)[first]).not.toBe(
      "CONFIRMED"
    );
    expect(statesOf((await loadGateState(untouched)).fixture.facts)[first]).not.toBe("VERIFIED");
  });
});
