import { randomUUID } from "node:crypto";
import { getPool } from "../db";

// ---------------------------------------------------------------------------
// R7 — run persistence. Server-side, runId in the URL, no index, no history
// list, no listing endpoint. Lose the URL and the run is gone.
//
// There is deliberately no listRuns, findRunsByTicker or recentRuns function
// in this module, and none may be added. The absence of every listing surface
// is what keeps this clear of Saved Analysis (§13.1), and a listing helper
// written "just for debugging" is how that boundary would quietly go.
// ---------------------------------------------------------------------------

// The vocabulary lives in ./decisions, which has no server dependency, so
// client components can render these controls without pulling `pg` into the
// browser bundle. Re-exported here so existing server-side callers are
// unaffected by where it is defined.
import type {
  FactDecision,
  ReasonCode,
  ProfileDecision,
  JudgmentKey,
  StoredFactDecision,
  StoredJudgment,
} from "./decisions";

export { REASON_CODES, JUDGMENT_KEYS } from "./decisions";
export type {
  FactDecision,
  ReasonCode,
  ProfileDecision,
  JudgmentKey,
  StoredFactDecision,
  StoredJudgment,
};

export interface AnalyzerRun {
  runId: string;
  ticker: string;
  resolvedCompanyName: string;
  createdAt: string;
  profileDecision: ProfileDecision | null;
  profile: string | null;
  profileOverrideReason: string | null;
  profileHumanConfirmed: boolean;
}


/**
 * Creates a run. Called only on confirmation of the resolved company at Step 1
 * (design:121) — never on ticker entry, and never for a ticker that failed
 * identity resolution, which per §9.3.1 is refused "before a run exists".
 *
 * The id is a v4 UUID from the platform CSPRNG. It is the run's only handle
 * and it travels in the URL, so it must be unguessable: a sequential key makes
 * every run reachable by typing /analyzer/1, which is a listing surface
 * arriving without a listing endpoint.
 */
export async function createRun(ticker: string, resolvedCompanyName: string): Promise<string> {
  const runId = randomUUID();
  await getPool().query(
    `INSERT INTO analyzer_runs (run_id, ticker, resolved_company_name, instrument_class)
     VALUES ($1, $2, $3, 'LISTED OPERATING COMPANY')`,
    [runId, ticker, resolvedCompanyName]
  );
  return runId;
}

export async function getRun(runId: string): Promise<AnalyzerRun | null> {
  // A malformed id is a miss, not a crash: runIds arrive from the URL bar,
  // where anything can be typed, and Postgres rejects a non-UUID literal.
  if (!isUuid(runId)) return null;

  const { rows } = await getPool().query(
    `SELECT run_id, ticker, resolved_company_name, created_at,
            profile_decision, profile, profile_override_reason, profile_human_confirmed
       FROM analyzer_runs
      WHERE run_id = $1`,
    [runId]
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    runId: r.run_id,
    ticker: r.ticker,
    resolvedCompanyName: r.resolved_company_name,
    createdAt: r.created_at,
    profileDecision: r.profile_decision,
    profile: r.profile,
    profileOverrideReason: r.profile_override_reason,
    profileHumanConfirmed: r.profile_human_confirmed,
  };
}

/**
 * Records one Step 2 decision, replacing any earlier decision on the same
 * fact so an analyst may change their mind before the step completes.
 *
 * §3.8.4: a non-confirmation is not complete without a reason code. That rule
 * is a CHECK constraint on the table and this validation does not replace it —
 * it exists so a caller gets a legible error instead of a constraint
 * violation. The database remains the enforcement; deleting these four lines
 * would not let a bad row through.
 */
export async function recordFactDecision(
  runId: string,
  factId: string,
  decision: FactDecision,
  reasonCode: ReasonCode | null
): Promise<void> {
  if (decision === "NOT CONFIRMED" && reasonCode === null) {
    throw new Error(
      "Cannot verify requires a reason code (§3.8.4): CONTRADICTED BY SOURCE or NOT LOCATED"
    );
  }
  if (decision === "CONFIRMED" && reasonCode !== null) {
    throw new Error("Confirm carries no reason code (§3.8.4)");
  }

  await getPool().query(
    `INSERT INTO analyzer_run_fact_decisions (run_id, fact_id, decision, reason_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id, fact_id)
     DO UPDATE SET decision = EXCLUDED.decision,
                   reason_code = EXCLUDED.reason_code,
                   decided_at = now()`,
    [runId, factId, decision, reasonCode]
  );
}

export async function getFactDecisions(runId: string): Promise<StoredFactDecision[]> {
  if (!isUuid(runId)) return [];
  const { rows } = await getPool().query(
    `SELECT fact_id, decision, reason_code
       FROM analyzer_run_fact_decisions
      WHERE run_id = $1
      ORDER BY decided_at`,
    [runId]
  );
  return rows.map((r) => ({
    factId: r.fact_id,
    decision: r.decision,
    reasonCode: r.reason_code,
  }));
}

/**
 * The decided fact ids, in the shape isSpotCheckComplete wants. This is what
 * the route gate reads, and it reads it from the database on every request
 * rather than from a session or a cookie — a client-held run cannot be gated
 * by the server (R7).
 */
export async function getDecidedFactIds(runId: string): Promise<Set<string>> {
  const decisions = await getFactDecisions(runId);
  return new Set(decisions.map((d) => d.factId));
}

export async function recordJudgment(
  runId: string,
  judgmentKey: JudgmentKey,
  selection: string,
  reason: string | null
): Promise<void> {
  await getPool().query(
    `INSERT INTO analyzer_run_judgments (run_id, judgment_key, selection, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id, judgment_key)
     DO UPDATE SET selection = EXCLUDED.selection,
                   reason = EXCLUDED.reason,
                   decided_at = now()`,
    [runId, judgmentKey, selection, reason]
  );
}

export async function getJudgments(runId: string): Promise<StoredJudgment[]> {
  if (!isUuid(runId)) return [];
  const { rows } = await getPool().query(
    `SELECT judgment_key, selection, reason
       FROM analyzer_run_judgments
      WHERE run_id = $1`,
    [runId]
  );
  return rows.map((r) => ({
    judgmentKey: r.judgment_key,
    selection: r.selection,
    reason: r.reason,
  }));
}

/**
 * Records the Step 6 outcome (§6.3).
 *
 * human_confirmed is derived here rather than passed in, so no caller can
 * record Cannot judge as a confirmation. The table's CHECK constraint refuses
 * that combination too — this is the same rule stated where the decision is
 * made and where it is stored, and neither alone is trusted.
 */
export async function recordProfileDecision(
  runId: string,
  decision: ProfileDecision,
  profile: string,
  overrideReason: string | null
): Promise<void> {
  if (decision === "OVERRIDDEN" && !overrideReason?.trim()) {
    throw new Error("An override is recorded with its reason (§6.3)");
  }
  if (decision !== "OVERRIDDEN" && overrideReason !== null) {
    throw new Error("Only an override carries a reason (§6.3)");
  }

  // Cannot judge never counts as confirmation (§6.3).
  const humanConfirmed = decision === "CONFIRMED" || decision === "OVERRIDDEN";

  await getPool().query(
    `UPDATE analyzer_runs
        SET profile_decision = $2,
            profile = $3,
            profile_override_reason = $4,
            profile_human_confirmed = $5,
            profile_decided_at = now()
      WHERE run_id = $1`,
    [runId, decision, profile, overrideReason, humanConfirmed]
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
