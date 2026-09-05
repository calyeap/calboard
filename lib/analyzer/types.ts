import Decimal from "decimal.js";

// Stock Analyzer v1 — the Analysis Result contract (spec §10.0, §10.0.1).
// This file is the schema every calculation module, acquisition source and
// report component is built against. It has no runtime logic of its own.
//
// Representation conventions, load-bearing for every module that follows:
//  - All rates, margins, growth figures and ratios are Decimal fractions
//    (0.08 for 8%, 0.185 for 18.5%). "1 point" in spec language equals 0.01
//    here, so "0.1pt" (the §7.3 rounding granularity) is 0.001. Do not mix in
//    plain-number percentage points anywhere in this module tree — that
//    inconsistency is exactly what produced the Dashboard/Holdings rounding
//    divergence this codebase already fixed once (see money.ts).
//  - All dollar and share-count values are Decimal, never a JS number, for
//    the same reason lib/money.ts uses Decimal throughout.
//  - A "Figure" is the unit every displayed value comes in: either a
//    computed value with its qualification attached (§10.0.2 rule 1 — a
//    value is never separated from its qualifications), or a suppressed
//    state that always carries its cause (§9.5 forbids a state without one).

// ---------------------------------------------------------------------------
// §3.2 — the six-field fact record
// ---------------------------------------------------------------------------

export type FactType = "FACT" | "ASSUMPTION" | "INFERENCE";
export type SourceClass = "PRIMARY" | "SECONDARY";
export type ExtractionType = "DETERMINISTIC/STRUCTURED" | "AI-EXTRACTED";
export type VerificationState = "VERIFIED" | "UNVERIFIED" | "SPOT-CHECK PENDING";
export type Requiredness = "REQUIRED" | "OPTIONAL";

export interface FactRecord {
  id: string;
  name: string;
  type: FactType;
  // null only for an OPTIONAL fact that is genuinely absent — absence is
  // displayed, never rendered as zero (§4.3). A REQUIRED fact with no value
  // is not represented here; its dependent outputs return INCOMPLETE instead
  // (§5.1) and the fact simply has no record.
  value: Decimal | string | null;
  source: string;
  sourceUrl: string | null;
  sourceClass: SourceClass;
  extractionType: ExtractionType;
  verificationState: VerificationState;
  asOfDate: string;
  // null only where genuinely not applicable — price and financial-statement
  // figures always carry one (§3.4).
  retrievalTimestamp: string | null;
  // Set when this record restates an earlier one for the same quantity.
  // Restatements are retained side by side, never overwritten (§3.4) — both
  // FactRecords stay in the array.
  supersedesFactId: string | null;
}

// ---------------------------------------------------------------------------
// §3.2.1 / §9 — provenance and qualification, never collapsed into one score
// ---------------------------------------------------------------------------

// Three independent slots, fixed order, never merged (§7.1 of the design;
// §3.2.1 of the spec). A component accepting a single combined value here
// would not satisfy either document.
export interface ProvenanceTokens {
  sourceClass: SourceClass;
  extractionType: ExtractionType;
  verificationState: VerificationState;
}

export type ProvenanceQualifier = "SECONDARY" | "UNVERIFIED" | "AI-EXTRACTED";

export type AnalyticQualifier =
  | "LOW RONIC — VALUE-DESTROYING GROWTH"
  | "INVERTED — HIGHER GROWTH LOWERS VALUE"
  | "RONIC CAPPED AT 200%"
  | "CAPITAL-LIGHT"
  | "SHORT HISTORY"
  | "MARGIN AT HISTORICAL HIGH"
  | "PEAK EARNINGS"
  | "SHAPE MISMATCH"
  | "RATE CAPPED — VALUE IS AN UPPER BOUND";

export type QualifyingFlag = ProvenanceQualifier | AnalyticQualifier;

// "Each flag carries its number where it has one. A flag without its number
// is a mood" (design §7.2) — detail is optional only because a small number
// of analytic flags are genuinely numberless (e.g. CAPITAL-LIGHT alone,
// before its working-capital-intensity figure is attached elsewhere).
export interface AnalyticFlagInstance {
  flag: AnalyticQualifier;
  detail?: string;
}

