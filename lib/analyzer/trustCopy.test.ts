import { describe, it, expect } from "vitest";
import { trustStatusLine, trustConsequenceLine } from "./trustCopy";

// ---------------------------------------------------------------------------
// The page-one trust line, derived rather than written.
//
// report/page.tsx printed "Profile not confirmed · trust status PARTIAL" as a
// literal. After Fix 1 that string is reachable on a run whose range was
// suppressed, which §9.6 rule 1 makes UNUSABLE — so the page would assert
// PARTIAL about a run the Analysis Result calls UNUSABLE. §10.0.2 rule 3 is
// the general form: the renderer adds formatting and prose, not content.
// ---------------------------------------------------------------------------

describe("§9.6 — the trust line states the computed status", () => {
  it("says UNUSABLE where the status is UNUSABLE", () => {
    expect(trustStatusLine("UNUSABLE", false)).toContain("UNUSABLE");
  });

  it("says PARTIAL where the status is PARTIAL", () => {
    expect(trustStatusLine("PARTIAL", false)).toContain("PARTIAL");
  });

  it("never says PARTIAL where the status is UNUSABLE", () => {
    // The exact defect: a literal that was right for one run and wrong for
    // the next.
    expect(trustStatusLine("UNUSABLE", true)).not.toContain("PARTIAL");
  });

  it("still names the unconfirmed profile beside the status it produced", () => {
    expect(trustStatusLine("PARTIAL", true)).toContain("Profile not confirmed");
  });
});

describe("§9.6 — the consequence sentence follows the status, not the copy", () => {
  it("says the range still renders under PARTIAL", () => {
    // §6.3: "Trust status falls to PARTIAL on the §9.4 flag and the fair-value
    // range still renders."
    expect(trustConsequenceLine("PARTIAL")).toMatch(/range below still renders/i);
  });

  it("says the page refuses the range under UNUSABLE", () => {
    // §9.6: "Under UNUSABLE the page refuses to render the range — which is
    // the instruction, enforced rather than requested."
    const line = trustConsequenceLine("UNUSABLE");
    expect(line).toMatch(/no fair-value range/i);
    expect(line).not.toMatch(/still renders/i);
  });

  it("never says or implies the company is bad (§9.6)", () => {
    // "It says this run cannot tell you what the company is worth. It does not
    // say the company is bad, and no copy may let it be read that way."
    for (const status of ["CLEAN", "PARTIAL", "UNUSABLE"] as const) {
      expect(trustConsequenceLine(status)).not.toMatch(/\b(bad|avoid|overvalued|risky|poor)\b/i);
    }
  });
});
