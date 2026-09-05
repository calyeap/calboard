import type { ReactNode } from "react";
import Decimal from "decimal.js";
import type { AnalysisResult, Profile, SuppressingState } from "@/lib/analyzer/types";
import { ValuationStrip } from "./ValuationStrip";

// IA-audit restoration (2026-09-05) — Quick Read matches §17.16 exactly:
// eight items, always visible, one component (no "Learn more" drawer —
// §17.12: "QUICK READ / the finding block, always visible"). A state or
// flag that qualifies or suppresses an output travels with the item it
// belongs to; it is never one click away behind a disclosure.
//
// Everything below restates a field already computed elsewhere in the
// AnalysisResult (§10.0.2 rule 3 applies here too, even though Quick Read
// sits outside §10.2's own section list) — no new calculation, score,
// verdict or AI call. No "N of M" ratio is manufactured anywhere in this
// file — that count is not itself a field anywhere in the Analysis Result
// (only each cell/definition's own state is), so only existence checks
// (`.some`) are used, never a count (Quick Read contract check).

const PROFILE_LABELS: Record<Profile, string> = {
  MATURE_PROFITABLE_STABLE_FCF: "mature, profitable, stable free cash flow",
  HIGH_GROWTH_PROFITABLE_UNCERTAIN_DURABILITY: "high-growth, profitable, uncertain durability",
  PRE_REVENUE_UNPROFITABLE: "pre-revenue / unprofitable",
  ASSET_BASED: "asset-based",
};

// Best-effort section reference for a suppressing/qualifying state's own
// `appliesTo` text, so a consolidated Quick Read line can still point the
// reader at the full detail — never required, only a convenience.
function sectionRefFor(appliesTo: string): string | null {
  const a = appliesTo.toLowerCase();
  if (a.includes("reverse-dcf")) return "E";
  if (a.includes("fcf yield")) return "D";
  if (a.includes("own-history") || a.includes("history-based")) return "D";
  if (a.includes("all valuation outputs")) return "C";
  if (a.includes("rate-dependent")) return "C";
  if (a.includes("margin")) return "D";
  return null;
}

interface ConsolidatedState {
  state: SuppressingState;
  sectionRef: string | null;
}

// Collapses repeated identical states (e.g. several DEGENERATE reverse-DCF
// cells) into one line each — never dumping the same state name once per
// row.
function consolidateStates(suppressing: AnalysisResult["states"]["suppressing"]): ConsolidatedState[] {
  const seen = new Map<SuppressingState, string | null>();
  for (const s of suppressing) {
    if (!seen.has(s.state)) {
      seen.set(s.state, sectionRefFor(s.appliesTo));
    }
  }
  return Array.from(seen.entries()).map(([state, sectionRef]) => ({ state, sectionRef }));
}

function formatDollar(v: Decimal): string {
  return `$${v.toFixed(2)}`;
}
function formatPct(v: Decimal, dp = 1): string {
  return `${v.mul(100).toFixed(dp)}%`;
}

function SecLink({ id, children }: { id: string; children: ReactNode }) {
  return <a href={`#${id}`}>{children}</a>;
}

interface QuickReadItem {
  label: string;
  body: ReactNode;
}

// --- Item 8, "Data and model quality" -------------------------------------
// Material suppression, qualification and provenance issues — not the whole
// register (§17.16). This is the content that used to live behind the
// single "Learn more" drawer; it is the same restatement, just always
// visible under its own named item instead of hidden behind a disclosure.
function dataAndModelQualityItem(result: AnalysisResult): ReactNode {
  const { states } = result;
  const consolidated = consolidateStates(states.suppressing);
  const anyNonDefaultProvenanceFact = result.facts.some(
    (f) => f.sourceClass === "SECONDARY" || f.extractionType === "AI-EXTRACTED" || f.verificationState !== "VERIFIED"
  );
  const bullets: ReactNode[] = [
    ...consolidated.map((c) => (
      <li key={`s-${c.state}`}>
        Output(s) return <b>{c.state}</b>
        {c.sectionRef ? (
          <>
            {" — see "}
            <SecLink id={c.sectionRef}>Section {c.sectionRef}</SecLink>
          </>
        ) : (
          "."
        )}
      </li>
    )),
    ...states.qualifying.map((q, i) => (
      <li key={`q-${i}`}>
        <b>{q.flag}</b> — {q.appliesTo}.
      </li>
    )),
    ...(anyNonDefaultProvenanceFact
      ? [
          <li key="prov">
            One or more facts in <SecLink id="B">Section B</SecLink> carry a non-default provenance marker
            (secondary source, AI-extracted, or unverified).
          </li>,
        ]
      : []),
  ];
  if (bullets.length === 0) {
    return <p className="t">No suppressing state or qualifying flag is active for this analysis.</p>;
  }
  return <ul>{bullets}</ul>;
}

