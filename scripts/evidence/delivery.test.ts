import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decideDeliveryGate, deliverArchive } from "./delivery";

describe("decideDeliveryGate", () => {
  it("allows delivery when the build is bound and the evidence is complete", () => {
    expect(decideDeliveryGate("MATCH", true).allowed).toBe(true);
  });

  // Ruling: UNKNOWN is a real result, not a failure. It must not block.
  it("allows delivery when the served binding is UNKNOWN", () => {
    expect(decideDeliveryGate("UNKNOWN", true).allowed).toBe(true);
  });

  // Negative case 1 (§5.1): a proven stale server blocks EVIDENCE DELIVERED.
  it("REFUSES delivery when the served revision provably mismatches", () => {
    const g = decideDeliveryGate("MISMATCH", true);
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("served");
  });

  // Negative case 2 (§5.2): incomplete evidence blocks EVIDENCE DELIVERED.
  it("REFUSES delivery when the evidence is incomplete", () => {
    const g = decideDeliveryGate("MATCH", false);
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("incomplete");
  });
});

describe("deliverArchive", () => {
  it("DELIVERS a real archive, recording its location and hash", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-deliver-"));
    const capture = path.join(tmp, "capture");
    await fs.mkdir(capture);
    await fs.writeFile(path.join(capture, "manifest.json"), "{}", "utf8");

    const d = await deliverArchive(capture, path.join(tmp, "capture.zip"));

    expect(d.status).toBe("DELIVERED");
    expect(d.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.error).toBeNull();
    await expect(fs.access(d.location as string)).resolves.toBeUndefined();
  }, 60_000);

  // Negative case 3 (§5.3): packaging failure is reported as FAILED, and can
  // never be reported as delivered.
  it("reports FAILED, never DELIVERED, when packaging fails", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-deliver-"));
    const missing = path.join(tmp, "does-not-exist");

    const d = await deliverArchive(missing, path.join(tmp, "out.zip"));

    expect(d.status).toBe("FAILED");
    expect(d.error).not.toBeNull();
    expect(d.archiveSha256).toBeNull();
  }, 60_000);
});
