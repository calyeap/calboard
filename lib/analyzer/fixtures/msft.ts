import Decimal from "decimal.js";
import { CLEAN_PROVENANCE } from "../provenance";
import type { CompanyFixture } from "../assemble";
import type { FactRecord, SourcedValue } from "../types";

// ---------------------------------------------------------------------------
// Milestone 5 — MSFT validation fixture.
// ---------------------------------------------------------------------------
//
// Source: the frozen, hash-verified design mock (SHA-256 88b04457… per the
// "Foolproof" Notion record, matching lib/analyzer's own local copy at
// design2/mock-report-msft.html). Every percentage, ratio, margin-history
// statistic, RONIC figure, growth rate, terminal share, gate/trigger result
// and provenance qualifier below is taken DIRECTLY from that mock's
// displayed text — these are not invented.
//
// The reverse-DCF grid inputs (price $510.12, shares 7.4255B, EV bridge
// $6.3B, base revenue $332B, RONIC 17.8% five-year, current/median/stress
// margins 46.8%/41.8%/38.0%, NOPAT tax rate 20%) are the EXACT inputs
// already golden-tested in reverseDcf.test.ts's msftInput — reused
// verbatim here, not re-derived, so this fixture inherits that test's own
// verification rather than risking a second, independently-drifting copy.
//
// SYNTHETIC RECONSTRUCTION, clearly flagged: the mock shows OUTPUTS
// (ratios, percentages, the derived EV/net-debt figures), not every raw
// SOURCE fact M1–M4 need as inputs (e.g. the individual totalDebt/cash
// split behind "net debt $30.0B", or the ten individual yearly margins
// behind "range 21.4pt / median 41.8pt / worst decline 4.1pt"). Phase 2
// (SEC acquisition) does not exist yet, so there is no way to acquire the
// real underlying facts — every such figure below is a clearly-labelled,
// internally-consistent construction that REPRODUCES the mock's own
// disclosed derived numbers exactly, not an independent re-acquisition of
// Microsoft's real financials.
//
// RULED ERRATUM in the frozen mock's own prose (not a live ambiguity):
// Section D's Quick Read text says margin "median 38.0%", but the grid
// (Section E's own row heads), the frozen design, and the already-accepted
// M7 reference behaviour all agree: 41.8% is the ten-year/window median
// and 38.0% is the stress level. Section D's sentence is a typo, ruled as
// such — not reproduced here, and not treated as an unresolved financial-
// definition question. The frozen mock file itself is left untouched
// (hash-stable); this comment is the erratum's record, in implementation/
// test context rather than in the frozen artefact.

// --- margin history: 10-year series reproducing the mock's own summary
// stats exactly (current 46.8% = max, range 21.4pt, median 41.8pt, worst
// single-year decline 4.1pt) — solved by hand; see assemble.test.ts for the
// arithmetic check that recomputing these stats from this exact series
// reproduces all four disclosed numbers.
const TEN_YEAR_MARGINS = [0.254, 0.290, 0.330, 0.365, 0.441, 0.400, 0.436, 0.453, 0.460, 0.468].map((v) => new Decimal(v));

