// ---------------------------------------------------------------------------
// The one seam between this analyzer and a model.
//
// §13.1.1 forbids building "a generic Intelligence Layer... a reusable
// service, a shared abstraction, or a layer other Calboard modules are
// expected to call. Build the two calls this spec describes and no framework
// around them." So this is not a framework: it is a single function type, with
// exactly two callers — interpretation.ts and challenger.ts — and one
// implementation, anthropicCall.ts.
//
// It exists for one reason: §8.5 requires the challenger's payload to be
// isolated BY CONSTRUCTION, and a test cannot prove isolation against a
// network call it cannot see. Passing the call in makes the request an object
// the tests assert on.
// ---------------------------------------------------------------------------

export interface AnalystCallRequest {
  /** Which of the two calls this is. Carried for logging and for the tests. */
  label: "interpretation" | "challenger";
  system: string;
  user: string;
  /** JSON Schema the response must satisfy. */
  responseSchema: Record<string, unknown>;
}

/**
 * Returns the model's parsed JSON response. Shape validation is the caller's
 * job — interpretation.ts and challenger.ts each check their own, because a
 * schema-shaped response can still carry a figure that does not trace.
 */
export type AnalystCall = (request: AnalystCallRequest) => Promise<unknown>;

export class AnalystCallUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `The interpretation and challenger calls cannot run: ${reason}. ` +
        `The deterministic analysis is unaffected — §8.1's boundary means the numbers do not depend on this.`
    );
    this.name = "AnalystCallUnavailableError";
  }
}

export class MalformedAnalystResponseError extends Error {
  readonly diagnostic: string;

  constructor(label: string, detail: string) {
    super(`The ${label} call returned a response this analyzer cannot read: ${detail}`);
    this.name = "MalformedAnalystResponseError";
    this.diagnostic = detail;
  }
}

/** Any refusal that can say, to the model, what was wrong with its output. */
function diagnosticOf(err: unknown): string | null {
  const value = (err as { diagnostic?: unknown }).diagnostic;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Calls once; on a refusal, tells the model exactly what failed and calls once
 * more. Two attempts, then the refusal stands.
 *
 * THIS IS NOT A REPAIR PASS, and the distinction is the one §10.7 rule 3
 * insists on: "a numeral emitted by [C] is a defect rather than a value to be
 * checked". A refused output is discarded WHOLE — nothing is patched, nothing
 * is salvaged, and no sentence from it survives into the second attempt. What
 * happens is that the same request is asked again with the defects named.
 *
 * Why retry at all: unlike everything else in this analyzer, these calls are
 * not a function of their inputs, so a single unlucky wording would otherwise
 * cost the report its entire prose layer. Why only once: a loop that retries
 * until something passes is selecting for output that satisfies the checker,
 * which is a different objective from output that is true, and the difference
 * would be invisible.
 */
export async function callWithOneRegeneration<T>(
  call: AnalystCall,
  request: AnalystCallRequest,
  interpret: (raw: unknown) => T
): Promise<T> {
  try {
    return interpret(await call(request));
  } catch (err) {
    const diagnostic = diagnosticOf(err);
    if (diagnostic === null) throw err;

    const corrected: AnalystCallRequest = {
      ...request,
      user:
        `${request.user}\n\n` +
        `YOUR PREVIOUS ANSWER WAS REFUSED IN FULL AND DISCARDED. It failed on:\n\n  ${diagnostic}\n\n` +
        `Write the whole answer again from the beginning. Do not try to repair the previous one — you cannot ` +
        `see it and it no longer exists. Every figure must be a slot reference from the catalogue above, and ` +
        `no digit may appear anywhere outside one.`,
    };
    return interpret(await call(corrected));
  }
}