export interface Qualification {
  provenanceTokens: ProvenanceTokens;
  analyticFlags: AnalyticFlagInstance[];
}

// ---------------------------------------------------------------------------
// §9.3 — the suppressing states
//
// Thirteen distinct literal strings, not ten: §9.3's own table groups
// "NOT COMPUTABLE / NO SOLUTION IN RANGE / DEGENERATE — TERMINAL EXCEEDS
// TOTAL VALUE" and "SUCCESS WORTH LESS THAN FAILURE / PRICE NOT JUSTIFIABLE"
// into single rows for that table's own bookkeeping, but each named state
// renders with its own cause line and is a distinct value here (design §6's
// footnote makes the same point). Gate 0 (§6.1) likewise returns one of two
// fully-named states, not a generic "UNSUPPORTED PROFILE" qualified by a
// separate cause field — the spec's own return values are the two strings
// below, and the spec wins over any document that simplifies them.
// ---------------------------------------------------------------------------

export type SuppressingState =
  | "UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1"
  | "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE"
  | "HISTORY INSUFFICIENT"
  | "LEVERAGE UNSUPPORTED IN v1"
  | "RONIC NOT MEANINGFUL"
  | "NOT COMPUTABLE"
  | "NO SOLUTION IN RANGE"
  | "DEGENERATE — TERMINAL EXCEEDS TOTAL VALUE"
  | "PRECONDITION FAILED"
  | "NOT ACHIEVABLE AT ANY SCALE"
  | "SEASONAL — RUN-RATE SUPPRESSED"
  | "INCOMPLETE"
  | "THIS SUCCESS IS WORTH LESS THAN FAILURE"
  | "PRICE NOT JUSTIFIABLE BY THIS OUTCOME";

export interface SuppressedValue {
  suppressed: true;
  state: SuppressingState;
  // Mandatory, never optional — §9.5 forbids "n/a" without the reason.
  cause: string;
}

export interface ComputedValue<T> {
  suppressed: false;
  value: T;
  qualification: Qualification;
}

// The one type every rendered number in the report comes in. `Figure`
// (design §3.1) renders ComputedValue; `StateSlot` renders SuppressedValue.
export type Figure<T> = ComputedValue<T> | SuppressedValue;

// ---------------------------------------------------------------------------
// §10.0.1 member: provenance — the derivation graph
// ---------------------------------------------------------------------------

export interface ProvenanceEdge {
  fromFactId: string;
  toValueId: string;
  // Two independent labels per edge, never a single combined quality score
  // (§10.0.1, §3.2.1).
  sourceClass: SourceClass;
  extractionType: ExtractionType;
}

export type ProvenanceGraph = ProvenanceEdge[];

// ---------------------------------------------------------------------------
// §6 — gates and triggers
// ---------------------------------------------------------------------------

export interface OverrideRecord {
  reason: string;
  // Always true when an OverrideRecord exists — the acknowledgement is a
  // statement, not a dismissable consent flow (design §5.3), so there is no
  // "acknowledged: false" state to represent.
  acknowledgedNotValidated: true;
}

export interface Gate0Result {
  result: "PASS" | Extract<SuppressingState, `UNSUPPORTED PROFILE${string}`>;
  evaluatedTests: {
    sectorClassification: string | null;
    interestIncomeOverRevenue: Decimal | null;
    hasInsurancePremiumOrReserveLineItems: boolean | null;
    industryClassification: string | null;
  };
  override: OverrideRecord | null;
}

export interface Gate1Result {
  filedYearsCount: number;
  // null means >= 10 filed years — no state, "as written throughout" (§6.2).
  state: "HISTORY INSUFFICIENT" | "SHORT HISTORY" | null;
}

export interface LeverageResult {
  // null only when a REQUIRED input is missing, which fails closed to
  // LEVERAGE UNSUPPORTED IN v1 rather than PASS (§5.3, §6.5).
  netDebtRatio: Decimal | null;
  operatingLeaseInclusiveMemo: Decimal | null;
  result: "PASS" | "LEVERAGE UNSUPPORTED IN v1";
  // The levered-residual exception (§6.5) is an explicit branch a caller
  // must check, never a special case discovered implicitly at runtime.
  leveredResidualExceptionApplies: boolean;
}

