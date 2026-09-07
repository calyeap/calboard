import { notFound, redirect } from "next/navigation";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { ProfileDecisionForm } from "@/app/components/ProfileDecisionForm";
import { loadGateState, RunNotFoundError } from "@/lib/analyzer/gate";
import { PROFILE_LABELS } from "@/lib/analyzer/profileLabels";

// Screen 3 — Steps 3–5 displayed, Step 6 input.
//
// The design requires this screen to redirect to Screen 2 when the run is not
// spot-check-complete (design §104). That redirect is a convenience for the
// analyst, NOT the enforcement: the enforcement is that computeAnalysisForRun
// refuses to compute, so a deep link here cannot produce a number even if this
// check were removed.

export default async function ProfilePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  let state;
  try {
    state = await loadGateState(runId);
  } catch (err) {
    if (err instanceof RunNotFoundError) notFound();
    throw err;
  }

  if (!state.spotCheckComplete) {
    redirect(`/analyzer/${runId}/facts`);
  }

  // Read from the run's own inputs rather than computing: the recommendation
  // is a classification the fixture carries, and running the module set here
  // would run Step 8 before Steps 6 and 7 have happened.
  const recommended = state.fixture.profile.recommended;
  const recommendedLabel = PROFILE_LABELS[recommended];
  const inputs = state.fixture.profile.classificationInputs;

  return (
    <AnalyzerShell>
      <div className="cb-steps">
        <div className="wrap">
          <div className="sechead">
            <h2>Steps 3–5 — Gates and triggers</h2>
            <span className="screenlabel">Software · read-only</span>
          </div>
          <hr className="rule" />

          <div className="judgment">
            <h3>Gate 0 — supported profile</h3>
            <p className="why">
              Sector classification: {state.fixture.gate0.sectorClassification} ·{" "}
              {state.fixture.gate0.industryClassification}
            </p>
            <h3 style={{ marginTop: 18 }}>Gate 1 — history sufficiency</h3>
            <p className="why">
              {state.fixture.gate1.filedYearsCount} filed years. Gate 1 never stops the analysis;
              it sets suppression and labelling state.
            </p>
          </div>

          <div className="sechead" style={{ marginTop: 44 }}>
            <h2>Step 6 — Profile confirmation</h2>
            <span className="screenlabel">Human · nothing pre-selected</span>
          </div>
          <hr className="rule" />

          <p className="whythisfact">
            The profile selects the primary valuation method. Mature companies get a DCF and a
            reverse DCF; high-growth gets scenario paths instead; pre-revenue gets none of them.
            Confirm the wrong one and every number below is computed by a method that does not
            suit the company — and the report will look entirely normal.
          </p>

          <div className="judgment" style={{ marginTop: 24 }}>
            <h3>Recommended: {recommendedLabel}</h3>
            <p className="why">The facts that drove it, per §6.3:</p>
            <div className="idsource">
              <dl>
                <dt>Revenue</dt>
                <dd>{inputs.revenueScale}</dd>
                <dt>Free cash flow</dt>
                <dd>{inputs.fcfCharacter.replace(/_/g, " ")}</dd>
                <dt>Revenue growth</dt>
                <dd>{inputs.revenueGrowthBand}</dd>
                <dt>Capital intensity</dt>
                <dd>{inputs.capitalIntensity.mul(100).toFixed(1)}% of revenue</dd>
                <dt>Ten-year margin range</dt>
                <dd>{inputs.cyclicality.tenYearMarginRange.mul(100).toFixed(1)} pts</dd>
                <dt>Balance-sheet nature</dt>
                <dd>{inputs.balanceSheetNature} — an ASSUMPTION you confirm, not a FACT</dd>
              </dl>
            </div>
          </div>

          <p className="whythisfact" style={{ marginTop: 20 }}>
            Three answers, and none of them is the expected one. <b>Confirm</b> means the
            classification above describes this company as you read it. <b>Override</b> means it
            does not, and you name the profile that does and why. <b>Cannot judge</b> means you
            cannot assess the question — a recorded answer, not a way past this screen.
          </p>

          <ProfileDecisionForm runId={runId} recommendedLabel={recommendedLabel} />
        </div>
      </div>
    </AnalyzerShell>
  );
}
