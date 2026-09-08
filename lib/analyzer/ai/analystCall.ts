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
  constructor(label: string, detail: string) {
    super(`The ${label} call returned a response this analyzer cannot read: ${detail}`);
    this.name = "MalformedAnalystResponseError";
  }
}
