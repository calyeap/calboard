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
  }, 180_000);
});