function sourced(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: CLEAN_PROVENANCE };
}
function aiExtracted(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: { sourceClass: "PRIMARY", extractionType: "AI-EXTRACTED", verificationState: "VERIFIED" } };
}
function secondary(value: Decimal): SourcedValue<Decimal> {
  return { value, provenance: { sourceClass: "SECONDARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "VERIFIED" } };
}

const price = new Decimal("510.12");
const shares = new Decimal("7.4255");
const bridge = new Decimal("6.3");
const baseRevenue = new Decimal(332);
const financeLeaseRouAdditions = new Decimal("24.6"); // Section B fact, exact
const financeLeaseLiabilities = new Decimal("66.6"); // Section B fact, exact
// Net debt $30.0B (given) = totalDebt + financeLease - cash. Individual
// totalDebt/cash split is not disclosed — this pair is one internally
// consistent reconstruction, not a re-acquired fact.
const totalDebt = new Decimal(45);
const cashAndSecurities = new Decimal("81.6");
// nonOp = netDebtNumerator(30.0) - bridge(6.3), reproducing EV - marketCap = bridge exactly.
const nonOpInvestments = new Decimal("23.7");
const operatingLeaseLiabilities = new Decimal("22.0"); // reproduces the 1.37% memo ratio

// EV/marketCap depend only on the inputs above (never on leverage or
// multiples, which depend on THEM) — computed directly here rather than
// asking assemble.ts to backfill a "null" placeholder after the fact.
const marketCap = shares.mul(price);
const enterpriseValue = marketCap.plus(totalDebt).plus(financeLeaseLiabilities).minus(cashAndSecurities).minus(nonOpInvestments);

// M5 reinvestment: NOPAT=$123B chosen so leaseAdditions(24.6)/NOPAT=20pt,
// matching the mock's own 86% (lease-inclusive) vs 66% (cash-only) split
// exactly (66% + 20pt = 86%).
const nopat = new Decimal(123);
const capex = new Decimal("81.18"); // reinvestment cash-only = 81.18 = 0.66 x 123

export const MSFT_FIXTURE: CompanyFixture = {
  schemaVersion: "v1.0.2",
  runId: "fixture-msft-milestone5",
  ticker: "MSFT",
  companyName: "Microsoft Corporation",
  price: { value: price, timestamp: "2026-09-04T21:00:00-04:00" },

  facts: [
    factRow("finance-lease-rou-additions", "Finance-lease ROU assets obtained", financeLeaseRouAdditions, "FY2026 Form 10-K, Note 15", "PRIMARY", "AI-EXTRACTED"),
    factRow("finance-lease-liabilities", "Finance lease liabilities", financeLeaseLiabilities, "XBRL tagged element", "PRIMARY", "DETERMINISTIC/STRUCTURED"),
    factRow("current-operating-margin", "Current operating margin", new Decimal("0.468"), "aggregator fundamentals feed", "SECONDARY", "DETERMINISTIC/STRUCTURED"),
    factRow("operating-lease-liabilities", "Operating lease liabilities (memo only)", operatingLeaseLiabilities, "XBRL tagged element", "PRIMARY", "DETERMINISTIC/STRUCTURED"),
  ],

  gate0: {
    sectorClassification: "Information Technology",
    interestIncomeOverRevenue: new Decimal("0.004"),
    hasInsurancePremiumOrReserveLineItems: false,
    industryClassification: "Software",
    override: null,
  },
  gate1: { filedYearsCount: 10 },
  leverage: {
    totalDebt,
    financeLeaseLiabilities,
    cashAndMarketableDebtSecurities: cashAndSecurities,
    enterpriseValue,
    operatingLeaseLiabilities,
    leveredResidualExceptionApplies: false,
  },
  triggerMargins: { yearlyOperatingMargins: TEN_YEAR_MARGINS },

  profile: {
    recommended: "MATURE_PROFITABLE_STABLE_FCF",
    confirmedOrOverridden: "MATURE_PROFITABLE_STABLE_FCF",
    override: null,
    classificationInputs: {
      revenueScale: "large",
      fcfCharacter: "positive_stable",
      revenueGrowthBand: "10-30%",
      capitalIntensity: new Decimal("0.424"), // $140.6B / $332B, methodology's own MSFT FY26 figure
      cyclicality: { tenYearMarginRange: new Decimal("0.214"), worstSingleYearChange: new Decimal("0.041") },
      balanceSheetNature: "asset-light",
    },
  },

  enterpriseValue: {
    sharesOutstanding: sourced(shares),
    treasuryMethodDilution: sourced(new Decimal(0)),
    price: sourced(price),
    totalDebt: sourced(totalDebt),
    financeLeaseLiabilities: sourced(financeLeaseLiabilities),
    cashAndMarketableDebtSecurities: sourced(cashAndSecurities),
    nonOperatingEquityInvestmentsAtBook: sourced(nonOpInvestments),
    nonOperatingInvestmentsErrorDirection: null,
  },

  multiplesInput: {
    price: sourced(price),
    epsTrailing: sourced(new Decimal("10.20")),
    epsForward: sourced(new Decimal("11.40")),
    enterpriseValue: sourced(enterpriseValue),
    ebit: sourced(new Decimal(140)),
    ebitda: sourced(new Decimal(160)),
    cashFcf: sourced(new Decimal("68.82")),
    marketCap: sourced(marketCap),
    bookValue: sourced(new Decimal(90)),
    revenue: sourced(baseRevenue),
    impliedMarginForNormalMultiple: new Decimal("0.30"),
    peBasis: { gaapEps: sourced(new Decimal("10.20")), nonOperatingItemPretax: null, preTaxIncome: sourced(new Decimal(150)), taxRate: sourced(new Decimal("0.2")) },
    ownHistoryCurrentValue: sourced(new Decimal("0.468")),
    ownHistoryValues: TEN_YEAR_MARGINS,
  },

  marginHistory: {
    yearlyOperatingMargins: TEN_YEAR_MARGINS.map((m) => sourced(m)),
    fiftyTwoWeekLow: sourced(new Decimal("410.00")),
    fiftyTwoWeekHigh: sourced(new Decimal("560.00")),
  },

  fcf: {
    operatingCashFlow: sourced(new Decimal(150)),
    cashCapex: sourced(capex),
    financeLeaseRouAdditions: aiExtracted(financeLeaseRouAdditions),
    nopat: sourced(nopat),
    depreciationAndAmortization: sourced(new Decimal(0)),
    deltaNwc: sourced(new Decimal(0)),
    sbc: sourced(new Decimal(11)),
  },

  reinvestment: {
    capex: sourced(capex),
    acquisitions: sourced(new Decimal(0)),
    financeLeaseRouAdditions: aiExtracted(financeLeaseRouAdditions),
    depreciationAndAmortization: sourced(new Decimal(0)),
    deltaNwc: sourced(new Decimal(0)),
    deltaRevenue: null,
  },
  ronic: {
    fiveYearDeltaNopat: sourced(new Decimal("17.8")),
    fiveYearDeltaInvestedCapital: sourced(new Decimal(100)),
    lagBiasDirection: "conservative",
  },
  impliedReturnOnNewCapital: {
    reinvestmentInput: {
      capex: sourced(capex),
      acquisitions: sourced(new Decimal(0)),
      financeLeaseRouAdditions: aiExtracted(financeLeaseRouAdditions),
      depreciationAndAmortization: sourced(new Decimal(0)),
      deltaNwc: sourced(new Decimal(0)),
      deltaRevenue: null,
    },
    currentNopat: sourced(nopat),
    // Reproduces the mock's 20.9% (lease-inclusive): growth = reinvestmentRate(0.86) x impliedReturn(0.209) = 0.17974.
    currentYearNopatGrowth: sourced(new Decimal("0.17974")),
  },

  reverseDcf: {
    baseYearRevenue: sourced(baseRevenue),
    targetEnterpriseValue: sourced(shares.mul(price).plus(bridge)),
    currentMargin: sourced(new Decimal("0.468")),
    medianMargin: sourced(new Decimal("0.418")),
    lagBiasDirection: "conservative",
  },

  fcfYieldGrowth: {
    // PRECONDITION FAILED per the mock: (capex + lease additions) / D&A
    // outside 0.8x-1.5x. capex+lease = 81.18+24.6=105.78; D&A must be small
    // enough to push the ratio outside the band — using D&A=5 gives 21.2x,
    // matching the methodology's own "3.65x" ballpark direction (well
    // outside the band either way).
    capex: sourced(capex),
    financeLeaseRouAdditions: aiExtracted(financeLeaseRouAdditions),
    depreciationAndAmortization: sourced(new Decimal(5)),
    fcfConversionWithinNormalRange: true,
    fcfYieldValue: sourced(new Decimal("0.02")),
  },

  runRate: {
    currentQuarterRevenue: sourced(new Decimal(95)),
    priorQuarterRevenue: sourced(new Decimal(85)), // +11.8% sequential, clears the ~10% trigger
    sameQuarterYear1: sourced(new Decimal(80)),
    sameQuarterYear1Prior: sourced(new Decimal(75)), // +6.7%, below threshold
    sameQuarterYear2: sourced(new Decimal(70)),
    sameQuarterYear2Prior: sourced(new Decimal(66)), // +6.1%, below threshold
    ttm: sourced(baseRevenue),
  },

  shapeMismatch: { guidedNearTermGrowth: null, impliedConstantGrowth: null },

  rateSensitivityCells: null,
  terminalValuePv: null,
  impliedExitMultipleMetric: { value: sourced(new Decimal(140)), metricName: "FY36 EBIT" },

  scenarios: {
    bear: {
      revenueGrowthOrPath: new Decimal("0.10"),
      operatingMargin: new Decimal("0.418"), // margin reverts to the ten-year median — no revenue decline (trigger A alone)
      reinvestmentCapitalIntensity: new Decimal("0.15"),
      shareCount: shares,
      writtenAnchor: "Margin reverts toward the ten-year median; growth slows but does not turn negative (trigger A fired, trigger B did not).",
    },
    base: {
      revenueGrowthOrPath: new Decimal("0.137"),
      operatingMargin: new Decimal("0.468"),
      reinvestmentCapitalIntensity: new Decimal("0.15"),
      shareCount: shares,
      writtenAnchor: "Ten-year CAGR consistent with the price-implied path.",
    },
    bull: {
      revenueGrowthOrPath: new Decimal("0.185"),
      operatingMargin: new Decimal("0.468"),
      reinvestmentCapitalIntensity: new Decimal("0.15"),
      shareCount: shares,
      writtenAnchor: "Margin holds at its current level and growth sustains the five-year implied path.",
    },
  },
  scenarioValues: { bear: new Decimal(265), base: new Decimal(510), bull: new Decimal(650) },
  // PER-SHARE, matching `price`'s own units — solveRateForTargetValue
  // compares this against currentPrice ($510.12), not against an aggregate
  // market cap. Anchored so the base case exactly equals price at r=10%
  // (illustrative; not one of the mock's own disclosed numbers, which
  // shows only "X.X%" as a placeholder for this figure).
  revalueBaseCaseAtRate: (rate: Decimal) => price.mul(new Decimal("0.1").dividedBy(rate)),

  configuredConstants: {
    nopatTaxRate: new Decimal("0.2"),
    stressMarginLevel: new Decimal("0.38"),
    preRevenueUnleveredRate: null,
    projectDebtCost: null,
  },

  preRevenue: null,
};

function factRow(
  id: string,
  name: string,
  value: Decimal,
  source: string,
  sourceClass: "PRIMARY" | "SECONDARY",
  extractionType: "DETERMINISTIC/STRUCTURED" | "AI-EXTRACTED"
): FactRecord {
  return {
    id,
    name,
    type: "FACT",
    value,
    source,
    sourceUrl: null,
    sourceClass,
    extractionType,
    verificationState: "VERIFIED",
    asOfDate: "FY2026",
    retrievalTimestamp: "2026-09-04T21:04:00-04:00",
    supersedesFactId: null,
  };
}
