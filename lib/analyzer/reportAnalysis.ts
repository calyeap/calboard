import { computeAnalysisForRun } from "./gate";
import { getAiOutputs, saveAiOutputs } from "./aiOutputStore";
import { runAiLayer, mergeAiLayer, type AiLayerOutputs } from "./ai/run";
import { analystCallIfConfigured, ANALYST_MODEL } from "./ai/anthropicCall";
import { writeAnalystLog, type AnalystCall } from "./ai/analystCall";
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
 * The full refusal, to the server log — never to the page.
 *
 * A refusal has two audiences with opposite needs. Whoever is debugging must
 * see what the model actually wrote; the reader of the report must not, because
 * the offending text is precisely a figure with no field behind it (§10.0.2
 * rule 3). The error classes carry both registers, and this is the one place
 * the unsafe one is read.
 */
function logDiagnostic(err: unknown): void {
  const diagnostic = (err as { diagnostic?: unknown }).diagnostic;
  if (typeof diagnostic === "string" && diagnostic !== "") {
    // Through the AI layer's own channel, which writes to the stream directly
    // rather than through console.error (ruled). Next's development overlay
    // hooks console.error, so a refusal — designed behaviour, the control doing
    // exactly its job — came up as a red crash screen; correct operation was
    // then indistinguishable from a defect.
    //
    // This line is the FINAL failure, after the one regeneration also failed.
    // The near miss that a regeneration recovers is logged by
    // callWithOneRegeneration, so the log now carries both.
    writeAnalystLog(`AI layer refused after regenerating — ${diagnostic}`);
  }
}

/**
 * Generations currently running, keyed by run.
 *
 * AN IN-FLIGHT REGISTRY, NOT A CACHE, and the distinction is ruled rather than
 * stylistic. An entry lives only while its generation is running and is deleted
 * the moment the promise settles, whichever way it settles. Nothing completed
 * is held here, so nothing outlives the request that produced it — which is the
 * line R7 draws: the run lives at its URL, there is no index, and a cache of
 * completed analyses is a step toward Saved Analysis and Research Memory
 * (§13.1), neither of which is v1's to build.
 *
 * What it fixes: a report takes the better part of a minute, so a reader
 * refreshes, and every refresh used to start its own generation. Three
 * overlapping requests meant six model calls, three generations, one stored row
 * — the last write silently winning — and nothing anywhere recording that it
 * had happened.
 *
 * SCOPE, stated because it is a real limit: this is per process. Two Node
 * instances behind a load balancer would each hold their own registry and could
 * each start a generation. Calboard is single-user and local (§1.5), so the
 * process is the boundary; a database-level guard would be the answer if that
 * ever stops being true, and that is a different decision.
 */
const generationsInFlight = new Map<string, Promise<AiLayerOutputs>>();

function generateOnce(
  runId: string,
  result: AnalysisResult,
  call: AnalystCall
): Promise<AiLayerOutputs> {
  const running = generationsInFlight.get(runId);
  if (running !== undefined) return running;

  const started = (async () => {
    const outputs = await runAiLayer(result, call);
    await saveAiOutputs(runId, ANALYST_MODEL, outputs);
    return outputs;
  })();

  generationsInFlight.set(runId, started);

  // Removed on settle, success or failure. A failure must not latch: the next
  // request should be free to try again rather than inherit a dead entry.
  // Registered with both handlers so a rejection is never unhandled here — the
  // caller's own `await` is what reports it.
  const forget = (): void => {
    if (generationsInFlight.get(runId) === started) generationsInFlight.delete(runId);
  };
  void started.then(forget, forget);

  return started;
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
    const outputs = await generateOnce(runId, result, call);
    return {
      result: mergeAiLayer(result, outputs),
      aiLayer: { status: "COMPLETED", model: ANALYST_MODEL, detail: null },
    };
  } catch (err) {
    logDiagnostic(err);
    // Nothing is stored, so a later view retries rather than inheriting a
    // failure. The analysis itself is returned untouched.
    return {
      result,
      aiLayer: { status: "FAILED", model: null, detail: messageOf(err) },
    };
  }
}
