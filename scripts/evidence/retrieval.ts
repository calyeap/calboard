// scripts/evidence/retrieval.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RetrievalProof } from "./delivery";

const run = promisify(execFile);

/**
 * The GitHub CLI, which is installed here but reliably absent from PATH.
 *
 * Probed rather than assumed: the whole point of this module is that a route
 * is only claimed when it demonstrably exists.
 */
const GH_CANDIDATES = [
  "gh",
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "/usr/bin/gh",
  "/usr/local/bin/gh",
];

export interface RouteCapability {
  ghAvailable: boolean;
  ghAuthenticated: boolean;
  /**
   * owner/repo slug this evidence would deliver to, or null when none could
   * be resolved from the git remote.
   *
   * Resolved once, by `SourceIdentity.repo` (identity/source.ts), and passed
   * in here rather than re-derived — a second independent parse of the same
   * remote is exactly the kind of duplicate resolution that let the two
   * disagree in the first place (CB-G2-EVIDENCE-03: the release-existence
   * check used a filesystem path where gh expects this slug).
   */
  repoSlug: string | null;
}

export interface RouteDecision {
  route: string | null;
  /** Why there is no route. Empty when there is one. */
  gap: string;
}

/**
 * The release tag an owner asks for, derived from the OUTCOME ID alone.
 *
 * No timestamp and no run state: "retrievable from the OUTCOME ID" only means
 * anything if the owner can construct the locator knowing nothing but the
 * assignment. The `evidence/` prefix namespaces these away from any real
 * product release.
 */
export function releaseTagFor(outcomeId: string): string {
  return `evidence/${outcomeId}`;
}

/**
 * Whether a native retrieval route is available, and if not, precisely why.
 *
 * Each branch names its own reason because the fallback is a legitimate Gate 2
 * outcome — but only when it is recorded as a specific, checked absence rather
 * than a shrug. Never guess a slug: an unresolved repo slug is treated exactly
 * like no remote at all, not papered over with a fallback derivation.
 */
export function decideRetrievalRoute(c: RouteCapability): RouteDecision {
  if (!c.ghAvailable) {
    return {
      route: null,
      gap:
        "no native retrieval route: the gh CLI was not found, and standing up any " +
        "other transport is outside Gate 2",
    };
  }
  if (!c.ghAuthenticated) {
    return {
      route: null,
      gap:
        "no native retrieval route: the gh CLI is present but not authenticated, and " +
        "adding credentials is outside Gate 2",
    };
  }
  if (c.repoSlug === null) {
    return {
      route: null,
      gap: "no native retrieval route: this repository has no remote resolvable to an owner/repo slug",
    };
  }
  return { route: "github-draft-release", gap: "" };
}

