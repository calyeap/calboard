import { computeAnalysisForRun } from "./gate";
import { getAiOutputs, saveAiOutputs } from "./aiOutputStore";
import { runAiLayer, mergeAiLayer } from "./ai/run";
import { analystCallIfConfigured, ANALYST_MODEL } from "./ai/anthropicCall";
import type { AnalystCall } from "./ai/analystCall";
import type { AnalysisResult } from "./types";

// ---------------------------------------------------------------------------
// The report's view of a run: the deterministic analysis, plus the two AI
// outputs where they exist.
//
// THE ORDERING, which is the whole of §8.1 and §8.5.4 expressed as control
// flow. The analysis is computed first and completely. Only then is either
// call made, and neither can change a number — mergeAiLayer writes two members
// and touches nothing else. A failure anywhere in the AI layer therefore costs
// the report its prose and nothing else, which is what §8.1's boundary claims:
// "Deterministic code handles calculations, gates, states and rules."
//
// THE FAILURE POLICY, stated once here. Every way the AI layer can fail —
// no key, an unreachable model, a malformed response, a figure that does not
// trace, a prohibited phrase — produces the SAME outcome: no prose, and the
// reason carried to the screen. There is no partial acceptance and no repair
// pass. §10.7 rule 3 is explicit that "a numeral emitted by [C] is a defect
// rather than a value to be checked", and a defect is not something to fix up
// and keep; if any part of an output failed a limit, the whole output is
// refused. A report that says the call did not run is honest. A report
// carrying the half of the prose that happened to pass is not.
// ---------------------------------------------------------------------------

export type AiLayerStatus = "COMPLETED" | "NOT CONFIGURED" | "FAILED";

export interface AiLayerReport {
  status: AiLayerStatus;
  /** Which model wrote the prose, where any was written. */
  model: string | null;
  /** Why there is no prose, in the analyst's words rather than a stack trace. */
  detail: string | null;
}

export interface ReportAnalysis {
  result: AnalysisResult;
  aiLayer: AiLayerReport;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The analysis as the report renders it.
 *
 * The call is a parameter so tests can drive it without a network or a key,
 * and so the one place that decides whether a live call is possible
 * (`analystCallIfConfigured`) is visible in the signature rather than buried.
 */
export async function analysisForReport(
  runId: string,
  call: AnalystCall | null = analystCallIfConfigured()
): Promise<ReportAnalysis> {
  // First, and independently of everything below.
  const result = await computeAnalysisForRun(runId);

  // Already run for this run. The words a report shows must not change under
  // the reader on a refresh, and re-rolling them would also re-bill the call.
  const stored = await getAiOutputs(runId);
  if (stored !== null) {
    return {
      result: mergeAiLayer(result, { interpretation: stored.interpretation, challenger: stored.challenger }),
      aiLayer: { status: "COMPLETED", model: stored.model, detail: null },
    };
  }

  if (call === null) {
    return {
      result,
      aiLayer: {
        status: "NOT CONFIGURED",
        model: null,
        detail:
          "No model credentials are configured, so the interpretation and challenger calls did not run. " +
          "Every computed value on this page is unaffected.",
      },
    };
  }

  try {
    const outputs = await runAiLayer(result, call);
    await saveAiOutputs(runId, ANALYST_MODEL, outputs);
    return {
      result: mergeAiLayer(result, outputs),
      aiLayer: { status: "COMPLETED", model: ANALYST_MODEL, detail: null },
    };
  } catch (err) {
    // Nothing is stored, so a later view retries rather than inheriting a
    // failure. The analysis itself is returned untouched.
    return {
      result,
      aiLayer: { status: "FAILED", model: null, detail: messageOf(err) },
    };
  }
}
