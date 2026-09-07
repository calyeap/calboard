"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { activeProvider } from "@/lib/marketdata";
import {
  resolveAnalyzerIdentity,
  mayBeginAnalysis,

} from "@/lib/analyzer/identity";
import {
  createRun,
  recordFactDecision,
  recordJudgment,
  recordProfileDecision,
  REASON_CODES,
  JUDGMENT_KEYS,
  type FactDecision,
  type ReasonCode,
  type ProfileDecision,
  type JudgmentKey,
} from "@/lib/analyzer/runStore";
import { fixtureForTicker } from "@/lib/analyzer/gate";
import type { ResolveState } from "@/lib/analyzer/resolveState";

// ---------------------------------------------------------------------------
// Server actions for the human steps. Every one of these runs on the server,
// which is the point: the Step 2 gate is server-side (design §104), and a
// decision recorded only in client state could not gate anything.
// ---------------------------------------------------------------------------

/**
 * Step 1 resolution. Fires on blur or Enter; there is no Resolve button.
 *
 * Creates nothing. The run commits only when the analyst confirms the
 * resolved company (design:121), which is beginAnalysisAction below.
 */
export async function resolveTickerAction(
  _prev: ResolveState,
  formData: FormData
): Promise<ResolveState> {
  const entered = String(formData.get("ticker") ?? "");
  if (entered.trim() === "") {
    return { identity: null, entered };
  }
  const identity = await resolveAnalyzerIdentity(entered, activeProvider());
  return { identity, entered };
}

/**
 * Commits the run and moves to Step 2.
 *
 * Re-resolves rather than trusting the posted company name: the identity in
 * the form is client-supplied, and a run must not be created for a company the
 * server has not itself resolved. This is the same reasoning as the gate —
 * what the client says happened is not evidence that it did.
 */
export async function beginAnalysisAction(formData: FormData): Promise<void> {
  const ticker = String(formData.get("ticker") ?? "");
  const identity = await resolveAnalyzerIdentity(ticker, activeProvider());

  if (!mayBeginAnalysis(identity) || identity.outcome !== "RESOLVED") {
    // Nothing is created. The screen re-renders with the refusal.
    redirect("/analyzer");
  }

  // M7 serves the two validation fixtures; acquisition arrives at M8. A
  // company that resolves but has no fact set cannot be spot-checked, and a
  // run that cannot be spot-checked must not exist.
  if (fixtureForTicker(identity.ticker) === null) {
    redirect(`/analyzer?unavailablefixture=${encodeURIComponent(identity.ticker)}`);
  }

  const runId = await createRun(identity.ticker, identity.companyName);
  redirect(`/analyzer/${runId}/facts`);
}

function parseReasonCode(raw: FormDataEntryValue | null): ReasonCode | null {
  const value = raw === null ? "" : String(raw);
  return (REASON_CODES as readonly string[]).includes(value) ? (value as ReasonCode) : null;
}

/**
 * Records one Step 2 decision.
 *
 * A non-confirmation without a valid reason code is refused here, refused by
 * runStore, and refused by the table's CHECK constraint. Three layers is not
 * belt-and-braces for its own sake: the first gives a usable message, the
 * second protects every other caller, and only the third cannot be bypassed.
 */
export async function recordFactDecisionAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  const factId = String(formData.get("factId") ?? "");
  const decision = String(formData.get("decision") ?? "") as FactDecision;

  if (decision !== "CONFIRMED" && decision !== "NOT CONFIRMED") {
    throw new Error("Step 2 offers exactly two decisions (§3.8.3)");
  }

  const reasonCode = decision === "NOT CONFIRMED" ? parseReasonCode(formData.get("reasonCode")) : null;

  await recordFactDecision(runId, factId, decision, reasonCode);
  revalidatePath(`/analyzer/${runId}/facts`);
}

export async function recordJudgmentAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  const judgmentKey = String(formData.get("judgmentKey") ?? "") as JudgmentKey;
  const selection = String(formData.get("selection") ?? "");
  const rawReason = String(formData.get("reason") ?? "").trim();

  if (!(JUDGMENT_KEYS as readonly string[]).includes(judgmentKey)) {
    throw new Error("Unknown judgment (§4.4 defines three)");
  }
  if (selection.trim() === "") {
    throw new Error("A judgment records the selection that was made (§4.4)");
  }

  await recordJudgment(runId, judgmentKey, selection, rawReason === "" ? null : rawReason);
  revalidatePath(`/analyzer/${runId}/facts`);
}

/**
 * Records the Step 6 outcome and moves to the report.
 *
 * human_confirmed is not accepted from the form — runStore derives it from the
 * decision, so Cannot judge cannot arrive as a confirmation.
 */
export async function recordProfileDecisionAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  const decision = String(formData.get("decision") ?? "") as ProfileDecision;
  const recommended = String(formData.get("recommendedProfile") ?? "");
  const overrideProfile = String(formData.get("overrideProfile") ?? "").trim();
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();

  if (decision !== "CONFIRMED" && decision !== "OVERRIDDEN" && decision !== "CANNOT JUDGE") {
    throw new Error("Step 6 offers exactly three outcomes (§6.3)");
  }

  if (decision === "OVERRIDDEN") {
    if (overrideProfile === "") throw new Error("An override names the profile it selects (§6.3)");
    if (overrideReason === "") throw new Error("An override is recorded with its reason (§6.3)");
    await recordProfileDecision(runId, decision, overrideProfile, overrideReason);
  } else {
    // Confirm and Cannot judge both proceed on the recommended profile. The
    // difference is human_confirmed, which runStore sets, not this action.
    await recordProfileDecision(runId, decision, recommended, null);
  }

  redirect(`/analyzer/${runId}/report`);
}
