import Decimal from "decimal.js";
import { POLICY, buildProvisionalLabels } from "./policy";
import { computeEnterpriseValue, computeEquityValueFromEnterpriseValue, type EnterpriseValueInput } from "./modules/enterpriseValue";
import { computeMultiples, type MultiplesInput } from "./modules/multiples";
import { computeMarginHistory, type MarginHistoryInput } from "./modules/marginHistory";
import { computeFcf, type FcfInput } from "./modules/fcf";
import {
  computeReinvestmentRonic,
  computeImpliedReturnOnNewCapital,
  type ReinvestmentInput,
  type RonicInput,
  type ImpliedReturnOnNewCapitalInput,
} from "./modules/reinvestmentRonic";
import { computeSteadyStateEvPvgo } from "./modules/steadyStateEvPvgo";
import { computeReverseDcfGrid, type ReverseDcfInput } from "./modules/reverseDcf";
import { computeTerminalDiagnostics } from "./modules/terminalDiagnostics";
import { computeImpliedExitMultiple } from "./modules/impliedExitMultiple";
import { computeRateSensitivity, rateSensitivityNotModelled } from "./modules/rateSensitivity";
import { computeFcfYieldGrowth, type FcfYieldGrowthInput } from "./modules/fcfYieldGrowth";
import { computeRunRate, type RunRateInput } from "./modules/runRate";
import { computeShapeMismatch } from "./modules/shapeMismatch";
import { buildSensitivityResult } from "./modules/sensitivity";
import { computeScenarioEnterpriseValue, computeScenarioOutputs, rateSearchBracket } from "./modules/scenarioOutputs";
import { notComputed, NOT_COMPUTED_BINDING } from "./notComputed";
import {
  computeFundingStackYearByYear,
  computeBothFundingRamps,
  computeImpliedProbability,
  computeUnitExitBreakEvenPrice,
  successWeightDateCause,
  type FundingStackYearParams,
  type UnitExitEconomicsInput,
} from "./modules/preRevenue";
import { evaluateGate0, evaluateGate1, evaluateLeverage, evaluateTriggerA, evaluateTriggerB } from "./gates";
import type { Gate0Input, Gate1Input, LeverageInput, TriggerMarginInput } from "./gates";
import { CLEAN_PROVENANCE } from "./provenance";
import { computeTrustStatus } from "./trust";
import {
  gate0Cause,
  leverageCause,
  stateRemovingFairValueRange,
  type ActiveSuppression,
} from "./suppression";
import type {
  AnalysisResult,
  FactRecord,
  Figure,
  OverrideRecord,
  Profile,
  ProfileClassificationInputs,
  QualifyingFlag,
  ScenarioDriverSet,
  ScenarioSet,
  SourcedValue,
  SuccessDefinitionRow,
  SuppressingState,
  UndefinedPolicyConstants,
} from "./types";

// ---------------------------------------------------------------------------
// Milestone 5 — Analysis Result assembly.
// ---------------------------------------------------------------------------
//
// Wires the already-accepted M1–M16 outputs into the frozen AnalysisResult
// contract (types.ts). Every calculation call below reuses an accepted
// module's EXPORTED function unmodified — this file contains no valuation
// arithmetic of its own, only orchestration: building each module's input
// shape from the fixture, threading gate/trigger/M5 outputs into the
// modules that require them, and assembling the results into one object.
//
// SCOPE DELIBERATELY NARROWER than the full contract, consistent with
// Milestone 5 (not Milestone 6/8): `provenance` (the full derivation graph)
// is left as an empty array — building it exhaustively for every value is
// report-assembly/Step-4-adjacent work, not required to prove the M1–M16
// wiring itself is correct. `interpretation` is empty (§8.2's plain-English
// layer is AI-narrative, not a deterministic M1–M16 output) and `challenger`
// is always null (populated only after a separate call, §8.5.4). `facts`
// carries only the fixture's own hand-supplied FactRecords, not a fact for
// every input.
//
// PROFILE CLASSIFICATION is taken directly from the fixture, not computed
// by a general classifier — none exists in this codebase, and the
// methodology's own text (§1) frames this step as software RECOMMENDING a
// profile that an analyst then confirms or overrides ("hard auto-assignment
// is too crude... the table is the recommendation rule, not the final
// word"), not a rigid deterministic function. For MSFT and OKLO the profile
// is already stated as confirmed in the frozen design mocks, so this
// assembly takes that confirmed profile as a fixture input rather than
// inventing a classifier the frozen contract does not actually specify.

