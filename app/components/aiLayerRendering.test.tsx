// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { QuickRead } from "./QuickRead";
import { AnalyzerReport } from "./AnalyzerReport";
import { assembleAnalysisResult } from "@/lib/analyzer/assemble";
import { MSFT_FIXTURE } from "@/lib/analyzer/fixtures/msft";
import type { AnalysisResult, ChallengerResult, InterpretationResult } from "@/lib/analyzer/types";

afterEach(cleanup);

// §10.2 sections I and I2, and §10.7's page one. What is under test is the
// RENDERING contract, not the calls: Section I2 renders `challenger` and
// cannot read `interpretation` (design §10.7's own table), page one's variable
// sentences come from [C] where the call ran and from the deterministic
// template where it did not, and nothing anywhere is invented in the absence
// of either.

const base = assembleAnalysisResult(MSFT_FIXTURE);

const interpretation: InterpretationResult = {
  statements: [
    {
      responsibility: "PRICE-IMPLIED DIAGNOSTICS",
      statement: "The price rests on growth this company has not yet delivered.",
      referencesValueIds: ["price"],
    },
    {
      responsibility: "MODEL FRAGILITY",
      statement: "Most of the calculated value sits in the terminal period.",
      referencesValueIds: [],
    },
  ],
  pageOne: {
    mainFinding: {
      responsibility: "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES",
      statement: "Page one main finding, written by the interpretation layer.",
      referencesValueIds: [],
    },
    whatSupportsTheCase: {
      responsibility: "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES",
      statement: "Page one support, written by the interpretation layer.",
      referencesValueIds: [],
    },
    whatWorriesCalboard: {
      responsibility: "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES",
      statement: "Page one worry, written by the interpretation layer.",
      referencesValueIds: [],
    },
    biggestUncertainty: {
      responsibility: "ASSUMPTION PLAUSIBILITY AND WHAT THE PRICE REQUIRES",
      statement: "Page one uncertainty, written by the interpretation layer.",
      referencesValueIds: [],
    },
  },
};

const challenger: ChallengerResult = {
  findings: [
    {
      claimOrFactReference: "Finance-lease ROU additions (finance-lease-rou-additions)",
      boundSection: "B",
      evidence: "The record carries a secondary source class.",
      whatWouldHaveToBeTrue: "The figure would have to be wrong by more than a rounding.",
    },
  ],
  completedAt: "2026-09-08T12:00:00.000Z",
};

const withAi: AnalysisResult = { ...base, interpretation, challenger };

// §17.7.1 — three findings, deliberately returned out of §10.2 order and with
// the earliest-bound one NOT first, so a test that only checked "the first
// finding renders" could not pass by accident.
const multiSectionChallenger: ChallengerResult = {
  findings: [
    {
      claimOrFactReference: "Late-bound fact (late-fact)",
      boundSection: "H",
      evidence: "Evidence for the late-bound finding.",
      whatWouldHaveToBeTrue: "Condition for the late-bound finding.",
    },
    {
      claimOrFactReference: "Earliest-bound fact (early-fact)",
      boundSection: "C",
      evidence: "Evidence for the earliest-bound finding.",
      whatWouldHaveToBeTrue: "Condition for the earliest-bound finding.",
    },
    {
      claimOrFactReference: "Middle-bound fact (middle-fact)",
      boundSection: "E",
      evidence: "Evidence for the middle-bound finding.",
      whatWouldHaveToBeTrue: "Condition for the middle-bound finding.",
    },
  ],
  completedAt: "2026-09-10T12:00:00.000Z",
};

const withMultiFindings: AnalysisResult = { ...base, interpretation, challenger: multiSectionChallenger };

describe("Section I — interpretation", () => {
  it("says the call has not run rather than leaving the section blank", () => {
    const { container } = render(<AnalyzerReport result={base} />);

    const section = container.querySelector("section#I")!;
    expect(within(section as HTMLElement).getByText(/has not run/i)).not.toBeNull();
  });

  it("renders each statement under the §8.2 responsibility it discharges", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/growth this company has not yet delivered/)).not.toBeNull();
    expect(within(section).getByText("PRICE-IMPLIED DIAGNOSTICS")).not.toBeNull();
    expect(within(section).getByText("MODEL FRAGILITY")).not.toBeNull();
  });
});

