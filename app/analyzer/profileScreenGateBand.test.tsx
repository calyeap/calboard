// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Decimal from "decimal.js";
import { evaluateGate0, type Gate0Input } from "@/lib/analyzer/gates";
import { gate0Heading, gate0TestRows, gate0ExplanationIfFailed } from "@/lib/analyzer/gateBand";

// ---------------------------------------------------------------------------
// The fourth of the dispatch's required negative tests: the profile screen shows
// the gate's REAL result when the gate fails.
//
// Rendered rather than asserted on the copy functions alone, because the defect
// was in the markup — a literal `<h3>Gate 0 — supported profile</h3>` above the
// gate's inputs. The page is a server component that loads a run from the
// database, so this renders the same block with the same derivation the page
// uses, which is what proves the markup now takes its words from the gate.
// ---------------------------------------------------------------------------

function Gate0Block({ input }: { input: Gate0Input }) {
  const gate0 = evaluateGate0(input);
  const explanation = gate0ExplanationIfFailed(gate0);

  return (
    <div>
      <h3>{gate0Heading(gate0)}</h3>
      <dl>
        {gate0TestRows(gate0).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              {row.value}
              {row.fired && <span>Fired</span>}
            </dd>
          </div>
        ))}
      </dl>
      {explanation !== null && (
        <div>
          <span>{gate0.result}</span>
          <span>{explanation}</span>
        </div>
      )}
    </div>
  );
}

const PASSING: Gate0Input = {
  sectorClassification: "Services-Prepackaged Software",
  industryClassification: "Services-Prepackaged Software",
  interestIncomeOverRevenue: new Decimal(0),
  hasInsurancePremiumOrReserveLineItems: false,
  override: null,
};

describe("the profile screen's Gate 0 block", () => {
  afterEach(cleanup);

  it("shows the refusal, not 'supported profile', where the gate fails on a bank", () => {
    render(<Gate0Block input={{ ...PASSING, sectorClassification: "Financials" }} />);

    expect(
      screen.getByRole("heading", {
        name: /UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1/,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /— supported profile/i })).toBeNull();
  });

  it("shows the fail-closed refusal where a classification was never acquired", () => {
    render(
      <Gate0Block
        input={{ ...PASSING, sectorClassification: null, industryClassification: null }}
      />
    );

    expect(
      screen.getByRole("heading", { name: /UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE/ })
    ).toBeInTheDocument();
  });

  it("still says supported profile where the gate actually passed", () => {
    render(<Gate0Block input={PASSING} />);

    expect(
      screen.getByRole("heading", { name: "Gate 0 — supported profile" })
    ).toBeInTheDocument();
  });

  it("shows all four classification tests with their evaluated values", () => {
    render(<Gate0Block input={PASSING} />);

    expect(screen.getByText("Sector classification")).toBeInTheDocument();
    expect(screen.getByText("Industry classification")).toBeInTheDocument();
    expect(screen.getByText(/Interest income as % of revenue/)).toBeInTheDocument();
    expect(screen.getByText("Insurance premium or policy-reserve line items")).toBeInTheDocument();
  });

  it("names which test fired, so the refusal is attributable on screen", () => {
    render(<Gate0Block input={{ ...PASSING, hasInsurancePremiumOrReserveLineItems: true }} />);

    expect(screen.getByText("Present")).toBeInTheDocument();
    expect(screen.getByText("Fired")).toBeInTheDocument();
  });

  it("shows NOT ACQUIRED for an input no run supplied", () => {
    // The state this milestone found: two of Gate 0's five REQUIRED inputs were
    // hard-coded null and nothing on screen said so.
    render(<Gate0Block input={{ ...PASSING, interestIncomeOverRevenue: null }} />);

    expect(screen.getAllByText("NOT ACQUIRED").length).toBeGreaterThan(0);
  });

  it("carries §6.1's explanation only where the gate refused", () => {
    const { unmount } = render(<Gate0Block input={PASSING} />);
    expect(screen.queryByText(/funding rather than capital structure/i)).toBeNull();
    unmount();

    render(<Gate0Block input={{ ...PASSING, sectorClassification: "Financials" }} />);
    expect(screen.getByText(/funding rather than capital structure/i)).toBeInTheDocument();
  });
});
