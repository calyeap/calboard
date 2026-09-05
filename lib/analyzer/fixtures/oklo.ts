import Decimal from "decimal.js";
import { CLEAN_PROVENANCE } from "../provenance";
import type { CompanyFixture, PreRevenueFixture } from "../assemble";
import type { FactRecord, SourcedValue } from "../types";

// ---------------------------------------------------------------------------
// Milestone 5 — OKLO validation fixture.
// ---------------------------------------------------------------------------
//
// Source: the frozen, hash-verified design mock (SHA-256 041c9935… per the
// "Foolproof" Notion record, matching design2/mock-report-oklo.html).
// Gate results, the implied-probability table's V_success/V_fail/rate
// figures for success definitions 1-4, cash-per-share ($3.10), the 30%
// levered-cost-of-equity cap, the project-debt share (60% of capex), and
// the construction lead (2 years) are all taken DIRECTLY from that mock.
//
// NOT ATTEMPTED: exact reproduction of the two 8GW funding-stack values
// ($31 back-loaded, $48 steady per current share). Those figures depend on
// a capacity ramp and capex-per-unit schedule that neither the frozen spec
// nor the mock discloses — only the OUTPUT dollar values are shown, not the
// GW-by-year schedule or $/kW assumption that produced them. Re-deriving
// those two exact numbers would mean inventing the underlying schedule to
// fit a target, which the frozen contract explicitly forbids. This fixture
// instead supplies a plausible, internally-consistent capacity ramp and
// capex assumption (clearly synthetic, not claimed to reproduce $31/$48
// exactly) so the funding-stack WIRING itself (year-by-year solve, both
// ramps, dilution) can still be exercised and checked structurally —
// output value present, four lines all shown, back-loaded vs steady
// diverge — without claiming numeric equality to the frozen reference.
//
// Success definitions 1-4 use the mock's own EXACT V_success/V_fail/rate
// figures ($0/$1/$31/$48 against $3.10, at 30.0%/28.4%/30.0%/22.6%) —
// these ARE real, hash-verified reference values, independent of the
// funding-stack reconstruction above, and are used directly to validate
// computeImpliedProbability's states. Definitions 5-6 are "$XX" mock
// placeholders (no real figure given) and are omitted from this fixture.

function sourced(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: CLEAN_PROVENANCE };
}
function unverified(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: { sourceClass: "PRIMARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "UNVERIFIED" } };
}

const price = new Decimal("14.50"); // mock shows "$XX.XX" — no real figure given; a placeholder within the two 8GW cases' range
const cashPerShare = new Decimal("3.10");
const quarterlyBurn = new Decimal("45"); // $XXm placeholder in the mock — illustrative, UNVERIFIED per its own provenance flag

const preRevenue: PreRevenueFixture = {
  cashPerShare,
  quarterlyBurn,
  runway: new Decimal(8), // quarters — illustrative; mock shows "XX quarters" placeholder
  unitEconomics: {
    annualOutputPerUnit: new Decimal("8760"), // MWh/yr per unit at 100% capacity factor, 1 MW nameplate
    operatingCostPerUnit: new Decimal("50000"),
    capexPerUnit: new Decimal("8000000"), // $8,000/kW x 1,000 kW — the methodology's own OKLO calibration point
    exitValueToAnnualContributionMultiple: new Decimal(5),
    requiredReturn: new Decimal("0.12"),
    constructionLeadYears: 2, // frozen, PROVISIONAL policy constant — matches the mock's "fixed at 2 years"
  },
  fundingStackShared: {
    capexPerUnit: new Decimal("8000000"),
    revenuePerUnitInService: new Decimal("962900"), // 8,760 MWh/yr x $110/MWh — the methodology's own OKLO price point
    operatingCostPerUnitInService: new Decimal("300000"),
    corporateOverheadPerYear: new Decimal("20000000"),
    projectDebtShareOfCapex: new Decimal("0.6"), // "60% of capex" — given directly in the mock
    projectDebtCost: new Decimal("0.08"),
    customerPrepaymentByYear: [new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)],
    nopatTaxRate: new Decimal("0.21"),
    constructionLeadYears: 2,
  },
  // Illustrative 8-year, 8-unit (8 GW at 1 GW/unit) ramp — synthetic, see
  // this file's own header note on why $31/$48 are not independently
  // reproduced from this schedule.
  backLoadedCapacityByYear: [0, 0, 0, 1, 1, 1, 2, 3].map((n) => new Decimal(n)),
  steadyCapacityByYear: [0, 1, 1, 1, 1, 1, 1, 2].map((n) => new Decimal(n)),
  successDefinitions: [
    { definition: "Definition 1 — early deployment, base tariff", vSuccess: new Decimal(0), vFail: cashPerShare, rSuccess: new Decimal("0.30"), rFail: new Decimal("0.10"), rateCapped: true },
    { definition: "Definition 2 — early deployment, contracted tariff", vSuccess: new Decimal(1), vFail: cashPerShare, rSuccess: new Decimal("0.284"), rFail: new Decimal("0.10"), rateCapped: false },
    { definition: "Definition 3 — 8 GW, utility multiple, back-loaded ramp", vSuccess: new Decimal(31), vFail: cashPerShare, rSuccess: new Decimal("0.30"), rFail: new Decimal("0.10"), rateCapped: true },
    { definition: "Definition 4 — 8 GW, utility multiple, steady ramp", vSuccess: new Decimal(48), vFail: cashPerShare, rSuccess: new Decimal("0.226"), rFail: new Decimal("0.10"), rateCapped: false },
  ],
};

