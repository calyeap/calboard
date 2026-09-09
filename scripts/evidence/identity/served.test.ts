import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decideServedBinding, extractServedBuildId, probeServedIdentity } from "./served";

describe("extractServedBuildId", () => {
  it("reads the build id from app-router flight data", () => {
    const html = `<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"UjIWbHqCseK1Tx7Icpcmp\\",\\"p\\":\\"\\"}"])</script>`;
    expect(extractServedBuildId(html)).toBe("UjIWbHqCseK1Tx7Icpcmp");
  });

  it("returns null when the page carries no build id", () => {
    expect(extractServedBuildId("<html><body>nothing here</body></html>")).toBeNull();
  });
});

describe("decideServedBinding", () => {
  it("MATCHes when the served build id equals the worktree's build id", () => {
    const d = decideServedBinding({
      servedBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      diskBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      worktreeDirty: false,
    });
    expect(d.binding).toBe("MATCH");
  });

  // Negative case 1 (§5.1): a stale server serving an older build must be
  // provably distinguishable from a healthy one, so delivery can be blocked.
  it("MISMATCHes when the server serves a different build than the worktree", () => {
    const d = decideServedBinding({
      servedBuildId: "aaaaaaaaaaaaaaaaaaaaa",
      diskBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      worktreeDirty: false,
    });
    expect(d.binding).toBe("MISMATCH");
    expect(d.reason).toContain("aaaaaaaaaaaaaaaaaaaaa");
    expect(d.reason).toContain("UjIWbHqCseK1Tx7Icpcmp");
  });

  it("is UNKNOWN under next dev, which serves no real build id", () => {
    const d = decideServedBinding({
      servedBuildId: "development",
      diskBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      worktreeDirty: false,
    });
    expect(d.binding).toBe("UNKNOWN");
    expect(d.reason).toContain("dev");
  });

  it("is UNKNOWN when no build id could be read from the served page", () => {
    expect(
      decideServedBinding({ servedBuildId: null, diskBuildId: "x", worktreeDirty: false }).binding
    ).toBe("UNKNOWN");
  });

  it("is UNKNOWN when the worktree has no build to compare against", () => {
    expect(
      decideServedBinding({ servedBuildId: "x", diskBuildId: null, worktreeDirty: false }).binding
    ).toBe("UNKNOWN");
  });

  // Never a false yes: the build may predate the uncommitted edits, so a
  // matching build id does not prove the served code is the recorded HEAD.
  it("refuses to claim MATCH when the worktree is dirty", () => {
    const d = decideServedBinding({
      servedBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      diskBuildId: "UjIWbHqCseK1Tx7Icpcmp",
      worktreeDirty: true,
    });
    expect(d.binding).toBe("UNKNOWN");
    expect(d.reason).toContain("dirty");
  });
});

describe("probeServedIdentity (against a real server)", () => {
  async function serve(html: string): Promise<{ url: string; close: () => Promise<void> }> {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  async function worktreeWithBuild(buildId: string | null): Promise<string> {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-served-"));
    if (buildId !== null) {
      await fs.mkdir(path.join(tmp, ".next"), { recursive: true });
      await fs.writeFile(path.join(tmp, ".next", "BUILD_ID"), buildId, "utf8");
    }
    return tmp;
  }

  // Negative case 1 (§5.1), end to end: a server genuinely serving an older
  // build than the worktree is detected as MISMATCH over real HTTP.
  it("MISMATCHes a real server serving a stale build", async () => {
    const s = await serve('<script>self.__next_f.push([1,"0:{"b":"STALEBUILD0000000000"}"])</script>');
    try {
      const probe = await probeServedIdentity(s.url, await worktreeWithBuild("FRESHBUILD000000000"), false);
      expect(probe.servedBuildId).toBe("STALEBUILD0000000000");
      expect(decideServedBinding(probe).binding).toBe("MISMATCH");
    } finally {
      await s.close();
    }
  }, 30_000);

  it("MATCHes a real server serving this worktree's build", async () => {
    const s = await serve('<script>self.__next_f.push([1,"0:{"b":"SAMEBUILD00000000000"}"])</script>');
    try {
      const probe = await probeServedIdentity(s.url, await worktreeWithBuild("SAMEBUILD00000000000"), false);
      expect(decideServedBinding(probe).binding).toBe("MATCH");
    } finally {
      await s.close();
    }
  }, 30_000);

  it("is UNKNOWN, not a crash, when the server cannot be reached", async () => {
    const probe = await probeServedIdentity(
      "http://127.0.0.1:1",
      await worktreeWithBuild("ANY"),
      false
    );
    expect(probe.servedBuildId).toBeNull();
    expect(decideServedBinding(probe).binding).toBe("UNKNOWN");
  }, 30_000);

  it("is UNKNOWN when the worktree has never been built", async () => {
    const s = await serve('<script>"b":"SOMEBUILD00000000000"</script>');
    try {
      const probe = await probeServedIdentity(s.url, await worktreeWithBuild(null), false);
      expect(probe.diskBuildId).toBeNull();
      expect(decideServedBinding(probe).binding).toBe("UNKNOWN");
    } finally {
      await s.close();
    }
  }, 30_000);
});
