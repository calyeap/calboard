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
      evidence: "The record carries a secondary source class.",
      whatWouldHaveToBeTrue: "The figure would have to be wrong by more than a rounding.",
    },
  ],
  completedAt: "2026-09-08T12:00:00.000Z",
};

const withAi: AnalysisResult = { ...base, interpretation, challenger };

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
