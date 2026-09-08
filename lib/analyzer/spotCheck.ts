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
  | "UNRECOGNISED — FAIL-CLOSED"
  // Not material: a software-derived figure whose every component is itself
  // exempt and which a §3.8.2 cross-check constrained and passed. Named
  // distinctly so it is never confused with a fact §3.8 simply does not
  // mention — the first was recognised and ruled on, the second was not
  // recognised at all.
  | "DERIVED — COMPONENTS EXEMPT AND CROSS-CHECKED";

export interface Materiality {
  material: boolean;
  reason: MaterialityReason | "NOT MATERIAL";
}

/**
 * What materialityOf needs beyond the fact itself to apply the derived-fact
 * exemption (Command Center ruling, 8 September 2026).
 *
 * OPTIONAL EVERYWHERE. Called without it, materialityOf behaves exactly as it
 * did before the ruling and a derived figure falls through to the fail-closed
 * default. That direction is deliberate: a caller that cannot supply the
 * evidence must not be able to exempt anything.
 */
export interface MaterialityContext {
  /** Ids of the facts in this run that are tag-exempt (§3.8.1). */
  exemptFactIds: ReadonlySet<string>;
  /**
   * Ids a §3.8.2 cross-check constrained against other facts AND passed —
   * `constrainedAndPassedFactIds` from the cross-check report. Never "a check
   * appeared", never "nothing failed".
   */
  crossCheckConstrainedFactIds: ReadonlySet<string>;
}

/**
 * Why a fact is material, not merely whether. The reason is returned so the
 * fail-closed default is visible and testable rather than hiding inside a
 * boolean — a fact queued because nothing recognised it is a different
 * situation from one queued because §3.8 names it, and only the first is a
 * signal that this mapping needs extending.
 */
