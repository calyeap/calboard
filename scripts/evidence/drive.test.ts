import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createRun, recordFactDecision } from "@/lib/analyzer/runStore";
import { loadGateState } from "@/lib/analyzer/gate";
import { queuedFacts } from "@/lib/analyzer/spotCheck";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import { expectedQueueForRun, assertCardsForQueue } from "./drive";

// ---------------------------------------------------------------------------
// The runner's expected Step 2 queue.
//
// It used to come from MSFT_FIXTURE / OKLO_FIXTURE, which bypassed the run's
// acquisition, its cross-check outcomes and its derivedExemption evidence. Two
// sources of truth for one question, and the copy went stale the moment
// acquisition landed: the runner stopped on a card the screen was correct not
// to render.
//
// These tests pin both halves — that the expectation now comes from the gate,
// and that the stop still fires when a queued fact really has no card.
// ---------------------------------------------------------------------------

describe("the expected queue comes from the run's gate state", () => {
  beforeEach(async () => {
    await getPool().query(
      "TRUNCATE analyzer_run_fact_decisions, analyzer_run_judgments, analyzer_runs CASCADE"
    );
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("matches what the page enforces for this run", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const state = await loadGateState(runId);

    const expected = await expectedQueueForRun(runId, "MSFT");
    const enforced = queuedFacts(
      state.fixture.facts,
      state.crossCheckFailedFactIds,
      state.derivedExemption
    ).map((f) => f.id);

    expect(expected).toEqual(enforced);
  });

  it("disagrees with the fixture-derived queue — the bug this replaced", async () => {
    // The regression assertion. If these two ever coincide the test is no
    // longer proving anything, so it asserts they DIFFER: the fixture's facts
    // are a hand-written set from M5/M7 and the run's are acquired from SEC
    // filings. A runner reading the first was checking a different company's
    // paperwork.
    const runId = await createRun("MSFT", "Microsoft Corporation");

    const expected = await expectedQueueForRun(runId, "MSFT");
    const fromFixture = queuedFacts(MSFT_FIXTURE.facts).map((f) => f.id);

    expect(expected).not.toEqual(fromFixture);
    // Concretely: the fixture queues a fact the real screen does not render,
    // which is exactly what stopped the first real outing.
    expect(fromFixture).toContain("finance-lease-rou-additions");
    expect(expected).not.toContain("finance-lease-rou-additions");
  });

  it("refuses a run that already carries decisions rather than checking a short list", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");
    const [first] = await expectedQueueForRun(runId, "MSFT");
    await recordFactDecision(runId, first, "CONFIRMED", null);

    await expect(expectedQueueForRun(runId, "MSFT")).rejects.toThrow(
      /already carries decisions/
    );
  });
});

describe("the stop still fires when a queued fact has no card", () => {
  const queue = ["price", "current-operating-margin"];

  it("passes when every queued fact has a card", async () => {
    const rendered = new Set(queue);
    await expect(
      assertCardsForQueue("MSFT", queue, async (id) => rendered.has(id))
    ).resolves.toBeUndefined();
  });

  it("FAILS naming the fact when one card is missing", async () => {
    // A genuine mismatch: the expectation is right and the screen did not
    // render one of them.
    const rendered = new Set(["price"]);

    await expect(
      assertCardsForQueue("MSFT", queue, async (id) => rendered.has(id))
    ).rejects.toThrow(
      'Queued fact "current-operating-margin" has no card on the MSFT facts screen'
    );
  });

  it("FAILS naming every missing fact, not just the first", async () => {
    const rendered = new Set<string>();

    await expect(
      assertCardsForQueue("MSFT", queue, async (id) => rendered.has(id))
    ).rejects.toThrow(/"price", "current-operating-margin" have no card/);
  });

  it("FAILS on an empty queue rather than passing vacuously", async () => {
    // A queue of nothing would let the runner capture a Step 2 screen it never
    // checked, and report success.
    await expect(assertCardsForQueue("MSFT", [], async () => true)).rejects.toThrow(
      /the spot-check queue is empty/
    );
  });
});
