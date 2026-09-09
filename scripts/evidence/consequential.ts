// scripts/evidence/consequential.ts
import type { CheckResult } from "./preflight/types";

/**
 * A write that changes state the runner is measuring.
 *
 * There are two in this runner, both in `drive.ts`: `Begin analysis`, which
 * creates an analyzer run, and each decision submit, which records a decision
 * against one. Both are irreversible from the runner's side, and for both the
 * response can be lost without the write having been lost with it.
 */
export interface ConsequentialWrite {
  operation: string;
  ticker: string;
  /** The run the write targeted, when there was one. Null before it exists. */
  runId: string | null;
}

export interface InspectionReport {
  /** Whether the inspection ran at all. A failed inspection is not "nothing found". */
  performed: boolean;
  findings: string[];
  /** What a human must confirm before re-executing. */
  beforeRetry: string;
}

/**
 * A consequential write whose response never arrived.
 *
 * Carries the inspection rather than just a message, because the caller has to
 * report what the current state actually is — the point of §5.5 is that the
 * runner looks before anyone retries, not that it fails loudly.
 */
export class LostWriteError extends Error {
  constructor(
    readonly write: ConsequentialWrite,
    readonly inspected: InspectionReport
  ) {
    super(`${write.operation} (${write.ticker}): response lost`);
    this.name = "LostWriteError";
  }
}

/**
 * Turns a lost write into the UNKNOWN it is.
 *
 * Never FAIL. A FAIL asserts something was measured and found wrong; here
 * nothing was measured at all — the write may have landed, may not have, and
 * the runner cannot tell from a timeout. Reporting it as FAIL would also make
 * it exit on the preflight code, claiming a verdict about the application that
 * this run never reached.
 *
 * The detail always ends with what to confirm before retrying, because a
 * duplicate analyzer run created by an unthinking retry is the actual harm
 * this case exists to prevent.
 */
export function describeLostWrite(
  write: ConsequentialWrite,
  inspected: InspectionReport
): CheckResult {
  const target = write.runId === null ? write.ticker : `${write.ticker} run ${write.runId}`;
  const preamble = inspected.performed
    ? "current state was inspected:"
    : "current state could not be inspected:";

  return {
    step: `${write.operation} response lost (${target})`,
    status: "UNKNOWN",
    detail:
      `The response to ${write.operation} against ${target} never arrived, so it is ` +
      `unknown whether the write landed. ${preamble}\n` +
      inspected.findings.map((f) => `    - ${f}`).join("\n") +
      `\n  Before retry: ${inspected.beforeRetry}`,
  };
}

/**
 * Looks for runs this ticker may have just created.
 *
 * Used when `Begin analysis` times out: the run row may exist even though the
 * navigation never completed, and creating a second one is the harm. The
 * window is deliberately short and the query read-only — the runner never
 * repairs state it is measuring, it only reports what it found.
 */
export async function inspectRunsForTicker(ticker: string): Promise<InspectionReport> {
  try {
    const { getPool } = await import("@/lib/db");
    const res = await getPool().query<{ run_id: string; created_at: Date }>(
      `SELECT run_id, created_at FROM analyzer_runs
        WHERE ticker = $1 AND created_at > now() - interval '10 minutes'
        ORDER BY created_at DESC LIMIT 5`,
      [ticker]
    );
    if (res.rows.length === 0) {
      return {
        performed: true,
        findings: [`no ${ticker} run was created in the last 10 minutes`],
        beforeRetry:
          "the write appears not to have landed, but confirm before re-dispatching",
      };
    }
    return {
      performed: true,
      findings: res.rows.map(
        (r) => `${ticker} run ${r.run_id} exists, created ${r.created_at.toISOString()}`
      ),
      beforeRetry:
        `confirm whether one of those ${res.rows.length} run(s) is this dispatch's ` +
        "before creating another",
    };
  } catch (err) {
    return {
      performed: false,
      findings: [`analyzer_runs could not be queried: ${(err as Error).message}`],
      beforeRetry: "inspect analyzer_runs by hand before retrying",
    };
  }
}

/**
 * Looks at whether a decision actually landed on a run.
 *
 * Used when a decision submit times out. The gate state is the same source the
 * screen enforces, so "did this decision record" is answered by the
 * application's own view of the run rather than by the runner's expectation.
 */
export async function inspectRunDecisions(
  runId: string,
  ticker: string
): Promise<InspectionReport> {
  try {
    const { loadGateState } = await import("@/lib/analyzer/gate");
    const state = await loadGateState(runId);
    const decided = state.queuedCount - state.outstandingFactIds.length;
    return {
      performed: true,
      findings: [
        `${ticker} run ${runId}: ${decided} of ${state.queuedCount} queued facts decided, ` +
          `${state.outstandingFactIds.length} outstanding`,
      ],
      beforeRetry:
        "confirm whether the timed-out decision is among the recorded ones before resubmitting it",
    };
  } catch (err) {
    return {
      performed: false,
      findings: [`gate state for run ${runId} could not be read: ${(err as Error).message}`],
      beforeRetry: `inspect run ${runId}'s decisions by hand before retrying`,
    };
  }
}
