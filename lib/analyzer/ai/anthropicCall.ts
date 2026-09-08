import Anthropic from "@anthropic-ai/sdk";
import {
  AnalystCallUnavailableError,
  MalformedAnalystResponseError,
  type AnalystCall,
  type AnalystCallRequest,
} from "./analystCall";

// ---------------------------------------------------------------------------
// The one implementation of AnalystCall, and the only place in this codebase
// that talks to a model.
//
// Everything the §8.3 limits actually rest on is enforced elsewhere, on the
// objects: interpretation.ts and challenger.ts refuse an output whose figures
// do not trace, and challengerPayload.ts refuses to send material §8.5.2
// excludes. This file carries no rules of its own — which is deliberate. A
// limit implemented in the transport is a limit that moves when the transport
// does.
// ---------------------------------------------------------------------------

/**
 * Fixed here rather than configurable per run.
 *
 * A model choice is an input to the words, and §3's whole argument is that an
 * input which changes the output belongs in the record. This constant is
 * carried into the stored AI output (runStore) so a report can say which model
 * wrote its prose.
 */
export const ANALYST_MODEL = "claude-opus-5";

/**
 * `high` rather than the cheaper levels. The task is adherence to six hard
 * limits under a schema, on material where a fluent wrong sentence is
 * indistinguishable from a fluent right one — which is the case for spending
 * the reasoning rather than saving it.
 */
const ANALYST_EFFORT = "high" as const;

// Comfortably above the longest plausible response (five statements, four
// page-one sentences, a handful of findings) so a truncated JSON body is not a
// failure mode anyone has to diagnose.
const MAX_TOKENS = 16000;

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Builds the live call.
 *
 * The client is constructed once and closed over, so both calls in a run share
 * one connection pool. It reads ANTHROPIC_API_KEY from the environment like
 * every other credential in this project; there is no key parameter, because a
 * key travelling through application code is a key that ends up in a log.
 */
export function anthropicAnalystCall(client: Anthropic = new Anthropic()): AnalystCall {
  return async (request: AnalystCallRequest) => {
    const response = await client.messages.create({
      model: ANALYST_MODEL,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      thinking: { type: "adaptive" },
      output_config: {
        effort: ANALYST_EFFORT,
        format: { type: "json_schema", schema: request.responseSchema },
      },
    });

    if (response.stop_reason === "refusal") {
      throw new AnalystCallUnavailableError(
        `the ${request.label} call was declined by the model's safety classifiers` +
          `${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new MalformedAnalystResponseError(request.label, "the response was truncated at the token ceiling");
    }

    const text = textOf(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MalformedAnalystResponseError(request.label, "the response body was not JSON");
    }
  };
}

/**
 * The live call where credentials exist, and a refusal where they do not.
 *
 * Returns null rather than throwing so a caller can decide: the report renders
 * its deterministic analysis either way, and §8.1's boundary is exactly the
 * claim that the numbers do not depend on this call succeeding.
 */
export function analystCallIfConfigured(): AnalystCall | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key.trim() === "") return null;
  return anthropicAnalystCall();
}
