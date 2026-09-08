import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { ProfileDecisionForm } from "@/app/components/ProfileDecisionForm";
import { loadGateState, RunNotFoundError } from "@/lib/analyzer/gate";
import { PROFILE_LABELS } from "@/lib/analyzer/profileLabels";
import { evaluateGate0, evaluateGate1 } from "@/lib/analyzer/gates";
import { gate0Heading, gate0TestRows, gate0ExplanationIfFailed } from "@/lib/analyzer/gateBand";

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

  // Steps 3–5 are this screen's own subject, so the gates are EVALUATED here
  // rather than having their inputs printed under a hard-coded verdict. §2's
  // ordering rule forbids a calculation module before Step 2; Gate 0 is Step 3
  // and a pure function of inputs already acquired, and no valuation arithmetic
  // is reachable from it. The profile RECOMMENDATION below is still read from
  // the run's inputs — running the module set here would run Step 8 before
  // Steps 6 and 7 have happened.
  const gate0 = evaluateGate0(state.fixture.gate0);
  const gate0Explanation = gate0ExplanationIfFailed(gate0);
  const gate1 = evaluateGate1(state.fixture.gate1);

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
            {/* The heading is the gate's RESULT. It used to be the literal
                "Gate 0 — supported profile" printed above the gate's inputs,
                which read as a verdict over a company the gate may have
                refused. Design §5.1: result, then the four tests with their
                evaluated values. */}
            <h3>{gate0Heading(gate0)}</h3>
            <div className="idsource">
              <dl>
                {gate0TestRows(gate0).map((row) => (
                  <Fragment key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>
                      {row.value}
                      {row.fired && <span className="typetag">Fired</span>}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </div>
            {gate0Explanation !== null && (
              <div className="state" style={{ marginTop: 14 }}>
                <span className="name">{gate0.result}</span>
                <span className="cause">{gate0Explanation}</span>
              </div>
            )}

            <h3 style={{ marginTop: 18 }}>Gate 1 — history sufficiency</h3>
            <p className="why">
              {gate1.filedYearsCount} filed years
              {gate1.state !== null && ` · ${gate1.state}`}. Gate 1 never stops the analysis; it
              sets suppression and labelling state.
              {gate1.state === "HISTORY INSUFFICIENT" &&
                " The own-history multiple percentile and history-based normalisation are" +
                  " suppressed; the margin and stress diagnostics still run."}
              {gate1.state === "SHORT HISTORY" &&
                " Every history statistic is labelled with the window actually used."}
            </p>
          </div>

          <div className="sechead" style={{ marginTop: 44 }}>
            <h2>Step 6 — Profile confirmation</h2>
            <span className="screenlabel">Human · nothing pre-selected</span>
          </div>
          <hr className="rule" />

          {/* Amendment M7-c, change C4. The line used to stop at "...the
              report will look entirely normal", covering only Confirm. C4
              requires it to cover Override and Cannot judge too — M7-c exists
              because the profile card did not say what the three answers
              meant. Wording is the mock's, verbatim. */}
          <p className="whythisfact">
            The profile decides which valuation methods run and which are refused outright.
            Mature-profitable gets a DCF and a reverse DCF; high-growth gets explicit year-by-year
            revenue paths instead, and pre-revenue gets none of them. Confirm the wrong one and
            every number below is computed by a method that does not describe this company — the
            arithmetic will be correct and the report will look entirely normal. Override and the
            methods change to match the profile you name, carrying your reason and the
            not-validated statement into the report. Answer Cannot judge and the run continues on
            the recommendation with no confirmed profile behind it, which the report states on its
            face.
          </p>

          <div className="judgment" style={{ marginTop: 24 }}>
            <h3>Recommended: {recommendedLabel}</h3>
            {/* The mock's kicker. Section references are the contract's
                vocabulary, not the reader's — "per §6.3" was printed to the
                analyst and told them nothing. */}
            <p className="why">Software recommends, with the facts that drove it</p>
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
                {/* The mock gives this the underlined token treatment rather
                    than prose in the cell: it is an ASSUMPTION the analyst
                    confirms, and §6.3 is explicit that it was wrongly marked
                    FACT in earlier versions. */}
                <dd>
                  {inputs.balanceSheetNature} <span className="typetag">Assumption</span>
                </dd>
              </dl>
            </div>
          </div>

          {/* Amendment M7-c, change C3. The block used to stop at "a recorded
              answer, not a way past this screen". C3 requires the three §6.3
              consequences and the closing sentence. Wording is the mock's,
              verbatim. */}
          <p className="whythisfact" style={{ marginTop: 20 }}>
            Three answers, and none of them is the expected one.{" "}
            <b>Confirm recommended profile</b> means the classification above describes this
            company as you read it. <b>Override</b> means it does not, and you name the profile
            that does and why. <b>Cannot judge</b> means you cannot assess the question — a
            recorded answer, not a way past this screen. It uses the recommended profile
            provisionally so the run continues, records the profile as not human-confirmed, and
            the valuation position does not render. It never counts as confirmation.
          </p>

          <ProfileDecisionForm runId={runId} recommendedLabel={recommendedLabel} />
        </div>
      </div>
    </AnalyzerShell>
  );
}