export interface CompanyFixture {
  schemaVersion: string;
  runId: string;
  ticker: string;
  companyName: string;
  price: { value: Decimal; timestamp: string };
  facts: FactRecord[];

  gate0: Gate0Input;
  gate1: Gate1Input;
  leverage: LeverageInput;
  triggerMargins: TriggerMarginInput;

  profile: {
    recommended: Profile;
    confirmedOrOverridden: Profile;
    override: OverrideRecord | null;
    classificationInputs: ProfileClassificationInputs;
  };

  enterpriseValue: EnterpriseValueInput;

  multiplesInput: Omit<MultiplesInput, "gate1State" | "triggerBFired">;

  marginHistory: MarginHistoryInput;

  fcf: FcfInput;

  reinvestment: ReinvestmentInput;
  ronic: RonicInput;
  impliedReturnOnNewCapital: ImpliedReturnOnNewCapitalInput | null;

  // Everything reverseDcf.ts's ReverseDcfInput needs EXCEPT gate1State and
  // ronicCells, both threaded through from gates/M5 by this function.
  reverseDcf: Omit<ReverseDcfInput, "gate1State" | "ronicCells">;

  fcfYieldGrowth: FcfYieldGrowthInput;

  runRate: RunRateInput;

  shapeMismatch: { guidedNearTermGrowth: Decimal | null; impliedConstantGrowth: Decimal | null };

  rateSensitivityCells: { plusOnePoint: Decimal; minusOnePoint: Decimal } | null;

  // M8 needs a terminal PV directly — neither M7's exported cell type nor
  // M15's scenario function surfaces its internal terminal value as a
  // standalone figure, and this file does not duplicate either module's
  // terminal-value formula to extract one. The fixture author computes it
  // from whichever cell/scenario it represents and supplies it here.
  terminalValuePv: Decimal | null;

  // M9 — explicitly labelled by the metric it actually divides (§7.2 M9).
  impliedExitMultipleMetric: { value: SourcedValue<Decimal> | null; metricName: string };

  scenarios: ScenarioInputSet;
  scenarioValues: { bear: Decimal; base: Decimal; bull: Decimal };
  // null where the fixture has no real revaluation-at-rate solver — see
  // computeScenarioOutputs's own doc comment (CB-AUDIT-01 H2). Never a
  // placeholder formula standing in for one.
  revalueBaseCaseAtRate: ((rate: Decimal) => Decimal) | null;

  configuredConstants: UndefinedPolicyConstants;

  // §9.6 rule 2 needs two facts about the run that no calculation module
  // produces: whether a human confirmed the profile (§6.3's *Cannot judge*
  // raises PROFILE NOT CONFIRMED on the valuation path) and which facts failed
  // a §3.8.2 cross-check. Both are already known where a real run is built —
  // see gate.ts — and they arrive here rather than being guessed at, because
  // guessing either way would make trust say something about a run that is not
  // true of it.
  trustInputs: {
    profileHumanConfirmed: boolean;
    crossCheckFailedFactIds: readonly string[];
  };

  // Populated only for the pre-revenue profile.
  preRevenue: PreRevenueFixture | null;
}

/**
 * Step 7's three scenarios as they arrive — where a driver may be null because
 * nobody authored it (CB-AUDIT-01 H4c: the OKLO validation set carries 0 for
 * all nine, which Section F printed as 0.0% growth, margin and reinvestment).
 * A null driver reaches the result as NaN, with INCOMPLETE bound to that
 * scenario (notComputed.ts) — the schema's ScenarioSet has no way to hold the
 * absence itself.
 */
type NullableDrivers = "revenueGrowthOrPath" | "operatingMargin" | "reinvestmentCapitalIntensity";
export type ScenarioDriverInputs = Omit<ScenarioDriverSet, NullableDrivers> & {
  [K in NullableDrivers]: ScenarioDriverSet[K] | null;
};
export type ScenarioInputSet = Record<keyof ScenarioSet, ScenarioDriverInputs>;

const DRIVER_LABELS: Record<NullableDrivers, string> = {
  revenueGrowthOrPath: "revenue growth",
  operatingMargin: "operating margin",
  reinvestmentCapitalIntensity: "reinvestment",
};

