import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  releaseTagFor,
  decideRetrievalRoute,
  deliverViaGitHubDraftRelease,
  type GhRunner,
} from "./retrieval";

describe("releaseTagFor", () => {
  // Retrievability "from the OUTCOME ID alone" means the locator is a pure
  // function of the id — no timestamp, no run-specific state.
  it("derives the tag from the outcome id alone", () => {
    expect(releaseTagFor("CB-G2-EVIDENCE-02")).toBe("evidence/CB-G2-EVIDENCE-02");
  });

  it("is stable across calls, so an owner can predict it", () => {
    expect(releaseTagFor("CB-X")).toBe(releaseTagFor("CB-X"));
  });
});

describe("decideRetrievalRoute", () => {
  it("uses the GitHub draft-release route when the CLI is authenticated", () => {
    const d = decideRetrievalRoute({
      ghAvailable: true,
      ghAuthenticated: true,
      repoSlug: "calyeap/calboard",
    });
    expect(d.route).toBe("github-draft-release");
    expect(d.gap).toBe("");
  });

  // The fallback is a legitimate outcome, not a failure — but it must say why.
  it("has no route, with a reason, when the CLI is absent", () => {
    const d = decideRetrievalRoute({
      ghAvailable: false,
      ghAuthenticated: false,
      repoSlug: "calyeap/calboard",
    });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("gh");
  });

  it("has no route, with a reason, when the CLI is not authenticated", () => {
    const d = decideRetrievalRoute({
      ghAvailable: true,
      ghAuthenticated: false,
      repoSlug: "calyeap/calboard",
    });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("authenticat");
  });

  // §5.7 / item 1 of CB-G2-EVIDENCE-03: never guess a slug. When none can be
  // resolved from the git remote, there is no route — full stop.
  it("has no route, with a reason, when the repo slug could not be resolved", () => {
    const d = decideRetrievalRoute({ ghAvailable: true, ghAuthenticated: true, repoSlug: null });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("remote");
  });
});

/** A tiny real file on disk, standing in for a packaged evidence archive. */
async function writeTempArchive(basename = "archive.zip"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-retrieval-test-"));
  const file = path.join(dir, basename);
  await fs.writeFile(file, "not a real zip, just bytes for the test", "utf8");
  return file;
}

/**
 * Fixture-scoped, realistic `gh` behavior for a mocked `GhRunner`: `gh`
 * itself fails immediately on a malformed or missing `--repo` value, before
 * it ever looks up whether the release exists — so a call missing --repo, or
 * carrying anything other than the one resolved slug, must reject exactly as
 * the real CLI would. This is what lets the regression tests below fail for
 * the right reason (a defect in *which args were sent*), not an incidental
 * mocking artefact. The download branch actually writes the requested file,
 * since the real function reads it back afterward to compute the hash.
 */
function fakeGh(opts: { repoSlug: string; releaseAlreadyExists: boolean }) {
  const calls: string[][] = [];
  const runGh: GhRunner = vi.fn(async (args: readonly string[]) => {
    const a = [...args];
    calls.push(a);

    const repoIdx = a.indexOf("--repo");
    const repoValue = repoIdx === -1 ? null : a[repoIdx + 1];
    if (repoValue !== opts.repoSlug) {
      throw new Error(`unknown repository: ${repoValue ?? "(no --repo given)"}`);
    }

    if (a[0] === "release" && a[1] === "view" && !a.includes("--json")) {
      if (!opts.releaseAlreadyExists) throw new Error("release not found");
      return { stdout: "", stderr: "" };
    }
    if (a[0] === "release" && a[1] === "view" && a.includes("--json")) {
      return { stdout: JSON.stringify({ isDraft: true }), stderr: "" };
    }
    if (a[0] === "release" && a[1] === "download") {
      const dir = a[a.indexOf("--dir") + 1];
      const assetName = a[a.indexOf("--pattern") + 1];
      await fs.writeFile(path.join(dir, assetName), "downloaded bytes", "utf8");
      return { stdout: "", stderr: "" };
    }
    // create, upload
    return { stdout: "", stderr: "" };
  });
  return { runGh, calls };
}

