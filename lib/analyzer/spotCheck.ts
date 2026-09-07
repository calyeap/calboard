import type { FactRecord, VerificationState } from "./types";

// ---------------------------------------------------------------------------
// §3.8 / §3.8.1 — what Step 2 queues, and when Step 2 is complete.
//
// This module is the authority the route gate reads. It answers two questions
// and nothing else: which facts require a human decision, and whether every
// one of them has had one. It computes; it does not store, render or decide.
// ---------------------------------------------------------------------------

// §3.8's named material-fact categories, as fact ids. The three "any figure
// classified X" limbs of that list are not here — they are properties of the
// record, evaluated in materialityOf below, and a fact matching one is
// material whatever its id.
//
// Deliberately NOT included: "cash per share". §3.8's pre-revenue limb names
// share count, cash balance and quarterly burn; cash-per-share is a derived
// figure the spec does not name, and OKLO's is queued anyway because it is
// UNVERIFIED. Adding it here would put words in §3.8's mouth to reach an
// outcome the classification limbs already reach honestly.
export const NAMED_MATERIAL_FACT_IDS: ReadonlySet<string> = new Set([
  "price",
  "shares-outstanding",
  "treasury-method-dilution",
  "total-debt",
  "finance-lease-liabilities",
  "cash-and-marketable-debt-securities",
  "current-revenue",
  "current-operating-margin",
  "finance-lease-rou-additions",
  "capex",
  // §3.8, pre-revenue limb.
  "share-count",
  "cash-balance",
  "quarterly-burn",
]);

export type MaterialityReason =
  | "NAMED IN §3.8"
  | "CLASSIFIED SECONDARY"
  | "CLASSIFIED AI-EXTRACTED"
  | "UNRECOGNISED — FAIL-CLOSED";

export interface Materiality {
  material: boolean;
  reason: MaterialityReason | "NOT MATERIAL";
}

/**
 * Why a fact is material, not merely whether. The reason is returned so the
 * fail-closed default is visible and testable rather than hiding inside a
 * boolean — a fact queued because nothing recognised it is a different
 * situation from one queued because §3.8 names it, and only the first is a
 * signal that this mapping needs extending.
 */
export function materialityOf(fact: FactRecord): Materiality {
  if (NAMED_MATERIAL_FACT_IDS.has(fact.id)) {
    return { material: true, reason: "NAMED IN §3.8" };
  }
  if (fact.sourceClass === "SECONDARY") {
    return { material: true, reason: "CLASSIFIED SECONDARY" };
  }
  if (fact.extractionType === "AI-EXTRACTED") {
    return { material: true, reason: "CLASSIFIED AI-EXTRACTED" };
  }
  // §3.8's third classification limb is "any figure classified UNVERIFIED".
  // There is deliberately no test for it here, because since amendment M7
  // UNVERIFIED is the §5.1 PROPAGATION state — a property of a figure and its
  // source that travels onto outputs — and not a value of the §3.2
  // verification-state field a FactRecord carries. There is nothing on an input
  // record to test it against, and inventing one would put the word back to
  // doing the two jobs the amendment separated.
  //
  // Nothing escapes the queue as a result: a fact that would have matched this
  // limb falls through to the fail-closed default below and is queued anyway,
  // which is why removing the test changes no outcome on either fixture.
  // Fail-closed, per §5.3 and the Command Center ruling of 7 September 2026:
  // an unrecognised fact staying in the queue costs a spot-check, one skipping
  // it costs the thing the queue exists for. A fact reaching here is PRIMARY,
  // deterministic, verified and unnamed by §3.8 — plausibly immaterial, but
  // "plausibly" is not the standard this milestone works to.
  return { material: true, reason: "UNRECOGNISED — FAIL-CLOSED" };
}

/**
 * Whether the §3.8.1 tag-mapping exemption applies.
 *
 * Granted by acquisition path and never by extraction-type label: a fact
 * marked DETERMINISTIC/STRUCTURED that did not come through a fixed, versioned
 * tag mapping is queued like any other (guard 1). The test is therefore on the
 * recorded mapping version, never on extractionType.
 *
 * Note the shape of the check. A bare `!== null` would treat `undefined` as a
 * mapping version and exempt the fact — which is exactly what an unsound type
 * assertion produced on the OKLO fixture before this milestone. Absence of a
 * recorded mapping version is not evidence of one.
 */
export function isExemptFromQueue(fact: FactRecord): boolean {
  return typeof fact.tagMappingVersion === "string" && fact.tagMappingVersion.length > 0;
}

/**
 * The Step 2 queue: material facts that are not exempt. Order is the fact
 * set's own order, so the queue is stable across refreshes and a run resumed
 * from its URL presents the same fact in the same place.
 */
export function queuedFacts(facts: readonly FactRecord[]): FactRecord[] {
  return facts.filter((f) => materialityOf(f).material && !isExemptFromQueue(f));
}

