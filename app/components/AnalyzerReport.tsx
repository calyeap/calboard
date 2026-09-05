import { Fragment, type ReactNode } from "react";
import Decimal from "decimal.js";
import { formatUsd } from "@/lib/formatUsd";
import { QuickRead } from "./QuickRead";
import { ValuationStrip } from "./ValuationStrip";
import type {
  AnalysisResult,
  ComputedValue,
  Figure,
  Profile,
  ProvenanceTokens,
  ReverseDcfCell,
  SuccessDefinitionRow,
  SuppressedValue,
} from "@/lib/analyzer/types";

// Milestone 6 — the report renderer. Every figure below comes directly
// from the AnalysisResult passed in; this component computes nothing
// (§10.0.2 rule 3: "No figure appears in the rendered report that is not
// in the result object. The renderer adds formatting and prose; it adds
// no content."). Section order (A-J) is §10.2's, unchanged. Quick Read
// (QuickRead.tsx, ONE dominant reading path — no permanent second column)
// and "Investment case at a glance" are restatement-only: every line is a
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

function points(value: Decimal): string {
  return value.mul(100).toFixed(0);
}

function num(value: Decimal, dp = 2): string {
  return value.toFixed(dp);
}

// "Success as commonly described" is a {low, high} range in the Analysis
// Result itself (types.ts) — the approved OKLO mock shows "$31-$48", never
// one number, for this concept. Pure formatting of that field; no new
// calculation.
function formatRange(range: { low: Decimal; high: Decimal }): string {
  return range.low.equals(range.high) ? `$${num(range.low)}` : `$${num(range.low)} - $${num(range.high)}`;
}

// B3's smaller-batch item: large dollar figures (funding-stack lines,
// dilution) were rendering raw — "$-15800000" — instead of Calboard's own
// house currency format. Reuses the same formatUsd() the Dashboard and
// Holdings tables already use (lib/formatUsd.ts), so this is a formatting
// fix, not a new convention: thousands separators, and the negative sign
// outside the currency symbol rather than between "$" and the digits.
function formatDollarSigned(v: Decimal): string {
  return v.isNegative() ? `−$${formatUsd(v.abs())}` : `$${formatUsd(v)}`;
}

// Finance acronyms that read correctly only in full caps — applied after
// splitting, and independently to any bare occurrence, so both
// "fiveYearDeltaNopat" and a lone "nopat" come out as "NOPAT".
const CAUSE_ACRONYMS = new Set([
  "nopat",
  "nwc",
  "rou",
  "ronic",
  "ev",
  "pvgo",
  "cagr",
  "ttm",
  "fcf",
  "sbc",
  "roic",
  "wc",
]);

// B3 (defect class also fixed in Section J last pass) — a suppressed
// value's `cause` string is module-authored and names its own missing
// REQUIRED input(s) by their internal camelCase field name (§4.2's own
// input lists). This is the one place that translation happens for every
// rendered cause, so the class cannot recur as new modules/sections are
// built — no calculation, gate, threshold or field changes; this only
// reformats a string already in the Analysis Result.
function humanizeCause(cause: string): string {
  const withSpacedWords = cause.replace(/\b[a-z][a-zA-Z0-9]*\b/g, (token) => {
    if (!/[A-Z]/.test(token)) {
      // No internal camel hump — still translate a bare acronym
      // ("nopat" -> "NOPAT"), leave ordinary words ("capex") untouched.
      return CAUSE_ACRONYMS.has(token) ? token.toUpperCase() : token;
    }
    const words = token.split(/(?=[A-Z])/).map((w) => w.toLowerCase());
    return words.map((w) => (CAUSE_ACRONYMS.has(w) ? w.toUpperCase() : w)).join(" ");
  });
  return withSpacedWords;
}

