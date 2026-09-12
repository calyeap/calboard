import Decimal from "decimal.js";
import { CLEAN_PROVENANCE, combineProvenance } from "../provenance";
import { TAG_MAP } from "./tagMap";
import { annualSeries, operatingMarginSeries, filedAnnualYearsCount, quarterlySeries } from "./history";
import { computeAcquiredCashBasis, type AcquiredCashBasisResult } from "../modules/preRevenue";
import type { AcquisitionResult } from "./acquire";
import type { CompanyFactsDocument } from "./secClient";
import type { CompanyFixture } from "../assemble";
import type { FactRecord, ProvenanceTokens, SourcedValue } from "../types";

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

function tokensOf(fact: FactRecord | undefined): ProvenanceTokens | null {
  if (fact === undefined) return null;
  return {
    sourceClass: fact.sourceClass,
    extractionType: fact.extractionType,
    verificationState: fact.verificationState,
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
  /**
   * §9.6 rule 2's two run-level inputs. Supplied by whoever knows them —
   * gate.ts reads the profile decision out of the database and the cross-check
   * outcomes off the acquisition — rather than defaulted here, because a
   * default would have trust describe a run it never looked at.
   */
  trustInputs: CompanyFixture["trustInputs"];
}

export interface CompanyInputsResult {
  fixture: CompanyFixture;
  /**
   * Which fact-derived module inputs came back null, and therefore which
   * outputs will return INCOMPLETE. Reported, never silently absorbed.
   */
  absentInputs: string[];
}

export interface H3CashBasis {
  cashBasis: AcquiredCashBasisResult;
  cashPerShareProvenance: ProvenanceTokens | null;
  quarterlyBurnProvenance: ProvenanceTokens | null;
  /**
   * Runway's own weakest-input provenance — the acquired cash balance AND
   * the acquired quarterly burn (§7.2 M16's runway dependency), never the
   * shares-outstanding token cashPerShareProvenance carries (H3 conformance
   * correction: runway does not depend on share count).
   */
  runwayProvenance: ProvenanceTokens | null;
}

/**
 * The H3 acquired-cash-basis calculation (methodology v2), derived from
 * whatever verification state a fact set's own three cash/share/burn facts
 * currently carry.
 *
 * Called twice in a real run's life, over two different fact arrays, never
 * two different mechanisms: once here in `buildCompanyInputs`, at
 * acquisition time, before any human decision exists; again by
 * `gate.ts:loadGateState`, over the SAME facts after `applyDecisions` has
 * recorded this run's final decisions. A fact this run marked NOT CONFIRMED
 * (a Cannot-verify decision) is treated exactly like one that was never
 * acquired — its value must not keep computing beside a rejected input
 * (H3 conformance correction, §3.8/§5.2). Reusing this one function for both
 * calls is what keeps that a single decision derivation rather than a second,
 * competing one.
 */
export function deriveH3CashBasis(facts: readonly FactRecord[]): H3CashBasis {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cashBalanceFact = byId.get("cash-balance");
  const sharesOutstandingFact = byId.get("shares-outstanding");
  const quarterlyBurnFact = byId.get("quarterly-burn");

  const rejected = (f: FactRecord | undefined): boolean =>
    f !== undefined && f.verificationState === "NOT CONFIRMED";

  const usableRaw = (f: FactRecord | undefined): Decimal | null => {
    if (f === undefined || f.value === null || rejected(f)) return null;
    return f.value instanceof Decimal ? f.value : new Decimal(String(f.value));
  };

  const cashBasis = computeAcquiredCashBasis({
    cashBalance: usableRaw(cashBalanceFact),
    cashBalanceAsOfDate: cashBalanceFact?.asOfDate ?? null,
    sharesOutstanding: usableRaw(sharesOutstandingFact),
    quarterlyBurnRaw: usableRaw(quarterlyBurnFact),
    quarterlyBurnAsOfDate: quarterlyBurnFact?.asOfDate ?? null,
  });

  // A value nulled by REJECTION, rather than absence, still deserves an
  // accurate cause: "missing REQUIRED input" is not what happened to a fact
  // that WAS acquired and then marked NOT CONFIRMED.
  const rejectionCause = (name: string) =>
    `${name} is NOT CONFIRMED (a Cannot-verify decision) — a rejected input is not computed`;
  if (cashBasis.cashPerShare === null) {
    if (rejected(cashBalanceFact)) cashBasis.cashPerShareCause = rejectionCause("the acquired cash balance");
    else if (rejected(sharesOutstandingFact))
      cashBasis.cashPerShareCause = rejectionCause("shares outstanding used by the acquired run");
  }
  if (cashBasis.quarterlyBurn === null && rejected(quarterlyBurnFact)) {
    cashBasis.quarterlyBurnCause = rejectionCause("the acquired quarterly operating cash flow (burn)");
  }
  if (cashBasis.runway === null) {
    if (rejected(cashBalanceFact)) cashBasis.runwayCause = rejectionCause("the acquired cash balance");
    else if (rejected(quarterlyBurnFact)) cashBasis.runwayCause = rejectionCause("the acquired quarterly burn");
  }

  const cashPerShareProvenance =
    cashBasis.cashPerShare !== null && cashBalanceFact !== undefined && sharesOutstandingFact !== undefined
      ? combineProvenance(tokensOf(cashBalanceFact)!, tokensOf(sharesOutstandingFact)!)
      : null;
  const quarterlyBurnProvenance = cashBasis.quarterlyBurn !== null ? tokensOf(quarterlyBurnFact) : null;
  const runwayProvenance =
    cashBasis.runway !== null && cashBalanceFact !== undefined && quarterlyBurnFact !== undefined
      ? combineProvenance(tokensOf(cashBalanceFact)!, tokensOf(quarterlyBurnFact)!)
      : null;

  return { cashBasis, cashPerShareProvenance, quarterlyBurnProvenance, runwayProvenance };
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

  // CalFinance Methodology v2's acquired-run cash basis (§7.2 M16). Overrides
  // the analyst bundle's own cashPerShare/quarterlyBurn/runway — which, where
  // one exists at all, is carried from the M5/M7 validation fixture and is not
  // filing data (analystInputs.ts) — with this run's own acquired facts.
  // Everything else in the analyst's preRevenue block (unit economics, the
  // funding stack, each success definition's V_success/rates) is not a fact
  // and is untouched here.
  // Weakest-input provenance (§3.3) behind each H3 output this acquisition
  // seam derives — carried through to assembly rather than dropped at the
  // acquired-fact boundary, so a SECONDARY / AI-EXTRACTED / not-confirmed
  // input still qualifies the figure at every point of use (H3 conformance
  // correction). At acquisition time no fact yet carries a human decision,
  // so this is identical to the pre-decision state; gate.ts re-derives the
  // same basis from this run's post-decision facts before assembly.
  const { cashBasis, cashPerShareProvenance, quarterlyBurnProvenance, runwayProvenance } = deriveH3CashBasis(
    acquisition.facts
  );
  const preRevenue: CompanyFixture["preRevenue"] =
    analyst.preRevenue === null
      ? null
      : {
          ...analyst.preRevenue,
          cashPerShare: cashBasis.cashPerShare,
          cashPerShareAsOfDate: cashBasis.cashPerShareAsOfDate,
          cashPerShareCause: cashBasis.cashPerShareCause,
          cashPerShareProvenance,
          quarterlyBurn: cashBasis.quarterlyBurn,
          quarterlyBurnAsOfDate: cashBasis.quarterlyBurnAsOfDate,
          quarterlyBurnCause: cashBasis.quarterlyBurnCause,
          quarterlyBurnProvenance,
          runway: cashBasis.runway,
          runwayCause: cashBasis.runwayCause,
          runwayProvenance,
          // Step 7 (the real analyst-authored per-definition V_success date
          // and comparable-basis evidence) does not exist yet, so
          // analyst.preRevenue.successDefinitions here is always the M5
          // illustrative validation bundle's own dollar figures, reused for
          // lack of anything else (analystInputs.ts). That bundle's own
          // vSuccessAsOfDate/vSuccessBasis are a deliberate claim about ITS
          // OWN illustrative construction — never acquired evidence for a
          // real run — so a real run explicitly nulls both back out here
          // rather than reporting a fabricated date/basis as if it had been
          // established for this company's actual filings (H3 conformance
          // correction). This correctly leaves every success weight
          // suppressed, honestly, on a real run until Step 7 exists.
          successDefinitions: analyst.preRevenue.successDefinitions.map((d) => ({
            ...d,
            vSuccessAsOfDate: null,
            vSuccessBasis: null,
          })),
        };

  const fixture: CompanyFixture = {
    schemaVersion: "v1.0.2",
    runId: `acquired-${acquisition.ticker.toLowerCase()}`,
    ticker: acquisition.ticker,
    companyName: acquisition.companyName,
    price: { value: price.value, timestamp: price.timestamp },
    facts: acquisition.facts,

    gate0: analyst.gate0,
    trustInputs: analyst.trustInputs,
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
    preRevenue,
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
