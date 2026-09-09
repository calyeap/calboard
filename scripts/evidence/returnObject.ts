// scripts/evidence/returnObject.ts
import type { CheckStatus } from "./preflight/types";
import type { Verdict } from "./preflight/verdict";
import type { DeliveryStatus, RetrievalProof } from "./delivery";
import type { ServedBinding } from "./identity/served";
import type { SourceIdentity } from "./identity/source";
import type { CheckInventory } from "./completeness";

export interface ServedFacts {
  baseUrl: string;
  /** The revision the server reported, as read. Null when none was readable. */
  revision: string | null;
  binding: ServedBinding;
  reason: string;
}

export interface ExecutionFacts {
  started: string;
  completed: string;
  /** Last revision to touch the runner itself. */
  runnerRevision: string;
}

export interface ArtefactFacts {
  /** Absolute, for the operator standing at this machine. */
  captureDir: string;
  manifest: string;
  /**
   * Repo-relative, for everyone else.
   *
   * Required rather than optional: an owner reading this return object from
   * another machine cannot act on a `C:\Users\...` path, and making these
   * optional would let a run omit them and still typecheck.
   */
  captureDirRelative: string;
  manifestRelative: string;
  artefactCount: number;
}

export interface DeliveryFacts {
  status: DeliveryStatus;
  location: string | null;
  archiveSha256: string | null;
  error: string | null;
  /** Proof an owner elsewhere fetched it back. Null unless DELIVERED. */
  retrieval: RetrievalProof | null;
  /** Why delivery was not reached. Null when it was. */
  gap: string | null;
}

export interface ReturnArgs {
  outcomeId: string;
  source: SourceIdentity;
  served: ServedFacts;
  execution: ExecutionFacts;
  inventory: CheckInventory;
  verdict: Verdict;
  artefacts: ArtefactFacts;
  delivery: DeliveryFacts;
  evidenceComplete: boolean;
  /** Earlier runs for this OUTCOME ID, when --repeat authorised re-execution. */
  priorRuns: string[];
}

export interface RunStates {
  executionComplete: boolean;
  evidenceComplete: boolean;
  evidenceDelivered: boolean;
}

/** Whether the served code is the source code, in the words §4 asks for. */
function sourceEqualsServed(binding: ServedBinding): "yes" | "no" | "unknown" {
  if (binding === "MATCH") return "yes";
  if (binding === "MISMATCH") return "no";
  return "unknown";
}

/**
 * The one object an evidence consumer reads.
 *
 * The three states are computed independently and never from each other. That
 * is the whole point of §3: a run can be execution complete with its delivery
 * failed, or evidence complete but not yet accepted, and collapsing those into
 * a single DONE flag is the failure this replaces. In particular
 * `executionComplete` says nothing about whether the archive left the machine,
 * and `evidenceDelivered` is never inferred from a passing verdict.
 *
 * Acceptance is deliberately absent. The chain ends at EVIDENCE DELIVERED;
 * ACCEPTED / REJECTED / REROUTED belongs to the owner, not to the worker that
 * produced the evidence.
 */
export function buildReturnObject(args: ReturnArgs) {
  const states: RunStates = {
    // Execution is complete when every required check was accounted for —
    // executed or explicitly declared not-run. A FAIL verdict is still a
    // complete execution: it measured something and got an answer.
    executionComplete: args.inventory.complete,
    evidenceComplete: args.evidenceComplete,
    // Delivery is read from the delivery result alone, so a blocked or failed
    // packaging step can never be inferred away by a healthy verdict.
    evidenceDelivered: args.delivery.status === "DELIVERED",
  };

  return {
    outcomeId: args.outcomeId,
    states,
    source: args.source,
    served: {
      baseUrl: args.served.baseUrl,
      revision: args.served.revision,
      binding: args.served.binding,
      sourceEqualsServed: sourceEqualsServed(args.served.binding),
      reason: args.served.reason,
    },
    execution: args.execution,
    checks: {
      verdict: args.verdict.status,
      failingStep: args.verdict.failingStep,
      required: args.inventory.required,
      executed: args.inventory.executed,
      notRun: args.inventory.notRun,
      unaccountedFor: args.inventory.unaccountedFor,
      results: args.verdict.results,
    },
    artefacts: args.artefacts,
    delivery: args.delivery,
    priorRuns: args.priorRuns,
    returnTo: "Calboard CC",
  };
}

/**
 * The exit code, with one axis per failure kind.
 *
 * 1 keeps its existing meaning exactly — a preflight FAIL and nothing else —
 * so anything already reading this runner's exit code is unaffected. UNKNOWN
 * still exits 0, because it is a result rather than an error. 2 and 3 are new,
 * and they exist because an operator who reads only the exit code must not be
 * told "fine" when the evidence was incomplete or never got packaged.
 *
 * The preflight verdict is checked first: when both a FAIL and a delivery
 * problem are present, the wrong measurement is the one worth acting on, which
 * is the same precedence `aggregate` already applies to FAIL over UNKNOWN.
 */
export function exitCodeFor(
  verdict: CheckStatus,
  evidenceComplete: boolean,
  delivery: DeliveryStatus,
  executionComplete = true
): number {
  if (verdict === "FAIL") return 1;
  // An unaccounted-for required check shares code 2 with incomplete evidence:
  // in both, the archive does not cover what it claims. Without this a run
  // that skipped a required check could still exit 0 by delivering, which is
  // precisely the silent pass §5.6 forbids.
  if (!executionComplete || !evidenceComplete) return 2;
  if (delivery !== "DELIVERED") return 3;
  return 0;
}
