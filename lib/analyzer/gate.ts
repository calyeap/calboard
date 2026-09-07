import { assembleAnalysisResult, type CompanyFixture } from "./assemble";
import type { AnalysisResult } from "./types";
import { MSFT_FIXTURE } from "./fixtures/msft";
import { OKLO_FIXTURE } from "./fixtures/oklo";
import { isSpotCheckComplete, queuedFacts, undecidedFacts, applyDecisions } from "./spotCheck";
import { getRun, getFactDecisions, type AnalyzerRun } from "./runStore";

// ---------------------------------------------------------------------------
// §2's ordering rule: "no calculation module may execute before Step 2 has
// been completed by a human. The software must enforce this, not merely
// recommend it." Design §104: the gate is server-side, and no calculation
// module may be reachable by any route, refresh, deep link or API call until
// every material fact carries a decision.
//
// This module is the ONLY route from a runId to an AnalysisResult. It is a
// chokepoint by construction: computeAnalysisForRun is the single exported
// function that calls assembleAnalysisResult, and it checks the gate before
// doing so. A route that wants a report must come through here.
//
// The check is not "has the UI shown Step 2". It reads the decisions out of
// the database on every request, because a client-held run cannot be gated by
// the server (R7) and a route guard in the UI layer is a recommendation.
// ---------------------------------------------------------------------------

// M7 serves the two M5 validation fixtures; acquisition arrives at M8. Keyed
// by the ticker frozen on the run at Step 1.
const FIXTURES: Record<string, CompanyFixture> = {
  MSFT: MSFT_FIXTURE,
  OKLO: OKLO_FIXTURE,
};

export function fixtureForTicker(ticker: string): CompanyFixture | null {
  return FIXTURES[ticker.toUpperCase()] ?? null;
}

export const SUPPORTED_FIXTURE_TICKERS = Object.keys(FIXTURES);

/**
 * Raised when a calculation is attempted before Step 2 is complete.
 *
 * This is a refusal, not an error state to be rendered as a broken page: the
 * routes catch it and redirect to Screen 2, which is where the analyst has
 * work to do. It carries the outstanding fact ids so the caller can say what
 * remains rather than only that something does.
 */
export class SpotCheckIncompleteError extends Error {
  readonly runId: string;
  readonly outstandingFactIds: string[];

  constructor(runId: string, outstandingFactIds: string[]) {
    super(
      `Spot-check incomplete for run ${runId}: ${outstandingFactIds.length} queued fact(s) carry no decision. ` +
        `No calculation module may execute before Step 2 has been completed by a human (§2).`
    );
    this.name = "SpotCheckIncompleteError";
    this.runId = runId;
    this.outstandingFactIds = outstandingFactIds;
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No run ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export interface GateState {
  run: AnalyzerRun;
  fixture: CompanyFixture;
  decidedFactIds: Set<string>;
  queuedCount: number;
  outstandingFactIds: string[];
  spotCheckComplete: boolean;
}

/**
 * Loads everything the gate needs and says whether Step 2 is complete.
 * Read-only: it computes no valuation and calls no calculation module. Screens
 * use it to decide what to render; computeAnalysisForRun uses it to decide
 * whether to compute at all.
 */
export async function loadGateState(runId: string): Promise<GateState> {
  const run = await getRun(runId);
  if (run === null) throw new RunNotFoundError(runId);

  const fixture = fixtureForTicker(run.ticker);
  if (fixture === null) {
    // A run exists for a ticker M7 has no fixture for. Fail closed: without a
    // fact set there is nothing to spot-check, and a run that cannot be
    // spot-checked must not be computable.
    throw new RunNotFoundError(runId);
  }

  const decisions = await getFactDecisions(runId);
  const decidedFactIds = new Set(decisions.map((d) => d.factId));
  const outstanding = undecidedFacts(fixture.facts, decidedFactIds).map((f) => f.id);

  // Every fact leaves this function carrying the verification state THIS run
  // gives it, derived from the decisions — never the acquisition-time label the
  // fixture wrote. Done once, here, because this is the single place a run's
  // facts are loaded: the screens, the Analysis Result and the report's
  // provenance tokens all read what this produces, and none of them re-derives
  // it. A second derivation downstream is how the screen and the data came to
  // disagree.
  const facts = applyDecisions(
    fixture.facts,
    new Map(decisions.map((d) => [d.factId, d.decision]))
  );

  return {
    run,
    fixture: { ...fixture, facts },
    decidedFactIds,
    queuedCount: queuedFacts(fixture.facts).length,
    outstandingFactIds: outstanding,
    spotCheckComplete: isSpotCheckComplete(fixture.facts, decidedFactIds),
  };
}

/**
 * The gated entry to calculation, and the only one.
 *
 * Throws SpotCheckIncompleteError before reaching assembleAnalysisResult when
 * any queued fact lacks a decision. The order of the two statements below is
 * the milestone: the check precedes the call, and nothing computes on the
 * failing path.
 */
export async function computeAnalysisForRun(runId: string): Promise<AnalysisResult> {
  const state = await loadGateState(runId);

  if (!state.spotCheckComplete) {
    throw new SpotCheckIncompleteError(runId, state.outstandingFactIds);
  }

  return assembleAnalysisResult(state.fixture);
}