export interface PreRevenueFixture {
  // CalFinance Methodology v2's acquired-run cash basis. null only where the
  // component facts behind it were not acquired/authored for this run — see
  // the matching *Cause field, which assembly turns into the bound
  // notComputed.ts state (never a zero or fixture substitute). vFail below is
  // always this same basis — it is not a per-definition input.
  cashPerShare: Decimal | null;
  cashPerShareAsOfDate: string | null;
  cashPerShareCause: string | null;
  quarterlyBurn: Decimal | null;
  quarterlyBurnAsOfDate: string | null;
  quarterlyBurnCause: string | null;
  runway: Decimal | null;
  runwayCause: string | null;
  unitEconomics: UnitExitEconomicsInput;
  fundingStackShared: Omit<FundingStackYearParams, "capacityAddedByYear">;
  backLoadedCapacityByYear: Decimal[];
  steadyCapacityByYear: Decimal[];
  successDefinitions: {
    definition: string;
    vSuccess: Decimal;
    rSuccess: Decimal;
    rFail: Decimal;
    rateCapped: boolean;
  }[];
}

function sourced(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: CLEAN_PROVENANCE };
}

export function assembleAnalysisResult(fixture: CompanyFixture): AnalysisResult {
  // --- Gates + triggers (Milestone 3, unchanged) ---------------------------
  const gate0 = evaluateGate0(fixture.gate0);
  const gate1 = evaluateGate1(fixture.gate1);
  const triggerA = evaluateTriggerA(fixture.triggerMargins);
  const triggerB = evaluateTriggerB(fixture.triggerMargins);

  // --- M1 — enterprise value ------------------------------------------------
  const enterpriseValueBridge = computeEnterpriseValue(fixture.enterpriseValue);
  const currentEnterpriseValue: SourcedValue<Decimal> | null = enterpriseValueBridge.suppressed
    ? null
    : sourced(enterpriseValueBridge.value.enterpriseValue);
  const baseRevenueSourced = fixture.reverseDcf.baseYearRevenue;

  // --- §6.5 — the leverage precondition, AFTER M1 ---------------------------
  //
  // The ratio's denominator is enterprise value, so the precondition cannot be
  // evaluated before M1 has produced one. It used to be evaluated first, which
  // meant an acquired run — where companyInputs.ts supplies
  // `leverage.enterpriseValue` as null precisely because "it is filled by
  // assemble from M1's own output" — failed the test closed on a missing input
  // whatever the company's actual leverage. V4 pins Microsoft at "Leverage PASS
  // at 0.8%", and a run that cannot reach a ratio cannot reach that.
  //
  // The fixture's own EV still wins where it supplies one, so a fixture that
  // states the bridge directly is unaffected. Where it supplies null and M1
  // computed a value, M1's is used; where M1 is itself suppressed,
  // `currentEnterpriseValue` is null and the precondition fails closed exactly
  // as before (§5.3, §6.5, V8).
  const leverage = evaluateLeverage({
    ...fixture.leverage,
    enterpriseValue: fixture.leverage.enterpriseValue ?? currentEnterpriseValue?.value ?? null,
  });

  // --- M2 — multiples --------------------------------------------------------
  const multiples = computeMultiples({
    ...fixture.multiplesInput,
    gate1State: gate1.state,
    triggerBFired: triggerB.fired,
  });

  // --- M3 — margin history -----------------------------------------------
  const marginHistory = computeMarginHistory(fixture.marginHistory);

  // --- M4 — FCF ------------------------------------------------------------
  const fcf = computeFcf(fixture.fcf);

  // --- M5 — reinvestment / RONIC + implied-return-on-new-capital diagnostic
  const reinvestmentRonic = computeReinvestmentRonic(fixture.reinvestment, fixture.ronic);
  // §10.0.1 / §10.2 Section D require every M1-M14 diagnostic in the
  // output, and V4 pins this one's MSFT value at 20.9% — so it belongs in
  // DiagnosticsResult like every other M1-M14 figure (schema corrected;
  // see DiagnosticsResult.impliedReturnOnNewCapital's own doc comment).
  // The formula is unchanged (computeImpliedReturnOnNewCapital, untouched).
  // A fixture that supplies no input (e.g. OKLO, pre-revenue — no
  // per-unit NOPAT concept) still produces a real Figure here, via the
  // SAME missing-REQUIRED-input path the function already uses for any
  // other incomplete call — never a field that's simply absent.
  const impliedReturnOnNewCapital = fixture.impliedReturnOnNewCapital
    ? computeImpliedReturnOnNewCapital(fixture.impliedReturnOnNewCapital)
    : computeImpliedReturnOnNewCapital({
        reinvestmentInput: {
          capex: null,
          acquisitions: null,
          financeLeaseRouAdditions: null,
          depreciationAndAmortization: null,
          deltaNwc: null,
          deltaRevenue: null,
        },
        currentNopat: null,
        currentYearNopatGrowth: null,
      });

  const ronicCells = reinvestmentRonic.ronic.suppressed ? [] : reinvestmentRonic.ronic.value.cells;

  // --- M6 — steady-state EV / PVGO -----------------------------------------
  // Steady-state EV needs median-margin NOPAT directly. Derived here from
  // the reverseDcf bundle's own median margin x base revenue, after tax,
  // using the SAME nopatTaxRate every other module in this run reads from
  // `fixture.configuredConstants` — not a second, independently-chosen rate.
  const nopatTaxRateForRun = fixture.configuredConstants.nopatTaxRate;
  const medianMarginNopat: SourcedValue<Decimal> | null =
    fixture.reverseDcf.medianMargin !== null && baseRevenueSourced !== null && nopatTaxRateForRun !== null
      ? sourced(baseRevenueSourced.value.mul(fixture.reverseDcf.medianMargin.value).mul(new Decimal(1).minus(nopatTaxRateForRun)))
      : null;
  const currentMarginNopat: SourcedValue<Decimal> | null =
    fixture.reverseDcf.currentMargin !== null && baseRevenueSourced !== null && nopatTaxRateForRun !== null
      ? sourced(baseRevenueSourced.value.mul(fixture.reverseDcf.currentMargin.value).mul(new Decimal(1).minus(nopatTaxRateForRun)))
      : null;

  const steadyStateEvPvgo = computeSteadyStateEvPvgo({
    currentEnterpriseValue,
    medianMarginNopat,
    currentNopat: currentMarginNopat,
    discountRate: sourced(POLICY.rateGrid[1]),
    leverageUnsupported: leverage.result === "LEVERAGE UNSUPPORTED IN v1",
    triggerAOrBFired: triggerA.fired || triggerB.fired,
  });

  // --- M7 — reverse DCF grid (nine cells) -----------------------------------
  const reverseDcfGrid = computeReverseDcfGrid({
    ...fixture.reverseDcf,
    gate1State: gate1.state,
    ronicCells,
    configuredStressMarginLevel: fixture.configuredConstants.stressMarginLevel,
    configuredNopatTaxRate: fixture.configuredConstants.nopatTaxRate,
  });

  // --- M9 — implied exit multiple, labelled by the metric it actually divides
  const impliedExitMultiple = computeImpliedExitMultiple(
    currentEnterpriseValue,
    fixture.impliedExitMultipleMetric.value,
    fixture.impliedExitMultipleMetric.metricName
  );

  // --- M8 — terminal diagnostics (fixture supplies the terminal PV directly
  // — see CompanyFixture.terminalValuePv's own doc comment for why) --------
  const terminal =
    fixture.terminalValuePv !== null && currentEnterpriseValue !== null
      ? computeTerminalDiagnostics(fixture.terminalValuePv, currentEnterpriseValue.value)
      : { terminalShareOfValue: new Decimal(0), terminalFcfConsistencyApplied: true as const };

  // --- M10 — rate sensitivity ------------------------------------------------
  //
  // CB-AUDIT-01 H4. currentEnterpriseValue absent used to fall through to
  // `?? new Decimal(0)` here, substituting a zero enterprise value into a
  // real computation (0/0, a NaN sensitivity dressed up as a figure). Both
  // inputs are required before computing at all; without either, the module's
  // not-modelled state stands (no figure), and the reason is bound to the
  // output below so the report can say which input was missing.
  const rateSensitivityMissing =
    fixture.rateSensitivityCells === null
      ? "missing REQUIRED input: the base case revalued at a discount rate one point higher and one point lower — none was supplied for this run"
      : currentEnterpriseValue === null
        ? "missing REQUIRED input: enterprise value, which is INCOMPLETE on this run"
        : null;
  const rateSensitivity =
    fixture.rateSensitivityCells !== null && currentEnterpriseValue !== null
      ? computeRateSensitivity(
          currentEnterpriseValue.value,
          currentEnterpriseValue.value.mul(new Decimal(1).plus(fixture.rateSensitivityCells.plusOnePoint)),
          currentEnterpriseValue.value.mul(new Decimal(1).plus(fixture.rateSensitivityCells.minusOnePoint))
        )
      : rateSensitivityNotModelled();

  // --- M11 — FCF yield + growth ----------------------------------------------
  const fcfYieldGrowth = computeFcfYieldGrowth(fixture.fcfYieldGrowth);

  // --- M12 — run rate ----------------------------------------------------
  const runRate = computeRunRate(fixture.runRate);

  // --- M13 — shape mismatch -------------------------------------------------
  const shapeMismatch = computeShapeMismatch(fixture.shapeMismatch.guidedNearTermGrowth, fixture.shapeMismatch.impliedConstantGrowth);

  // --- M14 — sensitivity (tornado/two-way tables left to Step 4 wiring; see
  // sensitivity.ts's own Step 4 note — debtShareRemoved is the only settled
  // field at this milestone) ------------------------------------------------
  const sensitivity = buildSensitivityResult();

  // --- M15 — scenario outputs ------------------------------------------------
  const scenarioOutputs = computeScenarioOutputs({
    bearValue: fixture.scenarioValues.bear,
    baseValue: fixture.scenarioValues.base,
    bullValue: fixture.scenarioValues.bull,
    // Equal-weight, summing to 1 — display only, never a headline. Was
    // {1,1,1}, which sums to 3 and turned the weighted average into a
    // plain sum (B1, third-pass fix; authorised for this one line only).
    weights: { bear: new Decimal("1").dividedBy(3), base: new Decimal("1").dividedBy(3), bull: new Decimal("1").dividedBy(3) },
    currentPrice: fixture.price.value,
    revalueBaseCaseAtRate: fixture.revalueBaseCaseAtRate,
  });

  // --- §10 F — the analyst's scenarios, as the result carries them -----------
  //
  // A driver nobody authored reaches the schema's ScenarioSet as NaN — it has
  // no way to hold the absence — and the scenario gets INCOMPLETE bound to it
  // below, naming which drivers are missing.
  const missingDriversByScenario: Partial<Record<keyof ScenarioSet, string[]>> = {};
  const scenarioAsCarried = (key: keyof ScenarioSet): ScenarioDriverSet => {
    const s = fixture.scenarios[key];
    const missing = (Object.keys(DRIVER_LABELS) as NullableDrivers[]).filter((d) => s[d] === null);
    if (missing.length > 0) missingDriversByScenario[key] = missing.map((d) => DRIVER_LABELS[d]);
    return {
      ...s,
      revenueGrowthOrPath: s.revenueGrowthOrPath ?? new Decimal(NaN),
      operatingMargin: s.operatingMargin ?? new Decimal(NaN),
      reinvestmentCapitalIntensity: s.reinvestmentCapitalIntensity ?? new Decimal(NaN),
    };
  };
  const scenarios: ScenarioSet = {
    bear: scenarioAsCarried("bear"),
    base: scenarioAsCarried("base"),
    bull: scenarioAsCarried("bull"),
  };

  // --- states summary, BEFORE the range that has to read it ----------------
  //
  // M8-d FIX 1. This block used to sit at the bottom of the function, after
  // the fair-value range had already been built — so `gate0.result` was
  // recorded here and never read again, and a range rendered beside a state
  // saying there is no range. It is computed first now because the range is
  // downstream of it, which is the actual dependency.
  //
  // Each entry carries the §9.3 scope of what it suppresses (defaulted from
  // the state's own row by `scopeOf`) and its cause, so the output that gets
  // removed can name why (§9.5).
  const suppressing: ActiveSuppression[] = [];
  const qualifying: { flag: QualifyingFlag; appliesTo: string }[] = [];

  if (gate0.result !== "PASS") {
    suppressing.push({
      state: gate0.result,
      appliesTo: "all valuation outputs",
      cause: gate0Cause(gate0),
    });
  }
  // Gate 1 never refuses: HISTORY INSUFFICIENT (<5 filed years) is the only
  // SuppressingState it can return. SHORT HISTORY (5-9 years) is a
  // QualifyingFlag — the window is labelled, not suppressed (§6.2).
  if (gate1.state === "HISTORY INSUFFICIENT") {
    suppressing.push({
      state: "HISTORY INSUFFICIENT",
      appliesTo: "own-history percentile and history-based normalisation",
      cause: `${gate1.filedYearsCount} filed years`,
    });
  } else if (gate1.state === "SHORT HISTORY") {
    qualifying.push({ flag: "SHORT HISTORY", appliesTo: `history statistics (${gate1.filedYearsCount}-year window)` });
  }
  if (leverage.result === "LEVERAGE UNSUPPORTED IN v1") {
    suppressing.push({
      state: leverage.result,
      appliesTo: "every rate-dependent output",
      cause: leverageCause(leverage),
    });
  }
  if (fcfYieldGrowth.precondition === "PRECONDITION FAILED") {
    suppressing.push({ state: "PRECONDITION FAILED", appliesTo: "FCF yield + growth" });
  }
  for (const cell of reverseDcfGrid) {
    if (cell.fiveYearGrowth.suppressed) {
      suppressing.push({
        state: cell.fiveYearGrowth.state,
        appliesTo: `reverse-DCF cell ${cell.marginLevel}/${cell.rate}`,
        // One cell, never the grid and never the range (§9.3 row 5). MSFT
        // renders its range with four of these active; OKLO renders its
        // distribution summary with nine.
        scope: "the affected reverse-DCF cell",
        cause: cell.fiveYearGrowth.cause,
      });
    }
  }
  // --- outputs the schema types as a bare Decimal (notComputed.ts) --------
  //
  // Each was printed as a figure, or given a false reason for its absence,
  // when nothing computed it (CB-AUDIT-01 H2/H4). None is an input of the
  // fair-value range, so none removes it.
  if (rateSensitivityMissing !== null) {
    suppressing.push(notComputed(NOT_COMPUTED_BINDING.rateSensitivity, "INCOMPLETE", rateSensitivityMissing));
  }
  // G. Two different outcomes both arrive as a null rate, and they are two
  // different statements: no revaluation function was supplied, so nothing
  // ran — or one was, the solver searched, and the bracket held no root.
  if (fixture.revalueBaseCaseAtRate === null) {
    suppressing.push(
      notComputed(
        NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice,
        "INCOMPLETE",
        "missing REQUIRED input: a revaluation of the base case at other discount rates — none was supplied for this run, so no rate was solved for"
      )
    );
  } else if (scenarioOutputs.rateAtWhichBaseEqualsPrice === null) {
    // Design §6's cause line for this state is "the bracket and the value at
    // each end". The bracket only: `states` is one of the members the blind
    // challenger receives (§8.5.1), so a base-case value written into a cause
    // here would reach the one call §8.5.2 keeps valuation outputs away from.
    const b = rateSearchBracket(fixture.revalueBaseCaseAtRate);
    const asPct = (r: Decimal) => `${r.mul(100).toFixed(0)}%`;
    suppressing.push(
      notComputed(
        NOT_COMPUTED_BINDING.rateAtWhichBaseEqualsPrice,
        "NO SOLUTION IN RANGE",
        `searched ${asPct(b.lo)} to ${asPct(b.hi)}: no rate in that bracket brings the base case to the price`
      )
    );
  }
  for (const key of ["bear", "base", "bull"] as const) {
    const missing = missingDriversByScenario[key];
    if (missing === undefined) continue;
    suppressing.push(
      notComputed(
        NOT_COMPUTED_BINDING.scenarioDrivers(key),
        "INCOMPLETE",
        `missing REQUIRED input(s): ${missing.join(", ")} — not authored for this scenario`
      )
    );
  }
  // --- §7.2 M16 / CalFinance Methodology v2 — the acquired-run cash basis --
  //
  // cashPerShare is a REQUIRED input of the fair-value range (it IS the
  // range's `failure`/`cashFloor`), so its absence removes the range itself
  // (§9.6 rule 1's second clause) — the explicit `scope` override
  // suppression.ts documents for exactly this case. quarterlyBurn and
  // runway are not range inputs; their absence stays scoped to themselves.
  if (fixture.preRevenue !== null) {
    const pr = fixture.preRevenue;
    if (pr.cashPerShare === null) {
      suppressing.push({
        ...notComputed(NOT_COMPUTED_BINDING.cashPerShare, "INCOMPLETE", pr.cashPerShareCause ?? "not established"),
        scope: "the fair-value range",
      });
    }
    if (pr.quarterlyBurn === null) {
      suppressing.push(notComputed(NOT_COMPUTED_BINDING.quarterlyBurn, "INCOMPLETE", pr.quarterlyBurnCause ?? "not established"));
    }
    if (pr.runway === null) {
      suppressing.push(notComputed(NOT_COMPUTED_BINDING.runway, "INCOMPLETE", pr.runwayCause ?? "not established"));
    }
  }

  if (triggerA.fired) qualifying.push({ flag: "MARGIN AT HISTORICAL HIGH", appliesTo: "operating margin" });
  if (reinvestmentRonic.capitalLight) qualifying.push({ flag: "CAPITAL-LIGHT", appliesTo: "reinvestment/RONIC" });

  // --- §10 H — fair-value range ------------------------------------------
  // `successAsCommonlyDescribed` is a RANGE (types.ts), not a single
  // Decimal — corrected per the approved OKLO design mock
  // (design2/mock-report-oklo.html, hash-verified), which shows this as
  // "$31-$48" twice (lines 306, 683), never a single number. Populated
  // here from the [min, max] of every qualifying success value
  // (vSuccess > vFail) — no selection between them, both preserved
  // exactly as successDefinitions itself already holds them. When no
  // definition qualifies, both bounds fall back to cashFloor (the one
  // figure guaranteed present) rather than being invented.
  // vFail is always the acquired-run cash-per-share basis (methodology v2) —
  // never a per-definition input — so "qualifies" compares against that one
  // shared value, not a field the fixture's successDefinitions carry.
  const cashPerShareBasis = fixture.preRevenue?.cashPerShare ?? null;
  const qualifyingSuccessValues =
    fixture.preRevenue !== null && cashPerShareBasis !== null
      ? fixture.preRevenue.successDefinitions.filter((d) => d.vSuccess.greaterThan(cashPerShareBasis)).map((d) => d.vSuccess)
      : undefined;
  const computedFairValueRange: AnalysisResult["fairValueRange"] =
    fixture.preRevenue !== null
      ? {
          kind: "pre-revenue-distribution",
          failure: cashPerShareBasis ?? new Decimal(NaN),
          successAsCommonlyDescribed:
            qualifyingSuccessValues && qualifyingSuccessValues.length > 0
              ? {
                  low: qualifyingSuccessValues.reduce((min, v) => (v.lessThan(min) ? v : min)),
                  high: qualifyingSuccessValues.reduce((max, v) => (v.greaterThan(max) ? v : max)),
                }
              : { low: cashPerShareBasis ?? new Decimal(NaN), high: cashPerShareBasis ?? new Decimal(NaN) },
          successAsPriceRequires: fixture.price.value,
          cashFloor: cashPerShareBasis ?? new Decimal(NaN),
        }
      : {
          kind: "range",
          bear: fixture.scenarioValues.bear,
          bull: fixture.scenarioValues.bull,
          weightedValueInside: scenarioOutputs.weightedDistribution,
          drivingInputs: ["years 1-5 revenue growth", "operating margin path", "reinvestment as % of NOPAT"],
          scenarioLabelsWarning: triggerA.fired || triggerB.fired,
        };

  // §10.3 / §9.5 — "Where any suppressing state is active there is no
  // fair-value range. The state IS the output."
  //
  // The decision is the RULE in suppression.ts, over §9.3's own mapping of
  // state to suppressed output — not a check against the states this file
  // happens to know about. A state added to §9.3 later inherits this without
  // anything here changing.
  const rangeRemovedBy = stateRemovingFairValueRange(suppressing);
  const fairValueRange: AnalysisResult["fairValueRange"] =
    rangeRemovedBy === null
      ? computedFairValueRange
      : {
          kind: "suppressed",
          state: rangeRemovedBy.state,
          cause: rangeRemovedBy.cause ?? `suppressed with ${rangeRemovedBy.appliesTo}`,
        };

  // The range's own removal is itself an active state bound to the range
  // (§10.0.1: each state "bound to the output it applies to"), so the §10.2
  // section A manifest says the range is gone and why — rather than leaving
  // the reader to infer it from the absence.
  if (rangeRemovedBy !== null) {
    suppressing.push({
      state: rangeRemovedBy.state,
      appliesTo: "the fair-value range",
      scope: "the fair-value range",
      cause: rangeRemovedBy.cause,
    });
  }

  // --- M16 — pre-revenue module (populated only for that profile) --------
  const preRevenue =
    fixture.preRevenue !== null
      ? (() => {
          const p = fixture.preRevenue as PreRevenueFixture;
          const ramps = computeBothFundingRamps(p.backLoadedCapacityByYear, p.steadyCapacityByYear, p.fundingStackShared);
          const breakEven = computeUnitExitBreakEvenPrice(p.unitEconomics);
          const unitEconomicsBreakeven: Figure<Decimal> = breakEven.available
            ? { suppressed: false, value: breakEven.breakEvenOutputPrice, qualification: { provenanceTokens: CLEAN_PROVENANCE, analyticFlags: [] } }
            : { suppressed: true, state: "INCOMPLETE" as SuppressingState, cause: breakEven.cause };

          // V_fail is always the acquired-run cash-per-share basis — never a
          // per-definition input (CalFinance Methodology v2). V_success is
          // always a present value as of today (the basis rule's own words:
          // "both a present value as of today") — the run's price timestamp,
          // not a fixture-supplied date.
          const vFail = p.cashPerShare ?? new Decimal(NaN);
          const vFailAsOfDate = p.cashPerShare !== null ? p.cashPerShareAsOfDate : null;
          const vSuccessAsOfDate = fixture.price.timestamp;
          const dateCause = successWeightDateCause(vFailAsOfDate, vSuccessAsOfDate);

          const successDefinitions: SuccessDefinitionRow[] = p.successDefinitions
            .map((d) => ({
              definition: d.definition,
              vSuccess: d.vSuccess,
              vSuccessAsOfDate,
              vFail,
              vFailAsOfDate,
              rSuccess: d.rSuccess,
              rFail: d.rFail,
              rateCapped: d.rateCapped,
              // "may be computed only when V_fail and V_success are
              // expressed on the same valuation date and otherwise
              // comparable basis" — checked once per row (each row's V_fail
              // is the same basis, but the check stays per-row so a future
              // per-definition V_success date cannot silently skip it).
              state: dateCause !== null ? ({ kind: "NOT COMPUTED / SUPPRESSED", cause: dateCause } as const) : computeImpliedProbability(d.vSuccess, vFail, fixture.price.value),
            }))
            .sort((a, b) => a.vSuccess.minus(b.vSuccess).toNumber());

          const fundingStackByYear = {
            back_loaded: (ramps.back_loaded.years ?? []).map((y) => ({ year: y.year, lines: y.lines })),
            steady: (ramps.steady.years ?? []).map((y) => ({ year: y.year, lines: y.lines })),
          };

          return {
            cashPerShare: vFail,
            cashPerShareAsOfDate: vFailAsOfDate,
            quarterlyBurn: p.quarterlyBurn ?? new Decimal(NaN),
            quarterlyBurnAsOfDate: p.quarterlyBurn !== null ? p.quarterlyBurnAsOfDate : null,
            runway: p.runway ?? new Decimal(NaN),
            unitEconomicsBreakeven,
            fundingStackByYear,
            dilutionRequired: ramps.back_loaded.dilutionRequired ?? new Decimal(0),
            successDefinitions,
          };
        })()
      : null;

  // Named rather than inlined into the return, because §9.6 reads it: a
  // REQUIRED input of any other output being INCOMPLETE is one of PARTIAL's
  // conditions, and trust scans these figures for it.
  const diagnostics: AnalysisResult["diagnostics"] = {
    enterpriseValue: enterpriseValueBridge,
    multiples,
    marginHistory,
    fcf,
    reinvestmentRonic,
    impliedReturnOnNewCapital,
    terminal,
    impliedExitMultiple,
    rateSensitivity,
    fcfYieldGrowth,
    runRate,
    shapeMismatch,
    sensitivity,
  };

  return {
    schemaVersion: fixture.schemaVersion,
    runId: fixture.runId,
    ticker: fixture.ticker,
    companyName: fixture.companyName,
    price: fixture.price,
    facts: fixture.facts,
    provenance: [],
    gates: { gate0, gate1, leverage, triggerA, triggerB },
    profile: fixture.profile,
    // The §9.3 scope and the cause are assembly's working detail; the contract
    // member is the state and what it is bound to (§10.0.1).
    states: {
      suppressing: suppressing.map(({ state, appliesTo }) => ({ state, appliesTo })),
      qualifying,
    },
    diagnostics,
    scenarios,
    scenarioOutputs,
    priceImplied: {
      steadyStateEv: steadyStateEvPvgo.steadyStateEv,
      pvgo: steadyStateEvPvgo.pvgo,
      pvgoShareOfEv: steadyStateEvPvgo.pvgoShareOfEv,
      nopatGap: steadyStateEvPvgo.nopatGap,
      reverseDcfGrid,
      impliedExitMultiple,
    },
    fairValueRange,
    // §9.6, computed LAST of the deterministic members because every input it
    // reads is one of them — and reading `fairValueRange` rather than
    // re-deriving §10.3 is what keeps the status and the refusal one fact.
    trust: computeTrustStatus({
      fairValueRange,
      states: { suppressing, qualifying },
      facts: fixture.facts,
      diagnostics,
      profileHumanConfirmed: fixture.trustInputs.profileHumanConfirmed,
      crossCheckFailedFactIds: fixture.trustInputs.crossCheckFailedFactIds,
    }),
    preRevenue,
    // Both members are the AI layer's, and the AI layer runs AFTER this
    // function: §8.1 puts calculation on one side of the boundary and
    // interpretation on the other, and §8.5.4 says the challenger's findings
    // enter the report only once its own call has completed. Assembly
    // therefore produces an analysis that is complete and says nothing —
    // lib/analyzer/ai/run.ts merges the two in, and a report whose calls have
    // not run renders both sections honestly empty rather than inventing copy.
    challenger: null,
    interpretation: { statements: [], pageOne: null },
    policy: {
      constants: POLICY,
      undefinedConstants: fixture.configuredConstants,
      provisionalLabels: buildProvisionalLabels(),
    },
  };
}
