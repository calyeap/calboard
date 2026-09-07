import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyzerShell } from "@/app/components/AnalyzerShell";
import { FactCard } from "@/app/components/FactCard";
import { loadGateState, RunNotFoundError } from "@/lib/analyzer/gate";
import { getFactDecisions, getJudgments } from "@/lib/analyzer/runStore";
import { JUDGMENTS } from "@/lib/analyzer/judgments";
import { JudgmentSelector } from "@/app/components/JudgmentSelector";
import { queuedFacts, exemptFacts } from "@/lib/analyzer/spotCheck";
import type { FactRecord } from "@/lib/analyzer/types";

// Screen 2 — Step 2, fact acquisition and human spot-check.
// The step that blocks all calculation (§2 ordering rule, §3.8).

export default async function FactsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  let state;
  try {
    state = await loadGateState(runId);
  } catch (err) {
    if (err instanceof RunNotFoundError) notFound();
    throw err;
  }

  const decisions = await getFactDecisions(runId);
  const judgments = await getJudgments(runId);
  const decisionByFactId = new Map(decisions.map((d) => [d.factId, d]));
  const judgmentByKey = new Map(judgments.map((j) => [j.judgmentKey, j]));

  const queued = queuedFacts(state.fixture.facts).map(toPlainFact);
  const exempt = exemptFacts(state.fixture.facts).map(toPlainFact);
  const outstanding = state.outstandingFactIds.length;

  return (
    <AnalyzerShell>
      <div className="cb-steps">
        <div className="wrap">
          <div className="sechead">
            <h2>Step 2 — Fact acquisition and spot-check</h2>
            <span className="screenlabel">Human · blocks all calculation</span>
          </div>
          <hr className="rule" />

          <p className="whythisfact">
            Before anything is calculated, you check each number against the document it came
            from — one at a time. Every figure in the final report is built on these, and a wrong
            input does not produce an obviously wrong report. It produces a plausible one.
          </p>
          <p className="note">
            {state.run.resolvedCompanyName} · {state.run.ticker} · {queued.length} queued for
            spot-check, {exempt.length} shown but exempt.
          </p>

          {queued.map((fact) => (
            <FactCard
              key={fact.id}
              runId={runId}
              fact={fact}
              decision={decisionByFactId.get(fact.id)}
              queued
            />
          ))}

          {exempt.length > 0 && (
            <>
              <div className="sechead" style={{ marginTop: 44 }}>
                <h2>Acquired through a tag mapping</h2>
                <span className="screenlabel">Shown · not queued</span>
              </div>
              <hr className="rule" />
              <p className="whythisfact">
                These came through a fixed, versioned tag mapping, which is reproducible without a
                model. They are not spot-checked and they are not hidden — the exemption changes
                what is queued, not what is carried.
              </p>
              {exempt.map((fact) => (
                <FactCard
                  key={fact.id}
                  runId={runId}
                  fact={fact}
                  decision={decisionByFactId.get(fact.id)}
                  queued={false}
                />
              ))}
            </>
          )}

          {/* §4.4, placed in Step 2 by R6 (approved 7 September 2026). */}
          <div className="judgments">
            <div className="sechead">
              <h2>Judgments — labelled FACT, and not facts</h2>
              <span className="screenlabel">Select, do not type</span>
            </div>
            <hr className="rule" />
            <p className="whythisfact">
              Three inputs look like facts and are actually choices. You make them here, in the
              open, rather than inheriting them from a default nobody chose.
            </p>

            {JUDGMENTS.map((judgment) => (
              <JudgmentSelector
                key={judgment.key}
                runId={runId}
                judgment={judgment}
                existing={judgmentByKey.get(judgment.key)}
              />
            ))}
          </div>

          {/* The step completes when the last individual fact has a decision,
              and by no other route. There is no bulk control here: no confirm
              all, no confirm remaining, no select-all (design §174). */}
          <div className="continue" style={{ marginTop: 44 }}>
            {state.spotCheckComplete ? (
              <Link className="act" href={`/analyzer/${runId}/profile`}>
                Continue to gates
              </Link>
            ) : (
              <>
                <button className="act" type="button" disabled>
                  Continue to gates
                </button>
                <span className="reason">
                  {outstanding} material {outstanding === 1 ? "fact" : "facts"} still undecided —
                  Continue is unavailable until every fact carries a decision.
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </AnalyzerShell>
  );
}

/**
 * Renders a fact's value to a string before it crosses into a Client
 * Component.
 *
 * FactRecord.value is `Decimal | string | null`, and a Decimal is a class
 * instance. React refuses to serialise those across the server/client boundary
 * — "Only plain objects can be passed to Client Components" — so passing the
 * record through untouched logs an error on every fact on every render and
 * relies on behaviour that is not guaranteed to keep working.
 *
 * The conversion is lossless for display purposes because FactCard only ever
 * stringifies the value; it has no arithmetic to do. Every calculation module
 * keeps operating on the real Decimal, server-side, where it belongs — no
 * figure is ever recomputed from this string.
 */
function toPlainFact(fact: FactRecord): FactRecord {
  return { ...fact, value: fact.value === null ? null : String(fact.value) };
}

