import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { verifyFrozenArtefacts, verifyAppReachable } from "./gates";

const REPO_ROOT = path.resolve(__dirname, "../..");

async function frozenCopy(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-gate-"));
  const dest = path.join(tmp, "docs", "frozen");
  await fs.mkdir(dest, { recursive: true });
  const src = path.join(REPO_ROOT, "docs", "frozen");
  for (const name of await fs.readdir(src)) {
    await fs.copyFile(path.join(src, name), path.join(dest, name));
  }
  return tmp;
}

describe("verifyFrozenArtefacts", () => {
  it("PASSes against the real docs/frozen on this baseline", async () => {
    expect((await verifyFrozenArtefacts(REPO_ROOT)).status).toBe("PASS");
  });

  it("FAILs naming the artefact whose bytes changed", async () => {
    const tmp = await frozenCopy();
    await fs.appendFile(path.join(tmp, "docs/frozen/mock-report-oklo.html"), "\n<!-- tampered -->");
    const r = await verifyFrozenArtefacts(tmp);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("mock-report-oklo.html");
  });

  it("STOPs with 'absent', not a hash mismatch, when an artefact is missing", async () => {
    const tmp = await frozenCopy();
    await fs.rm(path.join(tmp, "docs/frozen/mock-screen1-entry.html"));
    const r = await verifyFrozenArtefacts(tmp);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("mock-screen1-entry.html: absent");
  });
});

describe("verifyAppReachable", () => {
  it("FAILs on a dead port", async () => {
    const r = await verifyAppReachable("http://127.0.0.1:59999");
    expect(r.status).toBe("FAIL");
    expect(r.step).toContain("reachable");
  });
});
