import Decimal from "decimal.js";
import type { AnalysisResult, Profile, SuppressingState } from "@/lib/analyzer/types";

// Milestone 6 correction — Quick Read, matching the approved Calboard UX
// direction (Notion): Main finding -> Why it matters -> What it means
// here -> What to examine next -> Learn/calculation/sources on demand.
// One dominant reading path (Quick Read, then the full A-J report), not a
// permanent second column.
//
// Everything below is restatement/synthesis of fields already computed
// elsewhere in the AnalysisResult (§10.0.2 rule 3 applies here too, even
// though Quick Read sits outside §10.2's own section list) — no new
// calculation, score, verdict or AI call. Where a restated item depends on
// a suppressing/qualifying state, that state's own name is kept inline
// ("state travels with the summary") rather than paraphrased away.

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
  if (a.includes("reverse-dcf")) return "Section E";
  if (a.includes("fcf yield")) return "Section D";
  if (a.includes("own-history") || a.includes("history-based")) return "Section D";
  if (a.includes("all valuation outputs")) return "Section C";
  if (a.includes("rate-dependent")) return "Section C";
  if (a.includes("margin")) return "Section D";
  return null;
}

interface ConsolidatedState {
  state: SuppressingState;
  count: number;
  sectionRef: string | null;
}

// Collapses repeated identical states (e.g. four DEGENERATE reverse-DCF
// cells) into one line each, per the approved correction — never dumping
// the same state name once per row.
function consolidateStates(suppressing: AnalysisResult["states"]["suppressing"]): ConsolidatedState[] {
  const byState = new Map<SuppressingState, { count: number; sectionRef: string | null }>();
  for (const s of suppressing) {
    const existing = byState.get(s.state);
    const sectionRef = sectionRefFor(s.appliesTo);
    if (existing) {
      existing.count += 1;
    } else {
      byState.set(s.state, { count: 1, sectionRef });
    }
  }
  return Array.from(byState.entries()).map(([state, v]) => ({ state, count: v.count, sectionRef: v.sectionRef }));
}

function formatDollar(v: Decimal): string {
  return `$${v.toFixed(2)}`;
}
function formatPct(v: Decimal, dp = 1): string {
  return `${v.mul(100).toFixed(dp)}%`;
}

interface QuickReadContent {
  mainFinding: string;
  whyItMatters: string;
  whatItMeansHere: string;
  whatToExamineNext: string;
  learnMoreBullets: string[];
}

