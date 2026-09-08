import Decimal from "decimal.js";
import type { CompanyFactsDocument } from "./secClient";

// ---------------------------------------------------------------------------
// §6.1's four tests, ACQUIRED rather than left null.
//
// Before this, two of Gate 0's five REQUIRED inputs were hard-coded null in
// acquiredRun.ts, so the gate failed closed on every run for every company —
// and the other two were mapped to a string that could never match, so the
// sector and industry tests were inert as well. A gate that refuses everything
// is indistinguishable from a gate that refuses nothing.
//
// WHY THE SIC CODE AND NOT sicDescription. §6.1 tests whether "sector
// classification is Financials or Real Estate" and whether "industry
// classification is reserve-based extraction". EDGAR's `sicDescription` is
// never either vocabulary — read off the live endpoint:
//
//   MSFT 7372 "Services-Prepackaged Software"   OKLO 4911 "Electric Services"
//   JPM  6021 "National Commercial Banks"       PGR  6331 "Fire, Marine & Casualty Insurance"
//   SPG  6798 "Real Estate Investment Trusts"   NEM  1040 "Gold and Silver Ores"
//
// Matching any of those against "Financials" or "Mining" fails, so the old
// mapping of sicDescription into both fields meant a bank passed Gate 0's
// sector test. The SIC CODE, by contrast, is a documented classification with
// fixed divisions, and §6.1 itself calls these tests "classification lookups,
// not thresholds" — which is exactly what a code range is.
//
// A KNOWN LIMITATION, recorded rather than hidden: the SEC assigns ExxonMobil
// SIC 2911, Petroleum Refining — manufacturing, not extraction — so a
// reserve-based major can pass the industry test on its assigned code. This is
// the limit of the only classification that is actually acquired, not an
// approximation chosen here, and the human override (§6.1) is the route for it.
// Worth Command Center's attention; not a reason to leave the gate inert.
// ---------------------------------------------------------------------------

