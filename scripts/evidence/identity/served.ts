// scripts/evidence/identity/served.ts
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Whether the server that was measured is provably running the code the
 * manifest claims to describe.
 *
 * MATCH and MISMATCH are both positive findings. UNKNOWN is the honest third
 * state — it means the question could not be answered, never that the answer
 * was no.
 */
export type ServedBinding = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface ServedProbe {
  /** Build id read out of the served HTML, or null if the page carried none. */
  servedBuildId: string | null;
  /** `.next/BUILD_ID` in the measured worktree, or null if there is no build. */
  diskBuildId: string | null;
  /** Whether the measured worktree has uncommitted changes. */
  worktreeDirty: boolean;
}

export interface ServedDecision {
  binding: ServedBinding;
  reason: string;
}

/** What `next dev` reports in place of a real build id. */
const DEV_BUILD_ID = "development";

/**
 * The build id Next embeds in app-router flight data, e.g. `\"b\":\"UjIW…\"`.
 *
 * The quotes are backslash-escaped in the served markup because the payload is
 * a JS string literal, so both the escaped and bare forms are accepted rather
 * than assuming one — a page that ever ships the unescaped form should not
 * silently become UNKNOWN.
 */
const BUILD_ID_IN_FLIGHT_DATA = /\\?"b\\?":\\?"([A-Za-z0-9_-]+)/;

export function extractServedBuildId(html: string): string | null {
  return BUILD_ID_IN_FLIGHT_DATA.exec(html)?.[1] ?? null;
}

/**
 * Decides whether the served code is the source code, from build identity alone.
 *
 * Every branch that cannot prove equality returns UNKNOWN rather than
 * MISMATCH. The distinction is the point: MISMATCH blocks delivery (§5.1), so
 * reaching it on anything less than a proven difference would turn "not
 * measurable" into "wrong", and a dev-mode run would stop looking like the
 * unbindable run it is and start looking like a stale server.
 *
 * A dirty worktree cannot reach MATCH either. The build on disk may predate
 * the uncommitted edits, so a matching build id proves the server is serving
 * *that build* — not that the build is the HEAD the manifest records.
 */
export function decideServedBinding(p: ServedProbe): ServedDecision {
  if (p.servedBuildId === null) {
    return {
      binding: "UNKNOWN",
      reason: "no build id could be read from the served page",
    };
  }
  if (p.servedBuildId === DEV_BUILD_ID) {
    return {
      binding: "UNKNOWN",
      reason:
        "the server is running next dev, which serves no build id; " +
        "binding requires a production build (npm run build && npm start)",
    };
  }
  if (p.diskBuildId === null) {
    return {
      binding: "UNKNOWN",
      reason: "the worktree has no .next/BUILD_ID to compare the served build against",
    };
  }
  if (p.servedBuildId !== p.diskBuildId) {
    return {
      binding: "MISMATCH",
      reason:
        `the server is serving build ${p.servedBuildId}, but this worktree built ` +
        `${p.diskBuildId} — the evidence would not describe the code being reported`,
    };
  }
  if (p.worktreeDirty) {
    return {
      binding: "UNKNOWN",
      reason:
        `the served build ${p.servedBuildId} is this worktree's build, but the worktree ` +
        "is dirty — the build may predate the uncommitted changes",
    };
  }
  return {
    binding: "MATCH",
    reason: `the server is serving this worktree's build ${p.servedBuildId}`,
  };
}

/**
 * Gathers the two build identities the decision compares.
 *
 * Neither read is allowed to throw. An unreachable server and an unbuilt
 * worktree are both ordinary conditions here, and both must arrive at the
 * decision as a null that becomes UNKNOWN — a probe that threw would turn a
 * measurable-but-unbindable run into a runner crash, which is the opposite of
 * what the third state is for.
 *
 * The page requested is the same route the reachability gate uses, so the
 * binding describes the server that actually served the evidence.
 */
export async function probeServedIdentity(
  baseUrl: string,
  repoRoot: string,
  worktreeDirty: boolean
): Promise<ServedProbe> {
  let servedBuildId: string | null = null;
  try {
    const res = await fetch(new URL("/analyzer", baseUrl), {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) servedBuildId = extractServedBuildId(await res.text());
  } catch {
    // Unreachable or timed out; stays null and decides as UNKNOWN.
  }

  let diskBuildId: string | null = null;
  try {
    diskBuildId = (await fs.readFile(path.join(repoRoot, ".next", "BUILD_ID"), "utf8")).trim();
  } catch {
    // No production build in this worktree; stays null and decides as UNKNOWN.
  }

  return { servedBuildId, diskBuildId, worktreeDirty };
}
