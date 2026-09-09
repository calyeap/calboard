// scripts/evidence/run.test.ts
import { describe, it, expect } from "vitest";
import { EXIT_RUNNER_ERROR, formatRunnerError } from "./run";

// §main().catch: an unexpected runner crash never produced a verdict, so it
// must not exit with the code reserved for a completed preflight FAIL (1).
describe("unexpected runner crash", () => {
  it("exits with the execution-incomplete code, not the preflight-FAIL code", () => {
    expect(EXIT_RUNNER_ERROR).toBe(2);
    expect(EXIT_RUNNER_ERROR).not.toBe(1);
  });

  it("prints a message that cannot be mistaken for a preflight FAIL", () => {
    const message = formatRunnerError(new Error("boom"));
    expect(message).toContain("runner error");
    expect(message).not.toContain("Preflight:");
  });

  it("carries the real error rather than fabricating one", () => {
    const message = formatRunnerError(new Error("disk full"));
    expect(message).toContain("disk full");
  });
});
