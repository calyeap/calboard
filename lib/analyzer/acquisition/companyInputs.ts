import Decimal from "decimal.js";
import { CLEAN_PROVENANCE } from "../provenance";
import { TAG_MAP } from "./tagMap";
import { annualSeries, operatingMarginSeries, filedAnnualYearsCount, quarterlySeries } from "./history";
import type { AcquisitionResult } from "./acquire";
import type { CompanyFactsDocument } from "./secClient";
import type { CompanyFixture } from "../assemble";
import type { FactRecord, SourcedValue } from "../types";

// ---------------------------------------------------------------------------
// Acquisition -> the assembly seam.
//
// Every FACT-derived module input below is either a real acquired figure or
// NULL. There is no third case, and in particular there is no default: the
// modules resolve a null REQUIRED input to INCOMPLETE (§5.2), and that cascade
// "is correct and must not be softened" (§5.4).
//
// WHAT THIS FILE DOES NOT SUPPLY, and why it is a parameter rather than a
// value: the analyst-side inputs. Scenarios, their values, the base-case
// revaluation function and the four undefined policy constants (§7.1) are not
// facts and were never acquired from anything — they are Step 7's output, and
// Step 7's interface is not built. They arrive through `AnalystInputs` so that
// a reader of this file can see exactly where the fact set stops and the
// analyst's judgment begins.
// ---------------------------------------------------------------------------

function sourcedFrom(fact: FactRecord | undefined): SourcedValue<Decimal> | null {
  if (fact === undefined || fact.value === null) return null;
  const value = fact.value instanceof Decimal ? fact.value : new Decimal(String(fact.value));
  return {
    value,
    provenance: {
      sourceClass: fact.sourceClass,
      extractionType: fact.extractionType,
      verificationState: fact.verificationState,
    },
  };
}

export interface NonOperatingInvestmentSelection {
  /** The tags the analyst classified as non-operating (§4.4). */
  tags: string[];
  value: Decimal;
  /** §3.5 requires the direction of the likely error beside the carrying value. */
  errorDirection: "understates" | "overstates" | null;
}

export interface AnalystInputs {
  profile: CompanyFixture["profile"];
  /**
   * §4.4's non-operating-investments judgment. NULL until the analyst makes
   * it, and null means enterprise value is INCOMPLETE — which is the correct
   * state, not a gap. No tag says which investments are non-operating.
   */
  nonOperatingInvestments: NonOperatingInvestmentSelection | null;
  /** 52-week range, from the price feed. Null where not fetched. */
  fiftyTwoWeek: { low: Decimal; high: Decimal } | null;
  /** Step 7. Not facts, not acquired. */
  scenarios: CompanyFixture["scenarios"];
  scenarioValues: CompanyFixture["scenarioValues"];
  revalueBaseCaseAtRate: CompanyFixture["revalueBaseCaseAtRate"];
  configuredConstants: CompanyFixture["configuredConstants"];
  preRevenue: CompanyFixture["preRevenue"];
  /** Gate 0's classification lookups, from the SEC submissions record. */
  gate0: CompanyFixture["gate0"];
}

export interface CompanyInputsResult {
  fixture: CompanyFixture;
  /**
   * Which fact-derived module inputs came back null, and therefore which
   * outputs will return INCOMPLETE. Reported, never silently absorbed.
   */
  absentInputs: string[];
}

