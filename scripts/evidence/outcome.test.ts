import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveOutcomeId, findPriorRuns, decideRepeat, captureDirName } from "./outcome";

describe("resolveOutcomeId", () => {
  it("takes the id from --outcome-id", () => {
    const r = resolveOutcomeId(["--outcome-id", "CB-G2-EVIDENCE-01"], {});
    expect(r.outcomeId).toBe("CB-G2-EVIDENCE-01");
  });

  it("takes the id from the environment when no flag is given", () => {
    const r = resolveOutcomeId([], { EVIDENCE_OUTCOME_ID: "CB-G2-EVIDENCE-01" });
    expect(r.outcomeId).toBe("CB-G2-EVIDENCE-01");
  });

  // No silent default: an unidentified archive is the gap this closes.
  it("refuses to invent an id when none is supplied", () => {
    const r = resolveOutcomeId([], {});
    expect(r.outcomeId).toBeNull();
    expect(r.error).toContain("--outcome-id");
  });

  it("rejects an id that would not be safe as a directory name", () => {
    const r = resolveOutcomeId(["--outcome-id", "../escape"], {});
    expect(r.outcomeId).toBeNull();
    expect(r.error).toContain("../escape");
  });
});

describe("findPriorRuns", () => {
  it("finds an existing run carrying the same outcome id", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-outcome-"));
    await fs.mkdir(path.join(tmp, captureDirName("CB-G2-EVIDENCE-01", "2026-09-09T10-00-00-000Z")));
    expect(await findPriorRuns(tmp, "CB-G2-EVIDENCE-01")).toHaveLength(1);
  });

  it("finds nothing when no run used that id", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-outcome-"));
    await fs.mkdir(path.join(tmp, captureDirName("CB-OTHER-99", "2026-09-09T10-00-00-000Z")));
    expect(await findPriorRuns(tmp, "CB-G2-EVIDENCE-01")).toHaveLength(0);
  });

  it("does not mistake a longer id for the one asked about", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-outcome-"));
    await fs.mkdir(path.join(tmp, captureDirName("CB-A-B", "2026-09-09T10-00-00-000Z")));
    expect(await findPriorRuns(tmp, "CB-A")).toHaveLength(0);
  });

  it("finds nothing when the evidence root does not exist yet", async () => {
    expect(await findPriorRuns(path.join(os.tmpdir(), "no-such-dir-here"), "X")).toHaveLength(0);
  });
});

describe("decideRepeat", () => {
  it("proceeds when the outcome id has no prior run", () => {
    expect(decideRepeat([], false).proceed).toBe(true);
  });

  // Negative case 4 (§5.4): prior state is detected BEFORE consequential work.
  it("STOPs on a duplicate outcome id when repeat was not authorised", () => {
    const d = decideRepeat(["/e/CB-G2-EVIDENCE-01-2026-09-09T10-00-00-000Z"], false);
    expect(d.proceed).toBe(false);
    expect(d.reason).toContain("--repeat");
    expect(d.reason).toContain("CB-G2-EVIDENCE-01");
  });

  it("proceeds on a duplicate when repeat is explicitly authorised", () => {
    const d = decideRepeat(["/e/CB-G2-EVIDENCE-01-2026-09-09T10-00-00-000Z"], true);
    expect(d.proceed).toBe(true);
  });

  it("carries the prior runs forward so the duplicate history stays visible", () => {
    const prior = ["/e/CB-G2-EVIDENCE-01-2026-09-09T10-00-00-000Z"];
    expect(decideRepeat(prior, true).priorRuns).toEqual(prior);
  });
});