/** The gh binary, or null when none of the candidates responds. */
export async function findGh(): Promise<string | null> {
  for (const candidate of GH_CANDIDATES) {
    try {
      await run(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Probes gh's availability and auth state. Takes the repo slug as an input
 * rather than resolving it here: `readSourceIdentity` (identity/source.ts)
 * has already parsed the git remote once, and re-deriving it a second time
 * in this module is precisely the duplication that let the two disagree.
 */
export async function probeRouteCapability(
  repoSlug: string | null
): Promise<RouteCapability & { gh: string | null }> {
  const gh = await findGh();
  if (gh === null) {
    return { gh: null, ghAvailable: false, ghAuthenticated: false, repoSlug };
  }
  let ghAuthenticated = false;
  try {
    await run(gh, ["auth", "status"]);
    ghAuthenticated = true;
  } catch {
    // Unauthenticated; recorded as such.
  }
  return { gh, ghAvailable: true, ghAuthenticated, repoSlug };
}

/**
 * One `gh` invocation: the args after the binary path, and the parsed
 * `{ stdout, stderr }` result. Real by default (the module-private `run`,
 * closing over the `gh` binary path); injectable so
 * `deliverViaGitHubDraftRelease` can be regression-tested against a
 * realistic fake without a live GitHub call or a network dependency in the
 * unit suite.
 */
export type GhRunner = (
  args: readonly string[],
  options?: { maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Uploads the archive to a DRAFT release and then fetches it back.
 *
 * Draft, never published: a draft release and its assets are visible only to
 * accounts with push access, and GitHub does not create the git tag until a
 * release is published — so nothing here becomes publicly visible on the
 * repository. That is a hard constraint of this gate, not a preference, and it
 * is verified after upload rather than trusted.
 *
 * `repoSlug` is the canonical `owner/repo` string, resolved once by the
 * caller (`SourceIdentity.repo`) and threaded through EVERY gh invocation
 * below via an explicit `--repo`. Nothing here relies on `cwd`-based
 * inference or re-derives the slug itself — CB-G2-EVIDENCE-03 was exactly
 * that inconsistency: one call carried a filesystem path where `--repo`
 * expects this slug, and the rest resolved implicitly through the process's
 * working directory. An explicit, identical `--repo` on every call closes
 * both problems at once: there is no path for a path to leak into, and no
 * implicit resolution left to disagree with it.
 *
 * The fetch back is the point. Uploading proves the bytes left; only a
 * download proves an owner can get them, which is what §5.7 asks. The fetch
 * writes to a temp directory outside the run's own output, so it cannot
 * accidentally read the local archive it is supposed to be verifying against.
 */
export async function deliverViaGitHubDraftRelease(
  gh: string,
  repoSlug: string,
  archivePath: string,
  outcomeId: string,
  runGh: GhRunner = (args, options) =>
    run(gh, args as string[], options) as Promise<{ stdout: string; stderr: string }>
): Promise<RetrievalProof> {
  const tag = releaseTagFor(outcomeId);
  const title = `Evidence ${outcomeId}`;
  const repoArgs = ["--repo", repoSlug];

  // Create the draft if it is not already there. A repeat dispatch reuses the
  // release and replaces the asset rather than creating a second one — this
  // only works because the existence check itself now uses a --repo gh can
  // actually parse; previously it errored on every call, so this catch ran
  // unconditionally and every repeat dispatch minted a fresh draft.
  try {
    await runGh(["release", "view", tag, ...repoArgs]);
  } catch {
    await runGh([
      "release",
      "create",
      tag,
      "--draft",
      "--title",
      title,
      "--notes",
      `Evidence archive for ${outcomeId}.`,
      ...repoArgs,
    ]);
  }

  // gh's own --clobber only replaces "existing assets of the SAME NAME" — it
  // is documented that way, and it is literal: the asset name it compares
  // against is the uploaded file's basename. The local archive's own
  // filename carries this run's capture timestamp precisely so prior local
  // evidence is never overwritten, which means two dispatches' local files
  // are never named alike — so --clobber given the raw archivePath directly
  // would never find a match, and every repeat dispatch would accumulate one
  // more asset on the one release instead of replacing it (CB-G2-EVIDENCE-03:
  // exactly this, observed on the real system).
  //
  // Uploading a STAGED COPY under a name derived from the OUTCOME ID alone —
  // stable across every dispatch of this assignment — is what makes
  // --clobber's same-name comparison actually fire. The local archive keeps
  // its own timestamped name and is never touched by this.
  const assetName = `${outcomeId}.zip`;
  const uploadStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-upload-"));
  try {
    const stagedPath = path.join(uploadStagingDir, assetName);
    await fs.copyFile(archivePath, stagedPath);
    await runGh(["release", "upload", tag, stagedPath, "--clobber", ...repoArgs], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    await fs.rm(uploadStagingDir, { recursive: true, force: true });
  }

  // The release must still be a draft. If it is not, this evidence is publicly
  // visible and the constraint has been broken.
  const { stdout: viewJson } = await runGh(
    ["release", "view", tag, "--json", "isDraft", ...repoArgs]
  );
  if (JSON.parse(viewJson).isDraft !== true) {
    throw new Error(`release ${tag} is not a draft — refusing to treat it as delivered`);
  }

  // Fetch it back, into a directory the run does not own.
  const fetchDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-fetch-"));
  await runGh(
    ["release", "download", tag, "--pattern", assetName, "--dir", fetchDir, ...repoArgs],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const fetched = await fs.readFile(path.join(fetchDir, assetName));

  return {
    route: "github-draft-release",
    locator: tag,
    // Runnable as printed: the real slug, not a placeholder an owner would
    // have to fill in themselves.
    command: `gh release download ${tag} --pattern '${assetName}' --repo ${repoSlug}`,
    verifiedBytes: fetched.length,
    verifiedSha256: createHash("sha256").update(fetched).digest("hex"),
  };
}
