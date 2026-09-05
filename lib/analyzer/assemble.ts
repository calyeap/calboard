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
import { computeRateSensitivity } from "./modules/rateSensitivity";
import { computeFcfYieldGrowth, type FcfYieldGrowthInput } from "./modules/fcfYieldGrowth";
import { computeRunRate, type RunRateInput } from "./modules/runRate";
import { computeShapeMismatch } from "./modules/shapeMismatch";
import { buildSensitivityResult } from "./modules/sensitivity";
import { computeScenarioEnterpriseValue, computeScenarioOutputs } from "./modules/scenarioOutputs";
import {
  computeFundingStackYearByYear,
  computeBothFundingRamps,
  computeImpliedProbability,
  computeUnitExitBreakEvenPrice,
  type FundingStackYearParams,
  type UnitExitEconomicsInput,
} from "./modules/preRevenue";
import { evaluateGate0, evaluateGate1, evaluateLeverage, evaluateTriggerA, evaluateTriggerB } from "./gates";
import type { Gate0Input, Gate1Input, LeverageInput, TriggerMarginInput } from "./gates";
import { CLEAN_PROVENANCE } from "./provenance";
import type {
  AnalysisResult,
  FactRecord,
  Figure,
  OverrideRecord,
  Profile,
  ProfileClassificationInputs,
  QualifyingFlag,
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

  scenarios: ScenarioSet;
  scenarioValues: { bear: Decimal; base: Decimal; bull: Decimal };
  revalueBaseCaseAtRate: (rate: Decimal) => Decimal;

  configuredConstants: UndefinedPolicyConstants;

  // Populated only for the pre-revenue profile.
  preRevenue: PreRevenueFixture | null;
}

