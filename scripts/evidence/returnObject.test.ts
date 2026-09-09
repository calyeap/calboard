import { describe, it, expect } from "vitest";
import { exitCodeFor, buildReturnObject } from "./returnObject";

const SOURCE = {
  repo: "calyeap/calboard", branch: "feat/x",
  baseRevision: "a".repeat(40), resultHead: "b".repeat(40),
  dirty: false, dirtyFingerprint: null,
};
const base = {
  outcomeId: "CB-G2-EVIDENCE-01",
  source: SOURCE,
  served: { baseUrl: "http://127.0.0.1:3000", revision: "UjIW", binding: "MATCH" as const, reason: "" },
  execution: { started: "2026-09-09T10:00:00.000Z", completed: "2026-09-09T10:05:00.000Z", runnerRevision: "c".repeat(40) },
  inventory: { required: ["a"], executed: ["a"], notRun: [], unaccountedFor: [], complete: true },
  verdict: { status: "PASS" as const, failingStep: null, results: [] },
  artefacts: { captureDir: "/e/cap", manifest: "/e/cap/manifest.json", artefactCount: 9 },
  delivery: { status: "DELIVERED" as const, location: "/e/cap.zip", archiveSha256: "d".repeat(64), error: null },
  evidenceComplete: true,
  priorRuns: [],
};

describe("exitCodeFor", () => {
  it("exits 0 when everything passed, completed and delivered", () => {
    expect(exitCodeFor("PASS", true, "DELIVERED")).toBe(0);
  });

  // Existing semantics, unweakened: UNKNOWN is a result, not an error.
  it("exits 0 on an UNKNOWN preflight verdict", () => {
    expect(exitCodeFor("UNKNOWN", true, "DELIVERED")).toBe(0);
  });

  it("exits 1 on a preflight FAIL, exactly as before", () => {
    expect(exitCodeFor("FAIL", true, "DELIVERED")).toBe(1);
  });

  it("exits 2 when the evidence is incomplete", () => {
    expect(exitCodeFor("PASS", false, "DELIVERED")).toBe(2);
  });

  // The bug this closes: today a packaging failure still exits 0.
  it("exits 3 when delivery failed", () => {
    expect(exitCodeFor("PASS", true, "FAILED")).toBe(3);
  });

  it("still reports the preflight FAIL when delivery also failed", () => {
    expect(exitCodeFor("FAIL", true, "FAILED")).toBe(1);
  });
});

describe("buildReturnObject", () => {
  it("names where the evidence is, and who it is for", () => {
    const r = buildReturnObject(base);
    expect(r.outcomeId).toBe("CB-G2-EVIDENCE-01");
    expect(r.delivery.location).toBe("/e/cap.zip");
    expect(r.returnTo).toBe("Calboard CC");
  });

  it("reports execution complete and evidence delivered as separate states", () => {
    const r = buildReturnObject(base);
    expect(r.states.executionComplete).toBe(true);
    expect(r.states.evidenceComplete).toBe(true);
    expect(r.states.evidenceDelivered).toBe(true);
  });

  // §3: "execution complete + delivery failed" must remain expressible.
  it("keeps execution complete when delivery failed", () => {
    const r = buildReturnObject({
      ...base,
      delivery: { status: "FAILED", location: null, archiveSha256: null, error: "zip failed" },
    });
    expect(r.states.executionComplete).toBe(true);
    expect(r.states.evidenceComplete).toBe(true);
    expect(r.states.evidenceDelivered).toBe(false);
  });

  it("is not execution complete when a required check is unaccounted for", () => {
    const r = buildReturnObject({
      ...base,
      inventory: { required: ["a", "b"], executed: ["a"], notRun: [], unaccountedFor: ["b"], complete: false },
    });
    expect(r.states.executionComplete).toBe(false);
  });

  it("never reports delivered when the served revision mismatched", () => {
    const r = buildReturnObject({
      ...base,
      served: { baseUrl: "http://127.0.0.1:3000", revision: "old", binding: "MISMATCH", reason: "stale" },
      delivery: { status: "FAILED", location: null, archiveSha256: null, error: "blocked" },
    });
    expect(r.states.evidenceDelivered).toBe(false);
    expect(r.served.sourceEqualsServed).toBe("no");
  });

  it("reports source == served as unknown when the binding is UNKNOWN", () => {
    const r = buildReturnObject({
      ...base,
      served: { baseUrl: "http://127.0.0.1:3000", revision: "development", binding: "UNKNOWN", reason: "dev" },
    });
    expect(r.served.sourceEqualsServed).toBe("unknown");
  });

  it("reports source == served as yes on a MATCH", () => {
    expect(buildReturnObject(base).served.sourceEqualsServed).toBe("yes");
  });
});