export interface TriggerResult {
  fired: boolean;
  evidence: string;
}

export interface GatesResult {
  gate0: Gate0Result;
  gate1: Gate1Result;
  leverage: LeverageResult;
  triggerA: TriggerResult;
  triggerB: TriggerResult;
}

// ---------------------------------------------------------------------------
// §6.3 — profile classification and recommendation
// ---------------------------------------------------------------------------

export type Profile =
  | "MATURE_PROFITABLE_STABLE_FCF"
  | "HIGH_GROWTH_PROFITABLE_UNCERTAIN_DURABILITY"
  | "PRE_REVENUE_UNPROFITABLE"
  // Reachable only via the Gate 0 override — never selectable through the
  // normal profile selector (design §5.3). "Has been validated on nothing"
  // (spec §1.2).
  | "ASSET_BASED";

export interface ProfileClassificationInputs {
  revenueScale: "zero" | "small" | "large";
  fcfCharacter: "negative" | "positive_volatile" | "positive_stable";
  revenueGrowthBand: ">30%" | "10-30%" | "<10%";
  capitalIntensity: Decimal;
  cyclicality: { tenYearMarginRange: Decimal; worstSingleYearChange: Decimal };
  // ASSUMPTION, not FACT — it was wrongly marked FACT in earlier versions
  // (§6.3).
  balanceSheetNature: "asset-light" | "asset-heavy";
}

export interface ProfileDecision {
  recommended: Profile;
  confirmedOrOverridden: Profile;
  override: OverrideRecord | null;
  classificationInputs: ProfileClassificationInputs;
}

// ---------------------------------------------------------------------------
// §5.4 / §10 F — analyst scenarios
// ---------------------------------------------------------------------------

export interface ScenarioDriverSet {
  // A constant rate, or an explicit year-by-year path where a constant rate
  // does not describe the company (RevenuePathEditor, design §5.4).
  revenueGrowthOrPath: Decimal | Decimal[];
  operatingMargin: Decimal;
  reinvestmentCapitalIntensity: Decimal;
  // Post-financing count where this scenario raises equity, expressed per
  // current share (§3.5).
  shareCount: Decimal;
  // Required, free text, cannot be empty (design §5.4).
  writtenAnchor: string;
}

export interface ScenarioSet {
  bear: ScenarioDriverSet;
  base: ScenarioDriverSet;
  bull: ScenarioDriverSet;
}

// ---------------------------------------------------------------------------
// §7.2 — deterministic diagnostic modules (M1–M14)
// ---------------------------------------------------------------------------

export interface EnterpriseValueBridge {
  marketCap: Decimal;
  totalDebt: Decimal;
  financeLeaseLiabilities: Decimal;
  cashAndMarketableDebtSecurities: Decimal;
  nonOperatingEquityInvestmentsAtBook: Decimal;
  enterpriseValue: Figure<Decimal>;
  // Memo only — operating leases stay excluded from the bridge itself
  // (§3.5).
  operatingLeaseInclusiveNetDebtMemo: Decimal;
}

export interface MultiplesResult {
  peTrailing: Figure<Decimal>;
  peForward: Figure<Decimal>;
  evToEbit: Figure<Decimal>;
  evToEbitda: Figure<Decimal>;
  fcfYieldOnMarketCap: Figure<Decimal>;
  priceToBook: Figure<Decimal>;
  // Never surfaced alone — always paired with the implied margin needed to
  // reach a normal profit multiple (M2, §10.5).
  evToRevenue: { value: Figure<Decimal>; impliedMarginForNormalMultiple: Decimal };
  peBasis: {
    gaapEps: Decimal;
    // Non-null only when |non-operating items| > 5% of pre-tax income — the
    // symmetric trigger correcting the methodology's gains-only asymmetry
    // (I5).
    nonOperatingItemAfterTax: Decimal | null;
    nopatBasisShown: boolean;
  };
  ownHistoryPercentile: Figure<Decimal>;
}