describe("Section I2 — challenger findings", () => {
  it("says the independent call has not completed rather than leaving the section blank", () => {
    const { container } = render(<AnalyzerReport result={base} />);

    const section = container.querySelector("section#I2") as HTMLElement;
    expect(within(section).getByText(/has not completed/i)).not.toBeNull();
  });

  it("renders each finding's three parts — the record, the evidence, and what would have to be true", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I2") as HTMLElement;
    expect(within(section).getByText(/finance-lease-rou-additions/)).not.toBeNull();
    expect(within(section).getByText(/secondary source class/)).not.toBeNull();
    expect(within(section).getByText(/wrong by more than a rounding/)).not.toBeNull();
  });

  it("carries no interpretation text — I2 renders `challenger` and cannot read `interpretation`", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I2") as HTMLElement;
    expect(section.textContent).not.toContain("growth this company has not yet delivered");
  });

  it("says the findings are unreconciled with the analysis (§8.5.4 — assembly, not synthesis)", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I2") as HTMLElement;
    expect(section.textContent).toMatch(/not reconciled|unreconciled/i);
  });
});

describe("why the prose is absent", () => {
  it("names the missing credential rather than only saying the section is empty", () => {
    const { container } = render(
      <AnalyzerReport
        result={base}
        aiLayer={{ status: "NOT CONFIGURED", model: null, detail: "No model credentials are configured." }}
      />
    );

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/No model credentials are configured/)).not.toBeNull();
  });

  it("names the refusal when an output failed a §8.3 limit, so a rejected sentence is visible rather than silent", () => {
    const { container } = render(
      <AnalyzerReport
        result={base}
        aiLayer={{ status: "FAILED", model: null, detail: "NUMERAL FROM MODEL (14.2%)" }}
      />
    );

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/NUMERAL FROM MODEL/)).not.toBeNull();
  });

  it("says which model wrote the prose where a call did run", () => {
    const { container } = render(
      <AnalyzerReport result={withAi} aiLayer={{ status: "COMPLETED", model: "claude-opus-5", detail: null }} />
    );

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/claude-opus-5/)).not.toBeNull();
  });
});

describe("page one — §10.7's two provenances and no third", () => {
  it("uses [C]'s sentences for the four variable items once the call has run", () => {
    render(<QuickRead result={withAi} />);

    expect(screen.getByText(/Page one main finding, written by the interpretation layer/)).not.toBeNull();
    expect(screen.getByText(/Page one support, written by the interpretation layer/)).not.toBeNull();
    expect(screen.getByText(/Page one worry, written by the interpretation layer/)).not.toBeNull();
    expect(screen.getByText(/Page one uncertainty, written by the interpretation layer/)).not.toBeNull();
  });

  it("keeps the deterministic template for the fixed-shape items even when [C] has run (§10.7 rule 1)", () => {
    render(<QuickRead result={withAi} />);

    // "Price vs scenarios" and "What today's price requires" are [S]
    // templates. A [C] call may not rewrite one after it is filled.
    expect(screen.getByText(/authored bear-bull range|fair-value range is suppressed/)).not.toBeNull();
  });

  it("falls back to the deterministic template where the call has not run, and invents nothing", () => {
    render(<QuickRead result={base} />);

    expect(screen.queryByText(/written by the interpretation layer/)).toBeNull();
    expect(screen.getAllByText(/Main finding/).length).toBeGreaterThan(0);
  });

  it("still shows eight items in both cases — the AI layer changes the words, never the structure", () => {
    const { container: withCall } = render(<QuickRead result={withAi} />);
    expect(withCall.querySelectorAll(".qitem")).toHaveLength(8);
    cleanup();

    const { container: withoutCall } = render(<QuickRead result={base} />);
    expect(withoutCall.querySelectorAll(".qitem")).toHaveLength(8);
  });
});

// CB-CHALLENGER-BIND-01 — §17.7's primary layer for I and I2, and §17.7.1's
// deterministic selection driving both sections at once.

describe("Section I — states above the takeaway, and the four labelled lines", () => {
  it("renders the bearing block before the takeaway, and the takeaway before the four lines", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    const bearing = section.querySelector(".bearing")!;
    const lede = section.querySelector(".finding > .lede")!;
    const dl = section.querySelector(".finding > dl")!;

    // DOCUMENT_POSITION_FOLLOWING (4): `lede` comes after `bearing` in the
    // tree, i.e. bearing renders first.
    expect(bearing.compareDocumentPosition(lede) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lede.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the one-sentence takeaway from page one's main finding", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/Page one main finding, written by the interpretation layer/)).not.toBeNull();
  });

  it("labels the four lines What supports it, What worries me, Biggest uncertainty and Challenger point", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    const labels = Array.from(section.querySelectorAll(".finding dl dt")).map((dt) => dt.textContent);
    expect(labels).toEqual(["What supports it", "What worries me", "Biggest uncertainty", "Challenger point"]);
  });

  it("shows the analysis's own active states in the bearing block, not a fixed subset", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    const bearing = section.querySelector(".bearing") as HTMLElement;
    // MSFT's own fixture carries these; the same ones Section A shows.
    expect(within(bearing).getByText("MARGIN AT HISTORICAL HIGH")).not.toBeNull();
    expect(within(bearing).getAllByText("DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE").length).toBeGreaterThan(0);
  });

  it("shows nothing suppressed or qualified rather than an empty heading when no state is active", () => {
    const clean: AnalysisResult = {
      ...withAi,
      states: { suppressing: [], qualifying: [] },
    };
    const { container } = render(<AnalyzerReport result={clean} />);

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/Nothing suppressed or qualified is active/)).not.toBeNull();
  });

  it("offers Full interpretation, Show calculation and Provenance as sibling disclosures", () => {
    const { container } = render(<AnalyzerReport result={withAi} />);

    const section = container.querySelector("section#I") as HTMLElement;
    const disclosures = Array.from(section.querySelectorAll(".more > details.disclose > summary .lbl")).map(
      (el) => el.textContent
    );
    expect(disclosures).toEqual(["Full interpretation", "Show calculation", "Provenance for every figure above"]);
    // "Full interpretation" still carries the real, complete statement set —
    // not the four summarised sentences again.
    expect(within(section).getByText("PRICE-IMPLIED DIAGNOSTICS")).not.toBeNull();
    expect(within(section).getByText("MODEL FRAGILITY")).not.toBeNull();
  });
});

