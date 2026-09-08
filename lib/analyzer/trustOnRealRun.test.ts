import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "../db";
import { createRun, recordFactDecision, recordProfileDecision } from "./runStore";
import { computeAnalysisForRun, loadGateState } from "./gate";

// ---------------------------------------------------------------------------
// §9.6 on a real run — the trust status a report would actually display.
//
// Through the database and the gated entry point, not the fixture: the defect
// class this milestone exists to close is a value computed in one place and
// asserted in another, so the test has to cross the same seams the report
// crosses.
// ---------------------------------------------------------------------------

async function completeSpotCheck(runId: string): Promise<void> {
  const state = await loadGateState(runId);
  for (const factId of state.outstandingFactIds) {
    await recordFactDecision(runId, factId, "CONFIRMED", null);
  }
}

describe("trust status on an acquired run", () => {
  beforeEach(async () => {
    await getPool().query(
      "TRUNCATE analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("agrees with its own fair-value range — UNUSABLE exactly where the range was suppressed", async () => {
    // §9.6 rule 1. The assertion is the AGREEMENT: whatever happened to the
    // range, trust says the same thing about it. A run that renders a range
    // must not be UNUSABLE, and a run that refuses one must not be anything
    // else — the property holds whichever way this run's Gate 0 comes out.
    const runId = await createRun("MSFT", "Microsoft Corporation");
    await completeSpotCheck(runId);
    await recordProfileDecision(runId, "CONFIRMED", "MATURE_PROFITABLE", null);

    const result = await computeAnalysisForRun(runId);

    expect(result.trust.status === "UNUSABLE").toBe(result.fairValueRange.kind === "suppressed");
    if (result.fairValueRange.kind === "suppressed") {
      expect(result.trust.determinedBy.map((d) => d.detail).join(" ")).toContain(
        result.fairValueRange.state
      );
    }
  });

  it("reads the run's recorded CONFIRM rather than a default (§6.3)", async () => {
    // The discriminating case. `buildAcquiredRun` defaults
    // profileHumanConfirmed to false — fail-closed, and correct as a default —
    // so a run that recorded Confirm must have that answer threaded through to
    // trust. Without the wiring, trust reports PROFILE NOT CONFIRMED on a run
    // the analyst confirmed, which is the screen and the data disagreeing
    // again, one layer down.
    const runId = await createRun("MSFT", "Microsoft Corporation");
    await completeSpotCheck(runId);
    await recordProfileDecision(runId, "CONFIRMED", "MATURE_PROFITABLE", null);

    const state = await loadGateState(runId);
    expect(state.run.profileHumanConfirmed).toBe(true);
    expect(state.fixture.trustInputs.profileHumanConfirmed).toBe(true);
  });

  it("carries the run's own profile decision into trust, not a default (§6.3)", async () => {
    // *Cannot judge* leaves the profile not human-confirmed, which §9.6 rule 2
    // reads as PARTIAL. The point is that the status reflects THIS run's
    // recorded answer rather than a value assembly chose for itself.
    const runId = await createRun("MSFT", "Microsoft Corporation");
    await completeSpotCheck(runId);
    await recordProfileDecision(runId, "CANNOT JUDGE", "MATURE_PROFITABLE", null);

    const result = await computeAnalysisForRun(runId);
    const state = await loadGateState(runId);

    expect(state.run.profileHumanConfirmed).toBe(false);
    if (result.trust.status === "PARTIAL") {
      expect(result.trust.determinedBy.map((d) => d.detail).join(" ")).toContain(
        "PROFILE NOT CONFIRMED"
      );
    }
    expect(["PARTIAL", "UNUSABLE"]).toContain(result.trust.status);
  });

  it("is never CLEAN or PARTIAL while the range is suppressed", async () => {
    // The disagreement this milestone forbids, stated as a prohibition.
    const runId = await createRun("MSFT", "Microsoft Corporation");
    await completeSpotCheck(runId);
    await recordProfileDecision(runId, "CONFIRMED", "MATURE_PROFITABLE", null);

    const result = await computeAnalysisForRun(runId);

    if (result.fairValueRange.kind === "suppressed") {
      expect(result.trust.status).not.toBe("CLEAN");
      expect(result.trust.status).not.toBe("PARTIAL");
    }
  });
});