export function buildCompanyInputs(
  acquisition: AcquisitionResult,
  companyFacts: CompanyFactsDocument,
  analyst: AnalystInputs,
  price: { value: Decimal; timestamp: string }
): CompanyInputsResult {
  const byId = new Map(acquisition.facts.map((f) => [f.id, f]));
  const get = (id: string) => sourcedFrom(byId.get(id));
  const raw = (id: string): Decimal | null => {
    const f = byId.get(id);
    if (f === undefined || f.value === null) return null;
    return f.value instanceof Decimal ? f.value : new Decimal(String(f.value));
  };

  const revenueTags = TAG_MAP.find((e) => e.factId === "current-revenue")!.candidates;
  const operatingIncomeTags = TAG_MAP.find((e) => e.factId === "operating-income")!.candidates;

  const margins = operatingMarginSeries(
    annualSeries(companyFacts, revenueTags),
    annualSeries(companyFacts, operatingIncomeTags)
  );
  const marginDecimals = (margins?.years ?? []).map((y) => new Decimal(y.margin));
  const quarters = quarterlySeries(companyFacts, revenueTags);

  const nonOp = analyst.nonOperatingInvestments;
  const nonOpSourced: SourcedValue<Decimal> | null =
    nonOp === null ? null : { value: nonOp.value, provenance: CLEAN_PROVENANCE };

  const absentInputs: string[] = [];
  const track = <T>(name: string, value: T | null): T | null => {
    if (value === null) absentInputs.push(name);
    return value;
  };

  const quarterSourced = (offset: number): SourcedValue<Decimal> | null => {
    const q = quarters[quarters.length - offset];
    return q === undefined ? null : { value: new Decimal(q.value), provenance: CLEAN_PROVENANCE };
  };

  const fixture: CompanyFixture = {
    schemaVersion: "v1.0.2",
    runId: `acquired-${acquisition.ticker.toLowerCase()}`,
    ticker: acquisition.ticker,
    companyName: acquisition.companyName,
    price: { value: price.value, timestamp: price.timestamp },
    facts: acquisition.facts,

    gate0: analyst.gate0,
    gate1: { filedYearsCount: filedAnnualYearsCount(companyFacts) },
    leverage: {
      totalDebt: raw("total-debt"),
      financeLeaseLiabilities: raw("finance-lease-liabilities"),
      cashAndMarketableDebtSecurities: raw("cash-and-marketable-debt-securities"),
      // Filled by assemble from M1's own output; null here means M1 was
      // INCOMPLETE, which fails the leverage test closed (§5.3, §6.5).
      enterpriseValue: null,
      operatingLeaseLiabilities: raw("operating-lease-liabilities"),
      leveredResidualExceptionApplies: false,
    },
    triggerMargins: { yearlyOperatingMargins: marginDecimals },

    profile: analyst.profile,

    enterpriseValue: {
      sharesOutstanding: track("sharesOutstanding", get("shares-outstanding")),
      treasuryMethodDilution: track("treasuryMethodDilution", get("treasury-method-dilution")),
      price: { value: price.value, provenance: CLEAN_PROVENANCE },
      totalDebt: track("totalDebt", get("total-debt")),
      financeLeaseLiabilities: track("financeLeaseLiabilities", get("finance-lease-liabilities")),
      cashAndMarketableDebtSecurities: track(
        "cashAndMarketableDebtSecurities",
        get("cash-and-marketable-debt-securities")
      ),
      nonOperatingEquityInvestmentsAtBook: track(
        "nonOperatingEquityInvestmentsAtBook (§4.4 judgment — not a tagged fact)",
        nonOpSourced
      ),
      nonOperatingInvestmentsErrorDirection: nonOp?.errorDirection ?? null,
    },

    multiplesInput: {
      price: { value: price.value, provenance: CLEAN_PROVENANCE },
      // EPS is not in this mapping version: the tagged element exists but the
      // §3.5 basis question (GAAP vs the I5 non-operating-items adjustment) is
      // a per-company decision this milestone does not make. Null, so P/E is
      // INCOMPLETE rather than computed on an unstated basis.
      epsTrailing: track("epsTrailing", null),
      epsForward: track("epsForward", null),
      enterpriseValue: null,
      ebit: get("operating-income"),
      ebitda: track("ebitda", null),
      cashFcf: get("cash-fcf"),
      marketCap: null,
      bookValue: track("bookValue", null),
      revenue: track("revenue", get("current-revenue")),
      impliedMarginForNormalMultiple: new Decimal("0.20"),
      // I5's symmetric trigger needs pre-tax income and the non-operating item
      // beside it. Neither is mapped in this version, so the basis is
      // unstated and P/E stays INCOMPLETE rather than being shown on a GAAP
      // basis that I5 might require adjusting.
      peBasis: {
        gaapEps: null,
        nonOperatingItemPretax: null,
        preTaxIncome: null,
        taxRate: null,
      },
      ownHistoryCurrentValue: null,
      ownHistoryValues: null,
    },

    marginHistory: {
      yearlyOperatingMargins: marginDecimals.map((m) => ({
        value: m,
        provenance: CLEAN_PROVENANCE,
      })),
      fiftyTwoWeekLow:
        analyst.fiftyTwoWeek === null
          ? track("fiftyTwoWeekLow", null)
          : { value: analyst.fiftyTwoWeek.low, provenance: CLEAN_PROVENANCE },
      fiftyTwoWeekHigh:
        analyst.fiftyTwoWeek === null
          ? track("fiftyTwoWeekHigh", null)
          : { value: analyst.fiftyTwoWeek.high, provenance: CLEAN_PROVENANCE },
    },

    fcf: {
      operatingCashFlow: track("operatingCashFlow", get("operating-cash-flow")),
      cashCapex: track("cashCapex", get("capex")),
      financeLeaseRouAdditions: track(
        "financeLeaseRouAdditions",
        get("finance-lease-rou-additions")
      ),
      // NOPAT needs the §7.1 NOPAT tax rate, which is one of the four
      // undefined policy constants. Derived only where the run configures one.
      nopat: track("nopat", nopatFrom(get("operating-income"), analyst.configuredConstants.nopatTaxRate)),
      depreciationAndAmortization: track(
        "depreciationAndAmortization",
        get("depreciation-and-amortisation")
      ),
      deltaNwc: track("deltaNwc", null),
      sbc: track("sbc", get("sbc")),
    },

    reinvestment: {
      capex: get("capex"),
      // Genuinely nil is different from unknown (§4.3). Not acquired in this
      // mapping version, so null.
      acquisitions: track("acquisitions", null),
      financeLeaseRouAdditions: get("finance-lease-rou-additions"),
      depreciationAndAmortization: get("depreciation-and-amortisation"),
      deltaNwc: null,
      deltaRevenue: null,
    },
    ronic: {
      fiveYearDeltaNopat: track("fiveYearDeltaNopat", null),
      fiveYearDeltaInvestedCapital: track("fiveYearDeltaInvestedCapital", null),
      lagBiasDirection: "conservative",
    },
    impliedReturnOnNewCapital: null,

    reverseDcf: {
      baseYearRevenue: get("current-revenue"),
      targetEnterpriseValue: null,
      currentMargin: get("current-operating-margin"),
      medianMargin: track("medianMargin", medianOf(marginDecimals)),
      configuredStressMarginLevel: analyst.configuredConstants.stressMarginLevel,
      configuredNopatTaxRate: analyst.configuredConstants.nopatTaxRate,
    } as CompanyFixture["reverseDcf"],

    fcfYieldGrowth: {
      capex: get("capex"),
      financeLeaseRouAdditions: get("finance-lease-rou-additions"),
      depreciationAndAmortization: get("depreciation-and-amortisation"),
      // The ten-year FCF-conversion range is not acquired in this mapping
      // version. Null, so the precondition fails rather than passing untested
      // — §8.2's own output on failure is PRECONDITION FAILED, never a number.
      fcfConversionWithinNormalRange: null,
      fcfYieldValue: null,
    },

    runRate: {
      currentQuarterRevenue: quarterSourced(1),
      priorQuarterRevenue: quarterSourced(2),
      sameQuarterYear1: quarterSourced(5),
      sameQuarterYear1Prior: quarterSourced(6),
      sameQuarterYear2: quarterSourced(9),
      sameQuarterYear2Prior: quarterSourced(10),
      ttm: ttmFrom(quarters),
    },

    shapeMismatch: { guidedNearTermGrowth: null, impliedConstantGrowth: null },
    rateSensitivityCells: null,
    terminalValuePv: null,
    impliedExitMultipleMetric: { value: null, metricName: "EV/EBIT (operating income)" },

    scenarios: analyst.scenarios,
    scenarioValues: analyst.scenarioValues,
    revalueBaseCaseAtRate: analyst.revalueBaseCaseAtRate,
    configuredConstants: analyst.configuredConstants,
    preRevenue: analyst.preRevenue,
  };

  return { fixture, absentInputs };
}

function nopatFrom(
  operatingIncome: SourcedValue<Decimal> | null,
  taxRate: Decimal | null
): SourcedValue<Decimal> | null {
  if (operatingIncome === null || taxRate === null) return null;
  return {
    value: operatingIncome.value.mul(new Decimal(1).minus(taxRate)),
    provenance: operatingIncome.provenance,
  };
}

function medianOf(values: Decimal[]): SourcedValue<Decimal> | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? sorted[mid - 1].plus(sorted[mid]).dividedBy(2) : sorted[mid];
  return { value: median, provenance: CLEAN_PROVENANCE };
}

/**
 * Trailing twelve months from four discrete quarters.
 *
 * Null unless FOUR are present. Three quarters annualised is an estimate, and
 * §5.1 admits no estimate anywhere — "not by an interpolation".
 */
function ttmFrom(
  quarters: { value: number }[]
): SourcedValue<Decimal> | null {
  if (quarters.length < 4) return null;
  const last4 = quarters.slice(-4);
  const sum = last4.reduce((acc, q) => acc.plus(q.value), new Decimal(0));
  return { value: sum, provenance: CLEAN_PROVENANCE };
}
