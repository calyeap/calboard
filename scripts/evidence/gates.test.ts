import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyFrozenArtefacts, verifyAppReachable } from "./gates";
import { SCREEN1_MARKUP_MARKER } from "./config";

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
  let server: Server;

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("FAILs on a dead port", async () => {
    const r = await verifyAppReachable("http://127.0.0.1:59999");
    expect(r.status).toBe("FAIL");
    expect(r.step).toContain("reachable");
  });

  it("FAILs when 200 has wrong body (no marker)", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/analyzer") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>nothing here</body></html>");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const r = await verifyAppReachable(baseUrl);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("HTTP 200, but Screen 1 markup is absent");
  });

  it("PASSes when 200 has the marker", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/analyzer") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body>
          <h1>Ticker entry and identity resolution</h1>
          <p>This page has the required marker: ${SCREEN1_MARKUP_MARKER}</p>
        </body></html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const r = await verifyAppReachable(baseUrl);
    expect(r.status).toBe("PASS");
  });

  it("FAILs on non-200 status code", async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/analyzer") {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<html><body>Server error</body></html>");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const r = await verifyAppReachable(baseUrl);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("HTTP 500");
  });
});
