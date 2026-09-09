import { describe, it, expect } from "vitest";
import { buildSourceIdentity, type GitFacts } from "./source";

const CLEAN: GitFacts = {
  remoteUrl: "https://github.com/calyeap/calboard.git",
  branch: "feat/evidence-gate2-hardening",
  baseRevision: "0c936781996da0decd92501a6d8604bd811e050c",
  head: "0c936781996da0decd92501a6d8604bd811e050c",
  porcelain: "",
  diff: "",
};

describe("buildSourceIdentity", () => {
  it("records repo, branch, base and result HEAD verbatim", () => {
    const s = buildSourceIdentity(CLEAN);
    expect(s.repo).toBe("calyeap/calboard");
    expect(s.branch).toBe("feat/evidence-gate2-hardening");
    expect(s.baseRevision).toBe(CLEAN.baseRevision);
    expect(s.resultHead).toBe(CLEAN.head);
  });

  it("is clean, with no fingerprint, when nothing is modified", () => {
    const s = buildSourceIdentity(CLEAN);
    expect(s.dirty).toBe(false);
    expect(s.dirtyFingerprint).toBeNull();
  });

  it("is dirty, with a fingerprint, when the worktree has changes", () => {
    const s = buildSourceIdentity({
      ...CLEAN,
      porcelain: " M scripts/evidence/run.ts",
      diff: "@@ -1 +1 @@ changed",
    });
    expect(s.dirty).toBe(true);
    expect(s.dirtyFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same fingerprint for the same dirty state", () => {
    const dirty = { ...CLEAN, porcelain: " M a.ts", diff: "@@ x" };
    expect(buildSourceIdentity(dirty).dirtyFingerprint).toBe(
      buildSourceIdentity(dirty).dirtyFingerprint
    );
  });

  it("gives a different fingerprint when the changed content differs", () => {
    const a = buildSourceIdentity({ ...CLEAN, porcelain: " M a.ts", diff: "@@ one" });
    const b = buildSourceIdentity({ ...CLEAN, porcelain: " M a.ts", diff: "@@ two" });
    expect(a.dirtyFingerprint).not.toBe(b.dirtyFingerprint);
  });

  it("fingerprints identically regardless of line-ending style", () => {
    const lf = buildSourceIdentity({ ...CLEAN, porcelain: " M a.ts", diff: "one\ntwo" });
    const crlf = buildSourceIdentity({ ...CLEAN, porcelain: " M a.ts", diff: "one\r\ntwo" });
    expect(lf.dirtyFingerprint).toBe(crlf.dirtyFingerprint);
  });
});
