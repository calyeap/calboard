import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FROZEN_HASHES, SCREEN1_MARKUP_MARKER } from "./config";
import type { CheckResult } from "./preflight/types";

/**
 * Frozen artefacts, byte-exact — and every artefact accounted for.
 *
 * An absent artefact is reported as absent and never as a hash mismatch. They
 * are different situations — a file that changed versus a file that is not
 * there — and collapsing them hides the second inside the first.
 *
 * Coverage runs in both directions. The loop above checks that every name
 * FROZEN_HASHES expects is present and byte-exact; the pass below checks the
 * opposite — that docs/frozen/ holds nothing FROZEN_HASHES has never heard
 * of. Without it, a newly frozen artefact sits unchecked and this gate keeps
 * returning PASS having never looked at it — exactly what happened to
 * calboard-valuation-methodology.md, frozen days before FROZEN_HASHES gained
 * an entry for it. The directory is authoritative for WHICH FILES must be
 * listed; FROZEN_HASHES stays authoritative for their VALUES — this only
 * ever reads a filename off disk to check it is registered, never bytes to
 * compute a hash from it. Deriving the expected hash from the file itself
 * would verify the file against itself, a check with no way to ever fail.
 */
export async function verifyFrozenArtefacts(repoRoot: string): Promise<CheckResult> {
  const step = "frozen artefacts match their SHA-256";
  const faults: string[] = [];
  for (const [name, expected] of Object.entries(FROZEN_HASHES)) {
    const file = path.join(repoRoot, "docs", "frozen", name);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file);
    } catch {
      faults.push(`${name}: absent`);
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) faults.push(`${name}: expected ${expected}, got ${actual}`);
  }

  try {
    const entries = await fs.readdir(path.join(repoRoot, "docs", "frozen"), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !(entry.name in FROZEN_HASHES)) {
        faults.push(`${entry.name}: present in docs/frozen/ but not registered in FROZEN_HASHES`);
      }
    }
  } catch (err) {
    faults.push(`docs/frozen/: could not be listed — ${(err as Error).message}`);
  }

  return faults.length === 0
    ? { step, status: "PASS", detail: "" }
    : { step, status: "FAIL", detail: faults.join("; ") };
}

/**
 * The app is reachable AND serving Screen 1.
 *
 * Deliberately not a socket check. "The port answered" is compatible with a
 * server returning a 500 or an empty shell, and capturing blank pages is the
 * failure family that cost the most time on M7.
 */
export async function verifyAppReachable(baseUrl: string): Promise<CheckResult> {
  const step = "app reachable and serving Screen 1";
  const url = new URL("/analyzer", baseUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return { step, status: "FAIL", detail: `${url}: ${(err as Error).message}` };
  }
  if (!res.ok) return { step, status: "FAIL", detail: `${url}: HTTP ${res.status}` };
  const body = await res.text();
  if (!body.includes(SCREEN1_MARKUP_MARKER)) {
    return { step, status: "FAIL", detail: `${url}: HTTP 200, but Screen 1 markup is absent` };
  }
  return { step, status: "PASS", detail: "" };
}

const DB_READY_STEP = "analyzer run table present";

/** One row of what `to_regclass('public.analyzer_runs')::text` returns. */
export interface RegclassRow {
  present: string | null;
}

/**
 * The pure decision from the row shape `to_regclass` returns, extracted so it
 * is testable without a live database.
 *
 * Uses `== null` rather than `=== null` so an *empty* result set FAILs too,
 * not just a row carrying an explicit `null`. `to_regclass` always returns
 * exactly one row today, so `rows` being empty is unreachable in practice —
 * but a default-to-PASS branch on an unproven shape is exactly the fault
 * family this project forbids, so both are treated as "not proven present."
 */
export function interpretRegclassRows(rows: readonly RegclassRow[]): CheckResult {
  if (rows[0]?.present == null) {
    return {
      step: DB_READY_STEP,
      status: "FAIL",
      detail:
        "analyzer_runs is absent — apply migration 002 yourself; the runner does not migrate",
    };
  }
  return { step: DB_READY_STEP, status: "PASS", detail: "" };
}

/**
 * The analyzer run table exists.
 *
 * The runner never migrates — an absent table is a STOP, because creating it
 * would be the runner changing the schema it is measuring against.
 */
export async function verifyDatabaseReady(): Promise<CheckResult> {
  try {
    const { getPool } = await import("@/lib/db");
    const res = await getPool().query<RegclassRow>(
      "SELECT to_regclass('public.analyzer_runs')::text AS present"
    );
    return interpretRegclassRows(res.rows);
  } catch (err) {
    return {
      step: DB_READY_STEP,
      status: "FAIL",
      detail: `database unreachable: ${(err as Error).message}`,
    };
  }
}