export interface PreRevenueFixture {
  cashPerShare: Decimal;
  quarterlyBurn: Decimal;
  runway: Decimal;
  unitEconomics: UnitExitEconomicsInput;
  fundingStackShared: Omit<FundingStackYearParams, "capacityAddedByYear">;
  backLoadedCapacityByYear: Decimal[];
  steadyCapacityByYear: Decimal[];
  successDefinitions: {
    definition: string;
    vSuccess: Decimal;
    vFail: Decimal;
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
  const leverage = evaluateLeverage(fixture.leverage);
  const triggerA = evaluateTriggerA(fixture.triggerMargins);
  const triggerB = evaluateTriggerB(fixture.triggerMargins);

  // --- M1 — enterprise value ------------------------------------------------
  const enterpriseValueBridge = computeEnterpriseValue(fixture.enterpriseValue);
  const currentEnterpriseValue: SourcedValue<Decimal> | null = enterpriseValueBridge.suppressed
    ? null
    : sourced(enterpriseValueBridge.value.enterpriseValue);
  const baseRevenueSourced = fixture.reverseDcf.baseYearRevenue;

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
  // CONTRACT GAP, surfaced by this assembly, not fixed here: this
  // diagnostic (approved d811305/ff21bad, kept structurally separate from
  // RONIC and never fed into M7 by design) has no field anywhere in
  // AnalysisResult / DiagnosticsResult (types.ts) — computed here so the
  // gap is visible, but there is currently nowhere in the frozen contract
  // for it to go. Flagged for a Command Center decision, not resolved by
  // silently adding a field to the contract.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const impliedReturnOnNewCapital = fixture.impliedReturnOnNewCapital
    ? computeImpliedReturnOnNewCapital(fixture.impliedReturnOnNewCapital)
    : null;
  void impliedReturnOnNewCapital;

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
  const rateSensitivity = fixture.rateSensitivityCells
    ? computeRateSensitivity(
        currentEnterpriseValue?.value ?? new Decimal(0),
        currentEnterpriseValue?.value.mul(new Decimal(1).plus(fixture.rateSensitivityCells.plusOnePoint)) ?? new Decimal(0),
        currentEnterpriseValue?.value.mul(new Decimal(1).plus(fixture.rateSensitivityCells.minusOnePoint)) ?? new Decimal(0)
      )
    : { plusOnePoint: new Decimal(0), minusOnePoint: new Decimal(0), closeToDeterministicFunctionOfTerminalShare: true as const };

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
    weights: { bear: new Decimal("1"), base: new Decimal("1"), bull: new Decimal("1") }, // equal-weight display only; never a headline
    currentPrice: fixture.price.value,
    revalueBaseCaseAtRate: fixture.revalueBaseCaseAtRate,
  });

  // --- §10 H — fair-value range ------------------------------------------
  const fairValueRange: AnalysisResult["fairValueRange"] =
    fixture.preRevenue !== null
      ? {
          kind: "pre-revenue-distribution",
          failure: fixture.preRevenue.cashPerShare,
          successAsCommonlyDescribed: fixture.preRevenue.successDefinitions
            .filter((d) => d.vSuccess.greaterThan(d.vFail))
            .reduce((max, d) => (d.vSuccess.greaterThan(max) ? d.vSuccess : max), new Decimal(0)),
          successAsPriceRequires: fixture.price.value,
          cashFloor: fixture.preRevenue.cashPerShare,
        }
      : {
          kind: "range",
          bear: fixture.scenarioValues.bear,
          bull: fixture.scenarioValues.bull,
          weightedValueInside: scenarioOutputs.weightedDistribution,
          drivingInputs: ["years 1-5 revenue growth", "operating margin path", "reinvestment as % of NOPAT"],
          scenarioLabelsWarning: triggerA.fired || triggerB.fired,
        };

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

          const successDefinitions: SuccessDefinitionRow[] = p.successDefinitions
            .map((d) => ({
              definition: d.definition,
              vSuccess: d.vSuccess,
              vFail: d.vFail,
              rSuccess: d.rSuccess,
              rFail: d.rFail,
              rateCapped: d.rateCapped,
              state: computeImpliedProbability(d.vSuccess, d.vFail, fixture.price.value),
            }))
            .sort((a, b) => a.vSuccess.minus(b.vSuccess).toNumber());

          const fundingStackByYear = {
            back_loaded: (ramps.back_loaded.years ?? []).map((y) => ({ year: y.year, lines: y.lines })),
            steady: (ramps.steady.years ?? []).map((y) => ({ year: y.year, lines: y.lines })),
          };

          return {
            cashPerShare: p.cashPerShare,
            quarterlyBurn: p.quarterlyBurn,
            runway: p.runway,
            unitEconomicsBreakeven,
            fundingStackByYear,
            dilutionRequired: ramps.back_loaded.dilutionRequired ?? new Decimal(0),
            successDefinitions,
          };
        })()
      : null;

  // --- states summary --------------------------------------------------------
  const suppressing: { state: SuppressingState; appliesTo: string }[] = [];
  const qualifying: { flag: QualifyingFlag; appliesTo: string }[] = [];

  if (gate0.result !== "PASS") suppressing.push({ state: gate0.result, appliesTo: "all valuation outputs" });
  // Gate 1 never refuses: HISTORY INSUFFICIENT (<5 filed years) is the only
  // SuppressingState it can return. SHORT HISTORY (5-9 years) is a
  // QualifyingFlag — the window is labelled, not suppressed (§6.2).
  if (gate1.state === "HISTORY INSUFFICIENT") {
    suppressing.push({ state: "HISTORY INSUFFICIENT", appliesTo: "own-history percentile and history-based normalisation" });
  } else if (gate1.state === "SHORT HISTORY") {
    qualifying.push({ flag: "SHORT HISTORY", appliesTo: `history statistics (${gate1.filedYearsCount}-year window)` });
  }
  if (leverage.result === "LEVERAGE UNSUPPORTED IN v1") suppressing.push({ state: leverage.result, appliesTo: "every rate-dependent output" });
  if (fcfYieldGrowth.precondition === "PRECONDITION FAILED") suppressing.push({ state: "PRECONDITION FAILED", appliesTo: "FCF yield + growth" });
  for (const cell of reverseDcfGrid) {
    if (cell.fiveYearGrowth.suppressed) suppressing.push({ state: cell.fiveYearGrowth.state, appliesTo: `reverse-DCF cell ${cell.marginLevel}/${cell.rate}` });
  }
  if (triggerA.fired) qualifying.push({ flag: "MARGIN AT HISTORICAL HIGH", appliesTo: "operating margin" });
  if (reinvestmentRonic.capitalLight) qualifying.push({ flag: "CAPITAL-LIGHT", appliesTo: "reinvestment/RONIC" });

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
    states: { suppressing, qualifying },
    diagnostics: {
      enterpriseValue: enterpriseValueBridge,
      multiples,
      marginHistory,
      fcf,
      reinvestmentRonic,
      terminal,
      impliedExitMultiple,
      rateSensitivity,
      fcfYieldGrowth,
      runRate,
      shapeMismatch,
      sensitivity,
    },
    scenarios: fixture.scenarios,
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
    preRevenue,
    challenger: null,
    interpretation: { statements: [] },
    policy: {
      constants: POLICY,
      undefinedConstants: fixture.configuredConstants,
      provisionalLabels: buildProvisionalLabels(),
    },
  };
}
