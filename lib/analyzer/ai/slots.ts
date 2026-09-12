import Decimal from "decimal.js";
import { formatFactValue, formatUsd } from "../factDisplay";
import { factUnit } from "../acquisition/factUnit";
import type { AnalysisResult, FactRecord, Figure, SuppressingState } from "../types";
import type { FigureSlot, SlotCatalogue } from "./traceability";
import { boundState, NOT_COMPUTED_BINDING, type BoundState } from "../notComputed";

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

/**
 * A per-share figure, with its cents. Read against a quote, so it keeps them.
 */
function money(v: Decimal, dp = 2): string {
  return v.isNegative() ? `−$${v.abs().toFixed(dp)}` : `$${v.toFixed(dp)}`;
}

/**
 * A company-scale aggregate, at the magnitude a filing states it — through the
 * SAME rule the fact card uses (factDisplay.formatUsd, ruled 8 September 2026).
 *
 * One report cannot carry two money conventions. The first real MSFT run
 * printed "$67.0B" in a challenger finding and "$66987000000" in an
 * interpretation statement for the same quantity, because fact slots went
 * through the display rule and computed ones did not. Both are [C] prose on
 * one page, and a reader comparing them would reasonably conclude they were
 * different figures.
 */
function bigMoney(v: Decimal): string {
  // Below a million, a computed figure is a PER-SHARE one, and per-share money
  // keeps its cents: a real OKLO run wrote "its value $3.1 sits on the balance
  // sheet at $3.10 per share" in one sentence, because the scenario value and
  // the cash floor took different branches. Same quantity, two forms, one
  // sentence.
  //
  // Above it, the filing's own magnitude through the shared display rule.
  // Either way the value is rounded BEFORE formatting: factDisplay's
  // sub-million branch prints the exact figure, which is right for a fact —
  // filings state whole dollars — and wrong for a computed one, where three
  // equal scenario weights summing to one produced $474.99999999999999999.
  // The exact value stays exact everywhere it is calculated with; this is the
  // screen.
  const rounded = v.toDecimalPlaces(2);
  return rounded.abs().lessThan(MILLION) ? money(rounded) : formatUsd(rounded);
}

const MILLION = new Decimal("1e6");

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

  /**
   * An output the schema types as a bare Decimal, which cannot carry its own
   * state (notComputed.ts). Where assembly bound one, the slot is the state —
   * exactly as a suppressed Figure's is — and the field behind it, which
   * holds no figure, is never formatted.
   */
  bound(id: string, label: string, bound: BoundState | null, v: Decimal | null, format: Formatter): void {
    if (bound !== null) {
      this.add(id, label, bound.state, true, bound.state);
      return;
    }
    this.value(id, label, v, format);
  }

  build(): SlotCatalogue {
    return this.slots;
  }
}

/**
 * A fact's value as it is displayed — through `formatFactValue`, the same rule
 * the fact card uses (ruled by Calvin, 8 September 2026).
 *
 * Not `toString()`. Acquisition holds the exact figure, and the ruling
 * separates that from what is shown: an operating margin is 46.8%, not
 * 0.46780818408927220731. A [C] sentence substituting the raw Decimal would put
 * the unshown form onto the page through a door the ruling did not know about,
 * and it would be the one number on the report in a form no filing states.
 */
