import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { getPool } from "../db";
import { createRun, recordFactDecision } from "./runStore";
import { boundState, NOT_COMPUTED_BINDING } from "./notComputed";

// The spy is installed around the REAL assembleAnalysisResult, not a stub, so
// the passing path still computes a genuine result. What is being proved is
// not that the function is absent — it is that on the failing path it is never
// reached. A test that asserted only "an error was thrown" would pass even if
// every calculation module had run first and the error came afterwards.
const assembleSpy = vi.hoisted(() => vi.fn());

vi.mock("./assemble", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assemble")>();
  assembleSpy.mockImplementation(actual.assembleAnalysisResult);
  return { ...actual, assembleAnalysisResult: assembleSpy };
});

const { computeAnalysisForRun, loadGateState, SpotCheckIncompleteError, RunNotFoundError } =
  await import("./gate");

/**
 * The facts THIS RUN actually queues, in queue order.
 *
 * Since M8-a a run's fact set is acquired from SEC filings rather than read
 * out of a fixture, so the queue is a property of the run and not of a
 * constant this file can import. Asking the gate is also the stronger test: it
 * exercises the same queue the route enforces, including any fact a §3.8.2
 * cross-check forced into it.
 */
async function queuedIdsForRun(runId: string): Promise<string[]> {
  const state = await loadGateState(runId);
  return state.outstandingFactIds;
}

