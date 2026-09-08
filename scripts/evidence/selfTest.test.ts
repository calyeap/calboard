import { describe, it, expect } from "vitest";
import { runSelfTest } from "./selfTest";

describe("runSelfTest", () => {
  it("proves checkOverflow (both limbs), checkFont, checkConsoleErrors, checkStatesAppeared (both directions), checkRendered (both directions), checkContinueGated (both directions), and the dead-port limb of verifyAppReachable, each against a real capture", async () => {
    const results = await runSelfTest();
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get("clean")?.actual).toBe("PASS");
    expect(byName.get("overflow")?.actual).toBe("FAIL");
    expect(byName.get("doc-overflow")?.actual).toBe("FAIL");
    expect(byName.get("missing-font")?.actual).toBe("FAIL");
    expect(byName.get("console-error")?.actual).toBe("FAIL");
    expect(byName.get("dead-port")?.actual).toBe("FAIL");
    expect(byName.get("states-appeared-pass")?.actual).toBe("PASS");
    expect(byName.get("states-appeared-fail")?.actual).toBe("FAIL");
    expect(byName.get("continue-gated")?.actual).toBe("PASS");
    expect(byName.get("continue-enabled")?.actual).toBe("FAIL");
    expect(byName.get("rendered-complete")?.actual).toBe("PASS");
    expect(byName.get("rendered-missing")?.actual).toBe("FAIL");

    for (const r of results) expect(r.ok).toBe(true);

    // A FAIL only proves something is wrong. These assert it is the RIGHT
    // check firing for the RIGHT reason — not an unrelated fault that happens
    // to also produce a FAIL.
    expect(byName.get("clean")?.detail).toBe("");

    expect(byName.get("overflow")?.step).toBe("no document or card overflow");
    expect(byName.get("overflow")?.detail).toContain("scrollW");
    expect(byName.get("overflow")?.detail).toContain("cb-analyzer");

    // doc-overflow.html has no scroll container anywhere, so the wide card's
    // overflow is not absorbed by an internal scrollbar the way overflow.html's
    // is — it propagates out to the document itself. (A browser's scrollWidth
    // measures actual content extent regardless of the overflow property, so
    // .cb-analyzer's own node-level scrollOverflow legitimately trips here
    // too — that is expected, not a fixture defect. What this fixture proves
    // that overflow.html cannot is the document limb, so "document overflows"
    // must be present.)
    expect(byName.get("doc-overflow")?.step).toBe("no document or card overflow");
    expect(byName.get("doc-overflow")?.detail).toContain("document overflows");

    expect(byName.get("missing-font")?.step).toBe("expected font family declared on .cb-analyzer");
    expect(byName.get("missing-font")?.detail).toContain("IBM Plex Sans");

    expect(byName.get("console-error")?.step).toBe("no console or page errors");
    expect(byName.get("console-error")?.detail).toContain("deliberate console error");

    // dead-port's detail is a platform-dependent fetch error message — only
    // the step (which check fired) is asserted here.
    expect(byName.get("dead-port")?.step).toBe("app reachable and serving Screen 1");

    expect(byName.get("states-appeared-pass")?.step).toBe("every requested state appeared");
    expect(byName.get("states-appeared-fail")?.step).toBe("every requested state appeared");
    expect(byName.get("states-appeared-fail")?.detail).toContain("Listed operating company");

    expect(byName.get("continue-gated")?.detail).toBe("");

    expect(byName.get("continue-enabled")?.step).toBe(
      "Continue to gates disabled with a reason on the undecided capture"
    );
    expect(byName.get("continue-enabled")?.detail).toContain("enabled");
    expect(byName.get("continue-enabled")?.detail).toContain("gate is not holding");

    // The complete map must report a clean PASS with no detail — if it did
    // not, the FAIL below would prove nothing about the missing entry.
    expect(byName.get("rendered-complete")?.detail).toBe("");

    // The FAIL must name BOTH the target and the width that went missing, and
    // say it was never captured rather than captured-but-empty — those are
    // different faults and the detail is what distinguishes them.
    expect(byName.get("rendered-missing")?.step).toBe(
      "every requested target rendered at every width"
    );
    expect(byName.get("rendered-missing")?.detail).toContain("rendered-probe");
    expect(byName.get("rendered-missing")?.detail).toContain("1024");
    expect(byName.get("rendered-missing")?.detail).toContain("not captured");
    // ...and must NOT implicate the width that really was captured.
    expect(byName.get("rendered-missing")?.detail).not.toContain("720");
  }, 180_000);
});
