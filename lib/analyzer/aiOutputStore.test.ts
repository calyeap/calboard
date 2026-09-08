import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool } from "../db";
import { createRun } from "./runStore";
import { saveAiOutputs, getAiOutputs } from "./aiOutputStore";
import type { ChallengerResult, InterpretationResult } from "./types";

// The AI layer is the one part of this analyzer that is not a function of its
// inputs, so it is the one part with something to store (see migration 003's
// own header). These tests pin what that store guarantees.

const interpretation: InterpretationResult = {
  statements: [
    {
      responsibility: "PRICE-IMPLIED DIAGNOSTICS",
      statement: "The price implies growth above what the company has delivered.",
      referencesValueIds: ["priceImplied.reverseDcf.current@0.08.tenYearCagr"],
    },
  ],
  pageOne: {
    mainFinding: { responsibility: "MODEL FRAGILITY", statement: "Main.", referencesValueIds: [] },
    whatSupportsTheCase: { responsibility: "MODEL FRAGILITY", statement: "Supports.", referencesValueIds: [] },
    whatWorriesCalboard: { responsibility: "MODEL FRAGILITY", statement: "Worries.", referencesValueIds: [] },
    biggestUncertainty: { responsibility: "MODEL FRAGILITY", statement: "Uncertainty.", referencesValueIds: [] },
  },
};

const challenger: ChallengerResult = {
  findings: [
    {
      claimOrFactReference: "Finance-lease ROU additions (finance-lease-rou-additions)",
      evidence: "The record is secondary.",
      whatWouldHaveToBeTrue: "It would have to be confirmed against the filing.",
    },
  ],
  completedAt: "2026-09-08T12:00:00.000Z",
};

describe("aiOutputStore", () => {
  beforeEach(async () => {
    await getPool().query("TRUNCATE analyzer_run_ai_outputs, analyzer_runs CASCADE");
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("returns nothing for a run whose calls have not run", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    expect(await getAiOutputs(runId)).toBeNull();
  });

  it("round-trips both outputs verbatim", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    await saveAiOutputs(runId, "claude-opus-5", { interpretation, challenger });
    const stored = await getAiOutputs(runId);

    expect(stored?.interpretation).toEqual(interpretation);
    expect(stored?.challenger).toEqual(challenger);
    expect(stored?.model).toBe("claude-opus-5");
  });

  it("keeps the challenger's own completion stamp, not the moment it was written to the table (§8.5.4)", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    await saveAiOutputs(runId, "claude-opus-5", { interpretation, challenger });

    const { rows } = await getPool().query(
      "SELECT completed_at FROM analyzer_run_ai_outputs WHERE run_id = $1 AND kind = 'CHALLENGER'",
      [runId]
    );
    expect(new Date(rows[0].completed_at).toISOString()).toBe(challenger.completedAt);
  });

  it("holds one interpretation and one challenger per run — never a panel to tally (§8.3 limit 6)", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    await saveAiOutputs(runId, "claude-opus-5", { interpretation, challenger });
    await saveAiOutputs(runId, "claude-opus-5", {
      interpretation,
      challenger: { ...challenger, findings: [] },
    });

    const { rows } = await getPool().query(
      "SELECT kind, count(*)::int AS n FROM analyzer_run_ai_outputs WHERE run_id = $1 GROUP BY kind ORDER BY kind",
      [runId]
    );
    expect(rows).toEqual([
      { kind: "CHALLENGER", n: 1 },
      { kind: "INTERPRETATION", n: 1 },
    ]);
    expect((await getAiOutputs(runId))?.challenger.findings).toEqual([]);
  });

  it("returns nothing when only one of the two rows exists — a half-merged report is the ordering failure §8.5.4 forbids", async () => {
    const runId = await createRun("MSFT", "Microsoft Corporation");

    await getPool().query(
      `INSERT INTO analyzer_run_ai_outputs (run_id, kind, model, payload, completed_at)
       VALUES ($1, 'INTERPRETATION', 'claude-opus-5', $2, now())`,
      [runId, JSON.stringify(interpretation)]
    );

    expect(await getAiOutputs(runId)).toBeNull();
  });
});
