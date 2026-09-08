import Decimal from "decimal.js";
import type { AnalysisResult, FactRecord, Figure } from "../types";
import type { FigureSlot, SlotCatalogue } from "./traceability";

// ---------------------------------------------------------------------------
// The catalogue of figures [C] may reference — built from the Analysis Result,
// and the only route by which a number reaches [C]-authored prose (§10.7 rule
// 3).
//
// Every entry is a value [S] already computed. Nothing here calculates: each
// slot reads one member of the result object and formats it, which is the
// same licence §10.0.2 rule 3 gives the renderer ("the renderer adds
// formatting and prose; it adds no content").
//
// A SUPPRESSED figure still gets a slot, and its formatted value is the state
// name. That is what makes §8.3 limit 5 structural: there is no number behind
// the slot to leak, so [C] referencing it prints "DEGENERATE — TERMINAL
// EXCEEDS TOTAL VALUE" and stops, which is precisely "reports the state and
// says nothing in its place".
// ---------------------------------------------------------------------------

function pct(v: Decimal, dp = 1): string {
  return `${v.mul(100).toFixed(dp)}%`;
}

function money(v: Decimal, dp = 2): string {
  return v.isNegative() ? `−$${v.abs().toFixed(dp)}` : `$${v.toFixed(dp)}`;
}

function multiple(v: Decimal): string {
  return `${v.toFixed(1)}x`;
}

type Formatter = (v: Decimal) => string;

class CatalogueBuilder {
  private readonly slots: SlotCatalogue = new Map();

  add(id: string, label: string, formatted: string, suppressed = false, state?: FigureSlot["state"]): void {
    if (formatted.trim() === "") return;
    this.slots.set(id, { id, label, formatted, suppressed, ...(state ? { state } : {}) });
  }

  value(id: string, label: string, v: Decimal | null, format: Formatter): void {
    if (v === null) return;
    this.add(id, label, format(v));
  }

  /**
   * A Figure — the one type every rendered number comes in. Computed values
   * format; suppressed values become their own state name.
   */
  figure(id: string, label: string, figure: Figure<Decimal>, format: Formatter): void {
    if (figure.suppressed) {
      this.add(id, label, figure.state, true, figure.state);
      return;
    }
    this.add(id, label, format(figure.value));
  }

  build(): SlotCatalogue {
    return this.slots;
  }
}

/**
 * A fact's value as it is displayed — the same `toString()` Section B renders,
 * so the fact card and any [C] sentence citing it cannot disagree.
 */
function factValue(fact: FactRecord): string {
  if (fact.value === null) return "";
  return typeof fact.value === "string" ? fact.value : fact.value.toString();
}

function addFacts(b: CatalogueBuilder, facts: readonly FactRecord[]): void {
  for (const fact of facts) {
    b.add(`facts.${fact.id}`, fact.name, factValue(fact));
  }
}

/**
 * The challenger's catalogue.
 *
 * Facts only, by construction — not "the full catalogue minus the valuation
 * entries". §8.5.2 is enforced by the call boundary, and a subtraction is a
 * boundary only until someone adds a member upstream and forgets to subtract
 * it. This builds up from the fact set instead, so a new valuation output
 * cannot appear here by omission.
 */
export function buildFactSlotCatalogue(facts: readonly FactRecord[]): SlotCatalogue {
  const b = new CatalogueBuilder();
  addFacts(b, facts);
  return b.build();
}

