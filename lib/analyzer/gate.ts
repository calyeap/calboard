import Decimal from "decimal.js";
import { assembleAnalysisResult, type CompanyFixture } from "./assemble";
import type { AnalysisResult } from "./types";
import { isSpotCheckComplete, queuedFacts, undecidedFacts, applyDecisions } from "./spotCheck";
import { getRun, getFactDecisions, getJudgments, type AnalyzerRun } from "./runStore";
import { buildAcquiredRun, type AcquiredRunInputs } from "./acquiredRun";
import { TICKERS_WITH_ANALYST_INPUTS } from "./acquisition/analystInputs";
import { selectionToNonOperatingInvestments } from "./acquisition/nonOperatingJudgment";
import { activeProvider } from "../marketdata";
import { roundMoney } from "../money";

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

// M8-a: a run's FACTS come from SEC filings, acquired per run through the
// fixed, versioned tag mapping. What is still keyed by ticker is the
// ANALYST-side bundle — Step 7's scenarios and the four undefined §7.1 policy
// constants — because those are a human's output and Step 7's interface is not
// built. See acquisition/analystInputs.ts, which states that plainly.
//
// A company with no bundle has no scenarios, so it has no fair-value range and
// cannot open a run. That is a refusal, not a gap to be filled with invented
// numbers.
export const SUPPORTED_FIXTURE_TICKERS = TICKERS_WITH_ANALYST_INPUTS;

export function isSupportedTicker(ticker: string): boolean {
  return TICKERS_WITH_ANALYST_INPUTS.includes(ticker.toUpperCase());
}

/**
 * Offline mode: acquire from the committed SEC captures and fetch no price.
 *
 * Explicit configuration, never a fallback. The test suite runs here so it
 * neither depends on EDGAR being up nor spends the published rate budget on
 * every `npm test`, and a developer can work on a train. What it must not
 * become is a silent default when a live fetch fails — a stale fact set that
 * looks fresh is the §3.4 staleness question answered wrongly, so
 * `acquireCompany` still raises on a live failure rather than dropping back
 * here, and the run's disclosures name which source was used either way.
 */
function isOffline(): boolean {
  return process.env.ANALYZER_OFFLINE === "1";
}

/**
 * Whether a ticker can open a run.
 *
 * Kept under its old name so existing callers are unaffected, but it no longer
 * returns a hand-written fact set — there is no longer one to return.
 */
export function fixtureForTicker(ticker: string): { ticker: string } | null {
  return isSupportedTicker(ticker) ? { ticker: ticker.toUpperCase() } : null;
}

/**
 * The latest close, with its timestamp (§3.4).
 *
 * A failure returns null rather than throwing. Price is one input among many:
 * losing it must return INCOMPLETE for price-dependent outputs (§5.2), not
 * take down a run whose filing facts were acquired perfectly well. It is never
 * estimated, carried forward or interpolated (§5.1), and there is no
 * "approximate" price state anywhere (§3.4).
 */
async function latestPrice(
  ticker: string
): Promise<{ value: Decimal; timestamp: string; source: string } | null> {
  // Offline mode fetches no quote at all. Price-dependent outputs then return
  // INCOMPLETE and the run says so in its disclosures — never a stale or
  // stand-in price, which §3.4 and §5.1 both forbid.
  if (isOffline()) return null;

  try {
    const provider = activeProvider();
    const point = await provider.fetchLatestEod(ticker, "equity");
    return {
      // Cent-rounded through the app's one money policy, exactly as the
      // portfolio side does. Providers serve prices as JS floats — Yahoo
      // returns Microsoft's 499.70 close as 499.70001220703125 — and
      // lib/money.ts's opening comment records why that is rounded once, at a
      // known point, rather than wherever each display path happens to do it.
      //
      // This is a rounding of the acquired figure, not an estimate of it
      // (§5.1): the cent is the unit the price is quoted in, and the trailing
      // binary noise is an artefact of the transport rather than information
      // from the source. Not doing it would put a sixteen-digit price on the
      // fact card and let the analyzer disagree with /holdings about the same
      // instrument on the same day — the divergence money.ts exists to end.
      value: roundMoney(new Decimal(point.close)),
      timestamp: point.date,
      source: `${provider.sourceName} latest close`,
    };
  } catch {
    return null;
  }
}

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
  /**
   * The whole acquisition, so the screens can show where each figure came
   * from, what the §3.8.2 suite found, and what on this run was not acquired.
   * §3.8.2 is explicit that unreported cross-check results are not a control,
   * so the outcomes travel to the screen rather than to a log.
   */
  acquired: AcquiredRunInputs;
  /** Forced into the queue by a failed §3.8.2 cross-check, whatever their path. */
  crossCheckFailedFactIds: Set<string>;
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

  if (!isSupportedTicker(run.ticker)) {
    // A run exists for a ticker with no analyst-input bundle. Fail closed: a
    // run whose scenarios cannot exist must not be computable.
    throw new RunNotFoundError(runId);
  }

  const [decisions, judgments, price] = await Promise.all([
    getFactDecisions(runId),
    getJudgments(runId),
    latestPrice(run.ticker),
  ]);

  // Acquire once to learn the candidate investment line items, then resolve
  // §4.4's judgment against them. Enterprise value depends on the outcome:
  // with no judgment recorded the non-operating figure is null and every
  // EV-based output is INCOMPLETE. That is the correct state — no tag says
  // which of a company's investments are non-operating.
  const source = isOffline() ? ("CAPTURE" as const) : undefined;
  const withoutJudgment = await buildAcquiredRun({ ticker: run.ticker, price, source });
  const nonOperatingInvestments = selectionToNonOperatingInvestments(
    judgments.find((j) => j.judgmentKey === "NON-OPERATING INVESTMENTS")?.selection,
    withoutJudgment.acquired.acquisition.candidateNonOperatingInvestments
  );

  // The second call is served from the acquisition cache, so this costs no
  // additional EDGAR request.
  const acquired =
    nonOperatingInvestments === null
      ? withoutJudgment
      : await buildAcquiredRun({ ticker: run.ticker, price, nonOperatingInvestments, source });

  const crossCheckFailedFactIds = acquired.acquired.crossCheckFailedFactIds;
  const fixture = acquired.fixture;

  const decidedFactIds = new Set(decisions.map((d) => d.factId));
  const outstanding = undecidedFacts(fixture.facts, decidedFactIds, crossCheckFailedFactIds).map(
    (f) => f.id
  );

  // Every fact leaves this function carrying the verification state THIS run
  // gives it, derived from the decisions AND the cross-check outcomes — never
  // the acquisition-time label. Done once, here, because this is the single
  // place a run's facts are loaded: the screens, the Analysis Result and the
  // report's provenance tokens all read what this produces, and none of them
  // re-derives it. A second derivation downstream is how the screen and the
  // data came to disagree.
  const facts = applyDecisions(
    fixture.facts,
    new Map(decisions.map((d) => [d.factId, d.decision])),
    crossCheckFailedFactIds
  );

  return {
    run,
    fixture: { ...fixture, facts },
    decidedFactIds,
    queuedCount: queuedFacts(fixture.facts, crossCheckFailedFactIds).length,
    outstandingFactIds: outstanding,
    spotCheckComplete: isSpotCheckComplete(fixture.facts, decidedFactIds, crossCheckFailedFactIds),
    acquired,
    crossCheckFailedFactIds,
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