describe("deliverViaGitHubDraftRelease — release invocations use the resolved slug", () => {
  const REPO_SLUG = "calyeap/calboard";

  // Regression for CB-G2-EVIDENCE-03: the diagnosed defect was `gh release
  // view` receiving `--repo <REPO_ROOT>` (a filesystem path) while create,
  // upload and download carried no --repo at all and resolved (or, in
  // reality, failed to resolve) implicitly. Every one of the five gh
  // invocations this function makes must carry the SAME resolved slug,
  // explicitly, every time — never a path, never an implicit fallback.
  it("sends the identical --repo <slug> on every gh invocation, never a path", async () => {
    const { runGh, calls } = fakeGh({ repoSlug: REPO_SLUG, releaseAlreadyExists: false });
    const archivePath = await writeTempArchive();

    await deliverViaGitHubDraftRelease("gh", REPO_SLUG, archivePath, "CB-REGRESSION-TEST", runGh);

    // view (existence check), create, upload, view --json isDraft, download.
    expect(calls.length).toBe(5);
    for (const call of calls) {
      const repoIdx = call.indexOf("--repo");
      expect(repoIdx, `call ${JSON.stringify(call)} is missing --repo`).toBeGreaterThan(-1);
      expect(call[repoIdx + 1]).toBe(REPO_SLUG);
    }
  });

  // Item 4: locator uniqueness. When the release already exists, "create"
  // must never run — a repeat dispatch reuses the one release, it does not
  // mint a second one under the same tag.
  it("does not create a second release when one already exists for the tag", async () => {
    const { runGh, calls } = fakeGh({ repoSlug: REPO_SLUG, releaseAlreadyExists: true });
    const archivePath = await writeTempArchive();

    await deliverViaGitHubDraftRelease("gh", REPO_SLUG, archivePath, "CB-REGRESSION-TEST", runGh);

    const createCalls = calls.filter((c) => c[0] === "release" && c[1] === "create");
    expect(createCalls).toEqual([]);
  });

  it("creates the release exactly once when it does not already exist", async () => {
    const { runGh, calls } = fakeGh({ repoSlug: REPO_SLUG, releaseAlreadyExists: false });
    const archivePath = await writeTempArchive();

    await deliverViaGitHubDraftRelease("gh", REPO_SLUG, archivePath, "CB-REGRESSION-TEST", runGh);

    const createCalls = calls.filter((c) => c[0] === "release" && c[1] === "create");
    expect(createCalls.length).toBe(1);
  });

  // Item 2: the command an owner pastes must be runnable as printed, not a
  // template with an unresolved placeholder.
  it("returns a retrieval command carrying the real slug, not a placeholder", async () => {
    const { runGh } = fakeGh({ repoSlug: REPO_SLUG, releaseAlreadyExists: true });
    const archivePath = await writeTempArchive();

    const proof = await deliverViaGitHubDraftRelease(
      "gh",
      REPO_SLUG,
      archivePath,
      "CB-REGRESSION-TEST",
      runGh
    );

    expect(proof.command).toContain(REPO_SLUG);
    expect(proof.command).not.toContain("<owner>/<repo>");
  });

  // Discovered proving item 5 at system level: --clobber only replaces an
  // asset "of the same name" (gh's own documented behavior), but the local
  // archive's filename carries this run's own capture timestamp — never the
  // same string twice — so two dispatches under one OUTCOME ID uploaded two
  // differently-named assets onto the one release instead of replacing one.
  // The asset name given to gh must be stable across repeat dispatches,
  // independent of whatever the local file happens to be called.
  it("uploads under a name derived from the outcome id, not the local archive's own filename", async () => {
    const { runGh, calls } = fakeGh({ repoSlug: REPO_SLUG, releaseAlreadyExists: true });
    // Two archives with DIFFERENT local filenames, standing in for two
    // dispatches' distinct, never-overwritten local captures.
    const archiveA = await writeTempArchive("2026-09-09T12-52-01-764Z.zip");
    const archiveB = await writeTempArchive("2026-09-09T12-53-44-209Z.zip");

    await deliverViaGitHubDraftRelease("gh", REPO_SLUG, archiveA, "CB-REGRESSION-TEST", runGh);
    await deliverViaGitHubDraftRelease("gh", REPO_SLUG, archiveB, "CB-REGRESSION-TEST", runGh);

    const uploadCalls = calls.filter((c) => c[0] === "release" && c[1] === "upload");
    expect(uploadCalls.length).toBe(2);
    // args are ["release", "upload", tag, <file>, "--clobber", ...repoArgs].
    const uploadedBasenames = uploadCalls.map((c) => path.basename(c[3]));
    // The SAME name both times — that is what makes --clobber replace rather
    // than accumulate. Neither upload used either archive's own filename.
    expect(uploadedBasenames[0]).toBe(uploadedBasenames[1]);
    expect(uploadedBasenames[0]).not.toBe(path.basename(archiveA));
    expect(uploadedBasenames[0]).not.toBe(path.basename(archiveB));
    expect(uploadedBasenames[0]).toBe("CB-REGRESSION-TEST.zip");
  });
});
