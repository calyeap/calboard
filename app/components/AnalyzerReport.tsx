import { Fragment } from "react";
import Decimal from "decimal.js";
import type {
  AnalysisResult,
  ComputedValue,
  Figure,
  ProvenanceTokens,
  ReverseDcfCell,
  SuppressedValue,
} from "@/lib/analyzer/types";

// Milestone 6 — the report renderer. Every figure below comes directly
// from the AnalysisResult passed in; this component computes nothing
// (§10.0.2 rule 3: "No figure appears in the rendered report that is not
// in the result object. The renderer adds formatting and prose; it adds
// no content."). Section order (A-J) is §10.2's, unchanged. Quick Read and
// "Investment case at a glance" are restatement-only: every line is a
// direct read of an AnalysisResult field, never a new computation, score
// or verdict. Where the mock's own hand-written narrative would require
// interpretive prose this component cannot manufacture (interpretation.
// statements is empty until the AI layer — Milestone 8 — exists), that
// narrative is simply omitted rather than invented.
//
// NOT INCLUDED YET (this checkpoint is desktop-only, one width): the
// ultrawide/mobile responsive breakpoints from the design mocks. Required
// before v1 acceptance regardless — Milestone 9 (full responsive/
// accessibility/acceptance validation) covers it, still inside this build;
// V1.5 is a separate, later hardening pass, not the first implementation.
// Also not included: Sections I/I2's real content (empty until Milestone
// 8's interpretation/challenger calls exist — the section headers still
// render, honestly empty).

function pct(value: Decimal, dp = 1): string {
  return `${value.mul(100).toFixed(dp)}%`;
}

function num(value: Decimal, dp = 2): string {
  return value.toFixed(dp);
}

// "Success as commonly described" — restated directly from
// preRevenue.successDefinitions (which already preserves every qualifying
// value) rather than FairValueRange.successAsCommonlyDescribed, whose
// single-Decimal shape cannot represent a range. See assemble.ts's own
// note on this schema/design gap (the approved OKLO mock shows "$31-$48",
// not one number, for this same concept). Purely a restatement of
// already-computed vSuccess figures — no new calculation.
function successAsCommonlyDescribedRange(preRevenue: AnalysisResult["preRevenue"]): string {
  if (!preRevenue) return "—";
  const qualifying = preRevenue.successDefinitions.filter((d) => d.vSuccess.greaterThan(d.vFail)).map((d) => d.vSuccess);
  if (qualifying.length === 0) return "none";
  const min = qualifying.reduce((m, v) => (v.lessThan(m) ? v : m));
  const max = qualifying.reduce((m, v) => (v.greaterThan(m) ? v : m));
  return min.equals(max) ? `$${num(min)}` : `$${num(min)} - $${num(max)}`;
}

const DEFAULT_PROVENANCE: ProvenanceTokens = {
  sourceClass: "PRIMARY",
  extractionType: "DETERMINISTIC/STRUCTURED",
  verificationState: "VERIFIED",
};

function isDefaultProvenance(tokens: ProvenanceTokens): boolean {
  return (
    tokens.sourceClass === DEFAULT_PROVENANCE.sourceClass &&
    tokens.extractionType === DEFAULT_PROVENANCE.extractionType &&
    tokens.verificationState === DEFAULT_PROVENANCE.verificationState
  );
}

