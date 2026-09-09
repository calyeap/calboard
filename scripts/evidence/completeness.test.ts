import { describe, it, expect } from "vitest";
import { decideEvidenceComplete, buildCheckInventory } from "./completeness";

describe("decideEvidenceComplete", () => {
  it("is complete when every claimed artefact is on disk", () => {
    const d = decideEvidenceComplete(["manifest.json", "s1-resolved-720.png"], [
      "manifest.json",
      "s1-resolved-720.png",
    ]);
    expect(d.complete).toBe(true);
    expect(d.missing).toEqual([]);
  });

  // Negative case 2 (§5.2): a manifest that claims an artefact which is not
  // there must not be deliverable.
  it("is INCOMPLETE, naming the artefact, when a claimed screenshot is absent", () => {
    const d = decideEvidenceComplete(["manifest.json", "s1-resolved-720.png"], ["manifest.json"]);
    expect(d.complete).toBe(false);
    expect(d.missing).toEqual(["s1-resolved-720.png"]);
  });

  it("is INCOMPLETE when the manifest itself is missing", () => {
    const d = decideEvidenceComplete(["manifest.json"], []);
    expect(d.complete).toBe(false);
    expect(d.missing).toContain("manifest.json");
  });

  it("is INCOMPLETE when nothing was claimed at all", () => {
    expect(decideEvidenceComplete([], []).complete).toBe(false);
  });
});

describe("buildCheckInventory", () => {
  it("reports required, executed and not-run separately", () => {
    const inv = buildCheckInventory(
      ["a", "b", "c"],
      [{ step: "a", status: "PASS", detail: "" }],
      [{ step: "b", reason: "unreachable without changing the environment" }]
    );
    expect(inv.required).toEqual(["a", "b", "c"]);
    expect(inv.executed).toEqual(["a"]);
    expect(inv.notRun).toEqual([{ step: "b", reason: "unreachable without changing the environment" }]);
  });

  // Negative case 6 (§5.6): a required check that was neither executed nor
  // declared not-run is unaccounted for, and must never read as a pass.
  it("names a required check that was neither executed nor declared not-run", () => {
    const inv = buildCheckInventory(["a", "b", "c"], [{ step: "a", status: "PASS", detail: "" }], [
      { step: "b", reason: "declared" },
    ]);
    expect(inv.unaccountedFor).toEqual(["c"]);
    expect(inv.complete).toBe(false);
  });

  it("is complete when every required check is executed or declared", () => {
    const inv = buildCheckInventory(
      ["a", "b"],
      [{ step: "a", status: "PASS", detail: "" }],
      [{ step: "b", reason: "declared" }]
    );
    expect(inv.unaccountedFor).toEqual([]);
    expect(inv.complete).toBe(true);
  });
});

describe("buildCheckInventory — repeated steps", () => {
  // Every target produces the same step names, so the raw result list holds
  // one entry per target per width. The inventory answers "was this check
  // run", not "how many times", so it must report each step once.
  it("lists a step once even when many targets produced it", () => {
    const inv = buildCheckInventory(
      ["no console or page errors"],
      [
        { step: "no console or page errors", status: "PASS", detail: "" },
        { step: "no console or page errors", status: "PASS", detail: "" },
        { step: "no console or page errors", status: "PASS", detail: "" },
      ],
      []
    );
    expect(inv.executed).toEqual(["no console or page errors"]);
    expect(inv.complete).toBe(true);
  });
});