export interface MarginHistoryResult {
  currentMargin: Decimal;
  windowYears: number;
  range: Decimal;
  median: Decimal;
  worstSingleYearChange: Decimal;
  fiftyTwoWeekRange: [Decimal, Decimal];
}

export interface FcfResult {
  cashFcf: Decimal;
  fcfAfterLeaseFundedCapacity: Decimal;
  unleveredFcf: Decimal;
  sbc: Decimal;
  workingCapitalSwing: Decimal;
  // Both shown always; the SBC-adjusted figure is the one compared to the
  // required return (I6).
  fcfYield: { cashFcf: Decimal; cashFcfLessSbc: Decimal };
}

export type DiscountRate = 0.08 | 0.1 | 0.12;
export type MarginLevel = "current" | "median" | "stress";

export type RonicLadderState =
  | "RONIC NOT MEANINGFUL"
  | "LOW RONIC — VALUE-DESTROYING GROWTH"
  | "INVERTED — HIGHER GROWTH LOWERS VALUE"
  | "RONIC CAPPED AT 200%"
  | "CLEAN";

export interface ReinvestmentRonicResult {
  reinvestment: Decimal;
  // Evaluated per grid cell, not once per company — "the rate in that cell"
  // differs across 8/10/12% (§7.2 M5).
  ronicByCell: { rate: DiscountRate; state: RonicLadderState; value: Decimal | null }[];
  capitalLight: boolean;
  workingCapitalIntensity: Decimal | null;
  lagBiasDirection: "conservative" | "generous";
}

export interface TerminalDiagnostics {
  terminalShareOfValue: Decimal;
  // True when terminal FCF = terminal NOPAT × (1 − g ÷ terminal ROIC) was
  // used, rather than final-year FCF × (1+g) (M8).
  terminalFcfConsistencyApplied: true;
}

export interface RateSensitivity {
  plusOnePoint: Decimal;
  minusOnePoint: Decimal;
  // The required caveat, not an independent signal (M10).
  closeToDeterministicFunctionOfTerminalShare: true;
}

export interface FcfYieldGrowthResult {
  precondition: "PASS" | "PRECONDITION FAILED";
  output: Figure<Decimal> | null;
}

export interface RunRateResult {
  seasonalityTestResult: "PASS" | "SEASONAL — RUN-RATE SUPPRESSED" | "INCOMPLETE";
  ttm: Decimal;
  // Null whenever the test does not pass — never computed at all, not even
  // internally, under SEASONAL — RUN-RATE SUPPRESSED or INCOMPLETE (M12).
  runRate: Decimal | null;
  triggeringQuarterGrowth: { thisYear: Decimal; priorYear1: Decimal; priorYear2: Decimal } | null;
}

export interface ShapeMismatchResult {
  fired: boolean;
  gapPoints: Decimal | null;
}

export interface SensitivityResult {
  tornado: unknown;
  twoWayGrowthMargin: unknown;
  twoWayRateTerminalGrowth: unknown;
  // Debt share is removed from the table — value-neutral by construction,
  // MM without taxes or distress (I10).
  debtShareRemoved: true;
}

export interface DiagnosticsResult {
  enterpriseValue: EnterpriseValueBridge;
  multiples: MultiplesResult;
  marginHistory: MarginHistoryResult;
  fcf: FcfResult;
  reinvestmentRonic: ReinvestmentRonicResult;
  terminal: TerminalDiagnostics;
  impliedExitMultiple: { value: Figure<Decimal>; dividesMetric: string };
  rateSensitivity: RateSensitivity;
  fcfYieldGrowth: FcfYieldGrowthResult;
  runRate: RunRateResult;
  shapeMismatch: ShapeMismatchResult;
  sensitivity: SensitivityResult;
}

// ---------------------------------------------------------------------------
// §7.2 M6 / §10 E — steady-state EV, PVGO and the reverse-DCF grid
// ---------------------------------------------------------------------------