function ProvenanceMarks({ tokens }: { tokens: ProvenanceTokens }) {
  if (isDefaultProvenance(tokens)) return null;
  const parts: string[] = [];
  if (tokens.sourceClass === "SECONDARY") parts.push("Secondary");
  if (tokens.extractionType === "AI-EXTRACTED") parts.push("AI-extracted");
  if (tokens.verificationState !== "VERIFIED") parts.push(tokens.verificationState === "UNVERIFIED" ? "Unverified" : "Spot-check pending");
  return (
    <div className="prov">
      {parts.map((p, i) => (
        <span key={p} className={p === "AI-extracted" ? "ai" : undefined}>
          {i > 0 && <span className="sep">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

function StateBlock({ figure }: { figure: SuppressedValue }) {
  return (
    <div className="state">
      <span className="name">{figure.state}</span>
      <span className="cause">{figure.cause}</span>
    </div>
  );
}

function Flags({ flags }: { flags: ComputedValue<unknown>["qualification"]["analyticFlags"] }) {
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((f) => (
        <div className="flag" key={f.flag}>
          {f.flag}
          {f.detail && <em> {f.detail}</em>}
        </div>
      ))}
    </>
  );
}

// A single figure, formatted, with its qualification shown at the point
// of use — never separated from the value (§10.0.2 rule 1).
function FigureValue({ figure, format }: { figure: Figure<Decimal>; format: (v: Decimal) => string }) {
  if (figure.suppressed) return <StateBlock figure={figure} />;
  return (
    <>
      <span className="v">{format(figure.value)}</span>
      <ProvenanceMarks tokens={figure.qualification.provenanceTokens} />
      <Flags flags={figure.qualification.analyticFlags} />
    </>
  );
}

function ReverseDcfCellView({ cell }: { cell: ReverseDcfCell }) {
  if (cell.fiveYearGrowth.suppressed) {
    return (
      <div className="cell suppressed">
        <span className="name">{cell.fiveYearGrowth.state}</span>
        <span className="cause">{cell.fiveYearGrowth.cause}</span>
      </div>
    );
  }
  return (
    <div className="cell">
      <div className="line">
        <span className="lbl">yrs 1-5 growth</span>
        <b>{pct(cell.fiveYearGrowth.value)}</b>
      </div>
      {!cell.tenYearCagr.suppressed && (
        <div className="line">
          <span className="lbl">10-yr CAGR</span>
          <b>{pct(cell.tenYearCagr.value)}</b>
        </div>
      )}
      {!cell.year10Revenue.suppressed && (
        <div className="line">
          <span className="lbl">yr-10 revenue</span>
          <b>${num(cell.year10Revenue.value, 0)}</b>
        </div>
      )}
      {!cell.ronic.suppressed && (
        <div className="line">
          <span className="lbl">RONIC</span>
          <b>{pct(cell.ronic.value)}</b>
        </div>
      )}
      <Flags flags={cell.ronic.suppressed ? [] : cell.ronic.qualification.analyticFlags} />
    </div>
  );
}

export function AnalyzerReport({ result }: { result: AnalysisResult }) {
  const { gates, states, diagnostics, priceImplied, scenarios, scenarioOutputs, fairValueRange, preRevenue, policy } = result;

  return (
    <div className="layout">
      <aside className="quickread" aria-label="Quick read">
        <h2>Quick read</h2>
        <p className="qsub">{result.companyName} · price as of {result.price.timestamp}</p>
        <hr className="qrule" />

        <div className="qitem">
          <span className="k">Profile</span>
          <p className="t">
            {result.profile.confirmedOrOverridden}
            {result.profile.override && ` (overridden — ${result.profile.override.reason})`}
          </p>
        </div>

        <div className="qitem">
          <span className="k">Active states</span>
          {states.suppressing.length === 0 && states.qualifying.length === 0 ? (
            <p className="t">None active.</p>
          ) : (
            <ul>
              {states.suppressing.map((s, i) => (
                <li key={`s${i}`}>
                  {s.state} — {s.appliesTo}
                </li>
              ))}
              {states.qualifying.map((q, i) => (
                <li key={`q${i}`}>
                  {q.flag} — {q.appliesTo}
                </li>
              ))}
            </ul>
          )}
        </div>

        {result.interpretation.statements.length > 0 && (
          <div className="qitem">
            <span className="k">Interpretation</span>
            <ul>
              {result.interpretation.statements.map((s, i) => (
                <li key={i}>{s.statement}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="qitem">
          <span className="k">Data and model quality</span>
          <p className="t">
            {result.facts.filter((f) => f.sourceClass === "SECONDARY" || f.extractionType === "AI-EXTRACTED" || f.verificationState !== "VERIFIED").length} of{" "}
            {result.facts.length} facts carry a non-default provenance marker — see Section B.
          </p>
        </div>
      </aside>

      <main>
        {/* ============ A ============ */}
        <section id="A">
          <div className="sechead">
            <h2>A — Header and states</h2>
            <span className="k">Before any number</span>
          </div>
          <hr />
          <div className="head">
            <h1>{result.companyName}</h1>
            <p className="tick">{result.ticker}</p>
          </div>
          <div className="pricerow">
            <span className="p">${num(result.price.value)}</span>
            <span className="ts">{result.price.timestamp}</span>
          </div>
          <p className="profileline">
            Profile: {result.profile.confirmedOrOverridden}
            {result.profile.recommended !== result.profile.confirmedOrOverridden &&
              ` (software recommended ${result.profile.recommended})`}
          </p>

          <div className="manifest">
            <div>
              <h3>Suppressed — no number is produced</h3>
              {states.suppressing.length === 0 ? (
                <p className="what">Nothing suppressed.</p>
              ) : (
                states.suppressing.map((s, i) => (
                  <div className="row" key={i}>
                    <div className="state">
                      <span className="name">{s.state}</span>
                      <span className="cause">{s.appliesTo}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div>
              <h3>Qualified — the number stands, with its qualification</h3>
              {states.qualifying.length === 0 ? (
                <p className="what">Nothing qualified.</p>
              ) : (
                states.qualifying.map((q, i) => (
                  <div className="row" key={i}>
                    <div className="qual">{q.flag}</div>
                    <p className="what">{q.appliesTo}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* ============ B ============ */}
        <section id="B">
          <div className="sechead">
            <h2>B — Fact set with provenance</h2>
            <span className="k">All six fields</span>
          </div>
          <hr />
          <table className="t records">
            <thead>
              <tr>
                <th>Fact</th>
                <th>Value</th>
                <th>Provenance</th>
                <th>As-of / retrieved</th>
              </tr>
            </thead>
            <tbody>
              {result.facts.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>
                    <span className="v">{f.value === null ? "—" : f.value.toString()}</span>
                  </td>
                  <td>
                    <ProvenanceMarks tokens={{ sourceClass: f.sourceClass, extractionType: f.extractionType, verificationState: f.verificationState }} />
                    <div className="sub">
                      {f.type} · {f.source}
                    </div>
                  </td>
                  <td>
                    <span className="v">{f.asOfDate}</span>
                    {f.retrievalTimestamp && <div className="sub">retrieved {f.retrievalTimestamp}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ============ C ============ */}
        <section id="C">
          <div className="sechead">
            <h2>C — Gate results</h2>
            <span className="k">No remedy is offered anywhere</span>
          </div>
          <hr />
          <table className="t">
            <tbody>
              <tr>
                <td>Gate 0 — supported profile</td>
                <td>
                  <span className="v">{gates.gate0.result}</span>
                </td>
              </tr>
              <tr>
                <td>Gate 1 — history sufficiency</td>
                <td>
                  <span className="v">{gates.gate1.state ?? `${gates.gate1.filedYearsCount} filed years`}</span>
                </td>
              </tr>
              <tr>
                <td>Leverage precondition</td>
                <td>
                  <span className="v">{gates.leverage.result}</span>
                  {gates.leverage.netDebtRatio !== null && <div className="sub">net debt ratio {pct(gates.leverage.netDebtRatio)}</div>}
                  {gates.leverage.operatingLeaseInclusiveMemo !== null && (
                    <div className="sub">operating-lease-inclusive memo {pct(gates.leverage.operatingLeaseInclusiveMemo)}</div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ============ D ============ */}
        <section id="D">
          <div className="sechead">
            <h2>D — Deterministic diagnostics</h2>
            <span className="k">M1-M14</span>
          </div>
          <hr />
          <table className="t">
            <thead>
              <tr>
                <th>Diagnostic</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Reinvestment, RONIC (5yr)
                  <div className="sub">§7.2 M5</div>
                </td>
                <td>
                  {diagnostics.reinvestmentRonic.ronic.suppressed ? (
                    <StateBlock figure={diagnostics.reinvestmentRonic.ronic} />
                  ) : (
                    diagnostics.reinvestmentRonic.ronic.value.cells.map((c) => (
                      <div key={c.rate}>
                        <span className="v">
                          r={pct(new Decimal(c.rate), 0)}: {c.state}
                          {c.value !== null && ` (${pct(c.value)})`}
                        </span>
                      </div>
                    ))
                  )}
                </td>
              </tr>
              <tr>
                <td>
                  Implied return on new capital
                  <div className="sub">§5.4/§11.4 — current fiscal year, year-over-year</div>
                </td>
                <td>
                  <FigureValue figure={diagnostics.impliedReturnOnNewCapital.value} format={pct} />
                </td>
              </tr>
              <tr>
                <td>
                  Margin history
                  <div className="sub">§7.2 M3</div>
                </td>
                <td>
                  {diagnostics.marginHistory.suppressed ? (
                    <StateBlock figure={diagnostics.marginHistory} />
                  ) : (
                    <>
                      <span className="v">{pct(diagnostics.marginHistory.value.currentMargin)}</span>
                      <div className="sub">
                        {diagnostics.marginHistory.value.windowYears}-year window · range {pct(diagnostics.marginHistory.value.range)} · median{" "}
                        {pct(diagnostics.marginHistory.value.median)} · worst change {pct(diagnostics.marginHistory.value.worstSingleYearChange)}
                      </div>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>
                  FCF yield + growth
                  <div className="sub">§7.2 M11 · conditional output</div>
                </td>
                <td className={diagnostics.fcfYieldGrowth.precondition === "PRECONDITION FAILED" ? "state" : undefined}>
                  {diagnostics.fcfYieldGrowth.precondition === "PRECONDITION FAILED" ? (
                    <>
                      <span className="name">PRECONDITION FAILED</span>
                    </>
                  ) : diagnostics.fcfYieldGrowth.output ? (
                    <FigureValue figure={diagnostics.fcfYieldGrowth.output} format={pct} />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <td>
                  Run-rate comparison
                  <div className="sub">§7.2 M12</div>
                </td>
                <td>
                  <span className="v">{diagnostics.runRate.seasonalityTestResult}</span>
                  {diagnostics.runRate.ttm !== null && <div className="sub">TTM {num(diagnostics.runRate.ttm, 0)}</div>}
                </td>
              </tr>
              <tr>
                <td>Shape mismatch</td>
                <td>
                  <span className="v">{diagnostics.shapeMismatch.fired ? "FIRED" : "not fired"}</span>
                  {diagnostics.shapeMismatch.gapPoints !== null && <div className="sub">gap {pct(diagnostics.shapeMismatch.gapPoints)}</div>}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ============ E ============ */}
        <section id="E">
          <div className="sechead">
            <h2>E — Price-implied diagnostics</h2>
            <span className="k">Diagnostic reverse DCF · 3 margin levels x 3 rates</span>
          </div>
          <hr />
          <div className="grid">
            <div></div>
            <div className="colhead">r = 8%</div>
            <div className="colhead">r = 10%</div>
            <div className="colhead">r = 12%</div>
            {(["current", "median", "stress"] as const).map((level) => (
              <Fragment key={level}>
                <div className="rowhead">{level}</div>
                {priceImplied.reverseDcfGrid
                  .filter((c) => c.marginLevel === level)
                  .map((c) => (
                    <ReverseDcfCellView cell={c} key={`${level}-${c.rate}`} />
                  ))}
              </Fragment>
            ))}
          </div>
          <table className="t" style={{ marginTop: "20px" }}>
            <tbody>
              <tr>
                <td>Steady-state EV</td>
                <td>
                  <FigureValue figure={priceImplied.steadyStateEv} format={(v) => `$${num(v, 0)}`} />
                </td>
              </tr>
              <tr>
                <td>PVGO</td>
                <td>
                  <FigureValue figure={priceImplied.pvgo} format={(v) => `$${num(v, 0)}`} />
                </td>
              </tr>
              <tr>
                <td>PVGO share of EV</td>
                <td>
                  <FigureValue figure={priceImplied.pvgoShareOfEv} format={pct} />
                </td>
              </tr>
              {priceImplied.nopatGap && (
                <tr>
                  <td>NOPAT gap (current vs median-margin)</td>
                  <td>
                    <span className="v">
                      ${num(priceImplied.nopatGap.current, 0)} vs ${num(priceImplied.nopatGap.medianMargin, 0)}
                    </span>
                  </td>
                </tr>
              )}
              <tr>
                <td>
                  Implied exit multiple
                  <div className="sub">divides {priceImplied.impliedExitMultiple.dividesMetric}</div>
                </td>
                <td>
                  <FigureValue figure={priceImplied.impliedExitMultiple.value} format={(v) => `${num(v, 1)}x`} />
                </td>
              </tr>
              <tr>
                <td>±1% rate sensitivity</td>
                <td>
                  <span className="v">
                    +{pct(diagnostics.rateSensitivity.plusOnePoint)} / {pct(diagnostics.rateSensitivity.minusOnePoint)}
                  </span>
                  <div className="sub">close to a deterministic function of terminal share, not an independent signal</div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ============ F ============ */}
        <section id="F">
          <div className="sechead">
            <h2>F — Analyst scenarios</h2>
            <span className="k">Drivers · anchors</span>
          </div>
          <hr />
          <table className="t">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Growth</th>
                <th>Margin</th>
                <th>Reinvestment</th>
              </tr>
            </thead>
            <tbody>
              {(["bear", "base", "bull"] as const).map((s) => {
                const d = scenarios[s];
                const growth = Array.isArray(d.revenueGrowthOrPath) ? "path" : pct(d.revenueGrowthOrPath);
                return (
                  <tr key={s}>
                    <td>
                      {s}
                      <div className="sub">{d.writtenAnchor}</div>
                    </td>
                    <td>
                      <span className="v">{growth}</span>
                    </td>
                    <td>
                      <span className="v">{pct(d.operatingMargin)}</span>
                    </td>
                    <td>
                      <span className="v">{pct(d.reinvestmentCapitalIntensity)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* ============ G ============ */}
        <section id="G">
          <div className="sechead">
            <h2>G — Scenario outputs</h2>
            <span className="k">Distribution is display only</span>
          </div>
          <hr />
          <table className="t">
            <tbody>
              <tr>
                <td>Bear / base / bull values</td>
                <td>
                  <span className="v">
                    ${num(scenarioOutputs.values.bear, 0)} / ${num(scenarioOutputs.values.base, 0)} / ${num(scenarioOutputs.values.bull, 0)}
                  </span>
                </td>
              </tr>
              <tr>
                <td>
                  Probability-weighted value
                  <div className="sub">display only, never a headline</div>
                </td>
                <td>
                  <span className="v">${num(scenarioOutputs.weightedDistribution, 0)}</span>
                </td>
              </tr>
              <tr>
                <td>Location of current price within the scenario range</td>
                <td>
                  <span className="v">{pct(scenarioOutputs.priceLocationWithinRange, 0)}</span>
                </td>
              </tr>
              <tr>
                <td>Discount rate at which the base case equals the price</td>
                <td>
                  <span className="v">{scenarioOutputs.rateAtWhichBaseEqualsPrice !== null ? pct(scenarioOutputs.rateAtWhichBaseEqualsPrice) : "no solution in range"}</span>
                </td>
              </tr>
              <tr>
                <td>Debt share in the sensitivity table</td>
                <td>
                  <span className="v">removed (I10)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ============ H ============ */}
        <section id="H">
          <div className="sechead">
            <h2>H — Fair-value range</h2>
            <span className="k">Never shown alone</span>
          </div>
          <hr />
          {fairValueRange.kind === "suppressed" ? (
            <div className="state">
              <span className="name">{fairValueRange.state}</span>
              <span className="cause">{fairValueRange.cause}</span>
            </div>
          ) : fairValueRange.kind === "pre-revenue-distribution" ? (
            <div className="hframe">
              <div>
                <h3>Distribution summary</h3>
                <div className="pi">
                  <span className="lbl">Failure (cash floor)</span>
                  <b>${num(fairValueRange.failure)}</b>
                </div>
                <div className="pi">
                  <span className="lbl">Success as commonly described</span>
                  <b>{successAsCommonlyDescribedRange(preRevenue)}</b>
                </div>
                <div className="pi" style={{ borderBottom: 0 }}>
                  <span className="lbl">Success as the price requires</span>
                  <b>${num(fairValueRange.successAsPriceRequires)}</b>
                </div>
              </div>
              <div>
                <h3>Cash floor</h3>
                <p className="note">${num(fairValueRange.cashFloor)} per current share.</p>
              </div>
            </div>
          ) : (
            <div className="hframe">
              <div>
                <h3>Fair-value range</h3>
                <div className="pi">
                  <span className="lbl">Bear</span>
                  <b>${num(fairValueRange.bear, 0)}</b>
                </div>
                <div className="pi" style={{ borderBottom: 0 }}>
                  <span className="lbl">Bull</span>
                  <b>${num(fairValueRange.bull, 0)}</b>
                </div>
                {fairValueRange.scenarioLabelsWarning && (
                  <div className="warn">Trigger A or B has fired. The bounds are scenario labels, not confidence bounds.</div>
                )}
              </div>
              <div>
                <h3>Driven by</h3>
                <p className="note">{fairValueRange.drivingInputs.join(" · ")}</p>
              </div>
            </div>
          )}
        </section>

        {/* ============ I, I2 ============ */}
        <section id="I">
          <div className="sechead">
            <h2>I — Interpretation</h2>
            <span className="k">Plain English · no verdict, target or recommendation</span>
          </div>
          <hr />
          {result.interpretation.statements.length === 0 ? (
            <p className="note">Not yet available — the interpretation call has not run for this analysis.</p>
          ) : (
            result.interpretation.statements.map((s, i) => <p key={i}>{s.statement}</p>)
          )}
        </section>

        <section id="I2">
          <div className="sechead">
            <h2>I2 — Challenger findings</h2>
            <span className="k">A separate call that did not see the analysis</span>
          </div>
          <hr />
          {result.challenger === null ? (
            <p className="note">Not yet available — the independent challenger call has not completed for this analysis.</p>
          ) : (
            result.challenger.findings.map((f, i) => (
              <div key={i}>
                <p>{f.claimOrFactReference}</p>
                <p className="sub">{f.evidence}</p>
                <p className="sub">{f.whatWouldHaveToBeTrue}</p>
              </div>
            ))
          )}
        </section>

        {/* ============ J ============ */}
        <section id="J">
          <div className="sechead">
            <h2>J — Provisional and unmodelled register</h2>
            <span className="k">Always expanded</span>
          </div>
          <hr />
          <dl className="jreg">
            {Object.entries(policy.provisionalLabels).map(([key, label]) => (
              <div key={key}>
                <dt>{key} — PROVISIONAL</dt>
                <dd>{label}</dd>
              </div>
            ))}
            <div>
              <dt>Undefined policy constants, configured for this run</dt>
              <dd>
                NOPAT tax rate {policy.undefinedConstants.nopatTaxRate !== null ? pct(policy.undefinedConstants.nopatTaxRate) : "unconfigured"} · stress
                margin level {policy.undefinedConstants.stressMarginLevel !== null ? pct(policy.undefinedConstants.stressMarginLevel) : "unconfigured"} ·
                pre-revenue unlevered rate {policy.undefinedConstants.preRevenueUnleveredRate !== null ? pct(policy.undefinedConstants.preRevenueUnleveredRate) : "unconfigured"} · project-debt cost{" "}
                {policy.undefinedConstants.projectDebtCost !== null ? pct(policy.undefinedConstants.projectDebtCost) : "unconfigured"}
              </dd>
            </div>
          </dl>
        </section>

        {/* ============ pre-revenue module ============ */}
        {preRevenue && (
          <section id="PreRevenue">
            <div className="sechead">
              <h2>Pre-revenue module</h2>
              <span className="k">§7.2 M16</span>
            </div>
            <hr />
            <table className="t">
              <tbody>
                <tr>
                  <td>Cash per share</td>
                  <td>
                    <span className="v">${num(preRevenue.cashPerShare)}</span>
                  </td>
                </tr>
                <tr>
                  <td>Quarterly burn / runway</td>
                  <td>
                    <span className="v">
                      ${num(preRevenue.quarterlyBurn, 0)} / {num(preRevenue.runway, 0)} quarters
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    Unit-economics breakeven
                    <div className="sub">evaluated before the scale solve</div>
                  </td>
                  <td>
                    <FigureValue figure={preRevenue.unitEconomicsBreakeven} format={(v) => `$${num(v, 2)}/unit`} />
                  </td>
                </tr>
                <tr>
                  <td>Dilution required (back-loaded reference)</td>
                  <td>
                    <span className="v">${num(preRevenue.dilutionRequired, 0)}</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="t" style={{ marginTop: "20px" }}>
              <thead>
                <tr>
                  <th>Success definition</th>
                  <th>V_success</th>
                  <th>V_fail</th>
                  <th>Implied probability</th>
                </tr>
              </thead>
              <tbody>
                {preRevenue.successDefinitions.map((row, i) => (
                  <tr key={i}>
                    <td>{row.definition}</td>
                    <td>
                      <span className="v">${num(row.vSuccess)}</span>
                    </td>
                    <td>
                      <span className="v">${num(row.vFail)}</span>
                    </td>
                    <td className={row.state.kind !== "probability" ? "state" : undefined}>
                      {row.state.kind === "probability" ? (
                        <span className="v">{pct(row.state.probability, 0)}</span>
                      ) : (
                        <span className="name">{row.state.kind}</span>
                      )}
                      {row.rateCapped && <div className="flag">Rate capped — value is an upper bound</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ============ Investment case at a glance ============ */}
        <section id="atglance">
          <div className="sechead">
            <h2>Investment case — at a glance</h2>
            <span className="k">Synthesis, not a new figure</span>
          </div>
          <hr />
          {preRevenue ? (
            <div className="atglance" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div>
                <span className="lb">Failure — cash floor</span>
                <span className="fig">${num(preRevenue.cashPerShare)}</span>
              </div>
              <div>
                <span className="lb">Success as described</span>
                <span className="fig">{successAsCommonlyDescribedRange(preRevenue)}</span>
              </div>
              <div className="cur">
                <span className="lb">Current price</span>
                <span className="fig">${num(result.price.value)}</span>
              </div>
            </div>
          ) : (
            <div className="atglance">
              <div>
                <span className="lb">Bear</span>
                <span className="fig">{fairValueRange.kind === "range" ? `$${num(fairValueRange.bear, 0)}` : "—"}</span>
              </div>
              <div>
                <span className="lb">Base</span>
                <span className="fig">${num(scenarioOutputs.values.base, 0)}</span>
              </div>
              <div>
                <span className="lb">Bull</span>
                <span className="fig">{fairValueRange.kind === "range" ? `$${num(fairValueRange.bull, 0)}` : "—"}</span>
              </div>
              <div className="cur">
                <span className="lb">Current price</span>
                <span className="fig">${num(result.price.value)}</span>
              </div>
            </div>
          )}
          <p className="closing">
            {states.suppressing.length > 0 || states.qualifying.length > 0
              ? `${states.suppressing.length} state(s) suppress an output; ${states.qualifying.length} flag(s) qualify one. See Section A for what and why.`
              : "No suppressing state or qualifying flag is active for this analysis."}
          </p>
        </section>
      </main>
    </div>
  );
}