export const OKLO_FIXTURE: CompanyFixture = {
  schemaVersion: "v1.0.2",
  runId: "fixture-oklo-milestone5",
  ticker: "OKLO",
  companyName: "Oklo Inc.",
  price: { value: price, timestamp: "2026-09-04T16:00:00-04:00" },

  facts: [
    {
      id: "cash-per-share",
      name: "Cash per share, adjusted for burn to today",
      type: "FACT",
      value: cashPerShare,
      source: "latest 10-Q, adjusted for burn",
      sourceUrl: null,
      sourceClass: "PRIMARY",
      extractionType: "DETERMINISTIC/STRUCTURED",
      verificationState: "UNVERIFIED",
      asOfDate: "Q2 FY2026",
      retrievalTimestamp: "2026-09-04T16:00:00-04:00",
      supersedesFactId: null,
    },
    {
      id: "quarterly-burn",
      name: "Quarterly burn",
      type: "FACT",
      value: quarterlyBurn,
      source: "latest 10-Q cash flow statement",
      sourceUrl: null,
      sourceClass: "PRIMARY",
      extractionType: "DETERMINISTIC/STRUCTURED",
      verificationState: "UNVERIFIED",
      asOfDate: "Q2 FY2026",
      retrievalTimestamp: "2026-09-04T16:00:00-04:00",
      supersedesFactId: null,
    },
  ] as FactRecord[],

  gate0: {
    sectorClassification: "Utilities",
    interestIncomeOverRevenue: new Decimal(0),
    hasInsurancePremiumOrReserveLineItems: false,
    industryClassification: "Nuclear Power Generation",
    override: null,
  },
  gate1: { filedYearsCount: 3 }, // -> HISTORY INSUFFICIENT, matches the mock exactly
  leverage: {
    // "Leverage precondition - company today: PASS" (mock). Pre-revenue,
    // minimal debt against a cash-heavy balance sheet.
    totalDebt: new Decimal(5),
    financeLeaseLiabilities: new Decimal(0),
    cashAndMarketableDebtSecurities: new Decimal(200),
    enterpriseValue: new Decimal(600),
    operatingLeaseLiabilities: null,
    // The success-case leverage test FAILS in every case (mock) and the
    // levered-residual exception applies there — but that is a SEPARATE,
    // per-success-case computation (D/E at exit, 0.20-3.95), not this
    // company-level test, which passes today per the mock.
    leveredResidualExceptionApplies: true,
  },
  triggerMargins: { yearlyOperatingMargins: [new Decimal(-0.5), new Decimal(-0.4), new Decimal(-0.3)] }, // 3 years, pre-revenue losses — neither trigger is meaningful pre-revenue; not asserted either way

  profile: {
    recommended: "PRE_REVENUE_UNPROFITABLE",
    confirmedOrOverridden: "PRE_REVENUE_UNPROFITABLE",
    override: null,
    classificationInputs: {
      revenueScale: "zero",
      fcfCharacter: "negative",
      revenueGrowthBand: "<10%",
      capitalIntensity: new Decimal(1), // pre-revenue: capex with no revenue base to divide by is not meaningful; nominal
      cyclicality: { tenYearMarginRange: new Decimal(0), worstSingleYearChange: new Decimal(0) }, // not evaluated — 3 filed years, HISTORY INSUFFICIENT
      balanceSheetNature: "asset-heavy",
    },
  },

  enterpriseValue: {
    sharesOutstanding: sourced(new Decimal(200)),
    treasuryMethodDilution: sourced(new Decimal(5)),
    price: sourced(price),
    totalDebt: sourced(new Decimal(5)),
    financeLeaseLiabilities: sourced(new Decimal(0)),
    cashAndMarketableDebtSecurities: sourced(new Decimal(200)),
    nonOperatingEquityInvestmentsAtBook: sourced(new Decimal(0)),
    nonOperatingInvestmentsErrorDirection: null,
  },

  multiplesInput: {
    // Pre-revenue: none of the standard multiples are meaningful (§1 "do
    // not use... any current multiple" for this profile) — every input
    // is null so each multiple independently, correctly reports INCOMPLETE.
    price: sourced(price),
    epsTrailing: null,
    epsForward: null,
    enterpriseValue: null,
    ebit: null,
    ebitda: null,
    cashFcf: null,
    marketCap: null,
    bookValue: null,
    revenue: null,
    impliedMarginForNormalMultiple: new Decimal(0),
    peBasis: { gaapEps: null, nonOperatingItemPretax: null, preTaxIncome: null, taxRate: null },
    ownHistoryCurrentValue: null,
    ownHistoryValues: null,
  },

  marginHistory: {
    yearlyOperatingMargins: [unverified(new Decimal(-0.5)), unverified(new Decimal(-0.4)), unverified(new Decimal(-0.3))],
    fiftyTwoWeekLow: sourced(new Decimal("8.00")),
    fiftyTwoWeekHigh: sourced(new Decimal("22.00")),
  },

  fcf: {
    operatingCashFlow: null,
    cashCapex: null,
    financeLeaseRouAdditions: null,
    nopat: null,
    depreciationAndAmortization: null,
    deltaNwc: null,
    sbc: null,
  },

  reinvestment: {
    capex: null,
    acquisitions: null,
    financeLeaseRouAdditions: null,
    depreciationAndAmortization: null,
    deltaNwc: null,
    deltaRevenue: null,
  },
  ronic: {
    fiveYearDeltaNopat: null,
    fiveYearDeltaInvestedCapital: null,
    lagBiasDirection: "conservative",
  },
  impliedReturnOnNewCapital: null, // pre-revenue: no NOPAT history to compute this from

  reverseDcf: {
    // Explicitly not run for the pre-revenue profile (§1: "do not use...
    // DCF as a point estimate" here) — every REQUIRED input is null so the
    // grid correctly returns INCOMPLETE on all nine cells rather than a
    // fabricated valuation.
    baseYearRevenue: null,
    targetEnterpriseValue: null,
    currentMargin: null,
    medianMargin: null,
    lagBiasDirection: "conservative",
  },

  fcfYieldGrowth: {
    capex: null,
    financeLeaseRouAdditions: null,
    depreciationAndAmortization: null,
    fcfConversionWithinNormalRange: null,
    fcfYieldValue: null,
  },

  runRate: {
    currentQuarterRevenue: null,
    priorQuarterRevenue: null,
    sameQuarterYear1: null,
    sameQuarterYear1Prior: null,
    sameQuarterYear2: null,
    sameQuarterYear2Prior: null,
    ttm: null,
  },

  shapeMismatch: { guidedNearTermGrowth: null, impliedConstantGrowth: null },

  rateSensitivityCells: null,
  terminalValuePv: null,
  impliedExitMultipleMetric: { value: null, metricName: "not applicable — pre-revenue" },

  scenarios: {
    bear: { revenueGrowthOrPath: new Decimal(0), operatingMargin: new Decimal(0), reinvestmentCapitalIntensity: new Decimal(0), shareCount: new Decimal(205), writtenAnchor: "Wind-down; cash returned to shareholders." },
    base: { revenueGrowthOrPath: new Decimal(0), operatingMargin: new Decimal(0), reinvestmentCapitalIntensity: new Decimal(0), shareCount: new Decimal(205), writtenAnchor: "8 GW back-loaded reference case." },
    bull: { revenueGrowthOrPath: new Decimal(0), operatingMargin: new Decimal(0), reinvestmentCapitalIntensity: new Decimal(0), shareCount: new Decimal(205), writtenAnchor: "8 GW steady-ramp case." },
  },
  // Not used for the pre-revenue profile — fairValueRange takes the
  // "pre-revenue-distribution" branch instead of bear/base/bull bounds
  // (§10.3: never compressed to bounds for this profile).
  scenarioValues: { bear: cashPerShare, base: new Decimal(31), bull: new Decimal(48) },
  revalueBaseCaseAtRate: () => new Decimal(31),

  configuredConstants: {
    nopatTaxRate: new Decimal("0.21"),
    stressMarginLevel: null,
    preRevenueUnleveredRate: new Decimal("0.10"),
    projectDebtCost: new Decimal("0.08"),
  },

  preRevenue,
};
