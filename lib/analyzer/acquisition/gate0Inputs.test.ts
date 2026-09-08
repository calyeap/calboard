import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  sectorClassificationFromSic,
  industryClassificationFromSic,
  hasInsurancePremiumOrReserveLineItems,
  operatingInterestIncome,
  interestIncomeOverRevenue,
  INSURANCE_PREMIUM_OR_RESERVE_TAGS,
} from "./gate0Inputs";
import { captureFor } from "./provider";
import { evaluateGate0 } from "../gates";
import type { CompanyFactsDocument } from "./secClient";

// ---------------------------------------------------------------------------
// §6.1's four tests, acquired.
//
// EVERY SIC CODE BELOW WAS READ OFF EDGAR, not recalled:
//
//   MSFT 7372 Services-Prepackaged Software      OKLO 4911 Electric Services
//   JPM  6021 National Commercial Banks          PGR  6331 Fire, Marine & Casualty Insurance
//   SPG  6798 Real Estate Investment Trusts      NEM  1040 Gold and Silver Ores
//   XOM  2911 Petroleum Refining
//
// WHY THE CODE AND NOT THE DESCRIPTION. `sicDescription` is never the string
// §6.1 tests against: JPM's is "National Commercial Banks", not "Financials",
// and NEM's is "Gold and Silver Ores", not "Mining". Matching the description
// against §6.1's vocabulary fails for every company, which is why Gate 0's
// sector and industry tests could not fire on real EDGAR data at all.
// ---------------------------------------------------------------------------

/**
 * A fact document reporting exactly these elements, each with one annual row.
 *
 * The row matters: a presence test passes on the element alone, but reading a
 * FIGURE needs a value, and a helper that supplied none would let
 * `operatingInterestIncome` return null for the wrong reason.
 */
function factsWith(tags: string[], value = 1_000): CompanyFactsDocument {
  const facts: CompanyFactsDocument["facts"] = { "us-gaap": {} };
  for (const tag of tags) {
    facts["us-gaap"][tag] = {
      label: null,
      units: {
        USD: [
          {
            end: "2026-06-30",
            val: value,
            fy: 2026,
            fp: "FY",
            form: "10-K",
            filed: "2026-07-30",
            start: "2025-07-01",
          },
        ],
      },
    };
  }
  return { cik: 1, entityName: "Test Co", facts };
}

describe("§6.1 sector classification, from the SEC's own SIC code", () => {
  it("reads a commercial bank as Financials (JPM, 6021)", () => {
    expect(sectorClassificationFromSic("6021")).toBe("Financials");
  });

  it("reads a property-casualty insurer as Financials (PGR, 6331)", () => {
    expect(sectorClassificationFromSic("6331")).toBe("Financials");
  });

  it("reads a broker-dealer as Financials (62xx)", () => {
    // §9.1's row names brokers alongside banks and insurers.
    expect(sectorClassificationFromSic("6211")).toBe("Financials");
  });

  it("reads a REIT as Real Estate (SPG, 6798)", () => {
    // §9.1's row names REITs explicitly.
    expect(sectorClassificationFromSic("6798")).toBe("Real Estate");
  });

  it("reads an operating real-estate company as Real Estate (65xx)", () => {
    expect(sectorClassificationFromSic("6512")).toBe("Real Estate");
  });

  it("does NOT read a software company as asset-based (MSFT, 7372)", () => {
    expect(sectorClassificationFromSic("7372")).not.toBe("Financials");
    expect(sectorClassificationFromSic("7372")).not.toBe("Real Estate");
  });

  it("does NOT read an electric-services company as asset-based (OKLO, 4911)", () => {
    // V6 requires OKLO to reach the pre-revenue module, so Gate 0 must pass it.
    expect(sectorClassificationFromSic("4911")).not.toBe("Financials");
    expect(sectorClassificationFromSic("4911")).not.toBe("Real Estate");
  });

  it("is null where no SIC code was acquired — never a classifiable default", () => {
    // §6.1 fails closed on a missing classification, which requires the
    // missing case to stay distinguishable from a present one.
    expect(sectorClassificationFromSic(null)).toBeNull();
    expect(sectorClassificationFromSic("")).toBeNull();
  });

  it("still names the sector for a company that is neither, so the input is present", () => {
    // The gate's fail-closed branch fires on a MISSING classification. A
    // software company has a classification and it is not asset-based, so the
    // value must be a real string rather than null.
    expect(typeof sectorClassificationFromSic("7372")).toBe("string");
  });

  it("uses the SEC's own description for a non-asset-based company, so the screen is readable", () => {
    // The gate only needs "is it Financials or Real Estate", but the profile
    // screen prints this value to an analyst. "SIC 7372" tells them nothing;
    // the description EDGAR supplied tells them what the gate looked at.
    expect(sectorClassificationFromSic("7372", "Services-Prepackaged Software")).toBe(
      "Services-Prepackaged Software"
    );
  });

  it("still reads Financials for a bank even when a description is supplied", () => {
    // The description must never override the lookup — that is the defect being
    // fixed, not a behaviour to preserve.
    expect(sectorClassificationFromSic("6021", "National Commercial Banks")).toBe("Financials");
  });
});