function buildQuickRead(result: AnalysisResult): QuickReadContent {
  const { gates, states, priceImplied, preRevenue, fairValueRange, scenarioOutputs } = result;
  const consolidated = consolidateStates(states.suppressing);
  const marginAtHigh = states.qualifying.some((q) => q.flag === "MARGIN AT HISTORICAL HIGH");

  const learnMoreBullets: string[] = [
    ...consolidated.map(
      (c) => `${c.count > 1 ? `${c.count} outputs return` : "One output returns"} ${c.state}${c.sectionRef ? ` — see ${c.sectionRef}` : ""}.`
    ),
    ...states.qualifying.map((q) => `${q.flag} — ${q.appliesTo}.`),
    `${result.facts.filter((f) => f.sourceClass === "SECONDARY" || f.extractionType === "AI-EXTRACTED" || f.verificationState !== "VERIFIED").length} of ${
      result.facts.length
    } facts in Section B carry a non-default provenance marker (secondary source, AI-extracted, or unverified).`,
  ];
  if (result.interpretation.statements.length === 0) {
    learnMoreBullets.push("Interpretation (Section I) has not run for this analysis yet.");
  }
  if (result.challenger === null) {
    learnMoreBullets.push("The independent challenger call (Section I2) has not completed for this analysis yet.");
  }

  // --- Gate/leverage refusal takes priority over everything else -------
  if (gates.gate0.result !== "PASS") {
    return {
      mainFinding: `Calboard cannot value ${result.companyName} with this method — ${gates.gate0.result} (Section C).`,
      whyItMatters:
        "The gates check before anything is calculated and refuse outright, rather than producing a confident-looking answer from the wrong model.",
      whatItMeansHere: `Every valuation output below is suppressed as a result. Facts, and whatever multiples and history diagnostics remain arithmetically defined, are still shown, each carrying that state.`,
      whatToExamineNext: "Whether the classification itself is right — see Section C for the exact test that fired.",
      learnMoreBullets,
    };
  }
  if (gates.leverage.result === "LEVERAGE UNSUPPORTED IN v1" && preRevenue === null) {
    return {
      mainFinding: `The leverage precondition fails for ${result.companyName}, so every rate-dependent output here is suppressed (LEVERAGE UNSUPPORTED IN v1 — Section C).`,
      whyItMatters:
        "A capital structure this levered can no longer be treated as a straightforward unlevered claim, so the diagnostics that assume one are refused rather than shown misleadingly.",
      whatItMeansHere: "The reverse-DCF grid, steady-state EV/PVGO, implied exit multiple and the fair-value range are all suppressed under this state.",
      whatToExamineNext: "The net debt ratio itself and whether it is likely to change — see Section C.",
      learnMoreBullets,
    };
  }

  // --- Pre-revenue --------------------------------------------------------
  if (preRevenue !== null && fairValueRange.kind === "pre-revenue-distribution") {
    const total = preRevenue.successDefinitions.length;
    const worthLess = preRevenue.successDefinitions.filter((d) => d.state.kind === "THIS SUCCESS IS WORTH LESS THAN FAILURE").length;
    const range = fairValueRange.successAsCommonlyDescribed;
    const rangeText = range.low.equals(range.high) ? formatDollar(range.low) : `${formatDollar(range.low)}-${formatDollar(range.high)}`;

    return {
      mainFinding:
        worthLess > 0
          ? `On ${worthLess} of ${total} ways ${result.companyName} could succeed, shareholders would end up with less than if it simply held its cash (THIS SUCCESS IS WORTH LESS THAN FAILURE).`
          : `Every modelled way ${result.companyName} could succeed is worth more than simply holding its cash — none returns THIS SUCCESS IS WORTH LESS THAN FAILURE.`,
      whyItMatters:
        "For a pre-revenue company, \"how likely is success?\" is meaningless until you say which success — building the asset but earning a thin return on it can leave shareholders worse off than the cash on the balance sheet today, once dilution is counted.",
      whatItMeansHere: `The cash floor is ${formatDollar(fairValueRange.failure)} per share. Success, as the modelled cases commonly describe it, is worth ${rangeText} — the spread is the honest uncertainty, not an error. Success as today's price (${formatDollar(result.price.value)}) would require is restated in Section H.`,
      whatToExamineNext: "What separates the cases that clear the cash floor from the ones that don't — the tariff or capacity assumption behind each — see the success-definition detail in Section D.",
      learnMoreBullets,
    };
  }

  // --- Mature / high-growth (reverse-DCF applies) -------------------------
  const cleanCell = priceImplied.reverseDcfGrid.find((c) => !c.fiveYearGrowth.suppressed && !c.tenYearCagr.suppressed);
  const degenerateCells = priceImplied.reverseDcfGrid.filter(
    (c) => c.fiveYearGrowth.suppressed && c.fiveYearGrowth.state === "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE"
  );
  const totalCells = priceImplied.reverseDcfGrid.length;

  const growthLine =
    cleanCell && !cleanCell.fiveYearGrowth.suppressed && !cleanCell.tenYearCagr.suppressed
      ? `Today's price implies roughly ${formatPct(cleanCell.tenYearCagr.value)} annual growth over ten years (${formatPct(
          cleanCell.fiveYearGrowth.value
        )} for the next five, at the ${cleanCell.marginLevel} margin and ${formatPct(new Decimal(cleanCell.rate), 0)} discount rate).`
      : "The reverse-DCF grid does not resolve to a usable growth figure at this run's inputs.";

  return {
    mainFinding:
      degenerateCells.length > 0
        ? `${growthLine} ${degenerateCells.length} of ${totalCells} reverse-DCF scenarios return no number at all (DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE) rather than a misleading one.`
        : growthLine,
    whyItMatters:
      "A reverse DCF solves for the growth the current price already requires, rather than starting from a growth guess — that turns a valuation into something checkable against the company's own record. A DEGENERATE result means more than all of the model's value would sit in the distant terminal period, which stops being a valuation and starts being an assumption about the far future.",
    whatItMeansHere: `${
      marginAtHigh
        ? "The current operating margin sits at or near its own ten-year high (MARGIN AT HISTORICAL HIGH), and the grid is run at that margin as one of three levels. "
        : ""
    }Where the base case falls within the bear-bull range, and the rate at which it equals today's price, are restated in Sections G and H.`,
    whatToExamineNext: marginAtHigh
      ? "Whether the current margin is the right level to project from — the grid also runs at the ten-year median and a stress level for exactly this reason (Section D, Section E)."
      : "The cells that do resolve, and how much of their value sits in the terminal period (Section E).",
    learnMoreBullets,
  };
}

export function QuickRead({ result }: { result: AnalysisResult }) {
  const content = buildQuickRead(result);
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
      <div className="finding">
        <p className="lede">{content.mainFinding}</p>
        <dl>
          <dt>Why it matters</dt>
          <dd>{content.whyItMatters}</dd>
          <dt>What it means here</dt>
          <dd>{content.whatItMeansHere}</dd>
          <dt>What to examine next</dt>
          <dd>{content.whatToExamineNext}</dd>
        </dl>
        <details className="disclose">
          <summary>
            <span className="lbl">Learn more — states, provenance and what has not run yet</span>
          </summary>
          <div className="body">
            <ul>
              {content.learnMoreBullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
