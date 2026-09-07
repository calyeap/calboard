import { notFound, redirect } from "next/navigation";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { AnalyzerReport } from "@/app/components/AnalyzerReport";
import {
  computeAnalysisForRun,
  loadGateState,
  RunNotFoundError,
  SpotCheckIncompleteError,
} from "@/lib/analyzer/gate";

// Screen 4 — Steps 8–10, output. No human input.
//
// Every path to a number on this page goes through computeAnalysisForRun,
// which refuses before reaching any calculation module when the spot-check is
// incomplete. The redirect below is what the analyst sees; the refusal is what
// enforces §2.

export default async function ReportPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  let state;
  try {
    state = await loadGateState(runId);
  } catch (err) {
    if (err instanceof RunNotFoundError) notFound();
    throw err;
  }

  // Step 6 precedes Step 8. An undecided profile sends the analyst back rather
  // than computing on a classification nobody has answered.
  if (state.run.profileDecision === null) {
    redirect(`/analyzer/${runId}/profile`);
  }

  let result;
  try {
    result = await computeAnalysisForRun(runId);
  } catch (err) {
    if (err instanceof SpotCheckIncompleteError) {
      redirect(`/analyzer/${runId}/facts`);
    }
    if (err instanceof RunNotFoundError) notFound();
    throw err;
  }

  // §6.3 / §10.6.3 — Cannot judge is the one outcome that leaves the profile
  // not human-confirmed.
  const profileNotConfirmed = !state.run.profileHumanConfirmed;

  return (
    <AnalyzerShell>
      {profileNotConfirmed && (
        <div className="cb-steps">
          <div className="wrap" style={{ paddingBottom: 0 }}>
            <div className="state">
              <span className="plain">
                The recommended profile was used provisionally. Nobody confirmed that it describes
                this company.
              </span>
              <span className="name">Profile not confirmed · trust status PARTIAL</span>
              <span className="cause">
                The fair-value range below still renders. The valuation position and its action
                clause do not — an unconfirmed profile would leave the loudest sentence in this
                report resting on a judgment nobody made (§10.6.3).
              </span>
            </div>

            {/* The §10.6 position slot, showing its state rather than a value.
                The position itself (CHEAP / FAIR / EXPENSIVE) is not built in
                M7: its band thresholds are PROVISIONAL and are calibrated at
                M8. What M7 builds is this suppression path. */}
            <div className="state" style={{ marginTop: 14 }}>
              <span className="name">Valuation position — suppressed</span>
              <span className="cause">PROFILE NOT CONFIRMED</span>
            </div>
          </div>
        </div>
      )}

      <AnalyzerReport result={result} />
    </AnalyzerShell>
  );
}