export function buildSlotCatalogue(result: AnalysisResult): SlotCatalogue {
  const b = new CatalogueBuilder();
  const { diagnostics, priceImplied, scenarioOutputs, fairValueRange, preRevenue, policy } = result;

  b.add("price", "current share price", money(result.price.value));
  b.add("price.timestamp", "price as-of timestamp", result.price.timestamp);
  addFacts(b, result.facts);

  // --- policy constants in force for this run (§7.1) — [C] may say the band
  // came from policy, and this is where it reads it from rather than recalling
  // one (§8.3 limit 4).
  b.value("policy.terminalGrowth", "terminal growth rate from policy", policy.constants.terminalGrowth, (v) => pct(v));
  b.value(
    "policy.terminalRoicPremium",
    "terminal ROIC premium assumed for every company",
    policy.constants.terminalRoicPremium,
    (v) => pct(v, 0)
  );
  policy.constants.rateGrid.forEach((rate, i) => {
    b.value(`policy.rateGrid.${i}`, "discount rate from the policy grid", rate, (v) => pct(v, 0));
  });

  // --- §10 E — price-implied diagnostics ----------------------------------
  b.figure("priceImplied.steadyStateEv", "steady-state enterprise value", priceImplied.steadyStateEv, (v) => money(v, 0));
  b.figure("priceImplied.pvgo", "present value of growth opportunities", priceImplied.pvgo, (v) => money(v, 0));
  b.figure("priceImplied.pvgoShareOfEv", "PVGO share of enterprise value", priceImplied.pvgoShareOfEv, (v) => pct(v));
  b.figure(
    "priceImplied.impliedExitMultiple",
    `implied exit multiple, dividing ${priceImplied.impliedExitMultiple.dividesMetric}`,
    priceImplied.impliedExitMultiple.value,
    multiple
  );
  if (priceImplied.nopatGap !== null) {
    b.value("priceImplied.nopatGap.current", "NOPAT at the current margin", priceImplied.nopatGap.current, (v) => money(v, 0));
    b.value(
      "priceImplied.nopatGap.medianMargin",
      "NOPAT at the median margin",
      priceImplied.nopatGap.medianMargin,
      (v) => money(v, 0)
    );
  }

  for (const cell of priceImplied.reverseDcfGrid) {
    const at = `${cell.marginLevel} margin at r = ${pct(new Decimal(cell.rate), 0)}`;
    const key = `priceImplied.reverseDcf.${cell.marginLevel}@${cell.rate}`;
    b.figure(`${key}.fiveYearGrowth`, `price-implied growth for years 1-5, ${at}`, cell.fiveYearGrowth, (v) => pct(v));
    b.figure(`${key}.tenYearCagr`, `price-implied ten-year CAGR, ${at}`, cell.tenYearCagr, (v) => pct(v));
    b.figure(`${key}.year10Revenue`, `price-implied year-10 revenue, ${at}`, cell.year10Revenue, (v) => money(v, 0));
    b.figure(`${key}.ronic`, `return on new invested capital, ${at}`, cell.ronic, (v) => pct(v));
  }

  // --- §10 D — deterministic diagnostics -----------------------------------
  b.figure("diagnostics.enterpriseValue", "enterprise value", figureOf(diagnostics.enterpriseValue, (v) => v.enterpriseValue), (v) =>
    money(v, 0)
  );
  b.figure("diagnostics.multiples.peTrailing", "trailing price/earnings", diagnostics.multiples.peTrailing, multiple);
  b.figure("diagnostics.multiples.evToEbit", "EV/EBIT", diagnostics.multiples.evToEbit, multiple);
  b.figure("diagnostics.multiples.evToEbitda", "EV/EBITDA", diagnostics.multiples.evToEbitda, multiple);
  b.figure(
    "diagnostics.multiples.fcfYieldOnMarketCap",
    "free-cash-flow yield on market capitalisation",
    diagnostics.multiples.fcfYieldOnMarketCap,
    (v) => pct(v)
  );
  b.figure(
    "diagnostics.multiples.ownHistoryPercentile",
    "where the multiple sits in the company's own history",
    diagnostics.multiples.ownHistoryPercentile,
    (v) => pct(v, 0)
  );
  b.figure(
    "diagnostics.marginHistory.currentMargin",
    "current operating margin",
    figureOf(diagnostics.marginHistory, (v) => v.currentMargin),
    (v) => pct(v)
  );
  b.figure(
    "diagnostics.marginHistory.median",
    "median operating margin over the history window",
    figureOf(diagnostics.marginHistory, (v) => v.median),
    (v) => pct(v)
  );
  b.figure(
    "diagnostics.marginHistory.range",
    "operating-margin range over the history window",
    figureOf(diagnostics.marginHistory, (v) => v.range),
    (v) => pct(v)
  );
  b.figure(
    "diagnostics.marginHistory.worstSingleYearChange",
    "worst single-year margin change in the history window",
    figureOf(diagnostics.marginHistory, (v) => v.worstSingleYearChange),
    (v) => pct(v)
  );
  b.figure("diagnostics.fcf.cashFcf", "cash free cash flow", diagnostics.fcf.cashFcf, (v) => money(v, 0));
  b.figure("diagnostics.fcf.unleveredFcf", "unlevered free cash flow", diagnostics.fcf.unleveredFcf, (v) => money(v, 0));
  b.figure(
    "diagnostics.impliedReturnOnNewCapital",
    "implied return on new capital, current fiscal year",
    diagnostics.impliedReturnOnNewCapital.value,
    (v) => pct(v)
  );
  b.value(
    "diagnostics.terminal.terminalShareOfValue",
    "share of value sitting in the terminal period",
    diagnostics.terminal.terminalShareOfValue,
    (v) => pct(v)
  );
  b.value(
    "diagnostics.rateSensitivity.plusOnePoint",
    "value change from a one-point higher discount rate",
    diagnostics.rateSensitivity.plusOnePoint,
    (v) => pct(v)
  );
  b.value(
    "diagnostics.rateSensitivity.minusOnePoint",
    "value change from a one-point lower discount rate",
    diagnostics.rateSensitivity.minusOnePoint,
    (v) => pct(v)
  );
  b.value("diagnostics.runRate.ttm", "trailing twelve-month revenue", diagnostics.runRate.ttm, (v) => money(v, 0));
  b.value(
    "diagnostics.shapeMismatch.gapPoints",
    "gap between guided and price-implied growth",
    diagnostics.shapeMismatch.gapPoints,
    (v) => pct(v)
  );

  // --- §10 G — scenario outputs --------------------------------------------
  b.value("scenarioOutputs.values.bear", "bear scenario value", scenarioOutputs.values.bear, (v) => money(v, 0));
  b.value("scenarioOutputs.values.base", "base scenario value", scenarioOutputs.values.base, (v) => money(v, 0));
  b.value("scenarioOutputs.values.bull", "bull scenario value", scenarioOutputs.values.bull, (v) => money(v, 0));
  b.value(
    "scenarioOutputs.weightedDistribution",
    "probability-weighted value, shown inside the range and never as a headline",
    scenarioOutputs.weightedDistribution,
    (v) => money(v, 0)
  );
  b.value(
    "scenarioOutputs.priceLocationWithinRange",
    "where today's price sits within the scenario range",
    scenarioOutputs.priceLocationWithinRange,
    (v) => pct(v, 0)
  );
  b.value(
    "scenarioOutputs.rateAtWhichBaseEqualsPrice",
    "discount rate at which the base case equals today's price",
    scenarioOutputs.rateAtWhichBaseEqualsPrice,
    (v) => pct(v)
  );

  // --- §10 H — the fair-value range, in whichever form this profile takes ---
  if (fairValueRange.kind === "range") {
    b.value("fairValueRange.bear", "bottom of the fair-value range", fairValueRange.bear, (v) => money(v, 0));
    b.value("fairValueRange.bull", "top of the fair-value range", fairValueRange.bull, (v) => money(v, 0));
    b.value(
      "fairValueRange.weightedValueInside",
      "weighted value shown inside the range",
      fairValueRange.weightedValueInside,
      (v) => money(v, 0)
    );
  } else if (fairValueRange.kind === "pre-revenue-distribution") {
    b.value("fairValueRange.failure", "value per share if this fails", fairValueRange.failure, money);
    b.value(
      "fairValueRange.successAsCommonlyDescribed.low",
      "lowest value per share among the successes as commonly described",
      fairValueRange.successAsCommonlyDescribed.low,
      money
    );
    b.value(
      "fairValueRange.successAsCommonlyDescribed.high",
      "highest value per share among the successes as commonly described",
      fairValueRange.successAsCommonlyDescribed.high,
      money
    );
    b.value(
      "fairValueRange.successAsPriceRequires",
      "value per share that today's price requires success to be worth",
      fairValueRange.successAsPriceRequires,
      money
    );
    b.value("fairValueRange.cashFloor", "cash floor per current share", fairValueRange.cashFloor, money);
  } else {
    b.add("fairValueRange.state", "the state that replaced the fair-value range", fairValueRange.state, true, fairValueRange.state);
  }

  // --- §7.2 M16 — the pre-revenue module -----------------------------------
  if (preRevenue !== null) {
    b.value("preRevenue.cashPerShare", "cash per share", preRevenue.cashPerShare, money);
    b.value("preRevenue.quarterlyBurn", "quarterly cash burn", preRevenue.quarterlyBurn, (v) => money(v, 0));
    b.value("preRevenue.runway", "quarters of runway", preRevenue.runway, (v) => v.toFixed(0));
    b.value("preRevenue.dilutionRequired", "dilution required on the back-loaded ramp", preRevenue.dilutionRequired, (v) =>
      money(v, 0)
    );
    b.figure(
      "preRevenue.unitEconomicsBreakeven",
      "output price at which the unit breaks even",
      preRevenue.unitEconomicsBreakeven,
      (v) => `${money(v)}/unit`
    );
    preRevenue.successDefinitions.forEach((row, i) => {
      const key = `preRevenue.successDefinitions.${i}`;
      b.value(`${key}.vSuccess`, `value per share if "${row.definition}" happens`, row.vSuccess, money);
      b.value(`${key}.vFail`, `value per share if "${row.definition}" does not happen`, row.vFail, money);
      // §10.5, and CalFinance Methodology v2's own wording: this is a
      // CONDITIONAL PRICE-IMPLIED BREAK-EVEN SUCCESS WEIGHT. It is never an
      // implied probability of success, and the label a model reads is the
      // label it will echo.
      if (row.state.kind === "probability") {
        b.value(
          `${key}.breakEvenSuccessWeight`,
          `conditional price-implied break-even success weight for "${row.definition}"`,
          row.state.probability,
          (v) => pct(v, 0)
        );
      } else {
        b.add(
          `${key}.breakEvenSuccessWeight`,
          `conditional price-implied break-even success weight for "${row.definition}"`,
          row.state.kind,
          true,
          row.state.kind
        );
      }
    });
  }

  return b.build();
}

/**
 * Narrows a Figure over a struct to a Figure over one of its Decimal members,
 * preserving the suppressing state unchanged. Used so a suppressed bridge or
 * margin history yields state-bearing slots for each of its fields rather than
 * silently dropping them.
 */
function figureOf<T>(figure: Figure<T>, pick: (value: T) => Decimal): Figure<Decimal> {
  return figure.suppressed ? figure : { ...figure, value: pick(figure.value) };
}
