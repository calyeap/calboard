import Decimal from "decimal.js";
import { acquireCompany, type AcquiredCompany, type AcquisitionSource } from "./acquisition/provider";
import { buildCompanyInputs, type NonOperatingInvestmentSelection } from "./acquisition/companyInputs";
import { analystInputsFor } from "./acquisition/analystInputs";
import {
  sectorClassificationFromSic,
  industryClassificationFromSic,
  interestIncomeOverRevenue,
  hasInsurancePremiumOrReserveLineItems,
} from "./acquisition/gate0Inputs";
import type { CompanyFixture } from "./assemble";

// ---------------------------------------------------------------------------
// One run's inputs, assembled from real filings.
//
// This is the seam M8-a replaces. Before it, a run's numbers came from a
// fixture someone wrote by hand; after it, every FACT comes from a filing and
// carries how it was obtained. The analyst-side inputs still come from the
// validation bundle, and analystInputs.ts is where that is stated plainly.
// ---------------------------------------------------------------------------

/**
 * §6.1's five REQUIRED inputs, all four testable ones acquired.
 *
 * THE DEFECT THIS REPLACES had two halves, and fixing either alone would have
 * been worse than fixing neither:
 *
 *  1. `interestIncomeOverRevenue` and `hasInsurancePremiumOrReserveLineItems`
 *     were hard-coded null, so Gate 0 failed closed on every run for every
 *     company.
 *  2. Both classification fields were the SIC DESCRIPTION, which is never the
 *     vocabulary §6.1 tests against — so once the two nulls were filled, the
 *     sector and industry tests would still never fire and a bank would pass
 *     Gate 0. Supplying the nulls without fixing the lookup would have turned a
 *     gate that refused everything into a gate that refused nothing.
 */
function gate0InputsFrom(acquired: AcquiredCompany): CompanyFixture["gate0"] {
  const revenueFact = acquired.acquisition.facts.find((f) => f.id === "current-revenue");
  const revenue =
    revenueFact?.value instanceof Decimal
      ? revenueFact.value
      : revenueFact?.value != null
        ? new Decimal(String(revenueFact.value))
        : null;

  return {
    // Looked up from the SIC CODE. A company with a code has a classification,
    // so only a failed submissions lookup leaves these null — and then Gate 0
    // fails closed, which is §6.1's instruction rather than a gap.
    sectorClassification: sectorClassificationFromSic(acquired.sic, acquired.sicDescription),
    industryClassification: industryClassificationFromSic(acquired.sic, acquired.sicDescription),
    // Zero where no operating interest-income line appears; null only where
    // revenue is unavailable, which leaves the test genuinely unevaluable.
    interestIncomeOverRevenue: interestIncomeOverRevenue(acquired.companyFacts, revenue),
    // Read off the company's own reported elements. Null only where the fact
    // document itself is missing.
    hasInsurancePremiumOrReserveLineItems: hasInsurancePremiumOrReserveLineItems(
      acquired.companyFacts
    ),
    override: null,
  };
}

export class AnalystInputsUnavailableError extends Error {
  constructor(ticker: string) {
    super(
      `No analyst input bundle for ${ticker}. Scenarios are Step 7's output and ` +
        `cannot be acquired or invented — a run without them has no fair-value range.`
    );
    this.name = "AnalystInputsUnavailableError";
  }
}

export interface AcquiredRunInputs {
  fixture: CompanyFixture;
  acquired: AcquiredCompany;
  /** Fact-derived module inputs that came back null, and so return INCOMPLETE. */
  absentInputs: string[];
  /** Rendered to the analyst: what on this run was not acquired. */
  disclosures: string[];
}

export interface BuildAcquiredRunOptions {
  ticker: string;
  price: { value: Decimal; timestamp: string; source: string } | null;
  /**
   * §4.4's judgment, once the analyst has made it. Null means enterprise value
   * is INCOMPLETE — the correct state, since no tag says which investments are
   * non-operating.
   */
  nonOperatingInvestments?: NonOperatingInvestmentSelection | null;
  fiftyTwoWeek?: { low: Decimal; high: Decimal } | null;
  source?: AcquisitionSource;
  acquiredAt?: string;
  /**
   * §6.3. False after *Cannot judge* — the profile was used provisionally and
   * nobody confirmed it, which §9.6 rule 2 reads as PARTIAL.
   *
   * Defaults to false, the fail-closed direction: an unanswered run has not
   * been confirmed by anybody, and claiming otherwise would overstate how much
   * of the analysis can be used.
   */
  profileHumanConfirmed?: boolean;
}

export async function buildAcquiredRun(
  options: BuildAcquiredRunOptions
): Promise<AcquiredRunInputs> {
  const bundle = analystInputsFor(options.ticker);
  if (bundle === null) throw new AnalystInputsUnavailableError(options.ticker);

  const acquired = await acquireCompany(options.ticker, {
    price: options.price,
    source: options.source,
    acquiredAt: options.acquiredAt,
  });

  const { fixture, absentInputs } = buildCompanyInputs(
    acquired.acquisition,
    acquired.companyFacts,
    {
      ...bundle.inputs,
      nonOperatingInvestments: options.nonOperatingInvestments ?? null,
      fiftyTwoWeek: options.fiftyTwoWeek ?? null,
      gate0: gate0InputsFrom(acquired),
      // §9.6 rule 2. The cross-check outcomes come off the acquisition that
      // just ran, so trust reads this run's own failures rather than a
      // remembered set.
      trustInputs: {
        profileHumanConfirmed: options.profileHumanConfirmed ?? false,
        crossCheckFailedFactIds: [...acquired.crossCheckFailedFactIds],
      },
    },
    {
      value: options.price?.value ?? new Decimal(0),
      timestamp: options.price?.timestamp ?? "",
    }
  );

  const disclosures = [acquired.provenanceNote, bundle.note];
  if (options.nonOperatingInvestments == null) {
    disclosures.push(
      "You have not yet said which of this company's investments are non-operating, " +
        "so enterprise value and everything built on it reports incomplete. No tag in " +
        "the filings answers that question — the candidate line items are below, with " +
        "what each is carried at."
    );
  }
  if (options.price === null) {
    disclosures.push(
      "No price was available for this run, so anything that needs one reports " +
        "incomplete. A price is never estimated or carried forward from an earlier day."
    );
  }

  return { fixture, acquired, absentInputs, disclosures };
}
