// scripts/evidence/delivery.ts
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { zipDirectory } from "./archive";
import type { ServedBinding } from "./identity/served";

export type DeliveryStatus = "DELIVERED" | "FAILED" | "UNKNOWN";

export interface DeliveryGate {
  allowed: boolean;
  reason: string;
}

export interface DeliveryResult {
  status: DeliveryStatus;
  /** Where the owner can retrieve it. Null unless DELIVERED. */
  location: string | null;
  archiveSha256: string | null;
  error: string | null;
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
  evidenceComplete: boolean
): DeliveryGate {
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
    };
  }
  if (bytes.length === 0) {
    return {
      status: "FAILED",
      location: null,
      archiveSha256: null,
      error: packagingError ?? "archive was written but is empty",
    };
  }

  return {
    status: "DELIVERED",
    location: zipPath,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    error: null,
  };
}