export function materialityOf(fact: FactRecord, context?: MaterialityContext): Materiality {
  if (NAMED_MATERIAL_FACT_IDS.has(fact.id)) {
    return { material: true, reason: "NAMED IN §3.8" };
  }
  if (fact.sourceClass === "SECONDARY") {
    return { material: true, reason: "CLASSIFIED SECONDARY" };
  }
  if (fact.extractionType === "AI-EXTRACTED") {
    return { material: true, reason: "CLASSIFIED AI-EXTRACTED" };
  }

  // The derived-fact exemption. Command Center, 8 September 2026, on the
  // evidence from the first real MSFT and OKLO runs.
  //
  // WHERE IT SITS IS THE WHOLE DESIGN. It comes after the three limbs above
  // and before the fail-closed default, so it can only ever refine "we did not
  // recognise this fact" — never overrule §3.8. current-operating-margin is
  // derived, has exempt components and passes a reconciliation rule, and it
  // still queues, because §3.8 names it and the first branch catches it. That
  // is not an accident of ordering to be tidied later; moving this block above
  // the NAMED test would silently drop a figure the spec names.
  //
  // The ruling's reasoning, so it is not re-argued: net-debt and cash-fcf are
  // computed by this software from components it has already exempted, and
  // §3.8.2 already recomputes both identities and reports the outcome. A card
  // asking an analyst to confirm one cannot be answered by matching a number
  // against a filing — there is no such line — only by agreeing with a
  // treatment, which §3.8.3 does not ask for and which invites a
  // Cannot-verify every time.
  // §3.2 IS NARROWER THAN THIS BEHAVIOUR, AND THE SPEC TEXT IS THE STALE PART.
  // Do not "fix" the code to match it.
  //
  // A fact exempted here ends up carrying SPOT-CHECK NOT REQUIRED
  // (deriveVerificationState below). §3.2 glosses that value as "exempt from
  // the queue because the figure came through a fixed, versioned tag mapping",
  // which describes ONE route to the state and not this one. Command Center
  // ruled on 8 September 2026 that the state is behaviourally correct — the
  // fact is not queued and not spot-checked, which is what the value means to
  // a reader — and that the narrow explanation goes into the M8 spec
  // amendment cycle alongside §17.16's Quick Read contents list and §19 line
  // 1082. It is deliberately NOT being re-frozen for now.
  //
  // A reader who takes §3.2's gloss literally and deletes this branch to match
  // it would silently re-queue every derived fact, undoing the ruling and
  // putting cards back in front of the analyst that cannot be answered by
  // matching a number against a filing. That is the specific mistake this
  // paragraph exists to prevent.
  if (context !== undefined && isDerivedAndAlreadyChecked(fact, context)) {
    return { material: false, reason: "DERIVED — COMPONENTS EXEMPT AND CROSS-CHECKED" };
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
  //
  // For the M8 cross-check: one of three items waiting on real acquisition,
  // with NAMED_MATERIAL_FACT_IDS above and the NON-OPERATING INVESTMENTS
  // judgment in judgments.ts. Re-read all three together when M8 lands.
  // Fail-closed, per §5.3 and the Command Center ruling of 7 September 2026:
  // an unrecognised fact staying in the queue costs a spot-check, one skipping
  // it costs the thing the queue exists for. A fact reaching here is PRIMARY,
  // deterministic, verified and unnamed by §3.8 — plausibly immaterial, but
  // "plausibly" is not the standard this milestone works to.
  return { material: true, reason: "UNRECOGNISED — FAIL-CLOSED" };
}

/**
 * Both conditions of the derived-fact exemption, in order.
 *
 * 1. It is a derived figure, and EVERY component it derives from is itself
 *    exempt. A component that is queued means a human is still looking at an
 *    input, and the aggregate over it is not settled.
 * 2. A §3.8.2 cross-check CONSTRAINED this fact against other facts and
 *    PASSED.
 *
 * Condition 2 is the one that matters, and it is written as a positive
 * requirement rather than as "did not fail". Absence of a cross-check is not
 * evidence of one — the same shape as §3.8.1 guard 1, where absence of a
 * recorded mapping version is not evidence of a mapping. A derived figure that
 * no rule reaches has been looked at by nobody and nothing, so it keeps
 * queueing.
 *
 * A FAILING cross-check never reaches here: §3.8.2 forces such a fact into the
 * queue in queuedFacts before materiality is consulted at all, and it is
 * absent from the constrained-and-passed set as well. Two independent reasons,
 * neither relied on alone.
 */
function isDerivedAndAlreadyChecked(fact: FactRecord, context: MaterialityContext): boolean {
  const components = fact.derivedFrom;
  // null or empty means "not derived", which is the fail-closed reading of a
  // record that did not declare its inputs.
  if (components === null || components.length === 0) return false;

  const everyComponentExempt = components.every((id) => context.exemptFactIds.has(id));
  if (!everyComponentExempt) return false;

  return context.crossCheckConstrainedFactIds.has(fact.id);
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
 * Fact ids a §3.8.2 cross-check failed on.
 *
 * Passed separately rather than stored on FactRecord because §3.8.2 is
 * emphatic that a failed cross-check "never corrects the figure" — the record
 * that came out of acquisition is left exactly as acquired, and the failure
 * travels beside it as a state. Threading it as a parameter also keeps the
 * queue a pure function of (facts, cross-check outcomes), which is what makes
 * the forcing behaviour testable without a database.
 */
export type CrossCheckFailedFactIds = ReadonlySet<string>;

const NO_FAILURES: CrossCheckFailedFactIds = new Set<string>();

/**
 * Evidence for the derived-fact exemption, supplied per run.
 *
 * Optional on every function below. Omitted, no derived fact is exempted and
 * the queue behaves exactly as it did before the 8 September ruling — so a
 * caller that has not run the cross-checks cannot exempt anything by
 * forgetting to pass this.
 */
export interface DerivedExemptionEvidence {
  /** `constrainedAndPassedFactIds(report)` from crosschecks/run.ts. */
  crossCheckConstrainedFactIds: ReadonlySet<string>;
}

/**
 * Builds the materiality context for a fact set.
 *
 * The exempt-component test is computed from THIS fact set's own tag mappings
 * rather than taken from a caller, so a component cannot be declared exempt by
 * anyone but §3.8.1.
 */
function materialityContextFor(
  facts: readonly FactRecord[],
  evidence: DerivedExemptionEvidence | undefined
): MaterialityContext | undefined {
  if (evidence === undefined) return undefined;
  return {
    exemptFactIds: new Set(facts.filter(isExemptFromQueue).map((f) => f.id)),
    crossCheckConstrainedFactIds: evidence.crossCheckConstrainedFactIds,
  };
}

/**
 * The Step 2 queue: material facts that are not exempt, PLUS any fact a
 * §3.8.2 cross-check failed on.
 *
 * The second limb is not a refinement of the first. §3.8.2: a failed
 * cross-check "forces that fact into the Step 2 queue WHATEVER ITS ACQUISITION
 * PATH" — so a tag-mapped fact that would otherwise carry SPOT-CHECK NOT
 * REQUIRED is queued, and the §3.8.1 exemption does not survive a failure. The
 * exemption rests on the compensating control; it cannot outrank it.
 *
 * Order is the fact set's own order, so the queue is stable across refreshes
 * and a run resumed from its URL presents the same fact in the same place.
 */
export function queuedFacts(
  facts: readonly FactRecord[],
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES,
  evidence?: DerivedExemptionEvidence
): FactRecord[] {
  const context = materialityContextFor(facts, evidence);
  return facts.filter(
    (f) =>
      // A failed cross-check comes FIRST and is unconditional. The derived-fact
      // exemption cannot rescue a fact whose own check failed, whatever its
      // components look like.
      crossCheckFailedFactIds.has(f.id) ||
      (materialityOf(f, context).material && !isExemptFromQueue(f))
  );
}

/**
 * Facts shown but not queued (§3.8.1): "It is not spot-checked; it is not
 * hidden." Screen 2 renders these with SPOT-CHECK NOT REQUIRED beside them.
 *
 * A fact whose cross-check failed is no longer exempt, so it leaves this set
 * as it enters the queue. The two functions must not both claim it — a fact
 * displayed as SPOT-CHECK NOT REQUIRED while sitting in the queue is exactly
 * the screen/data disagreement deriveVerificationState was written to end.
 */
export function exemptFacts(
  facts: readonly FactRecord[],
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES
): FactRecord[] {
  return facts.filter((f) => isExemptFromQueue(f) && !crossCheckFailedFactIds.has(f.id));
}

/**
 * Facts exempted by the derived-fact rule rather than by a tag mapping.
 *
 * Shown but not queued, on the same principle §3.8.1 guard 2 states for the
 * tag exemption: "it changes what is queued, not what is carried. It is not
 * spot-checked; it is not hidden." These are deliberately NOT folded into
 * `exemptFacts`, whose section on Screen 2 is headed "Acquired through a tag
 * mapping" — a derived figure was not, and putting it under that heading would
 * be a false claim about its provenance on the one screen that exists to make
 * provenance checkable.
 */
export function derivedExemptFacts(
  facts: readonly FactRecord[],
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES,
  evidence?: DerivedExemptionEvidence
): FactRecord[] {
  const context = materialityContextFor(facts, evidence);
  if (context === undefined) return [];
  return facts.filter(
    (f) =>
      !crossCheckFailedFactIds.has(f.id) &&
      !isExemptFromQueue(f) &&
      materialityOf(f, context).reason === "DERIVED — COMPONENTS EXEMPT AND CROSS-CHECKED"
  );
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
  decidedFactIds: ReadonlySet<string>,
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES,
  evidence?: DerivedExemptionEvidence
): boolean {
  return queuedFacts(facts, crossCheckFailedFactIds, evidence).every((f) =>
    decidedFactIds.has(f.id)
  );
}

/**
 * The queued facts still awaiting a decision, in queue order. Screen 2 uses
 * this to place the analyst at the next undecided fact after a refresh.
 */
export function undecidedFacts(
  facts: readonly FactRecord[],
  decidedFactIds: ReadonlySet<string>,
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES,
  evidence?: DerivedExemptionEvidence
): FactRecord[] {
  return queuedFacts(facts, crossCheckFailedFactIds, evidence).filter(
    (f) => !decidedFactIds.has(f.id)
  );
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

  // Not queued, so there is no decision to wait for.
  //
  // A READING, recorded because §3.2's gloss on this value names only the
  // §3.8.1 tag-mapping route ("Exempt from the queue because the figure came
  // through a fixed, versioned tag mapping"). Since the 8 September ruling a
  // second route reaches here: a derived figure whose components are exempt
  // and which a §3.8.2 cross-check constrained and passed.
  //
  // SPOT-CHECK NOT REQUIRED is used anyway, because criterion A24 fixes this
  // field at exactly four values and inventing a fifth would break it. The
  // value names the state — exempt from the queue, and expressly "not a human
  // confirmation" — even where §3.2's example of how a fact got there is not
  // the route this one took.
  //
  // RULED, 8 September 2026: record, do not amend. The state is correct and
  // §3.2's account of how it is reached is stale; the wording goes into the M8
  // spec amendment cycle, and nothing is re-frozen for it now. See the longer
  // note at the grant site in materialityOf above.
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
  decisions: ReadonlyMap<string, FactDecisionState>,
  crossCheckFailedFactIds: CrossCheckFailedFactIds = NO_FAILURES,
  evidence?: DerivedExemptionEvidence
): FactRecord[] {
  const exemptIds = new Set(exemptFacts(facts, crossCheckFailedFactIds).map((f) => f.id));
  const queuedIds = new Set(
    queuedFacts(facts, crossCheckFailedFactIds, evidence).map((f) => f.id)
  );

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