/** The leading digits of `sic` as a number, or null where none was acquired. */
function sicNumber(sic: string | null | undefined): number | null {
  if (sic === null || sic === undefined) return null;
  const trimmed = sic.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * §6.1's sector classification.
 *
 * Returns §6.1's own vocabulary where the code is asset-based, and a plain
 * descriptive sector otherwise — never null for a company that HAS a code,
 * because null is the gate's fail-closed signal and a classified company has
 * not failed to classify.
 *
 * Divisions, per the SEC's SIC list:
 *   6000–6499  depository institutions, non-depository credit, security and
 *              commodity brokers, insurance carriers and agents → Financials
 *   6500–6599  real estate → Real Estate
 *   6798       real estate investment trusts → Real Estate (§9.1 names REITs)
 *   6700–6799  holding and other investment offices → Financials
 *              (§9.1's "balance-sheet asset managers")
 */
export function sectorClassificationFromSic(
  sic: string | null | undefined,
  sicDescription?: string | null
): string | null {
  const code = sicNumber(sic);
  if (code === null) return null;

  if (code >= 6000 && code <= 6499) return "Financials";
  if (code >= 6500 && code <= 6599) return "Real Estate";
  // REITs first: 6798 sits inside the 67xx investment-offices block but is
  // real estate by construction, and §9.1 lists REITs as their own item.
  if (code === 6798) return "Real Estate";
  if (code >= 6700 && code <= 6799) return "Financials";

  // Classified, and not asset-based. The SEC's own description where there is
  // one, because the profile screen prints this value to an analyst and "SIC
  // 7372" tells them nothing about what the gate looked at. The description is
  // never consulted by the lookup above — that is the defect being fixed, not
  // a behaviour to keep.
  return sicDescription?.trim() || `SIC ${code}`;
}

/**
 * §6.1's industry classification, for the reserve-based extraction test.
 *
 *   1000–1099  metal mining          → Mining
 *   1200–1299  coal mining           → Mining
 *   1311       crude petroleum and natural gas → Oil & Gas Exploration & Production
 *   1400–1499  mining and quarrying of nonmetallic minerals → Mining
 *
 * 1381/1382/1389 are oil-and-gas FIELD SERVICES and are deliberately excluded:
 * a service company owns no reserves, and §6.1's test is the reserve-based row
 * rather than the energy sector.
 */
export function industryClassificationFromSic(
  sic: string | null | undefined,
  sicDescription?: string | null
): string | null {
  const code = sicNumber(sic);
  if (code === null) return null;

  if (code === 1311) return "Oil & Gas Exploration & Production";
  if (code >= 1000 && code <= 1099) return "Mining";
  if (code >= 1200 && code <= 1299) return "Mining";
  if (code >= 1400 && code <= 1499) return "Mining";

  return sicDescription?.trim() || `SIC ${code}`;
}

// ---------------------------------------------------------------------------
// §6.1 test 3 — insurance premium or policy-reserve line items
// ---------------------------------------------------------------------------

/**
 * The us-gaap elements that ARE an insurance premium or policy-reserve line
 * item. An explicit list, never a name pattern, and the reason is empirical.
 *
 * Probed against real filings before writing this: JPM reports
 * `FederalDepositInsuranceCorporationPremiumExpense` and
 * `PreferredStockRedemptionPremium`; MSFT reports
 * `DebtInstrumentUnamortizedDiscountPremiumAndDebtIssuanceCostsNet`; OKLO
 * reports `AccretionAmortizationOfDiscountsAndPremiumsInvestments`. Every one
 * contains "Premium" and none is insurance underwriting — a /Premium/ match
 * would have refused all three as insurers, and §6.1's wrong answer here
 * decides whether a company is refused outright.
 *
 * Each element below is an underwriting premium, a policy reserve, or a
 * directly dependent policy balance — the things that appear in an insurer's
 * primary statements and nowhere else.
 */
export const INSURANCE_PREMIUM_OR_RESERVE_TAGS: readonly string[] = [
  // Premiums earned and written, gross / ceded / net.
  "PremiumsEarnedNet",
  "PremiumsEarnedNetPropertyAndCasualty",
  "PremiumsEarnedNetLife",
  "DirectPremiumsEarned",
  "DirectPremiumsEarnedPropertyAndCasualty",
  "DirectPremiumsWritten",
  "CededPremiumsEarned",
  "CededPremiumsEarnedPropertyAndCasualty",
  "CededPremiumsWritten",
  "AssumedPremiumsEarned",
  "PremiumsWrittenNet",
  "UnearnedPremiums",
  "DeferredPolicyAcquisitionCosts",
  "DeferredPolicyAcquisitionCostAmortizationExpense",
  // Policy reserves and claim liabilities.
  "LiabilityForFuturePolicyBenefits",
  "LiabilityForFuturePolicyBenefitsAndUnpaidClaimsAndClaimsAdjustmentExpense",
  "LiabilityForClaimsAndClaimsAdjustmentExpense",
  "LiabilityForUnpaidClaimsAndClaimsAdjustmentExpense",
  "PolicyholderBenefitsAndClaimsIncurredNet",
  "PolicyholderContractDeposits",
  "PolicyLoansReceivable",
  "ReinsuranceRecoverables",
  "ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments",
];

/**
 * Whether insurance premium or policy-reserve line items appear in the primary
 * financial statements (§6.1 test 3).
 *
 * Null only where the fact document itself is unavailable — that is the genuine
 * unknown, and Gate 0 fails closed on it.
 *
 * FALSE IS AN OBSERVATION, NOT AN ASSUMPTION. A companyfacts document is the
 * index of every element a company reported, so "none of these elements is
 * present" is reading the index rather than inferring from silence. The residual
 * risk is a list that misses an element an insurer used, and it is bounded by
 * the other three tests: an insurance carrier also carries SIC 63xx, which the
 * sector test catches on its own.
 */
export function hasInsurancePremiumOrReserveLineItems(
  companyFacts: CompanyFactsDocument | null
): boolean | null {
  if (companyFacts === null) return null;

  const reported = companyFacts.facts?.["us-gaap"];
  if (reported === undefined) return null;

  return INSURANCE_PREMIUM_OR_RESERVE_TAGS.some((tag) => reported[tag] !== undefined);
}

// ---------------------------------------------------------------------------
// §6.1 test 2 — interest income over revenue
// ---------------------------------------------------------------------------

/**
 * The us-gaap elements that place interest income in the OPERATING section —
 * the banking presentation.
 *
 * Ordered most-specific first, exactly as TAG_MAP orders its candidates.
 *
 * `InterestIncomeOperating` is interest income alone and is preferred.
 * `InterestAndDividendIncomeOperating` combines interest with dividends, so
 * where it is the only element reported the figure is an UPPER BOUND on
 * interest income rather than the quantity itself. That is stated here because
 * it matters to the reading of the test: an upper bound can only make the
 * ">50% of revenue" test fire where the true figure would not, never the
 * reverse — and Gate 0's declared direction of error is refusal ("the gate
 * fails closed: an unclassifiable company is unsupported, never
 * mature-profitable by default"), with the human override as the route back.
 */
const OPERATING_INTEREST_INCOME_TAGS: readonly string[] = [
  "InterestIncomeOperating",
  "InterestAndDividendIncomeOperating",
  "InterestIncomeExpenseNet",
];

/**
 * NON-OPERATING investment interest is deliberately NOT read.
 *
 * `InvestmentIncomeInterest` and `InvestmentIncomeInterestAndDividend` are what
 * an industrial company reports for interest on its cash — MSFT and OKLO both
 * report one. Counting them would divide OKLO's investment interest by its
 * near-zero pre-revenue revenue and refuse it as a bank, contradicting V6,
 * which requires OKLO to reach the pre-revenue module. §6.1's test is about an
 * interest-driven OPERATING model, which is what the banking elements express.
 */
export function operatingInterestIncome(
  companyFacts: CompanyFactsDocument | null
): { tag: string; value: Decimal } | null {
  const reported = companyFacts?.facts?.["us-gaap"];
  if (reported === undefined) return null;

  for (const tag of OPERATING_INTEREST_INCOME_TAGS) {
    const element = reported[tag];
    if (element === undefined) continue;

    // The most recent annual USD figure reported under this element.
    const rows = element.units?.USD ?? [];
    const annual = rows.filter((r) => r.fp === "FY" && r.form?.startsWith("10-K"));
    const latest = (annual.length > 0 ? annual : rows).reduce<(typeof rows)[number] | null>(
      (best, row) => (best === null || row.end > best.end ? row : best),
      null
    );
    if (latest === undefined || latest === null) continue;

    return { tag, value: new Decimal(String(latest.val)) };
  }

  return null;
}

/**
 * §6.1 test 2's ratio, or null where it cannot be evaluated.
 *
 * THE NUMERATOR DECIDES WHETHER THE DENOMINATOR IS NEEDED, and that ordering is
 * load-bearing rather than a micro-optimisation. Zero interest income cannot
 * exceed 50% of ANY revenue, known or unknown, so where no operating
 * interest-income line appears the test cannot fire and revenue is never
 * consulted.
 *
 * Checking revenue first instead would return null for every PRE-REVENUE
 * company — OKLO has no revenue fact at all — and a null here fails Gate 0
 * closed. That would refuse the entire pre-revenue profile (§6.3's third row),
 * contradicting V6, which requires OKLO to reach the pre-revenue module.
 *
 * Null therefore means one specific thing: there IS an operating
 * interest-income line and no revenue to read it against. That is the case
 * where refusing rather than guessing is right.
 *
 * ZERO IS AN OBSERVATION, NOT AN ASSUMPTION, on the same basis as the insurance
 * test: companyfacts is the index of what the company reported, so no operating
 * interest-income element means no such line is in its primary statements.
 */
export function interestIncomeOverRevenue(
  companyFacts: CompanyFactsDocument | null,
  revenue: Decimal | null
): Decimal | null {
  const interest = operatingInterestIncome(companyFacts);
  if (interest === null || interest.value.isZero()) return new Decimal(0);

  if (revenue === null) return null;

  // A positive operating interest-income line against zero revenue: the ratio
  // is unbounded rather than undefined, and the company's income IS interest —
  // the asset-based case §6.1 is looking for. Reported as 1 (100% of revenue)
  // rather than as a division by zero.
  if (revenue.isZero()) return new Decimal(1);

  return interest.value.dividedBy(revenue);
}