export interface ReverseDcfCell {
  marginLevel: MarginLevel;
  rate: DiscountRate;
  fiveYearGrowth: Figure<Decimal>;
  tenYearCagr: Figure<Decimal>;
  year10Revenue: Figure<Decimal>;
  ronic: Figure<Decimal>;
  lagBiasDirection: "conservative" | "generous";
}

export interface PriceImplied {
  steadyStateEv: Figure<Decimal>;
  pvgo: Figure<Decimal>;
  pvgoShareOfEv: Figure<Decimal>;
  // Nine cells: three margin levels × three rates.
  reverseDcfGrid: ReverseDcfCell[];
  impliedExitMultiple: { value: Figure<Decimal>; dividesMetric: string };
}

// ---------------------------------------------------------------------------
// §10 G — scenario outputs
// ---------------------------------------------------------------------------

export interface ScenarioOutputs {
  values: { bear: Decimal; base: Decimal; bull: Decimal };
  // Display only, never a headline (§10.3, §10.5).
  weightedDistribution: Decimal;
  priceLocationWithinRange: Decimal;
  rateAtWhichBaseEqualsPrice: Decimal | null;
  sensitivity: SensitivityResult;
}

// ---------------------------------------------------------------------------
// §10 H / §10.3 — the fair-value range
// ---------------------------------------------------------------------------

export type FairValueRange =
  | {
      kind: "range";
      bear: Decimal;
      bull: Decimal;
      weightedValueInside: Decimal;
      drivingInputs: [string, string, string];
      // True where trigger A or B has fired — "the bounds are scenario
      // labels, not confidence bounds" (§10.3).
      scenarioLabelsWarning: boolean;
    }
  | {
      // Never compressed to bear/bull bounds — a distinct component, not a
      // variant (§10.4, §10.3).
      kind: "pre-revenue-distribution";
      failure: Decimal;
      successAsCommonlyDescribed: Decimal;
      successAsPriceRequires: Decimal;
      cashFloor: Decimal;
    }
  | { kind: "suppressed"; state: SuppressingState; cause: string };

// ---------------------------------------------------------------------------
// §7.2 M16 — the pre-revenue module
// ---------------------------------------------------------------------------

export type SuccessDefinitionState =
  | { kind: "probability"; probability: Decimal }
  | { kind: "PRICE NOT JUSTIFIABLE BY THIS OUTCOME" }
  | { kind: "THIS SUCCESS IS WORTH LESS THAN FAILURE" };

export interface SuccessDefinitionRow {
  definition: string;
  vSuccess: Decimal;
  vFail: Decimal;
  rSuccess: Decimal;
  rFail: Decimal;
  // I12 — the 30% levered cost-of-equity cap.
  rateCapped: boolean;
  state: SuccessDefinitionState;
}

export type FundingStackLine =
  | { line: "project_debt"; type: "ASSUMPTION"; shareOfCapex: Decimal; cost: Decimal }
  | { line: "customer_prepayments"; type: "FACT" | "ASSUMPTION"; amount: Decimal }
  // Mandatory — was missing from the OKLO manual test (§7.2 M16).
  | { line: "retained_operating_cash_flow"; type: "INFERENCE"; amount: Decimal }
  // The residual, not the first resort.
  | { line: "new_equity"; type: "INFERENCE"; amount: Decimal };

// Both ramps always shown; back-loaded is the reference (§7.2 M16).
export type FundingRamp = "back_loaded" | "steady";

export interface PreRevenueModule {
  cashPerShare: Decimal;
  quarterlyBurn: Decimal;
  runway: Decimal;
  // Runs before the scale solve; a value-destroying unit returns
  // NOT ACHIEVABLE AT ANY SCALE, never a very large number.
  unitEconomicsBreakeven: Figure<Decimal>;
  fundingStackByYear: Record<FundingRamp, { year: number; lines: FundingStackLine[] }[]>;
  dilutionRequired: Decimal;
  // Sorted by V_success ascending (R5) — never definition order.
  successDefinitions: SuccessDefinitionRow[];
}

// ---------------------------------------------------------------------------
// §8.5 — the blind challenger (a separate call; see lib/analyzer/ai)
// ---------------------------------------------------------------------------

