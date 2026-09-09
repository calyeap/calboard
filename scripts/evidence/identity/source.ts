// scripts/evidence/identity/source.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The raw git output this identity is derived from, so the shaping is testable. */
export interface GitFacts {
  remoteUrl: string;
  branch: string;
  /** The revision this work branched from. */
  baseRevision: string;
  /** The revision the evidence actually describes. */
  head: string;
  /** `git status --porcelain` — which paths differ. */
  porcelain: string;
  /** `git diff HEAD` — how they differ. */
  diff: string;
}

export interface SourceIdentity {
  repo: string | null;
  branch: string;
  baseRevision: string;
  resultHead: string;
  dirty: boolean;
  /** SHA-256 over the uncommitted change set. Null when clean. */
  dirtyFingerprint: string | null;
}

/** `owner/name` from any remote URL shape, or null when there is no remote. */
function repoSlug(remoteUrl: string): string | null {
  const m = /[/:]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  return m?.[1] ?? null;
}

/**
 * Identifies the code the evidence describes.
 *
 * A dirty worktree gets a fingerprint rather than being reported as merely
 * "dirty": two runs from the same HEAD with different uncommitted edits are
 * different code, and without the fingerprint their archives are
 * indistinguishable. It covers `git diff HEAD` as well as the path list, so an
 * edit that changes content without changing which files are modified still
 * moves the fingerprint.
 *
 * Line endings are normalised first. Git reports diffs with whatever endings
 * the file carries, and on Windows the same logical change can arrive as CRLF
 * or LF depending on autocrlf; without this the fingerprint would move for a
 * change that is not there.
 */
export function buildSourceIdentity(f: GitFacts): SourceIdentity {
  const porcelain = f.porcelain.trim();
  const dirty = porcelain.length > 0;
  const normalise = (s: string): string => s.split("\r\n").join("\n");
  return {
    repo: repoSlug(f.remoteUrl),
    branch: f.branch,
    baseRevision: f.baseRevision,
    resultHead: f.head,
    dirty,
    dirtyFingerprint: dirty
      ? createHash("sha256")
          .update(normalise(porcelain))
          .update(" ")
          .update(normalise(f.diff))
          .digest("hex")
      : null,
  };
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Reads the identity of the worktree being measured.
 *
 * `baseRevision` is the merge-base with the default branch — the point this
 * work diverged from. It falls back to HEAD when there is no such branch
 * (a fresh repo, or a checkout with no origin/master), because reporting a
 * wrong base is worse than reporting that the base is the head itself.
 */
/**
 * The last revision to touch the runner itself.
 *
 * Distinct from the result HEAD: the instrument and the code it measures are
 * versioned together here, but they do not change together, and a consumer
 * comparing two archives needs to know whether the measurement changed or only
 * the thing measured. Falls back to HEAD when the runner has no history of its
 * own yet.
 */
export async function readRunnerRevision(repoRoot: string): Promise<string> {
  try {
    const rev = await git(repoRoot, [
      "log",
      "-1",
      "--format=%H",
      "--",
      "scripts/evidence",
    ]);
    if (rev !== "") return rev;
  } catch {
    // Fall through to HEAD.
  }
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

export async function readSourceIdentity(repoRoot: string): Promise<SourceIdentity> {
  const head = await git(repoRoot, ["rev-parse", "HEAD"]);
  let baseRevision = head;
  try {
    baseRevision = await git(repoRoot, ["merge-base", "origin/master", "HEAD"]);
  } catch {
    // No origin/master to diverge from; base stays HEAD.
  }
  let remoteUrl = "";
  try {
    remoteUrl = await git(repoRoot, ["config", "--get", "remote.origin.url"]);
  } catch {
    // No remote configured; repo stays null.
  }
  return buildSourceIdentity({
    remoteUrl,
    branch: await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    baseRevision,
    head,
    porcelain: await git(repoRoot, ["status", "--porcelain"]),
    diff: await git(repoRoot, ["diff", "HEAD"]),
  });
}
