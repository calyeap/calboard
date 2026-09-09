// scripts/evidence/delivery.ts
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { zipDirectory } from "./archive";
import type { ServedBinding } from "./identity/served";

/**
 * How far the evidence actually got.
 *
 * LOCAL_READY exists because "packaged and verified" was being reported as
 * "delivered". Gate 2 defines delivery as the owner retrieving the evidence
 * from the OUTCOME ID alone, and a gitignored zip on the machine that produced
 * it satisfies none of that — it is exactly the optimistic-direction fault
 * this runner was hardened to remove, one level up.
 */
export type DeliveryStatus = "DELIVERED" | "LOCAL_READY" | "FAILED" | "UNKNOWN";

/** Evidence that the archive was actually fetched back, not merely uploaded. */
export interface RetrievalProof {
  /** The mechanism used, e.g. "github-draft-release". */
  route: string;
  /** What the owner asks for, derived from the OUTCOME ID alone. */
  locator: string;
  /** The command an owner on another machine runs to get it. */
  command: string;
  verifiedBytes: number;
  /** SHA-256 of the fetched copy. Must equal the archive that was produced. */
  verifiedSha256: string;
}

export interface DeliveryGate {
  allowed: boolean;
  reason: string;
}

export interface DeliveryResult {
  status: DeliveryStatus;
  /** The archive on the machine that produced it. Null when packaging failed. */
  location: string | null;
  archiveSha256: string | null;
  error: string | null;
  /** How an owner elsewhere retrieves it. Null until retrieval is demonstrated. */
  retrieval: RetrievalProof | null;
  /** Why delivery was not reached, when it was not. */
  gap: string | null;
}

/**
 * Whether this evidence is allowed to be delivered at all.
 *
 * Two conditions block it, and they block for different reasons. A proven
 * MISMATCH means the archive does not describe the code it claims to (§5.1).
 * Incomplete evidence means the manifest claims artefacts that are not there
 * (§5.2). Delivering either would put something in the owner's hands that
 * reads as evidence and is not.
 *
 * UNKNOWN deliberately does not block. It is a real result rather than a
 * failure — treating "could not be measured" as "wrong" would collapse the
 * three-state semantics this runner exists to preserve.
 */
export function decideDeliveryGate(
  binding: ServedBinding,
  evidenceComplete: boolean,
  executionComplete = true
): DeliveryGate {
  if (!executionComplete) {
    return {
      allowed: false,
      reason:
        "a required check was never executed and never declared not-run — " +
        "this evidence does not cover what it claims to (§3 puts EXECUTION COMPLETE first)",
    };
  }
  if (binding === "MISMATCH") {
    return {
      allowed: false,
      reason:
        "the served revision provably differs from the source revision — " +
        "this evidence does not describe the code it reports",
    };
  }
  if (!evidenceComplete) {
    return {
      allowed: false,
      reason: "the evidence is incomplete — the manifest claims artefacts that are not on disk",
    };
  }
  return { allowed: true, reason: "" };
}

/**
 * Packages the capture and proves the package is really there.
 *
 * The archive is stat'd and hashed *after* writing rather than trusting the
 * packaging command's exit code. PowerShell reports some failures without a
 * non-zero exit, so "the command returned" is not evidence a file exists —
 * and a delivery status that can be wrong in the optimistic direction is the
 * exact fault this replaces. Anything short of a readable, non-empty archive
 * is FAILED.
 *
 * The best outcome here is LOCAL_READY, never DELIVERED. This function only
 * knows about a file on this machine; whether an owner elsewhere can retrieve
 * it is a different question, answered by `promoteToDelivered`.
 */
export async function deliverArchive(
  captureDir: string,
  zipPath: string
): Promise<DeliveryResult> {
  let packagingError: string | null = null;
  try {
    await zipDirectory(captureDir, zipPath);
  } catch (err) {
    packagingError = (err as Error).message;
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(zipPath);
  } catch (err) {
    return {
      status: "FAILED",
      location: null,
      archiveSha256: null,
      error: packagingError ?? `archive was not written: ${(err as Error).message}`,
      retrieval: null,
      gap: null,
    };
  }
  if (bytes.length === 0) {
    return {
      status: "FAILED",
      location: null,
      archiveSha256: null,
      error: packagingError ?? "archive was written but is empty",
      retrieval: null,
      gap: null,
    };
  }

  return {
    status: "LOCAL_READY",
    location: zipPath,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    error: null,
    retrieval: null,
    gap: null,
  };
}

/**
 * Promotes a locally-packaged archive to DELIVERED, but only on proof.
 *
 * The proof required is a fetch that actually happened: bytes pulled back
 * through the retrieval route and hashed. Uploading is not retrieving, and a
 * route that reports success is not the same as a route an owner can use —
 * §5.7 is precisely the case where the files exist and the owner still cannot
 * get them.
 *
 * A hash that does not match is FAILED rather than LOCAL_READY. Something was
 * retrievable, but it was not this evidence, and that is worse than nothing
 * being there: it would put an archive in the owner's hands under the wrong
 * OUTCOME ID.
 */
export function promoteToDelivered(
  local: DeliveryResult,
  proof: RetrievalProof | null,
  gap: string
): DeliveryResult {
  // Never promote what was never packaged. A failed or unknown packaging step
  // has no archive for a route to have carried.
  if (local.status !== "LOCAL_READY") return local;

  if (proof === null) {
    return { ...local, status: "LOCAL_READY", gap };
  }
  if (proof.verifiedSha256 !== local.archiveSha256) {
    return {
      ...local,
      status: "FAILED",
      error:
        `the archive retrieved from ${proof.locator} does not match the one produced ` +
        `(fetched ${proof.verifiedSha256}, produced ${local.archiveSha256})`,
      gap: "retrieval returned a different artefact than the run produced",
    };
  }
  return { ...local, status: "DELIVERED", retrieval: proof, gap: null };
}
