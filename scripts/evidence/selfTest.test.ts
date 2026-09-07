import { describe, it, expect } from "vitest";
import { runSelfTest } from "./selfTest";

describe("runSelfTest", () => {
  it("shows every check failing against its fault fixture", async () => {
    const results = await runSelfTest();
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get("clean")?.actual).toBe("PASS");
    expect(byName.get("overflow")?.actual).toBe("FAIL");
    expect(byName.get("missing-font")?.actual).toBe("FAIL");
    expect(byName.get("console-error")?.actual).toBe("FAIL");
    expect(byName.get("dead-port")?.actual).toBe("FAIL");

    for (const r of results) expect(r.ok).toBe(true);

    // A FAIL only proves something is wrong. These assert it is the RIGHT
    // check firing for the RIGHT reason — not an unrelated fault that happens
    // to also produce a FAIL.
    expect(byName.get("clean")?.detail).toBe("");

    expect(byName.get("overflow")?.step).toBe("no document or card overflow");
    expect(byName.get("overflow")?.detail).toContain("scrollW");
    expect(byName.get("overflow")?.detail).toContain("cb-analyzer");

    expect(byName.get("missing-font")?.step).toBe("expected font family resolves on .cb-analyzer");
    expect(byName.get("missing-font")?.detail).toContain("IBM Plex Sans");

    expect(byName.get("console-error")?.step).toBe("no console or page errors");
    expect(byName.get("console-error")?.detail).toContain("deliberate console error");

    // dead-port's detail is a platform-dependent fetch error message — only
    // the step (which check fired) is asserted here.
    expect(byName.get("dead-port")?.step).toBe("app reachable and serving Screen 1");
  }, 180_000);
});