describe("§17.7.1 — the same selection drives Section I's Challenger point and Section I2's headline", () => {
  it("promotes the earliest-bound finding, not the one the challenger returned first", () => {
    const { container } = render(<AnalyzerReport result={withMultiFindings} />);

    const sectionI = container.querySelector("section#I") as HTMLElement;
    const sectionI2 = container.querySelector("section#I2") as HTMLElement;

    // Bound to C, the earliest of H/C/E — even though it was returned second.
    expect(within(sectionI).getByText(/Evidence for the earliest-bound finding/)).not.toBeNull();
    const headlineLede = sectionI2.querySelector(".finding > .lede")!;
    expect(headlineLede.textContent).toContain("Evidence for the earliest-bound finding");
  });

  it("labels the I2 headline Selected challenger point, never strongest, in either section", () => {
    const { container } = render(<AnalyzerReport result={withMultiFindings} />);

    const sectionI = container.querySelector("section#I") as HTMLElement;
    const sectionI2 = container.querySelector("section#I2") as HTMLElement;

    expect(within(sectionI2).getByText("Selected challenger point")).not.toBeNull();
    expect(`${sectionI.textContent}${sectionI2.textContent}`).not.toMatch(/strongest/i);
  });

  it("states the selection rule in both sections — report order, not damage", () => {
    const { container } = render(<AnalyzerReport result={withMultiFindings} />);

    const sectionI = container.querySelector("section#I") as HTMLElement;
    const sectionI2 = container.querySelector("section#I2") as HTMLElement;

    expect(within(sectionI).getByText(/earliest report section/)).not.toBeNull();
    expect(within(sectionI2).getByText(/earliest report section/)).not.toBeNull();
  });

  it("keeps the other findings behind one sibling disclosure, in the challenger's own return order", () => {
    const { container } = render(<AnalyzerReport result={withMultiFindings} />);

    const section = container.querySelector("section#I2") as HTMLElement;
    expect(within(section).getByText("The other 2 findings")).not.toBeNull();

    const remainderText = section.querySelector(".more")!.textContent!;
    const lateIndex = remainderText.indexOf("Evidence for the late-bound finding");
    const middleIndex = remainderText.indexOf("Evidence for the middle-bound finding");
    expect(lateIndex).toBeGreaterThanOrEqual(0);
    expect(middleIndex).toBeGreaterThan(lateIndex);
    // The selected (earliest-bound) finding is not repeated inside the
    // disclosure — it already has the headline position above it.
    expect(remainderText).not.toContain("Evidence for the earliest-bound finding");
  });

  it("falls back to the not-yet-completed message for Challenger point when the call has not completed at all", () => {
    const interpretationOnly: AnalysisResult = { ...base, interpretation, challenger: null };
    const { container } = render(<AnalyzerReport result={interpretationOnly} />);

    const section = container.querySelector("section#I") as HTMLElement;
    expect(within(section).getByText(/once that call completes/)).not.toBeNull();
  });

  it("falls back to the no-findings-recorded message for Challenger point when the call completed empty", () => {
    const emptyChallenger: AnalysisResult = {
      ...base,
      interpretation,
      challenger: { findings: [], completedAt: "2026-09-10T12:00:00.000Z" },
    };
    const { container } = render(<AnalyzerReport result={emptyChallenger} />);

    const sectionI = container.querySelector("section#I") as HTMLElement;
    const sectionI2 = container.querySelector("section#I2") as HTMLElement;
    expect(within(sectionI).getByText(/completed with no findings recorded/)).not.toBeNull();
    expect(within(sectionI2).getByText(/recorded no finding against this fact set/)).not.toBeNull();
  });
});
