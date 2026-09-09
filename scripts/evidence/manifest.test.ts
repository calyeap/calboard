import { describe, it, expect } from "vitest";
import { buildManifest, type ManifestArgs } from "./manifest";

const ARGS: ManifestArgs = {
  outcomeId: "CB-G2-EVIDENCE-01",
  baseUrl: "http://127.0.0.1:3000",
  captured: new Map(),
  verdict: { status: "PASS", failingStep: null, results: [] },
  runIds: { MSFT: "run-1" },
  unknowns: [],
  source: {
    repo: "calyeap/calboard",
    branch: "feat/evidence-gate2-hardening",
    baseRevision: "a".repeat(40),
    resultHead: "b".repeat(40),
    dirty: false,
    dirtyFingerprint: null,
  },
  served: { baseUrl: "http://127.0.0.1:3000", revision: "UjIW", binding: "MATCH", reason: "ok" },
  execution: { started: "2026-09-09T10:00:00.000Z", completed: "2026-09-09T10:05:00.000Z", runnerRevision: "c".repeat(40) },
  inventory: { required: ["a"], executed: ["a"], notRun: [], unaccountedFor: [], complete: true },
  priorRuns: [],
};

describe("buildManifest — hardened identity", () => {
  it("binds the evidence to the source revision it describes", () => {
    const m = buildManifest(ARGS) as any;
    expect(m.source.resultHead).toBe("b".repeat(40));
    expect(m.source.branch).toBe("feat/evidence-gate2-hardening");
    expect(m.source.repo).toBe("calyeap/calboard");
    expect(m.source.dirty).toBe(false);
  });

  it("records which server was measured and whether it matched", () => {
    const m = buildManifest(ARGS) as any;
    expect(m.served.binding).toBe("MATCH");
    expect(m.served.revision).toBe("UjIW");
  });

  it("carries the outcome id so the archive names its assignment", () => {
    expect((buildManifest(ARGS) as any).outcomeId).toBe("CB-G2-EVIDENCE-01");
  });

  it("carries the required / executed / not-run inventory", () => {
    const m = buildManifest(ARGS) as any;
    expect(m.checks.required).toEqual(["a"]);
    expect(m.checks.notRun).toEqual([]);
  });

  it("keeps the fields DESIGN already reads", () => {
    const m = buildManifest(ARGS) as any;
    expect(m.base).toBe("http://127.0.0.1:3000");
    expect(m.widths).toEqual([720, 1024, 1440]);
    expect(m.preflight.verdict).toBe("PASS");
    expect(m.runs).toEqual({ MSFT: "run-1" });
    expect(m.targets).toEqual({});
    expect(typeof m.captured).toBe("string");
  });
});