// Same defect class as humanizeCause above, confirmed against both frozen
// mocks (neither shows a "§" or "Appendix" citation anywhere as rendered
// text): policy.ts's calibration notes are internal documentation and
// carry spec/appendix/requirement-ID citations inline — e.g. "(§7.1,
// §10.4)", "(Appendix B)", "(I16)" — that were never meant as report copy.
// Strips only the parenthetical citation itself, keeping the surrounding
// sentence (which is genuine, already-computed calibration content).
function stripInternalCitations(text: string): string {
  return text
    .replace(/\s*\([^)]*(?:§|Appendix|\bI\d+\b)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// C2 — scenario keys are internal identifiers, same defect class as B3's
// camelCase and C3's raw profile enum. Both mocks capitalize these
// wherever they appear as a label rather than in prose (the "at a
// glance" box, Section H's range-bar) — "Bear" / "Base" / "Bull", never
// the raw lowercase key.
const SCENARIO_LABELS: Record<"bear" | "base" | "bull", string> = {
  bear: "Bear",
  base: "Base",
  bull: "Bull",
};

// C3 — same defect class: Section A rendered the raw Profile enum. Both
// mocks' own profileline gives the wording verbatim for the two profiles
// they cover; the other two are not in either mock, so their wording is
// lifted from the functional spec's own table (§1) rather than invented.
// The confirm/override control itself is Milestone 7 (not built) — this
// only translates the two enum values the existing conditional already
// reads, not the confirm/override UI.
const PROFILE_LABELS: Record<Profile, string> = {
  MATURE_PROFITABLE_STABLE_FCF: "mature, profitable, stable FCF",
  HIGH_GROWTH_PROFITABLE_UNCERTAIN_DURABILITY: "high-growth, profitable, uncertain durability",
  PRE_REVENUE_UNPROFITABLE: "pre-revenue / unprofitable",
  ASSET_BASED: "asset-based",
};

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

function sourceClassLabel(v: ProvenanceTokens["sourceClass"]): string {
  return v === "SECONDARY" ? "Secondary" : "Primary";
}
function extractionTypeLabel(v: ProvenanceTokens["extractionType"]): string {
  return v === "AI-EXTRACTED" ? "AI-extracted" : "Deterministic/structured";
}
function verificationStateLabel(v: ProvenanceTokens["verificationState"]): string {
  if (v === "VERIFIED") return "Verified";
  return v === "UNVERIFIED" ? "Unverified" : "Spot-check pending";
}

// D1 — R4 rules the full three-token stamp always renders in Section B
// ("Primary · Deterministic/structured · Verified" even when every token
// is default), while every other call site keeps R4's own omission rule
// (non-default tokens only). `full` is Section B's own opt-in, not a
// change to the default-hiding behaviour anywhere else. Per-token styling
// is unchanged either way — both mocks' own Section B markup gives
// AI-EXTRACTED alone the distinct `.ai` treatment; a defaulted or
// SECONDARY/UNVERIFIED token is plain text in the frozen mocks too, its
// distinctness carried by the word itself, not an extra style.
function ProvenanceMarks({ tokens, full = false }: { tokens: ProvenanceTokens; full?: boolean }) {
  if (full) {
    return (
      <div className="prov">
        <span>{sourceClassLabel(tokens.sourceClass)}</span>
        <span className="sep">·</span>
        <span className={tokens.extractionType === "AI-EXTRACTED" ? "ai" : undefined}>
          {extractionTypeLabel(tokens.extractionType)}
        </span>
        <span className="sep">·</span>
        <span>{verificationStateLabel(tokens.verificationState)}</span>
      </div>
    );
  }
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

// §17.12 disclosure component — restored (defect B7). One mechanism used
// wherever this interaction appears in the report body: visible chevron,
// entire row is the click target, sentence-case label. Text is ported
// verbatim from the frozen mock's own working examples; nothing here is a
// new explanation invented for a section the mock doesn't cover.
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="disclose">
      <summary>
        <span className="lbl">{label}</span>
      </summary>
      <div className="body">{children}</div>
    </details>
  );
}

function StateBlock({ figure }: { figure: SuppressedValue }) {
  return (
    <div className="state">
      <span className="name">{figure.state}</span>
      <span className="cause">{humanizeCause(figure.cause)}</span>
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
        <span className="cause">{humanizeCause(cell.fiveYearGrowth.cause)}</span>
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

interface ProvisionalRow {
  key: string;
  label: string;
  impact: string;
  detail: string;
}

// Section J (§10.6, defects 4-6) — every row restates a field already in
// the AnalysisResult: the constant's own value (result.policy.constants,
// for the plain-English label with units — never the raw PolicyConstants
// key), its calibration note (result.policy.provisionalLabels, for the
// detail line) and, where a row's relevance depends on this particular
// run, an already-computed existence check (never a "N of M" count — that
// pattern is reserved for outside Quick Read; here it is fine because
// Section A's own manifest already prints counts like "4 of 9").
//
// Curated, not a blanket dump of every PolicyConstants key: a threshold
// whose diagnostic did not run for this profile is not "in force" for this
// analysis, so it does not belong in this run's disclosure register
// (§10.6's "every PROVISIONAL threshold" means every one actually
// exercised, not the full policy-wide list regardless of relevance).
function buildProvisionalRegister(result: AnalysisResult): ProvisionalRow[] {
  const { policy, preRevenue, states, gates } = result;
  const c = policy.constants;
  const rows: ProvisionalRow[] = [];

  if (preRevenue !== null) {
    rows.push({
      key: "preRevenueConstructionLeadYears",
      label: `Construction lead fixed at ${c.preRevenueConstructionLeadYears} years — PROVISIONAL`,
      impact: "first-order",
      detail: stripInternalCitations(policy.provisionalLabels.preRevenueConstructionLeadYears ?? ""),
    });
  } else {
    rows.push({
      key: "terminalRoicPremium",
      label: `Terminal ROIC = r + ${points(c.terminalRoicPremium)} percentage points — PROVISIONAL`,
      impact: "assumed for every company",
      detail: stripInternalCitations(policy.provisionalLabels.terminalRoicPremium ?? ""),
    });
    rows.push({
      key: "gate0InterestIncomeOverRevenueThreshold",
      label: `Gate 0 interest-income test > ${pct(c.gate0InterestIncomeOverRevenueThreshold, 0)} of revenue — PROVISIONAL`,
      impact: "no observations",
      detail: stripInternalCitations(policy.provisionalLabels.gate0InterestIncomeOverRevenueThreshold ?? ""),
    });
    rows.push({
      key: "runRateSequentialGrowthTrigger",
      label: `Run-rate sequential trigger ~${pct(c.runRateSequentialGrowthTrigger, 0)} — PROVISIONAL`,
      impact: "calibrated on one company",
      detail: stripInternalCitations(policy.provisionalLabels.runRateSequentialGrowthTrigger ?? ""),
    });
    // Restored (defect B6) — triggerAMarginProximityPoints and
    // triggerAWindowRangePoints are real PolicyConstants fields already in
    // the Analysis Result; only surfaced here once the trigger they gate
    // has actually fired for this run (same "only when exercised" curation
    // rule as leveredCostOfEquityCap above).
    if (gates.triggerA.fired || gates.triggerB.fired) {
      rows.push({
        key: "triggerAThresholds",
        label: `Trigger A thresholds — ${points(c.triggerAMarginProximityPoints)} points of window maximum, ${points(
          c.triggerAWindowRangePoints
        )}-point window range`,
        impact: "red-team judgment",
        detail: "Provisional — no observations behind either threshold.",
      });
    }
  }

  const anyRateCapped =
    (preRevenue !== null && preRevenue.successDefinitions.some((d) => d.rateCapped)) ||
    states.qualifying.some((q) => q.flag === "RATE CAPPED — VALUE IS AN UPPER BOUND");
  if (anyRateCapped) {
    rows.push({
      key: "leveredCostOfEquityCap",
      label: `Levered cost-of-equity cap at ${pct(c.leveredCostOfEquityCap, 0)} — PROVISIONAL`,
      impact: "binds on one or more cases",
      detail: stripInternalCitations(policy.provisionalLabels.leveredCostOfEquityCap ?? ""),
    });
  }

  rows.push({
    key: "gate1Thresholds",
    label: `Gate 1 thresholds — <${c.gate1HistoryInsufficientYears} / ${c.gate1HistoryInsufficientYears}-${c.gate1ShortHistoryYears} filed years — PROVISIONAL`,
    impact: "no observations",
    detail: "Direction of error is suppression.",
  });

  rows.push({
    key: "undefinedConstants",
    label: "Undefined policy constants, configured for this run",
    impact: String(Object.keys(policy.undefinedConstants).length),
    detail: "NOPAT tax rate · stress margin level · pre-revenue unlevered rate · project-debt cost",
  });

  rows.push({
    key: "namedUnmodelledRisks",
    label: "Named unmodelled risks",
    impact: "debt availability",
    detail: "Debt share is removed from the sensitivity table — value-neutral by construction.",
  });

  return rows;
}

export function AnalyzerReport({ result }: { result: AnalysisResult }) {
  const { gates, states, diagnostics, priceImplied, scenarios, scenarioOutputs, fairValueRange, preRevenue } = result;

  // Section H's right column restates the r = 8%, current-margin cell —
  // the same cell Section E's own base case reads from.
  const baseRateCell = priceImplied.reverseDcfGrid.find((c) => c.marginLevel === "current" && c.rate === 0.08);
  // Purely a marker position on the range bar, clamped to the bar's own
  // 0-100 extent — priceLocationWithinRange itself is the already-computed
  // field (confirmed correct; B1 is isolated to weightedDistribution).
  const weightedPositionPct =
    fairValueRange.kind === "range"
      ? Math.min(100, Math.max(0, scenarioOutputs.priceLocationWithinRange.mul(100).toNumber()))
      : 0;

  return (
    <div className="layout">
      <main>
        <QuickRead result={result} />

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
            Profile: {PROFILE_LABELS[result.profile.confirmedOrOverridden]}
            {result.profile.recommended !== result.profile.confirmedOrOverridden &&
              ` (software recommended ${PROFILE_LABELS[result.profile.recommended]})`}
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
          {/* Placement judgment call (report-back, B7): the mock nests this
              disclosure inside Section A's own interpretive "why it
              matters" narrative, which does not exist in this build yet
              (that prose requires Milestone 8's interpretation layer, per
              this file's own top-of-file note). Its text is fully generic
              policy configuration, not company-specific, so it is placed
              here at the end of Section A rather than skipped — the
              concept it explains (the fixed 8/10/12% rate grid) is read by
              Section D's RONIC ladder and Section E's grid alike. */}
          <Disclosure label="What is a discount rate?">
            The rate used to convert future cash into today&apos;s money. A higher rate means future cash is worth
            less today, so it produces a lower valuation and demands more growth to justify a given price. Calboard
            runs every company at 8%, 10% and 12% from policy configuration — the rate is never chosen per company
            and never chosen by the interpretation layer.
          </Disclosure>
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
                    <ProvenanceMarks
                      tokens={{ sourceClass: f.sourceClass, extractionType: f.extractionType, verificationState: f.verificationState }}
                      full
                    />
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
                <td>Leverage precondition{preRevenue && " — company today"}</td>
                <td>
                  <span className="v">{gates.leverage.result}</span>
                  {gates.leverage.netDebtRatio !== null && <div className="sub">net debt ratio {pct(gates.leverage.netDebtRatio)}</div>}
                  {gates.leverage.operatingLeaseInclusiveMemo !== null && (
                    <div className="sub">operating-lease-inclusive memo {pct(gates.leverage.operatingLeaseInclusiveMemo)}</div>
                  )}
                </td>
              </tr>
              {preRevenue && gates.leverage.leveredResidualExceptionApplies && (
                <tr>
                  <td>Leverage precondition — success cases</td>
                  <td>
                    <div className="sub">
                      A success-case cash flow is a residual after debt and is levered by construction — the levered-residual exception
                      applies. This does not change the company-level result above; it lets each success definition's own levered cost of
                      equity (below, per definition) proceed instead of being refused.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ============ D ============ */}
        <section id="D">
          <div className="sechead">
            <h2>D — Deterministic diagnostics</h2>
            <span className="k">M1–M14 · extract shown</span>
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
                <td>Reinvestment, RONIC (5yr)</td>
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
                  <div className="sub">current fiscal year, year-over-year</div>
                </td>
                <td>
                  <FigureValue figure={diagnostics.impliedReturnOnNewCapital.value} format={pct} />
                </td>
              </tr>
              <tr>
                <td>Margin history</td>
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
                  <div className="sub">conditional output</div>
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
                <td>Run-rate comparison</td>
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

          {(gates.triggerA.fired || gates.triggerB.fired) && (
            <Disclosure label="Why one flag fired and the other did not">
              {/* Ported verbatim from mock-report-msft.html's own disclosure
                  — its generic, definitional sentences only. The mock's
                  closing two sentences are Microsoft-specific narrative
                  ("Microsoft fires the first and not the second. A
                  software company..."), which this component cannot repeat
                  verbatim for any other company without misstating it, and
                  inventing a paraphrase is exactly what this restoration is
                  not supposed to do (report-back). */}
              Two tests are evaluated separately because they make different claims. <b>Margin at historical high</b>{" "}
              is a description: the current margin is at or near the window maximum and the window is wide.{" "}
              <b>Cyclical</b> is a claim about the business: it requires an actual single-year margin collapse in the
              record.
            </Disclosure>
          )}

          {/* Pre-revenue (M16) presentation stays IN Section D, matching
              the approved OKLO mock's own structure: three repeated
              "D — ..." sub-blocks (implied probability of success; unit
              economics and the scale solve; funding stack), never a new
              top-level section after J. */}
          {preRevenue && (
            <>
              <div className="sechead" style={{ marginTop: "32px" }}>
                <h2>D — Implied probability of success</h2>
                <span className="k">Per definition · never one number</span>
              </div>
              <hr />
              <table className="t">
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

              <div className="sechead" style={{ marginTop: "32px" }}>
                <h2>D — Unit economics and the scale solve</h2>
                <span className="k">Breakeven runs before the solve</span>
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
                      <span className="v">{formatDollarSigned(preRevenue.dilutionRequired)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="sechead" style={{ marginTop: "32px" }}>
                <h2>D — Funding stack</h2>
                <span className="k">Four lines · solved year by year · both ramps</span>
              </div>
              <hr />
              {(["back_loaded", "steady"] as const).map((ramp) => (
                <table className="t" key={ramp} style={{ marginBottom: "16px" }}>
                  <caption style={{ textAlign: "left", fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
                    {ramp === "back_loaded" ? "Back-loaded — conservative, and the reference" : "Steady"}
                  </caption>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Project debt</th>
                      <th>Customer prepayments</th>
                      <th>Retained OCF</th>
                      <th>New equity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preRevenue.fundingStackByYear[ramp].map((y) => {
                      const line = (name: string) => y.lines.find((l) => l.line === name);
                      const debt = line("project_debt");
                      const prepay = line("customer_prepayments");
                      const ocf = line("retained_operating_cash_flow");
                      const equity = line("new_equity");
                      return (
                        <tr key={y.year}>
                          <td>{y.year}</td>
                          <td>
                            <span className="v">{debt?.line === "project_debt" ? `${pct(debt.shareOfCapex, 0)} of capex` : "—"}</span>
                          </td>
                          <td>
                            <span className="v">
                              {prepay?.line === "customer_prepayments" ? formatDollarSigned(prepay.amount) : "—"}
                            </span>
                          </td>
                          <td>
                            <span className="v">
                              {ocf?.line === "retained_operating_cash_flow" ? formatDollarSigned(ocf.amount) : "—"}
                            </span>
                          </td>
                          <td>
                            <span className="v">
                              {equity?.line === "new_equity" ? formatDollarSigned(equity.amount) : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </>
          )}
        </section>

        {/* ============ E ============ */}
        <section id="E">
          <div className="sechead">
            <h2>E — Price-implied diagnostics</h2>
            <span className="k">Diagnostic reverse DCF · 3 margin levels x 3 rates</span>
          </div>
          <hr />
          <Disclosure label="What is a reverse DCF, and why nine cells?">
            A normal discounted-cash-flow model takes your growth assumption and produces a value. A reverse DCF
            takes the market&apos;s value — the price — and produces the growth assumption it implies. It removes
            the step where the analyst&apos;s own optimism enters the arithmetic. Nine cells because two things must
            be varied that materially change the answer: the discount rate (8%, 10%, 12%) and the profit margin
            being projected (current, ten-year median, a stress level). One cell would hide how sensitive the answer
            is to both.
          </Disclosure>
          <Disclosure label="See calculation — PVGO">
            Steady-state EV = median-margin NOPAT ÷ discount rate. PVGO = current EV − steady-state EV, EV to EV. The
            PVGO share is that difference over current EV.{" "}
            {priceImplied.nopatGap !== null &&
              "Because trigger A or B fired, PVGO is also shown on current NOPAT beside median-margin NOPAT, and the gap between them is printed — a margin at its own historical high makes the two materially different."}
          </Disclosure>
          <Disclosure label="What is PVGO?">
            Present Value of Growth Opportunities. Split the company&apos;s value in two: what it would be worth if
            it simply carried on at its current profit level forever, and everything above that. The second part is
            PVGO — the share of today&apos;s price that is a bet on growth that has not happened yet. A high share
            is not a warning by itself; it means the valuation is more sensitive to whether growth and returns on
            new investment hold up.
          </Disclosure>
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
                      {SCENARIO_LABELS[s]}
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
              <span className="cause">{humanizeCause(fairValueRange.cause)}</span>
            </div>
          ) : fairValueRange.kind === "pre-revenue-distribution" ? (
            <div className="hframe">
              <div>
                <h3>Distribution summary</h3>
                <p className="sub2">What you assume · not compressed to bounds</p>
                <div className="dist">
                  <div className="r">
                    <span className="lbl">Failure</span>
                    <b>${num(fairValueRange.failure)}</b>
                  </div>
                  <div className="r">
                    <span className="lbl">Success as commonly described</span>
                    <b>{formatRange(fairValueRange.successAsCommonlyDescribed)}</b>
                  </div>
                  <div className="r">
                    <span className="lbl">Success as the price requires</span>
                    <b>${num(fairValueRange.successAsPriceRequires)}</b>
                  </div>
                </div>
                <p className="floor">Cash floor ${num(fairValueRange.cashFloor)} per current share.</p>
                <span className="inference">Inference</span>
                {/* No "driven by" line here — unlike the range variant,
                    FairValueRange's pre-revenue-distribution member carries
                    no drivingInputs field to restate (types.ts). The mock's
                    "capacity ramp shape · capex per unit of capacity · exit
                    multiple assumption" line has no Analysis Result field
                    behind it; omitted rather than invented (report-back). */}
              </div>
              <div>
                <h3>What the price assumes</h3>
                <p className="sub2">Restated from Section E</p>
                {preRevenue &&
                  preRevenue.successDefinitions
                    .filter(
                      (d): d is SuccessDefinitionRow & { state: { kind: "probability"; probability: Decimal } } =>
                        d.state.kind === "probability"
                    )
                    .map((d, i) => (
                      <div className="pi" key={i}>
                        <span className="lbl">Implied probability, {d.definition}</span>
                        <b>{pct(d.state.probability, 0)}</b>
                      </div>
                    ))}
                {preRevenue && (
                  <div className="pi">
                    <span className="lbl">Success definitions returning a state</span>
                    <b>
                      {preRevenue.successDefinitions.filter((d) => d.state.kind !== "probability").length} of{" "}
                      {preRevenue.successDefinitions.length}
                    </b>
                  </div>
                )}
                {preRevenue && (
                  <div className="pi" style={{ borderBottom: 0 }}>
                    <span className="lbl">Dilution required (back-loaded reference)</span>
                    <b>{formatDollarSigned(preRevenue.dilutionRequired)}</b>
                  </div>
                )}
                <p className="note" style={{ marginTop: "14px" }}>
                  The range says what you assume; the diagnostics say what the market assumes. Neither is shown
                  alone.
                </p>
              </div>
            </div>
          ) : (
            <div className="hframe">
              <div>
                <h3>Fair-value range</h3>
                <p className="sub2">What you assume</p>
                <div className="rangebar">
                  <span className="lab" style={{ left: 0 }}>
                    Bear
                  </span>
                  <span className="lab" style={{ right: 0 }}>
                    Bull
                  </span>
                  <span
                    className="lab"
                    style={{ left: `${weightedPositionPct}%`, transform: "translateX(-50%)" }}
                  >
                    Weighted
                  </span>
                  <span className="dot" style={{ left: `${weightedPositionPct}%` }} />
                </div>
                <div className="rangeends">
                  <span>${num(fairValueRange.bear, 0)}</span>
                  <span>${num(fairValueRange.bull, 0)}</span>
                </div>
                <span className="inference">Inference</span>
                <p className="drivers">Driven by: {fairValueRange.drivingInputs.join(" · ")}.</p>
                {fairValueRange.scenarioLabelsWarning && (
                  <div className="warn">Trigger A or B has fired. The bounds are scenario labels, not confidence bounds.</div>
                )}
              </div>
              <div>
                <h3>What the price assumes</h3>
                <p className="sub2">Restated from Section E</p>
                {baseRateCell && (
                  <>
                    <div className="pi">
                      <span className="lbl">Implied growth, yrs 1-5 at r = 8%</span>
                      {baseRateCell.fiveYearGrowth.suppressed ? (
                        <b>{baseRateCell.fiveYearGrowth.state}</b>
                      ) : (
                        <b>{pct(baseRateCell.fiveYearGrowth.value)}</b>
                      )}
                    </div>
                    <div className="pi">
                      <span className="lbl">Equivalent ten-year CAGR</span>
                      {baseRateCell.tenYearCagr.suppressed ? (
                        <b>{baseRateCell.tenYearCagr.state}</b>
                      ) : (
                        <b>{pct(baseRateCell.tenYearCagr.value)}</b>
                      )}
                    </div>
                  </>
                )}
                {/* "Own ten-year revenue CAGR" (mock) has no Analysis Result
                    field behind it — no module computes or stores the
                    company's own historical revenue CAGR anywhere in
                    DiagnosticsResult or elsewhere in types.ts. Omitted
                    rather than invented (report-back). */}
                <div className="pi">
                  <span className="lbl">PVGO share of EV</span>
                  <FigureValue figure={priceImplied.pvgoShareOfEv} format={pct} />
                </div>
                <div className="pi">
                  <span className="lbl">RONIC</span>
                  <FigureValue figure={diagnostics.impliedReturnOnNewCapital.value} format={pct} />
                </div>
                <div className="pi" style={{ borderBottom: 0 }}>
                  <span className="lbl">Reverse-DCF cells returning a state</span>
                  <b>
                    {priceImplied.reverseDcfGrid.filter((c) => c.fiveYearGrowth.suppressed).length} of{" "}
                    {priceImplied.reverseDcfGrid.length}
                  </b>
                </div>
                <p className="note" style={{ marginTop: "14px" }}>
                  The range says what you assume; the diagnostics say what the market assumes. Neither is shown
                  alone.
                </p>
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
          <table className="t">
            <tbody>
              {buildProvisionalRegister(result).map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>
                    <span className="v">{row.impact}</span>
                    <div className="sub">{row.detail}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>


        {/* ============ Investment case at a glance ============ */}
        <section id="atglance">
          <div className="sechead">
            <h2>Investment case — at a glance</h2>
            <span className="k">Synthesis, not a new figure</span>
          </div>
          <hr />
          <ValuationStrip result={result} />
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
