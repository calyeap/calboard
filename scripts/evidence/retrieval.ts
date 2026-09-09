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
  hasRemote: boolean;
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
 * than a shrug.
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
  if (!c.hasRemote) {
    return {
      route: null,
      gap: "no native retrieval route: this repository has no remote to deliver to",
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

export async function probeRouteCapability(): Promise<RouteCapability & { gh: string | null }> {
  const gh = await findGh();
  if (gh === null) {
    return { gh: null, ghAvailable: false, ghAuthenticated: false, hasRemote: false };
  }
  let ghAuthenticated = false;
  try {
    await run(gh, ["auth", "status"]);
    ghAuthenticated = true;
  } catch {
    // Unauthenticated; recorded as such.
  }
  let hasRemote = false;
  try {
    const { stdout } = await run("git", ["config", "--get", "remote.origin.url"]);
    hasRemote = stdout.trim() !== "";
  } catch {
    // No remote; recorded as such.
  }
  return { gh, ghAvailable: true, ghAuthenticated, hasRemote };
}

/**
 * Uploads the archive to a DRAFT release and then fetches it back.
 *
 * Draft, never published: a draft release and its assets are visible only to
 * accounts with push access, and GitHub does not create the git tag until a
 * release is published — so nothing here becomes publicly visible on the
 * repository. That is a hard constraint of this gate, not a preference, and it
 * is verified after upload rather than trusted.
 *
 * The fetch back is the point. Uploading proves the bytes left; only a
 * download proves an owner can get them, which is what §5.7 asks. The fetch
 * writes to a temp directory outside the run's own output, so it cannot
 * accidentally read the local archive it is supposed to be verifying against.
 */
export async function deliverViaGitHubDraftRelease(
  gh: string,
  repoRoot: string,
  archivePath: string,
  outcomeId: string
): Promise<RetrievalProof> {
  const tag = releaseTagFor(outcomeId);
  const title = `Evidence ${outcomeId}`;

  // Create the draft if it is not already there. A repeat dispatch reuses the
  // release and replaces the asset rather than creating a second one.
  try {
    await run(gh, ["release", "view", tag, "--repo", repoRoot], { cwd: repoRoot });
  } catch {
    await run(
      gh,
      ["release", "create", tag, "--draft", "--title", title, "--notes", `Evidence archive for ${outcomeId}.`],
      { cwd: repoRoot }
    );
  }

  await run(gh, ["release", "upload", tag, archivePath, "--clobber"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });

  // The release must still be a draft. If it is not, this evidence is publicly
  // visible and the constraint has been broken.
  const { stdout: viewJson } = await run(gh, ["release", "view", tag, "--json", "isDraft"], {
    cwd: repoRoot,
  });
  if (JSON.parse(viewJson).isDraft !== true) {
    throw new Error(`release ${tag} is not a draft — refusing to treat it as delivered`);
  }

  // Fetch it back, into a directory the run does not own.
  const assetName = path.basename(archivePath);
  const fetchDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-fetch-"));
  await run(gh, ["release", "download", tag, "--pattern", assetName, "--dir", fetchDir], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const fetched = await fs.readFile(path.join(fetchDir, assetName));

  return {
    route: "github-draft-release",
    locator: tag,
    command: `gh release download ${tag} --pattern '${assetName}' --repo <owner>/<repo>`,
    verifiedBytes: fetched.length,
    verifiedSha256: createHash("sha256").update(fetched).digest("hex"),
  };
}
