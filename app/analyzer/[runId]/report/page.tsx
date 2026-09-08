import { notFound, redirect } from "next/navigation";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { AnalyzerReport } from "@/app/components/AnalyzerReport";
import { loadGateState, RunNotFoundError, SpotCheckIncompleteError } from "@/lib/analyzer/gate";
import { analysisForReport } from "@/lib/analyzer/reportAnalysis";
import { trustStatusLine, trustConsequenceLine } from "@/lib/analyzer/trustCopy";

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

  // M8-b: the same gated computation, followed by the §8.2 interpretation and
  // the §8.5 blind challenger. The order is the boundary — every number on this
  // page is settled before either call is made, and neither can change one.
  // A run whose calls have already completed reads the stored prose rather than
  // rolling new words on a refresh.
  let report;
  try {
    report = await analysisForReport(runId);
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

  // §9.6, read off the Analysis Result rather than written here. The status
  // used to be the literal "PARTIAL", which was true of the run this page was
  // built against and false of any run whose fair-value range was suppressed.
  const trust = report.result.trust;

  // The block renders on every run now, not only unconfirmed ones: §9.6 puts
  // one status per run on page one, and a status that appeared only when
  // something else was also wrong would be missing exactly where UNUSABLE
  // needs saying.
  const positionSuppressedBy =
    trust.status === "UNUSABLE"
      ? `TRUST STATUS UNUSABLE · ${trust.determinedBy[0]?.detail ?? ""}`
      : profileNotConfirmed
        ? "PROFILE NOT CONFIRMED"
        : null;

  return (
    <AnalyzerShell>
      {(profileNotConfirmed || trust.status !== "CLEAN") && (
        <div className="cb-steps">
          <div className="wrap" style={{ paddingBottom: 0 }}>
            <div className="state">
              {profileNotConfirmed && (
                <span className="plain">
                  The recommended profile was used provisionally. Nobody confirmed that it
                  describes this company.
                </span>
              )}
              <span className="name">{trustStatusLine(trust.status, profileNotConfirmed)}</span>
              <span className="cause">{trustConsequenceLine(trust.status)}</span>
            </div>

            {/* The §10.6 position slot, showing its state rather than a value.
                The position itself (CHEAP / FAIR / EXPENSIVE / INCONCLUSIVE) is
                not built: its band thresholds are PROVISIONAL until M8-c. What
                is built is this suppression path — and §10.6.3 gives it three
                conditions, of which trust status is one, so the slot now names
                whichever condition actually failed rather than assuming it was
                the profile. */}
            {positionSuppressedBy !== null && (
              <div className="state" style={{ marginTop: 14 }}>
                <span className="name">Valuation position — suppressed</span>
                <span className="cause">{positionSuppressedBy}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <AnalyzerReport result={report.result} aiLayer={report.aiLayer} />
    </AnalyzerShell>
  );
}