function factValue(fact: FactRecord): string {
  if (fact.value === null) return "";
  return formatFactValue(fact.value, factUnit(fact.id));
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
export function buildFactSlotCatalogue(
  facts: readonly FactRecord[],
  // §8.5.1 gives the challenger "gate results and active states, so it does
  // not challenge a suppressed output". Naming one is therefore correct
  // behaviour, and a state name carries no company figure — so the states this
  // payload actually told it about belong in the catalogue, on exactly the
  // reasoning traceability.ts's `withoutSystemVocabulary` sets out. Empty by
  // default, so a caller that supplies none exempts nothing.
  activeSuppressingStates: readonly SuppressingState[] = []
): SlotCatalogue {
  const b = new CatalogueBuilder();
  addFacts(b, facts);
  for (const state of new Set(activeSuppressingStates)) {
    b.add(`states.${state}`, "an active suppressing state on this run", state, true, state);
  }
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
  b.figure("priceImplied.steadyStateEv", "steady-state enterprise value", priceImplied.steadyStateEv, bigMoney);
  b.figure("priceImplied.pvgo", "present value of growth opportunities", priceImplied.pvgo, bigMoney);
  b.figure("priceImplied.pvgoShareOfEv", "PVGO share of enterprise value", priceImplied.pvgoShareOfEv, (v) => pct(v));
  b.figure(
    "priceImplied.impliedExitMultiple",
    `implied exit multiple, dividing ${priceImplied.impliedExitMultiple.dividesMetric}`,
    priceImplied.impliedExitMultiple.value,
    multiple
  );
  if (priceImplied.nopatGap !== null) {
    b.value("priceImplied.nopatGap.current", "NOPAT at the current margin", priceImplied.nopatGap.current, bigMoney);
    b.value(
      "priceImplied.nopatGap.medianMargin",
      "NOPAT at the median margin",
      priceImplied.nopatGap.medianMargin,
      bigMoney
    );
  }

  for (const cell of priceImplied.reverseDcfGrid) {
    const at = `${cell.marginLevel} margin at r = ${pct(new Decimal(cell.rate), 0)}`;
    const key = `priceImplied.reverseDcf.${cell.marginLevel}@${cell.rate}`;
    b.figure(`${key}.fiveYearGrowth`, `price-implied growth for years 1-5, ${at}`, cell.fiveYearGrowth, (v) => pct(v));
    b.figure(`${key}.tenYearCagr`, `price-implied ten-year CAGR, ${at}`, cell.tenYearCagr, (v) => pct(v));
    b.figure(`${key}.year10Revenue`, `price-implied year-10 revenue, ${at}`, cell.year10Revenue, bigMoney);
    b.figure(`${key}.ronic`, `return on new invested capital, ${at}`, cell.ronic, (v) => pct(v));
  }

  // --- §10 D — deterministic diagnostics -----------------------------------
  b.figure("diagnostics.enterpriseValue", "enterprise value", figureOf(diagnostics.enterpriseValue, (v) => v.enterpriseValue), (v) =>
    bigMoney(v)
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
  // The window's own LENGTH, not just what was measured over it. §6.2 is
  // explicit that the window is "never described as ten-year unless it is", so
  // a sentence about the history has to be able to say how long it actually
  // was — and the traceability rule refuses a spelled-out year count, which
  // leaves a slot as the only way to say it.
  b.figure(
    "diagnostics.marginHistory.windowYears",
    "length of the margin-history window, in years",
    figureOf(diagnostics.marginHistory, (v) => new Decimal(v.windowYears)),
    (v) => v.toFixed(0)
  );
  b.value(
    "gates.gate1.filedYearsCount",
    "number of filed years this company has",
    new Decimal(result.gates.gate1.filedYearsCount),
    (v) => v.toFixed(0)
  );
  b.value(
    "policy.preRevenueConstructionLeadYears",
    "construction lead assumed by policy, in years",
    new Decimal(policy.constants.preRevenueConstructionLeadYears),
    (v) => v.toFixed(0)
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
  b.figure("diagnostics.fcf.cashFcf", "cash free cash flow", diagnostics.fcf.cashFcf, bigMoney);
  b.figure("diagnostics.fcf.unleveredFcf", "unlevered free cash flow", diagnostics.fcf.unleveredFcf, bigMoney);
  b.figure(
    "diagnostics.impliedReturnOnNewCapital",
    "implied return on new capital, current fiscal year",
    diagnostics.impliedReturnOnNewCapital.value,
    (v) => pct(v)
  );
  // CB-AUDIT-01 H4: no fixture in this codebase supplies a real
  // terminalValuePv (see CompanyFixture.terminalValuePv's doc comment) — so
  // `diagnostics.terminal` is always assemble.ts's own "not computed"
  // placeholder today, never a genuine M8 result. Because the schema gives
  // this field no way to say that (`terminalShareOfValue: Decimal` and
  // `terminalFcfConsistencyApplied: true` are typed as though every
  // instance were real), there is no signal on AnalysisResult this
  // catalogue can check before deciding whether to hand [C] a real number
  // — so no slot is offered for it at all, rather than risk handing [C] a
  // fabricated one. Reinstating this slot needs a schema change giving
  // `terminal` a real/not-computed distinction (e.g. Figure<TerminalDiagnostics>),
  // which is out of scope here.
  const rateSensitivityState = boundState(result.states, NOT_COMPUTED_BINDING.rateSensitivity);
  b.bound(
    "diagnostics.rateSensitivity.plusOnePoint",
    "value change from a one-point higher discount rate",
    rateSensitivityState,
    diagnostics.rateSensitivity.plusOnePoint,
    (v) => pct(v)
  );
  b.bound(
    "diagnostics.rateSensitivity.minusOnePoint",
    "value change from a one-point lower discount rate",
    rateSensitivityState,
    diagnostics.rateSensitivity.minusOnePoint,
    (v) => pct(v)
  );
  b.value("diagnostics.runRate.ttm", "trailing twelve-month revenue", diagnostics.runRate.ttm, bigMoney);
  b.value(
    "diagnostics.shapeMismatch.gapPoints",
    "gap between guided and price-implied growth",
    diagnostics.shapeMismatch.gapPoints,
    (v) => pct(v)
  );

  // --- §10 G — scenario outputs --------------------------------------------
  b.value("scenarioOutputs.values.bear", "bear scenario value", scenarioOutputs.values.bear, bigMoney);
  b.value("scenarioOutputs.values.base", "base scenario value", scenarioOutputs.values.base, bigMoney);
  b.value("scenarioOutputs.values.bull", "bull scenario value", scenarioOutputs.values.bull, bigMoney);
  b.value(
    "scenarioOutputs.weightedDistribution",
    "probability-weighted value, shown inside the range and never as a headline",
    scenarioOutputs.weightedDistribution,
    bigMoney
  );
  b.value(
    "scenarioOutputs.priceLocationWithinRange",
    "where today's price sits within the scenario range",
    scenarioOutputs.priceLocationWithinRange,
    (v) => pct(v, 0)
  );
  b.bound(
    "scenarioOutputs.rateAtWhichBaseEqualsPrice",
    "discount rate at which the base case equals today's price",
    boundState(result.states, NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice),
    scenarioOutputs.rateAtWhichBaseEqualsPrice,
    (v) => pct(v)
  );

  // --- §10 H — the fair-value range, in whichever form this profile takes ---
  if (fairValueRange.kind === "range") {
    b.value("fairValueRange.bear", "bottom of the fair-value range", fairValueRange.bear, bigMoney);
    b.value("fairValueRange.bull", "top of the fair-value range", fairValueRange.bull, bigMoney);
    b.value(
      "fairValueRange.weightedValueInside",
      "weighted value shown inside the range",
      fairValueRange.weightedValueInside,
      bigMoney
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
    const cashPerShareState = boundState(result.states, NOT_COMPUTED_BINDING.cashPerShare);
    const quarterlyBurnState = boundState(result.states, NOT_COMPUTED_BINDING.quarterlyBurn);
    const runwayState = boundState(result.states, NOT_COMPUTED_BINDING.runway);
    b.bound("preRevenue.cashPerShare", "cash per share", cashPerShareState, preRevenue.cashPerShare, money);
    if (cashPerShareState === null && preRevenue.cashPerShareAsOfDate !== null) {
      b.add("preRevenue.cashPerShareAsOfDate", "cash per share, as of date", preRevenue.cashPerShareAsOfDate);
    }
    b.bound("preRevenue.quarterlyBurn", "quarterly cash burn", quarterlyBurnState, preRevenue.quarterlyBurn, bigMoney);
    if (quarterlyBurnState === null && preRevenue.quarterlyBurnAsOfDate !== null) {
      b.add("preRevenue.quarterlyBurnAsOfDate", "quarterly cash burn, as of date", preRevenue.quarterlyBurnAsOfDate);
    }
    b.bound("preRevenue.runway", "quarters of runway", runwayState, preRevenue.runway, (v) => v.toFixed(0));
    b.value("preRevenue.dilutionRequired", "dilution required on the back-loaded ramp", preRevenue.dilutionRequired, (v) =>
      bigMoney(v)
    );
    b.figure(
      "preRevenue.unitEconomicsBreakeven",
      "output price at which the unit breaks even",
      preRevenue.unitEconomicsBreakeven,
      (v) => `${money(v)}/unit`
    );
    preRevenue.successDefinitions.forEach((row, i) => {
      const key = `preRevenue.successDefinitions.${i}`;
      // The definition's own NAME as a slot, not only as a label. OKLO's read
      // "Definition 3 — 8 GW, utility multiple, back-loaded ramp": a sentence
      // naming one by typing it out would carry digits [C] is not allowed to
      // emit, and the sentence would be refused for a reason that has nothing
      // to do with the figure. §10.5 requires every one of these tied to a
      // named success definition, so naming them must be possible.
      b.add(`${key}.definition`, `the name of success definition ${i + 1}`, row.definition);
      b.value(`${key}.vSuccess`, `value per share if "${row.definition}" happens`, row.vSuccess, money);
      if (row.vSuccessAsOfDate !== null) {
        b.add(`${key}.vSuccessAsOfDate`, `valuation date for V_success under "${row.definition}"`, row.vSuccessAsOfDate);
      }
      b.bound(`${key}.vFail`, `value per share if "${row.definition}" does not happen`, cashPerShareState, row.vFail, money);
      if (cashPerShareState === null && row.vFailAsOfDate !== null) {
        b.add(`${key}.vFailAsOfDate`, `valuation date for V_fail under "${row.definition}"`, row.vFailAsOfDate);
      }
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
        // "NOT COMPUTED / SUPPRESSED" is §7.2 M16's own weight-table state,
        // not a §9.3 SuppressingState (FigureSlot.state's type) — the slot
        // still carries it as its formatted value (never a number), just
        // without the optional state tag the other two kinds get.
        b.add(
          `${key}.breakEvenSuccessWeight`,
          `conditional price-implied break-even success weight for "${row.definition}"`,
          row.state.kind,
          true,
          row.state.kind === "NOT COMPUTED / SUPPRESSED" ? undefined : row.state.kind
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
