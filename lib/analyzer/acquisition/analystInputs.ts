import { MSFT_FIXTURE } from "../fixtures/msft";
import { OKLO_FIXTURE } from "../fixtures/oklo";
import type { AnalystInputs } from "./companyInputs";

// ---------------------------------------------------------------------------
// The inputs that are NOT facts, and were never acquired from anything.
//
// Read this before reading anything else in this file: **the values below are
// not filing data and must never be presented as though they were.**
//
// M8-a replaces the fixtures as the source of FACTS. It does not, and is not
// meant to, replace them as the source of the ANALYST's inputs — the three
// scenarios with their drivers and written anchors (Step 7), the scenario
// values they produce, and the four §7.1 policy constants Command Center has
// not defined. Those come from a human, Step 7's interface is not built, and
// M8-a's scope explicitly excludes building it.
//
// So they are carried from the M5/M7 validation fixtures, and this file is the
// single place that happens, so that a reader can see the whole of the
// not-acquired surface in one screen rather than discovering it a field at a
// time. Every FACT-derived input is built from real filings in
// companyInputs.ts; nothing here touches one.
//
// The consequence to keep in view when reading a real run's report: the
// scenario block and the fair-value range it feeds are still fixture-derived.
// Everything upstream of them — the fact set, the gates, the margin history,
// the EV bridge inputs, the FCF components — is acquired.
// ---------------------------------------------------------------------------

export interface AnalystInputBundle {
  inputs: Omit<AnalystInputs, "nonOperatingInvestments" | "gate0" | "fiftyTwoWeek" | "trustInputs">;
  /** Rendered to the analyst. Not a comment — a disclosure. */
  note: string;
}

const NOTE =
  "The three scenarios, the values they produce and four unset policy constants " +
  "on this run were NOT acquired. They are carried from the validation set, " +
  "because the screen where you enter scenarios is not built yet. Every fact, " +
  "gate and margin figure on this run comes from SEC filings.";

function bundleFrom(fixture: typeof MSFT_FIXTURE): AnalystInputBundle {
  return {
    inputs: {
      profile: fixture.profile,
      scenarios: fixture.scenarios,
      scenarioValues: fixture.scenarioValues,
      revalueBaseCaseAtRate: fixture.revalueBaseCaseAtRate,
      configuredConstants: fixture.configuredConstants,
      preRevenue: fixture.preRevenue,
    },
    note: NOTE,
  };
}

/**
 * OKLO, less the two things its validation set carries but nobody authored.
 *
 * The validation set gives OKLO's three scenarios a written anchor each and
 * NO growth, margin or reinvestment drivers — it carries 0 for all nine, a
 * placeholder the frozen mock (which has no Section F for OKLO) never shows.
 * And it gives no revaluation of the base case at other discount rates — it
 * carries a constant $31 whatever the rate, which the solver then searched
 * and reported as having no solution. A live report printed the first as
 * 0.0% growth, margin and reinvestment (CB-AUDIT-01 H4c) and would state the
 * second as a finding about the company. Supplied here as absent instead, so
 * both report INCOMPLETE. The fixture itself is untouched: it reproduces the
 * mock, and its placeholders are part of what it reproduces against.
 */
function okloBundle(): AnalystInputBundle {
  const bundle = bundleFrom(OKLO_FIXTURE);
  const unauthored = { revenueGrowthOrPath: null, operatingMargin: null, reinvestmentCapitalIntensity: null };
  const s = bundle.inputs.scenarios;
  return {
    inputs: {
      ...bundle.inputs,
      scenarios: {
        bear: { ...s.bear, ...unauthored },
        base: { ...s.base, ...unauthored },
        bull: { ...s.bull, ...unauthored },
      },
      revalueBaseCaseAtRate: null,
    },
    note:
      bundle.note +
      " For OKLO the validation set holds no growth, margin or reinvestment drivers and no revaluation " +
      "of the base case at other discount rates, so those report incomplete rather than carrying placeholders.",
  };
}

const BUNDLES: Record<string, AnalystInputBundle> = {
  MSFT: bundleFrom(MSFT_FIXTURE),
  OKLO: okloBundle(),
};

/**
 * Null for any company without a recorded analyst bundle.
 *
 * Null is the correct answer, not a gap to be filled: a company nobody has
 * supplied scenarios for HAS no scenarios, and inventing three would put
 * numbers with no author into a fair-value range.
 */
export function analystInputsFor(ticker: string): AnalystInputBundle | null {
  return BUNDLES[ticker.toUpperCase()] ?? null;
}

export const TICKERS_WITH_ANALYST_INPUTS = Object.keys(BUNDLES);
