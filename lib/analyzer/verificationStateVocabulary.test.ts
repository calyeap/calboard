import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERIFICATION_STATES } from "./types";
import { CLEAN_PROVENANCE } from "./provenance";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";

// ---------------------------------------------------------------------------
// §3.2 gives the verification state FOUR values. VERIFIED and UNVERIFIED are
// not among them: amendment M7 records that the four REPLACED them, because
// UNVERIFIED was naming both a verification state here and the §5.1 propagation
// state, and those are different claims about a figure. §5.1 is explicit that a
// figure can be UNVERIFIED and CONFIRMED at once — unstatable while one word
// carried both jobs.
//
// These names must be UNREACHABLE on this field, not merely unused. The union
// is derived from VERIFICATION_STATES, so adding a value back to the type means
// adding it to that array, and this file fails.
//
// UNVERIFIED itself is not gone from the codebase and must not be: it remains
// the §5.1 propagation state on ProvenanceQualifier. What is gone is its use as
// a verification state.
// ---------------------------------------------------------------------------

const RETIRED = ["VERIFIED", "UNVERIFIED"] as const;

describe("the §3.2 verification-state vocabulary", () => {
  it("has exactly the four values §3.2 defines", () => {
    expect([...VERIFICATION_STATES]).toEqual([
      "CONFIRMED",
      "NOT CONFIRMED",
      "SPOT-CHECK PENDING",
      "SPOT-CHECK NOT REQUIRED",
    ]);
  });

  it("does not contain the retired names", () => {
    for (const retired of RETIRED) {
      expect(VERIFICATION_STATES as readonly string[]).not.toContain(retired);
    }
  });

  // VERIFIED is a substring of UNVERIFIED, so a naive `includes("VERIFIED")`
  // would also fire on the legitimate §5.1 propagation state. Matched on whole
  // values instead.
  it("contains no value that merely looks like one of them", () => {
    for (const state of VERIFICATION_STATES) {
      expect(RETIRED as readonly string[]).not.toContain(state);
    }
  });
});

describe("nothing sets a retired name on this field", () => {
  it("keeps the clean provenance baseline on a current value", () => {
    expect(VERIFICATION_STATES as readonly string[]).toContain(
      CLEAN_PROVENANCE.verificationState
    );
  });

  it("leaves both fixtures' fact records on current values", () => {
    for (const fixture of [MSFT_FIXTURE, OKLO_FIXTURE]) {
      for (const fact of fixture.facts) {
        expect(VERIFICATION_STATES as readonly string[]).toContain(fact.verificationState);
      }
    }
  });

  // The type system cannot catch a retired name written where it is never
  // typed as VerificationState — a label table keyed by string, a comparison
  // against a literal, a fixture behind a cast. This reads the source of the
  // modules that carry the field and fails on the field being SET to, or
  // COMPARED AGAINST, a retired name.
  //
  // Deliberately narrow. A blanket search for the quoted words would fire on
  // ProvenanceQualifier, where UNVERIFIED is correct and must stay — so the
  // pattern is anchored to the verification-state field itself.
  it("never sets or compares the field against a retired name", () => {
    const root = join(__dirname, "..", "..");
    const files = [
      "lib/analyzer/types.ts",
      "lib/analyzer/provenance.ts",
      "lib/analyzer/spotCheck.ts",
      "lib/analyzer/fixtures/msft.ts",
      "lib/analyzer/fixtures/oklo.ts",
      "app/components/AnalyzerReport.tsx",
      "app/components/FactCard.tsx",
      "app/components/QuickRead.tsx",
    ];

    // verificationState: "VERIFIED"   |   verificationState === "UNVERIFIED"
    const retiredOnTheField =
      /verificationState\s*(?::|===|!==|==|!=)\s*["'](?:UN)?VERIFIED["']/;

    for (const relative of files) {
      const source = readFileSync(join(root, relative), "utf-8");
      // Strip comments: the retired names are discussed there on purpose, and
      // that record is worth keeping.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

      expect(code, `${relative} still sets a retired verification state`).not.toMatch(
        retiredOnTheField
      );
    }
  });

  // The other half of the ruling, pinned so a later tidy-up does not "finish
  // the job" by deleting it: §5.1's UNVERIFIED is a different thing and stays.
  // It is a property of the figure and its source, propagating like SECONDARY
  // under §5.2, and a figure can be UNVERIFIED and CONFIRMED at once.
  it("keeps UNVERIFIED as the §5.1 propagation qualifier", () => {
    const types = readFileSync(join(__dirname, "types.ts"), "utf-8");
    expect(types).toMatch(/ProvenanceQualifier[^\n]*"UNVERIFIED"/);
  });
});
