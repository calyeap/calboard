import { describe, it, expect } from "vitest";
import { releaseTagFor, decideRetrievalRoute } from "./retrieval";

describe("releaseTagFor", () => {
  // Retrievability "from the OUTCOME ID alone" means the locator is a pure
  // function of the id — no timestamp, no run-specific state.
  it("derives the tag from the outcome id alone", () => {
    expect(releaseTagFor("CB-G2-EVIDENCE-02")).toBe("evidence/CB-G2-EVIDENCE-02");
  });

  it("is stable across calls, so an owner can predict it", () => {
    expect(releaseTagFor("CB-X")).toBe(releaseTagFor("CB-X"));
  });
});

describe("decideRetrievalRoute", () => {
  it("uses the GitHub draft-release route when the CLI is authenticated", () => {
    const d = decideRetrievalRoute({ ghAvailable: true, ghAuthenticated: true, hasRemote: true });
    expect(d.route).toBe("github-draft-release");
    expect(d.gap).toBe("");
  });

  // The fallback is a legitimate outcome, not a failure — but it must say why.
  it("has no route, with a reason, when the CLI is absent", () => {
    const d = decideRetrievalRoute({ ghAvailable: false, ghAuthenticated: false, hasRemote: true });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("gh");
  });

  it("has no route, with a reason, when the CLI is not authenticated", () => {
    const d = decideRetrievalRoute({ ghAvailable: true, ghAuthenticated: false, hasRemote: true });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("authenticat");
  });

  it("has no route, with a reason, when there is no remote to deliver to", () => {
    const d = decideRetrievalRoute({ ghAvailable: true, ghAuthenticated: true, hasRemote: false });
    expect(d.route).toBeNull();
    expect(d.gap).toContain("remote");
  });
});
