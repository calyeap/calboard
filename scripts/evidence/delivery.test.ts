import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decideDeliveryGate, deliverArchive, promoteToDelivered } from "./delivery";

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
  it("packages a real archive, recording its location and hash", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-deliver-"));
    const capture = path.join(tmp, "capture");
    await fs.mkdir(capture);
    await fs.writeFile(path.join(capture, "manifest.json"), "{}", "utf8");

    const d = await deliverArchive(capture, path.join(tmp, "capture.zip"));

    expect(d.status).toBe("LOCAL_READY");
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

describe("deliverArchive — local packaging is not delivery", () => {
  // Gate 2 defines DELIVERED as the owner retrieving evidence without Calvin
  // pointing at it. A verified zip on the machine that produced it is packaged,
  // not delivered.
  it("reports LOCAL_READY, not DELIVERED, for a verified local archive", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-local-"));
    const capture = path.join(tmp, "capture");
    await fs.mkdir(capture);
    await fs.writeFile(path.join(capture, "manifest.json"), "{}", "utf8");

    const d = await deliverArchive(capture, path.join(tmp, "capture.zip"));

    expect(d.status).toBe("LOCAL_READY");
    expect(d.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

describe("promoteToDelivered", () => {
  const local = {
    status: "LOCAL_READY" as const,
    location: "/e/cap.zip",
    archiveSha256: "a".repeat(64),
    error: null,
    retrieval: null,
    gap: null,
  };
  const proof = {
    route: "github-draft-release",
    locator: "evidence/CB-G2-EVIDENCE-02",
    command: "gh release download evidence/CB-G2-EVIDENCE-02",
    verifiedBytes: 1024,
    verifiedSha256: "a".repeat(64),
  };

  it("promotes to DELIVERED when retrieval was actually demonstrated", () => {
    const d = promoteToDelivered(local, proof, "");
    expect(d.status).toBe("DELIVERED");
    expect(d.retrieval?.locator).toBe("evidence/CB-G2-EVIDENCE-02");
  });

  // Negative case 7 (§5.7): evidence present on disk but not retrievable by
  // the owner must not reach DELIVERED.
  it("stays LOCAL_READY, naming the gap, when no retrieval route exists", () => {
    const d = promoteToDelivered(local, null, "no native route inside Gate 2 constraints");
    expect(d.status).toBe("LOCAL_READY");
    expect(d.gap).toContain("no native route");
  });

  // Retrieving *something* is not retrieving *this evidence*.
  it("FAILS when the fetched copy is not the archive that was produced", () => {
    const d = promoteToDelivered(local, { ...proof, verifiedSha256: "b".repeat(64) }, "");
    expect(d.status).toBe("FAILED");
    expect(d.error).toContain("does not match");
  });

  it("never promotes an archive that was never packaged", () => {
    const failed = { ...local, status: "FAILED" as const, archiveSha256: null };
    expect(promoteToDelivered(failed, proof, "").status).toBe("FAILED");
  });
});

describe("decideDeliveryGate — execution completeness", () => {
  // §3 orders the chain EXECUTION COMPLETE -> EVIDENCE COMPLETE -> DELIVERED.
  // Evidence from a run that skipped a required check is not deliverable.
  it("REFUSES delivery when a required check was never accounted for", () => {
    const g = decideDeliveryGate("MATCH", true, false);
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("required check");
  });

  it("allows delivery when execution was complete", () => {
    expect(decideDeliveryGate("MATCH", true, true).allowed).toBe(true);
  });
});
