// scripts/evidence/outcome.ts
import fs from "node:fs/promises";
import path from "node:path";

export interface OutcomeIdResult {
  outcomeId: string | null;
  /** Why the id was refused. Empty when one was resolved. */
  error: string;
}

export interface RepeatDecision {
  proceed: boolean;
  reason: string;
  /** Prior runs for this id, carried forward so the duplicate stays on record. */
  priorRuns: string[];
}

/**
 * Ids that are safe as a directory name and cannot climb out of `.evidence/`.
 *
 * The id reaches the filesystem, so it is validated rather than sanitised —
 * quietly rewriting an id would break the one property it exists for, which is
 * that the same assignment always produces the same identifier.
 */
const SAFE_OUTCOME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The capture stamp, as `run.ts` writes it: an ISO time with `:` and `.` hyphenated. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function captureDirName(outcomeId: string, stamp: string): string {
  return `${outcomeId}-${stamp}`;
}

/**
 * The OUTCOME ID for this run, from `--outcome-id` or `EVIDENCE_OUTCOME_ID`.
 *
 * There is deliberately no default. An archive that cannot say which
 * assignment it belongs to is the gap this closes, so a run without an id
 * stops rather than producing one more unattributable capture.
 */
export function resolveOutcomeId(
  argv: readonly string[],
  env: Record<string, string | undefined>
): OutcomeIdResult {
  const flagAt = argv.indexOf("--outcome-id");
  const raw = flagAt === -1 ? env.EVIDENCE_OUTCOME_ID : argv[flagAt + 1];

  if (raw === undefined || raw.trim() === "") {
    return {
      outcomeId: null,
      error:
        "no OUTCOME ID — pass --outcome-id <id> or set EVIDENCE_OUTCOME_ID. " +
        "Evidence that cannot name its assignment is not deliverable.",
    };
  }
  const id = raw.trim();
  if (!SAFE_OUTCOME_ID.test(id)) {
    return {
      outcomeId: null,
      error: `OUTCOME ID ${id} is not usable as a directory name (letters, digits, dot, dash, underscore)`,
    };
  }
  return { outcomeId: id, error: "" };
}

/**
 * Existing captures for this OUTCOME ID.
 *
 * Matches on the id plus a well-formed stamp rather than a bare prefix, so
 * `CB-A` does not claim `CB-A-B`'s runs as its own. A missing evidence root
 * is not an error — it is simply the first run.
 */
export async function findPriorRuns(evidenceRoot: string, outcomeId: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(evidenceRoot);
  } catch {
    return [];
  }
  const prefix = `${outcomeId}-`;
  return entries
    .filter((name) => name.startsWith(prefix) && STAMP.test(name.slice(prefix.length)))
    .map((name) => path.join(evidenceRoot, name));
}

/**
 * Whether this run may execute, given what already exists for its OUTCOME ID.
 *
 * The check runs before the browser opens and before any analyzer run is
 * created, because those are the consequential parts: re-executing them is
 * what §5.4 requires the system to notice rather than repeat blindly. Prior
 * evidence is never overwritten or reused — `--repeat` adds a run and records
 * the ones already there.
 */
export function decideRepeat(priorRuns: string[], repeatAuthorised: boolean): RepeatDecision {
  if (priorRuns.length === 0) {
    return { proceed: true, reason: "", priorRuns };
  }
  if (repeatAuthorised) {
    return {
      proceed: true,
      reason: `repeat authorised over ${priorRuns.length} prior run(s)`,
      priorRuns,
    };
  }
  return {
    proceed: false,
    reason:
      `${priorRuns.length} prior run(s) already exist for this OUTCOME ID:\n` +
      priorRuns.map((p) => `    ${p}`).join("\n") +
      "\n  Re-run with --repeat to execute anyway. Prior evidence is never overwritten.",
    priorRuns,
  };
}
