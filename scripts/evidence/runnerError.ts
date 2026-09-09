// scripts/evidence/runnerError.ts

/**
 * Exit code for an unexpected runner crash — the process threw before a
 * verdict was produced at all.
 *
 * Reuses exit 2 rather than adding a new code: `exitCodeFor` in
 * returnObject.ts already gives 2 the meaning "execution did not complete",
 * and a crash is exactly that. 1 stays reserved for a completed preflight
 * FAIL (see `stopOn` and `exitCodeFor` in run.ts), so a crash must never
 * borrow it — doing so would report a verdict about the app that this run
 * never produced.
 */
export const EXIT_RUNNER_ERROR = 2;

/**
 * Printed for an unexpected crash. Worded so it cannot be mistaken for the
 * "Preflight: FAIL" summary line main() prints after a completed run.
 */
export function formatRunnerError(err: unknown): string {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return `\nSTOP — runner error: execution did not complete (this is not a preflight result)\n  ${detail}\n`;
}