// --- Item 7, "Strongest challenger point" ---------------------------------
function challengerItem(result: AnalysisResult): ReactNode {
  if (result.challenger === null) {
    return (
      <p className="t">
        Findings from the independent challenger call appear in <SecLink id="I2">Section I2</SecLink>, unreconciled
        with the analysis above, once that call completes.
      </p>
    );
  }
  const first = result.challenger.findings[0];
  if (!first) {
    return (
      <p className="t">
        The independent challenger call completed with no findings recorded — see <SecLink id="I2">Section I2</SecLink>.
      </p>
    );
  }
  return (
    <p className="t">
      {first.claimOrFactReference} — see <SecLink id="I2">Section I2</SecLink>, unreconciled with the analysis above.
    </p>
  );
}

function buildQuickRead(result: AnalysisResult): QuickReadItem[] {
  const { gates, states, priceImplied, preRevenue, fairValueRange, scenarioOutputs } = result;
  const marginAtHigh = states.qualifying.some((q) => q.flag === "MARGIN AT HISTORICAL HIGH");

  const challengerItemBody = challengerItem(result);
  const dataQualityBody = dataAndModelQualityItem(result);

  // --- Gate/leverage refusal takes priority over everything else -------
  if (gates.gate0.result !== "PASS") {
    return [
      {
        label: "Main finding",
        body: (
          <p className="qlead">
            Calboard cannot value {result.companyName} with this method — <b>{gates.gate0.result}</b> (
            <SecLink id="C">Section C</SecLink>).
          </p>
        ),
      },
      {
        label: "Price vs scenarios",
        body: (
          <p className="t">
            Every price-implied and scenario output is suppressed under this state — see <SecLink id="H">Section H</SecLink>.
          </p>
        ),
      },
      {
        label: "What today's price requires",
        body: <p className="t">Not shown — no valuation output survives this gate. See <SecLink id="C">Section C</SecLink>.</p>,
      },
      {
        label: "What supports the case",
        body: (
          <p className="t">
            Facts, and whatever multiples and history diagnostics remain arithmetically defined, are still shown —
            see <SecLink id="D">Section D</SecLink>.
          </p>
        ),
      },
      {
        label: "What worries Calboard",
        body: (
          <p className="t">
            The gate refuses outright rather than producing a confident-looking answer from the wrong model — see{" "}
            <SecLink id="C">Section C</SecLink>.
          </p>
        ),
      },
      {
        label: "Biggest uncertainty",
        body: (
          <p className="t">
            Whether the classification itself is right — see <SecLink id="C">Section C</SecLink> for the exact test
            that fired.
          </p>
        ),
      },
      { label: "Strongest challenger point", body: challengerItemBody },
      { label: "Data and model quality", body: dataQualityBody },
    ];
  }

  if (gates.leverage.result === "LEVERAGE UNSUPPORTED IN v1" && preRevenue === null) {
    return [
      {
        label: "Main finding",
        body: (
          <p className="qlead">
            The leverage precondition fails for {result.companyName}, so every rate-dependent output here is
            suppressed (<b>LEVERAGE UNSUPPORTED IN v1</b> — <SecLink id="C">Section C</SecLink>).
          </p>
        ),
      },
      {
        label: "Price vs scenarios",
        body: (
          <p className="t">
            The fair-value range is suppressed under this state — see <SecLink id="H">Section H</SecLink>.
          </p>
        ),
      },
      {
        label: "What today's price requires",
        body: (
          <p className="t">
            Not shown — the reverse-DCF grid, steady-state EV/PVGO, implied exit multiple and the fair-value range
            are all suppressed. See <SecLink id="E">Section E</SecLink>.
          </p>
        ),
      },
      {
        label: "What supports the case",
        body: (
          <p className="t">
            Facts and whatever diagnostics do not depend on the levered structure remain shown — see{" "}
            <SecLink id="D">Section D</SecLink>.
          </p>
        ),
      },
      {
        label: "What worries Calboard",
        body: (
          <p className="t">
            A capital structure this levered can no longer be treated as a straightforward unlevered claim — see{" "}
            <SecLink id="C">Section C</SecLink>.
          </p>
        ),
      },
      {
        label: "Biggest uncertainty",
        body: (
          <p className="t">
            The net debt ratio itself and whether it is likely to change — see <SecLink id="C">Section C</SecLink>.
          </p>
        ),
      },
      { label: "Strongest challenger point", body: challengerItemBody },
      { label: "Data and model quality", body: dataQualityBody },
    ];
  }

  // --- Pre-revenue --------------------------------------------------------
  if (preRevenue !== null && fairValueRange.kind === "pre-revenue-distribution") {
    const anyWorthLessThanFailure = preRevenue.successDefinitions.some(
      (d) => d.state.kind === "THIS SUCCESS IS WORTH LESS THAN FAILURE"
    );
    const anyRateCapped = preRevenue.successDefinitions.some((d) => d.rateCapped);
    const anyClearsFloor = preRevenue.successDefinitions.some((d) => d.vSuccess.greaterThan(fairValueRange.cashFloor));
    const range = fairValueRange.successAsCommonlyDescribed;
    const rangeText = range.low.equals(range.high)
      ? formatDollar(range.low)
      : `${formatDollar(range.low)}-${formatDollar(range.high)}`;

    return [
      {
        label: "Main finding",
        body: (
          <p className="qlead">
            {anyWorthLessThanFailure ? (
              <>
                On one or more of the modelled ways {result.companyName} could succeed, shareholders would end up
                with less than if it simply held its cash (<b>THIS SUCCESS IS WORTH LESS THAN FAILURE</b>) — see{" "}
                <SecLink id="D">Section D</SecLink> for which.
              </>
            ) : (
              <>
                Every modelled way {result.companyName} could succeed is worth more than simply holding its cash —
                none returns THIS SUCCESS IS WORTH LESS THAN FAILURE.
              </>
            )}
          </p>
        ),
      },
      {
        label: "Price vs scenarios",
        body: (
          <p className="t">
            Not a bear-bull range. The outcomes are separate worlds, so the output is a distribution: failure{" "}
            {formatDollar(fairValueRange.failure)}, success as commonly described {rangeText}.{" "}
            <SecLink id="H">Section H</SecLink>
          </p>
        ),
      },
      {
        label: "What today's price requires",
        body: (
          <p className="t">
            Success as today&apos;s price requires is {formatDollar(fairValueRange.successAsPriceRequires)} per
            share. <SecLink id="H">Section H</SecLink>
          </p>
        ),
      },
      {
        label: "What supports the case",
        body: (
          <ul>
            <li>
              A cash floor of {formatDollar(fairValueRange.cashFloor)} per share that does not depend on{" "}
              {result.companyName}&apos;s operations succeeding — <SecLink id="H">Section H</SecLink>
            </li>
            {anyClearsFloor && (
              <li>
                At least one modelled success clears the cash floor by a wide margin —{" "}
                <SecLink id="D">Section D</SecLink>
              </li>
            )}
          </ul>
        ),
      },
      {
        label: "What worries Calboard",
        body: (
          <ul>
            {anyWorthLessThanFailure && (
              <li>
                One or more success definitions return <b>THIS SUCCESS IS WORTH LESS THAN FAILURE</b> — a finding,
                not an error. <SecLink id="D">Section D</SecLink>
              </li>
            )}
            {anyRateCapped && (
              <li>
                The levered cost-of-equity cap binds on one or more success definitions (
                <b>RATE CAPPED — VALUE IS AN UPPER BOUND</b>), so those values are upper bounds —{" "}
                <SecLink id="D">Section D</SecLink>
              </li>
            )}
            {!anyWorthLessThanFailure && !anyRateCapped && <li>No value-level concern is active for this analysis.</li>}
          </ul>
        ),
      },
      {
        label: "Biggest uncertainty",
        body: (
          <p className="t">
            The capacity ramp shape used in the funding stack — back-loaded versus steady moves the same success
            case's value. <SecLink id="D">Section D</SecLink>
          </p>
        ),
      },
      { label: "Strongest challenger point", body: challengerItemBody },
      { label: "Data and model quality", body: dataQualityBody },
    ];
  }

  // --- Mature / high-growth (reverse-DCF applies) -------------------------
  const cleanCell = priceImplied.reverseDcfGrid.find((c) => !c.fiveYearGrowth.suppressed && !c.tenYearCagr.suppressed);
  const anyDegenerateCell = priceImplied.reverseDcfGrid.some(
    (c) => c.fiveYearGrowth.suppressed && c.fiveYearGrowth.state === "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE"
  );
  const ronic = result.diagnostics.impliedReturnOnNewCapital.value;
  const ronicAboveEveryRate =
    !ronic.suppressed && result.policy.constants.rateGrid.every((r) => ronic.value.greaterThan(r));

  const growthLine =
    cleanCell && !cleanCell.fiveYearGrowth.suppressed && !cleanCell.tenYearCagr.suppressed
      ? `Today's price implies roughly ${formatPct(cleanCell.tenYearCagr.value)} annual growth over ten years (${formatPct(
          cleanCell.fiveYearGrowth.value
        )} for the next five, at the ${cleanCell.marginLevel} margin and ${formatPct(new Decimal(cleanCell.rate), 0)} discount rate).`
      : "The reverse-DCF grid does not resolve to a usable growth figure at this run's inputs.";

  const inRange = fairValueRange.kind === "range" ? scenarioOutputs.priceLocationWithinRange : null;
  const insideRange = inRange !== null && inRange.greaterThanOrEqualTo(0) && inRange.lessThanOrEqualTo(1);

  return [
    {
      label: "Main finding",
      body: (
        <p className="qlead">
          {growthLine}{" "}
          {anyDegenerateCell && (
            <>
              One or more reverse-DCF scenarios return no number at all (
              <b>DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE</b>) rather than a misleading one — see{" "}
              <SecLink id="E">Section E</SecLink> for which.
            </>
          )}
        </p>
      ),
    },
    {
      label: "Price vs scenarios",
      body: fairValueRange.kind === "range" ? (
        <p className="t">
          {insideRange ? "Inside" : "Outside"} the authored bear-bull range, with the weighted value shown inside the
          range rather than as a headline
          {fairValueRange.scenarioLabelsWarning && " (the bounds are scenario labels, not confidence bounds)"}.{" "}
          <SecLink id="H">Section H</SecLink>
        </p>
      ) : (
        <p className="t">
          The fair-value range is suppressed — see <SecLink id="H">Section H</SecLink>.
        </p>
      ),
    },
    {
      label: "What today's price requires",
      body:
        cleanCell && !cleanCell.fiveYearGrowth.suppressed && !cleanCell.tenYearCagr.suppressed ? (
          <p className="t">
            {formatPct(cleanCell.fiveYearGrowth.value)} revenue growth for five years at r ={" "}
            {formatPct(new Decimal(cleanCell.rate), 0)}, equivalent to {formatPct(cleanCell.tenYearCagr.value)} over
            ten. <SecLink id="E">Section E</SecLink>
          </p>
        ) : (
          <p className="t">
            No cell in the reverse-DCF grid resolves to a usable growth figure at this run's inputs.{" "}
            <SecLink id="E">Section E</SecLink>
          </p>
        ),
    },
    {
      label: "What supports the case",
      body: (
        <ul>
          {ronicAboveEveryRate && (
            <li>
              Return on new capital of {formatPct(ronic.value)}, above every discount rate tested —{" "}
              <SecLink id="D">Section D</SecLink>
            </li>
          )}
          {cleanCell && (
            <li>
              At least one reverse-DCF cell resolves to a usable growth figure rather than returning a state —{" "}
              <SecLink id="E">Section E</SecLink>
            </li>
          )}
          {!ronicAboveEveryRate && !cleanCell && <li>No supporting figure resolves cleanly for this analysis.</li>}
        </ul>
      ),
    },
    {
      label: "What worries Calboard",
      body: (
        <ul>
          {marginAtHigh && (
            <li>
              Operating margin sits at or near its own ten-year high (<b>MARGIN AT HISTORICAL HIGH</b>), and the
              reverse-DCF grid is run from that level — <SecLink id="D">Section D</SecLink>
            </li>
          )}
          {anyDegenerateCell && (
            <li>
              One or more reverse-DCF cells return <b>DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE</b> rather than a
              number — <SecLink id="E">Section E</SecLink>
            </li>
          )}
          {!marginAtHigh && !anyDegenerateCell && <li>No value-level concern is active for this analysis.</li>}
        </ul>
      ),
    },
    {
      label: "Biggest uncertainty",
      body: marginAtHigh ? (
        <p className="t">
          Which margin level is the right base for the reverse-DCF grid — the current level or the ten-year median.
          The gap drives the whole grid. <SecLink id="D">Section D</SecLink>
        </p>
      ) : (
        <p className="t">
          The cells that do resolve, and how much of their value sits in the terminal period.{" "}
          <SecLink id="E">Section E</SecLink>
        </p>
      ),
    },
    { label: "Strongest challenger point", body: challengerItemBody },
    { label: "Data and model quality", body: dataQualityBody },
  ];
}

export function QuickRead({ result }: { result: AnalysisResult }) {
  const items = buildQuickRead(result);
  const profileLabel = PROFILE_LABELS[result.profile.confirmedOrOverridden];

  return (
    <section id="quickread" aria-label="Quick read">
      <div className="sechead">
        <h2>Quick read</h2>
        <span className="k">
          {result.companyName} · {profileLabel} · price as of {result.price.timestamp}
        </span>
      </div>
      <hr />
      <ValuationStrip result={result} showLocation />
      {items.map((item) => (
        <div className="qitem" key={item.label}>
          <span className="k">{item.label}</span>
          {item.body}
        </div>
      ))}
    </section>
  );
}