describe("§6.1 industry classification — reserve-based extraction", () => {
  it("reads crude petroleum and natural gas as E&P (1311)", () => {
    expect(industryClassificationFromSic("1311")).toBe("Oil & Gas Exploration & Production");
  });

  it("reads metal ore mining as Mining (NEM, 1040)", () => {
    expect(industryClassificationFromSic("1040")).toBe("Mining");
  });

  it("reads coal mining as Mining (12xx)", () => {
    expect(industryClassificationFromSic("1220")).toBe("Mining");
  });

  it("does NOT read oil-and-gas field SERVICES as reserve-based (1389)", () => {
    // A service company owns no reserves. §6.1's test is the reserve-based
    // row, not the energy sector.
    expect(industryClassificationFromSic("1389")).not.toBe("Oil & Gas Exploration & Production");
    expect(industryClassificationFromSic("1389")).not.toBe("Mining");
  });

  it("does NOT read petroleum REFINING as reserve-based (XOM, 2911)", () => {
    // Read off EDGAR: ExxonMobil's assigned SIC is 2911, refining — which is
    // manufacturing, not extraction. Noted as a real limitation in the module.
    expect(industryClassificationFromSic("2911")).not.toBe("Oil & Gas Exploration & Production");
    expect(industryClassificationFromSic("2911")).not.toBe("Mining");
  });

  it("is null where no SIC code was acquired", () => {
    expect(industryClassificationFromSic(null)).toBeNull();
  });
});

describe("§6.1 insurance premium and policy-reserve line items", () => {
  it("is an explicit element list, never a name pattern", () => {
    // The probe that forced this: JPM reports
    // FederalDepositInsuranceCorporationPremiumExpense and
    // PreferredStockRedemptionPremium; MSFT reports
    // DebtInstrumentUnamortizedDiscountPremiumAndDebtIssuanceCostsNet; OKLO
    // reports AccretionAmortizationOfDiscountsAndPremiumsInvestments. A
    // /Premium/ match would refuse all three as insurers.
    expect(INSURANCE_PREMIUM_OR_RESERVE_TAGS.length).toBeGreaterThan(0);
    for (const tag of INSURANCE_PREMIUM_OR_RESERVE_TAGS) {
      expect(tag).not.toMatch(/FederalDepositInsurance|PreferredStockRedemption|DebtInstrument/);
    }
  });

  it("is true for an insurer's premium elements (PGR reports DirectPremiumsEarned)", () => {
    expect(hasInsurancePremiumOrReserveLineItems(factsWith(["DirectPremiumsEarned"]))).toBe(true);
  });

  it("is true for a policy-reserve element", () => {
    expect(
      hasInsurancePremiumOrReserveLineItems(factsWith(["LiabilityForFuturePolicyBenefits"]))
    ).toBe(true);
  });

  it("is false for a bank's FDIC premium expense (JPM's real tag)", () => {
    expect(
      hasInsurancePremiumOrReserveLineItems(
        factsWith(["FederalDepositInsuranceCorporationPremiumExpense", "PreferredStockRedemptionPremium"])
      )
    ).toBe(false);
  });

  it("is false for a bond-premium element (MSFT's real tag)", () => {
    expect(
      hasInsurancePremiumOrReserveLineItems(
        factsWith(["DebtInstrumentUnamortizedDiscountPremiumAndDebtIssuanceCostsNet"])
      )
    ).toBe(false);
  });

  it("is false for an investment-premium amortisation element (OKLO's real tag)", () => {
    expect(
      hasInsurancePremiumOrReserveLineItems(
        factsWith(["AccretionAmortizationOfDiscountsAndPremiumsInvestments"])
      )
    ).toBe(false);
  });

  it("is null where the fact document itself is unavailable — the genuine unknown", () => {
    expect(hasInsurancePremiumOrReserveLineItems(null)).toBeNull();
  });
});