export interface ChallengerFinding {
  claimOrFactReference: string;
  evidence: string;
  whatWouldHaveToBeTrue: string;
}

export interface ChallengerResult {
  findings: ChallengerFinding[];
  // Populated, and this field set, only after the independent call has
  // completed (§8.5.4) — never merged into `interpretation`.
  completedAt: string;
}

// ---------------------------------------------------------------------------
// §8.2 — [C] interpretation
// ---------------------------------------------------------------------------

export interface InterpretationStatement {
  statement: string;
  // Ids into this AnalysisResult that the statement rests on — a value and
  // its interpretation are never separable (§10.0.2 rule 1).
  referencesValueIds: string[];
}

export interface InterpretationResult {
  statements: InterpretationStatement[];
}

// ---------------------------------------------------------------------------
// §7.1 — policy constants, surfaced as configuration, not code literals
// ---------------------------------------------------------------------------

export interface PolicyConstants {
  terminalGrowth: Decimal;
  terminalRoicPremium: Decimal;
  rateGrid: [Decimal, Decimal, Decimal];
  preRevenueConstructionLeadYears: number;
  leveredCostOfEquityCap: Decimal;
  leverageThreshold: Decimal;
  // Gate 0's ">50% of revenue" interest-income test (§6.1). Provisional —
  // "the >50% interest-income test has no observations behind it" (§6.1).
  gate0InterestIncomeOverRevenueThreshold: Decimal;
  gate1HistoryInsufficientYears: number;
  gate1ShortHistoryYears: number;
  triggerAMarginProximityPoints: Decimal;
  triggerAWindowRangePoints: Decimal;
  triggerBDeclinePoints: Decimal;
  historyInsufficientStressMarginRelativeReductions: [Decimal, Decimal];
  peBasisNonOperatingThresholdOfPretaxIncome: Decimal;
  runRateSequentialGrowthTrigger: Decimal;
  seasonalityPriorYearThreshold: Decimal;
  capitalLightRonicFloor: Decimal;
  ronicCap: Decimal;
  shapeMismatchGapPoints: Decimal;
  sensitivityDisplayThreshold: Decimal;
  fcfYieldGrowthPreconditionBand: [Decimal, Decimal];
}

// The four constants the register records as LATER/undefined (§7.1). Kept
// as an explicit null-valued type, not a guessed number, so every module
// that would consume one is forced to handle "unset" rather than silently
// picking a value.
export interface UndefinedPolicyConstants {
  nopatTaxRate: null;
  stressMarginLevel: null;
  preRevenueUnleveredRate: null;
  projectDebtCost: null;
}

// ---------------------------------------------------------------------------
// §10.0.1 — the Analysis Result itself
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  // §10.0.2 rule 5 — a later consumer can tell what it is reading.
  schemaVersion: string;
  runId: string;
  ticker: string;
  companyName: string;
  // No "approximate" price state anywhere (§3.4) — always a value and a
  // timestamp.
  price: { value: Decimal; timestamp: string };
  facts: FactRecord[];
  provenance: ProvenanceGraph;
  gates: GatesResult;
  profile: ProfileDecision;
  states: {
    suppressing: { state: SuppressingState; appliesTo: string }[];
    qualifying: { flag: QualifyingFlag; appliesTo: string }[];
  };
  diagnostics: DiagnosticsResult;
  scenarios: ScenarioSet;
  scenarioOutputs: ScenarioOutputs;
  priceImplied: PriceImplied;
  fairValueRange: FairValueRange;
  // Populated only for the pre-revenue profile.
  preRevenue: PreRevenueModule | null;
  // Populated only after the independent blind-challenger call completes
  // (§8.5.4); null beforehand.
  challenger: ChallengerResult | null;
  interpretation: InterpretationResult;
  policy: {
    constants: PolicyConstants;
    undefinedConstants: UndefinedPolicyConstants;
    // Every PROVISIONAL threshold in use with what it was calibrated on
    // (§10.0.1 J).
    provisionalLabels: Record<string, string>;
  };
}
