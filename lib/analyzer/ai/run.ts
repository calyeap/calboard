import type { AnalysisResult, ChallengerResult, InterpretationResult } from "../types";
import type { AnalystCall } from "./analystCall";
import { runInterpretation } from "./interpretation";
import { runChallenger } from "./challenger";
import { buildChallengerPayload } from "./challengerPayload";

// ---------------------------------------------------------------------------
// The two calls, and the merge (§8.5.4).
//
// They run concurrently and independently. Concurrency is not an optimisation
// here: the two functions take different arguments — runInterpretation takes
// the Analysis Result, runChallenger takes a payload built from a fifth of it —
// and neither can be handed the other's output because neither has a parameter
// for one. That is the blinding, expressed in the type signatures rather than
// in a prompt.
//
// The merge is assembly. It writes two members and touches nothing else: "the
// numbers were settled before either call ran" is not a comment, it is what
// mergeAiLayer does.
// ---------------------------------------------------------------------------

export interface AiLayerOutputs {
  interpretation: InterpretationResult;
  challenger: ChallengerResult;
}

export class MergeOrderingError extends Error {
  constructor(detail: string) {
    super(
      `Refusing to merge the AI layer: ${detail}. §8.5.4 — the challenger's output is merged into the ` +
        `final report only after the independent call has completed.`
    );
    this.name = "MergeOrderingError";
  }
}

export async function runAiLayer(result: AnalysisResult, call: AnalystCall): Promise<AiLayerOutputs> {
  const payload = buildChallengerPayload(result);

  const [interpretation, challenger] = await Promise.all([
    runInterpretation(result, call),
    runChallenger(payload, call),
  ]);

  return { interpretation, challenger };
}

/**
 * Places both outputs into the Analysis Result.
 *
 * Assembly, not synthesis: two members are written, nothing is reconciled, and
 * no other member is read or changed. `challenger` is never merged into
 * `interpretation` (§10.0.2 rule 4).
 */
export function mergeAiLayer(result: AnalysisResult, outputs: AiLayerOutputs): AnalysisResult {
  if (outputs.challenger.completedAt.trim() === "") {
    throw new MergeOrderingError("the challenger result carries no completion stamp");
  }

  return { ...result, interpretation: outputs.interpretation, challenger: outputs.challenger };
}