describe("the §2 ordering rule, enforced at the route boundary", () => {
  beforeEach(async () => {
    await getPool().query(
      "TRUNCATE analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
    assembleSpy.mockClear();
  });

  afterAll(async () => {
    await getPool().end();
  });

  // ---------------------------------------------------------------------
  // DONE WHEN 2 — "No calculation runs before Step 2 completes — proven by a
  // test that attempts it and fails closed, not by inspection."
  // ---------------------------------------------------------------------

  it("refuses to compute for a run with an untouched queue, and computes nothing", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    await expect(computeAnalysisForRun(runId)).rejects.toBeInstanceOf(SpotCheckIncompleteError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  it("refuses when the queue is partly decided, and computes nothing", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const queued = await queuedIdsForRun(runId);
    expect(queued.length).toBeGreaterThan(1);

    // Every fact but the last.
    for (const factId of queued.slice(0, -1)) {
      await recordFactDecision(runId, factId, "CONFIRMED", null);
    }

    await expect(computeAnalysisForRun(runId)).rejects.toBeInstanceOf(SpotCheckIncompleteError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  it("names what is outstanding rather than only that something is", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const queued = await queuedIdsForRun(runId);
    await recordFactDecision(runId, queued[0], "CONFIRMED", null);

    await expect(computeAnalysisForRun(runId)).rejects.toMatchObject({
      outstandingFactIds: queued.slice(1),
    });
  });

  // Confirming an exempt fact must not be mistaken for progress on the queue.
  it("is not satisfied by decisions on facts the queue never contained", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    await recordFactDecision(runId, "finance-lease-liabilities", "CONFIRMED", null);
    await recordFactDecision(runId, "operating-lease-liabilities", "CONFIRMED", null);

    await expect(computeAnalysisForRun(runId)).rejects.toBeInstanceOf(SpotCheckIncompleteError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  it("computes once every queued fact carries a decision", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    for (const factId of await queuedIdsForRun(runId)) {
      await recordFactDecision(runId, factId, "CONFIRMED", null);
    }

    const result = await computeAnalysisForRun(runId);
    expect(assembleSpy).toHaveBeenCalledTimes(1);
    expect(result.ticker).toBe("MSFT");
  });

  // §3.8.3: the two decisions count identically toward completion. Cannot
  // verify does not block the gate; it blocks dependents through §5.
  it("computes when the queue is complete but answered entirely with Cannot verify", async () => {
    const runId = await createRun("OKLO", "Oklo Inc.");
    for (const factId of await queuedIdsForRun(runId)) {
      await recordFactDecision(runId, factId, "NOT CONFIRMED", "NOT LOCATED");
    }

    await expect(computeAnalysisForRun(runId)).resolves.toBeDefined();
    expect(assembleSpy).toHaveBeenCalledTimes(1);
  });

  // H3 conformance correction (CB-H3-CONFORMANCE-02). Reproduces the exact
  // counterexample the outcome names: a Cannot-verify decision on
  // cash-balance/shares-outstanding/quarterly-burn used to leave H3's
  // computed value and its acquisition-time (pre-decision) provenance
  // tokens intact, because buildCompanyInputs computes the acquired cash
  // basis once, before any decision exists, and gate.ts's applyDecisions
  // only rewrote `fixture.facts` — never the already-built preRevenue block.
  // With deriveH3CashBasis re-run over this run's OWN post-decision facts,
  // every rejected fact must suppress its dependent H3 output to INCOMPLETE
  // — never a computed number beside a stale CONFIRMED-looking mark.
  //
  // These three facts are tag-mapped (§3.8.1) and so are not themselves
  // QUEUED for OKLO — but §3.8.1 is explicit that an exempt fact is "not
  // spot-checked; it is not hidden", and this run's own decision store
  // still accepts a decision recorded against them directly (an analyst
  // annotating a shown-but-not-required fact). Recording one is exactly the
  // "Cannot verify" scenario the outcome's counterexample describes.
  it("suppresses H3's cash/burn/runway to INCOMPLETE — never a stale computed number — once cash, shares and burn are all Cannot verify", async () => {
    const runId = await createRun("OKLO", "Oklo Inc.");
    for (const factId of await queuedIdsForRun(runId)) {
      await recordFactDecision(runId, factId, "CONFIRMED", null);
    }
    for (const factId of ["cash-balance", "shares-outstanding", "quarterly-burn"]) {
      await recordFactDecision(runId, factId, "NOT CONFIRMED", "NOT LOCATED");
    }

    const result = await computeAnalysisForRun(runId);
    const pr = result.preRevenue!;
    expect(pr.cashPerShare.isNaN()).toBe(true);
    expect(pr.quarterlyBurn.isNaN()).toBe(true);
    expect(pr.runway.isNaN()).toBe(true);
    expect(boundState(result.states, NOT_COMPUTED_BINDING.cashPerShare)?.state).toBe("INCOMPLETE");
    expect(boundState(result.states, NOT_COMPUTED_BINDING.quarterlyBurn)?.state).toBe("INCOMPLETE");
    expect(boundState(result.states, NOT_COMPUTED_BINDING.runway)?.state).toBe("INCOMPLETE");
    // Every V_fail cell is unavailable too — never the rejected value.
    expect(pr.cashPerShareProvenance).toBeNull();
    for (const row of pr.successDefinitions) {
      expect(row.vFail.isNaN()).toBe(true);
      expect(row.vFailProvenance).toBeNull();
    }
  });

  // Rejecting only the shares-outstanding fact must not take burn/runway
  // down with it (independent dependency scoping, H3 conformance
  // correction) — cash per share is INCOMPLETE, but burn (which does not
  // depend on shares at all) and runway (which depends on cash balance and
  // burn, not shares) both still compute.
  it("suppresses only cash per share — not burn or runway — when shares outstanding alone is Cannot verify", async () => {
    const runId = await createRun("OKLO", "Oklo Inc.");
    for (const factId of await queuedIdsForRun(runId)) {
      await recordFactDecision(runId, factId, "CONFIRMED", null);
    }
    await recordFactDecision(runId, "shares-outstanding", "NOT CONFIRMED", "NOT LOCATED");

    const result = await computeAnalysisForRun(runId);
    const pr = result.preRevenue!;
    expect(pr.cashPerShare.isNaN()).toBe(true);
    expect(boundState(result.states, NOT_COMPUTED_BINDING.cashPerShare)?.state).toBe("INCOMPLETE");
    expect(pr.quarterlyBurn.isNaN()).toBe(false);
    expect(pr.runway.isNaN()).toBe(false);
    expect(boundState(result.states, NOT_COMPUTED_BINDING.quarterlyBurn)).toBeNull();
    expect(boundState(result.states, NOT_COMPUTED_BINDING.runway)).toBeNull();
  });

  // A deep link or API call carrying an id that was never issued must not
  // compute, and must not leak whether the id could have existed.
  it.each([
    ["a well-formed id that was never issued", "11111111-1111-4111-8111-111111111111"],
    ["a malformed id", "not-a-uuid"],
    ["an empty id", ""],
    ["a SQL fragment", "'; DROP TABLE analyzer_runs; --"],
  ])("refuses %s, and computes nothing", async (_label, runId) => {
    await expect(computeAnalysisForRun(runId)).rejects.toBeInstanceOf(RunNotFoundError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  // Fail-closed on a run whose ticker has no fact set: nothing to spot-check
  // means nothing that may be computed.
  it("refuses a run whose ticker has no fixture, rather than computing on an empty fact set", async () => {
    const runId = await createRun("NEWCO", "Newco Industries");
    await expect(computeAnalysisForRun(runId)).rejects.toBeInstanceOf(RunNotFoundError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  it("does not compute merely because the gate state was inspected", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const state = await loadGateState(runId);
    expect(state.spotCheckComplete).toBe(false);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  // DONE WHEN 5 — a refresh mid-queue preserves what was decided. The state is
  // read from the database, not from a session, so this is the same assertion
  // as "a second request sees the first request's decisions".
  it("preserves decisions across independent reads, as a refresh would", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const [first] = await queuedIdsForRun(runId);
    await recordFactDecision(runId, first, "NOT CONFIRMED", "CONTRADICTED BY SOURCE");

    const reloaded = await loadGateState(runId);
    expect(reloaded.decidedFactIds.has(first)).toBe(true);
    expect(reloaded.spotCheckComplete).toBe(false);
    expect(reloaded.outstandingFactIds).not.toContain(first);
  });

  // Two runs of the same company must not see each other's work.
  it("gates each run on its own decisions", async () => {
    const done = await createRun("MSFT", "Microsoft Corporation");
    const fresh = await createRun("MSFT", "Microsoft Corporation");
    for (const factId of await queuedIdsForRun(done)) {
      await recordFactDecision(done, factId, "CONFIRMED", null);
    }

    await expect(computeAnalysisForRun(done)).resolves.toBeDefined();
    assembleSpy.mockClear();

    await expect(computeAnalysisForRun(fresh)).rejects.toBeInstanceOf(SpotCheckIncompleteError);
    expect(assembleSpy).not.toHaveBeenCalled();
  });
});