/**
 * Facts shown but not queued (§3.8.1): "It is not spot-checked; it is not
 * hidden." Screen 2 renders these with SPOT-CHECK NOT REQUIRED beside them.
 */
export function exemptFacts(facts: readonly FactRecord[]): FactRecord[] {
  return facts.filter((f) => isExemptFromQueue(f));
}

/**
 * §3.8.1's operative definition, and the one the route gate enforces:
 * "spot-check complete means every queued material fact carries a decision."
 *
 * Note what this does NOT depend on. It does not care WHICH decision each fact
 * carries — a queue answered entirely with Cannot verify is complete, and its
 * dependents return INCOMPLETE per §5 rather than being blocked here. The two
 * decisions do not branch the gate (§3.8.3); they branch propagation.
 *
 * An empty queue is complete. That is not a licence to skip Step 2: it means
 * every material fact was tag-mapped, and §3.8.2's deterministic cross-checks
 * are the compensating control the exemption rests on.
 */
export function isSpotCheckComplete(
  facts: readonly FactRecord[],
  decidedFactIds: ReadonlySet<string>
): boolean {
  return queuedFacts(facts).every((f) => decidedFactIds.has(f.id));
}

/**
 * The queued facts still awaiting a decision, in queue order. Screen 2 uses
 * this to place the analyst at the next undecided fact after a refresh.
 */
export function undecidedFacts(
  facts: readonly FactRecord[],
  decidedFactIds: ReadonlySet<string>
): FactRecord[] {
  return queuedFacts(facts).filter((f) => !decidedFactIds.has(f.id));
}

/**
 * The verification state a fact actually has in THIS run.
 *
 * §3.2's verificationState describes acquisition, and the fixtures set it at
 * acquisition time — MSFT's helper writes VERIFIED on every record. That says
 * nothing about whether a human has checked the figure, so a queued fact that
 * nobody has decided was reporting VERIFIED while the screen beside it said
 * SPOT-CHECK PENDING. Anything reading the record rather than the decision —
 * the report's provenance tokens do exactly that — got VERIFIED for a fact
 * nobody checked. That is the combineProvenance fail-open one layer up.
 *
 * So the state is DERIVED from the run's decision rather than travelling
 * beside it, and the invariant is absolute: a queued fact with no decision can
 * never report VERIFIED.
 */
export function deriveVerificationState(
  fact: FactRecord,
  decision: FactDecisionState | undefined,
  queued: boolean
): VerificationState {
  // A decision, once taken, is the answer. Both count toward completion;
  // NOT CONFIRMED additionally drives §5's INCOMPLETE propagation.
  if (decision !== undefined) return decision;

  // §3.8.1 — acquired through a fixed, versioned tag mapping. Not queued, so
  // there is no decision to wait for.
  if (!queued) return "SPOT-CHECK NOT REQUIRED";

  // Queued and undecided. §3.2 defines SPOT-CHECK PENDING as exactly this —
  // "queued for Step 2 and not yet decided" — so it is the answer whatever the
  // fixture wrote at acquisition.
  //
  // This branch previously preserved an acquisition-time UNVERIFIED on the
  // reasoning that it was the fail-closed direction. That was my invention, not
  // the contract's: §3.2 as amended by M7 records that CONFIRMED /
  // NOT CONFIRMED / SPOT-CHECK PENDING / SPOT-CHECK NOT REQUIRED *replaced*
  // VERIFIED and UNVERIFIED on this field precisely because UNVERIFIED was
  // doing two unrelated jobs, and that "UNVERIFIED now means only the §5.1
  // propagation state". Keeping it here re-created the ambiguity the amendment
  // removed.
  return "SPOT-CHECK PENDING";
}

/** Just the decision half of a stored decision — this module needs no more. */
export type FactDecisionState = Extract<
  VerificationState,
  "CONFIRMED" | "NOT CONFIRMED"
>;

/**
 * Rewrites a fact set so every record carries the verification state this run
 * gives it.
 *
 * Applied once, where the run is loaded, so that every consumer — the screens,
 * the Analysis Result, the report's provenance tokens — reads the same state
 * and none of them has to remember to derive it. A second derivation somewhere
 * downstream is how the screen and the data came to disagree in the first
 * place.
 */
export function applyDecisions(
  facts: readonly FactRecord[],
  decisions: ReadonlyMap<string, FactDecisionState>
): FactRecord[] {
  const exemptIds = new Set(exemptFacts(facts).map((f) => f.id));
  const queuedIds = new Set(queuedFacts(facts).map((f) => f.id));

  return facts.map((fact) => {
    // A fact is queued, exempt, or neither (immaterial and unmapped); only the
    // queued set waits on a human.
    const queued = queuedIds.has(fact.id) && !exemptIds.has(fact.id);
    return {
      ...fact,
      verificationState: deriveVerificationState(fact, decisions.get(fact.id), queued),
    };
  });
}