describe("§6.1 interest income over revenue", () => {
  it("reads a bank's OPERATING interest income (JPM reports InterestAndDividendIncomeOperating)", () => {
    expect(operatingInterestIncome(factsWith(["InterestAndDividendIncomeOperating"]))).not.toBeNull();
  });

  it("ignores NON-OPERATING investment interest (OKLO reports InvestmentIncomeInterest)", () => {
    // Decisive for V6. OKLO is pre-revenue: counting its investment interest
    // against near-zero revenue would refuse a validated v1 case as a bank.
    // §6.1's test is about an interest-driven operating model, and the
    // operating presentation is what the banking elements express.
    expect(
      operatingInterestIncome(factsWith(["InvestmentIncomeInterest", "InvestmentIncomeInterestAndDividend"]))
    ).toBeNull();
  });

  it("is zero where no operating interest-income line appears at all", () => {
    // Not an estimate: XBRL company facts are the index of what the company
    // reported, so no operating interest-income element means no such line is
    // in its primary statements.
    const ratio = interestIncomeOverRevenue(factsWith(["Revenues"]), new Decimal(270_000));
    expect(ratio).not.toBeNull();
    expect(ratio!.isZero()).toBe(true);
  });

  it("is zero for a pre-revenue company with no interest income at all (V6 — OKLO)", () => {
    // Decisive. OKLO has no `current-revenue` fact, so revenue is null — and a
    // null ratio fails Gate 0 closed, which would refuse every pre-revenue
    // company and contradict V6, §6.3's third profile row and the whole
    // pre-revenue scope. Zero interest income cannot exceed 50% of ANY
    // revenue, known or not, so the test cannot fire and the denominator is
    // never needed.
    const ratio = interestIncomeOverRevenue(factsWith(["Revenues"]), null);
    expect(ratio).not.toBeNull();
    expect(ratio!.isZero()).toBe(true);
  });

  it("cannot be evaluated where there IS operating interest income but no revenue", () => {
    // The case that genuinely needs the denominator, and the one where failing
    // closed is right: an operating interest-income line with unknown revenue
    // is exactly where Gate 0 should refuse rather than guess.
    expect(
      interestIncomeOverRevenue(factsWith(["InterestAndDividendIncomeOperating"]), null)
    ).toBeNull();
  });

  it("is zero rather than undefined where revenue is zero and there is no interest income", () => {
    // A pre-revenue company must not be divided into a refusal. OKLO's own
    // case: no operating interest income, so the test cannot fire.
    const ratio = interestIncomeOverRevenue(factsWith(["Revenues"]), new Decimal(0));
    expect(ratio).not.toBeNull();
    expect(ratio!.isZero()).toBe(true);
  });
});

describe("against the committed captures — the populated case the suite must exercise", () => {
  it("MSFT's real filings show no insurance premium or policy-reserve line items", () => {
    const doc = captureFor("MSFT");
    expect(doc).not.toBeNull();
    expect(hasInsurancePremiumOrReserveLineItems(doc)).toBe(false);
  });

  it("OKLO's real filings show no insurance premium or policy-reserve line items", () => {
    const doc = captureFor("OKLO");
    expect(doc).not.toBeNull();
    expect(hasInsurancePremiumOrReserveLineItems(doc)).toBe(false);
  });

  it("MSFT's real filings show no operating interest income, so the ratio is zero", () => {
    const doc = captureFor("MSFT");
    const ratio = interestIncomeOverRevenue(doc, new Decimal(270_000_000_000));
    expect(ratio).not.toBeNull();
    expect(ratio!.isZero()).toBe(true);
  });
});

describe("the acquired inputs, run through Gate 0 itself", () => {
  // The lookup and the gate wired together. Testing the mapping alone would
  // leave the thing that actually matters — what the gate RETURNS for a bank —
  // unasserted, which is how the sector test came to be inert in the first
  // place.
  function gate0For(sic: string, sicDescription: string, facts: CompanyFactsDocument) {
    return evaluateGate0({
      sectorClassification: sectorClassificationFromSic(sic, sicDescription),
      industryClassification: industryClassificationFromSic(sic, sicDescription),
      interestIncomeOverRevenue: interestIncomeOverRevenue(facts, new Decimal(100_000)),
      hasInsurancePremiumOrReserveLineItems: hasInsurancePremiumOrReserveLineItems(facts),
      override: null,
    });
  }

  it("refuses a commercial bank (V7)", () => {
    // V7: "Gate 0 → UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1."
    const result = gate0For("6021", "National Commercial Banks", factsWith(["Revenues"]));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses a property-casualty insurer", () => {
    const result = gate0For("6331", "Fire, Marine & Casualty Insurance", factsWith(["DirectPremiumsEarned"]));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses a REIT (§9.1 names REITs)", () => {
    const result = gate0For("6798", "Real Estate Investment Trusts", factsWith(["Revenues"]));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses a gold miner (NEM, 1040)", () => {
    const result = gate0For("1040", "Gold and Silver Ores", factsWith(["Revenues"]));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("refuses an insurer on its premium line items even where the sector test misses", () => {
    // The independence §6.1 requires: "an interest-income, insurance/reserve, or
    // industry-classification result can fire the refusal on its own even if
    // another input is separately missing."
    const result = gate0For("7372", "Services-Prepackaged Software", factsWith(["LiabilityForFuturePolicyBenefits"]));
    expect(result.result).toBe("UNSUPPORTED PROFILE — ASSET-BASED ROW NOT VALIDATED IN v1");
  });

  it("passes a software company (V4 — MSFT)", () => {
    const result = gate0For("7372", "Services-Prepackaged Software", factsWith(["Revenues"]));
    expect(result.result).toBe("PASS");
  });

  it("passes an electric-services company (V6 — OKLO)", () => {
    const result = gate0For("4911", "Electric Services", factsWith(["Revenues"]));
    expect(result.result).toBe("PASS");
  });
});
