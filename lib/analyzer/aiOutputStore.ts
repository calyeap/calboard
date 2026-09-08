import { getPool } from "../db";
import type { ChallengerResult, InterpretationResult } from "./types";

// ---------------------------------------------------------------------------
// Persistence for the two AI outputs (migration 003).
//
// Everything else this analyzer produces is a function of its inputs and is
// recomputed on every request. These two are not: the same fact set can
// produce different words, so a [C] output is an event that happened once
// rather than a derivation that can be repeated. Storing it is what makes the
// report the analyst read the same report a minute later.
//
// There is deliberately no listing function here, on the same R7 reasoning as
// runStore: reachable only by runId, and only for a run you already hold.
// ---------------------------------------------------------------------------

export interface StoredAiOutputs {
  model: string;
  interpretation: InterpretationResult;
  challenger: ChallengerResult;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Writes both outputs, in one transaction.
 *
 * Both or neither, because §8.5.4 makes the pair the unit: the challenger's
 * findings enter the report only after its own call has completed, and a store
 * that could hold an interpretation beside a missing challenger would let a
 * half-merged report render. `getAiOutputs` refuses such a pair as well — the
 * transaction is the guard, the read is the second one.
 */
export async function saveAiOutputs(
  runId: string,
  model: string,
  outputs: { interpretation: InterpretationResult; challenger: ChallengerResult }
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO analyzer_run_ai_outputs (run_id, kind, model, payload, completed_at)
       VALUES ($1, 'INTERPRETATION', $2, $3, now())
       ON CONFLICT (run_id, kind)
       DO UPDATE SET model = EXCLUDED.model,
                     payload = EXCLUDED.payload,
                     completed_at = EXCLUDED.completed_at`,
      [runId, model, JSON.stringify(outputs.interpretation)]
    );
    await client.query(
      // The challenger's own completedAt, not now(): the stamp records when
      // the independent call finished, which is the fact §8.5.4 is about.
      `INSERT INTO analyzer_run_ai_outputs (run_id, kind, model, payload, completed_at)
       VALUES ($1, 'CHALLENGER', $2, $3, $4)
       ON CONFLICT (run_id, kind)
       DO UPDATE SET model = EXCLUDED.model,
                     payload = EXCLUDED.payload,
                     completed_at = EXCLUDED.completed_at`,
      [runId, model, JSON.stringify(outputs.challenger), outputs.challenger.completedAt]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Both outputs, or null.
 *
 * Null when either is missing. A report showing an interpretation with no
 * challenger beside it is the counter-case arriving from the interpretation
 * layer by omission — §10.5 prohibits that outcome however it is reached.
 */
export async function getAiOutputs(runId: string): Promise<StoredAiOutputs | null> {
  if (!UUID.test(runId)) return null;

  const { rows } = await getPool().query(
    `SELECT kind, model, payload
       FROM analyzer_run_ai_outputs
      WHERE run_id = $1`,
    [runId]
  );

  const interpretation = rows.find((r) => r.kind === "INTERPRETATION");
  const challenger = rows.find((r) => r.kind === "CHALLENGER");
  if (interpretation === undefined || challenger === undefined) return null;

  return {
    model: interpretation.model,
    interpretation: interpretation.payload as InterpretationResult,
    challenger: challenger.payload as ChallengerResult,
  };
}
