import Decimal from "decimal.js";
import { acquireCompany, type AcquiredCompany, type AcquisitionSource } from "./acquisition/provider";
import { buildCompanyInputs, type NonOperatingInvestmentSelection } from "./acquisition/companyInputs";
import { analystInputsFor } from "./acquisition/analystInputs";
import type { CompanyFixture } from "./assemble";

// ---------------------------------------------------------------------------
// One run's inputs, assembled from real filings.
//
// This is the seam M8-a replaces. Before it, a run's numbers came from a
// fixture someone wrote by hand; after it, every FACT comes from a filing and
// carries how it was obtained. The analyst-side inputs still come from the
// validation bundle, and analystInputs.ts is where that is stated plainly.
// ---------------------------------------------------------------------------

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
      gate0: {
        // Gate 0 fails closed on a missing classification (§6.1, §5.3). The SEC
        // SIC description is the only classification acquired; where the
        // submissions lookup returned nothing, this stays null and Gate 0
        // returns UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE rather than
        // defaulting to mature-profitable.
        sectorClassification: acquired.sicDescription,
        industryClassification: acquired.sicDescription,
        // Not mapped in this version. Null, so Gate 0's interest-income test
        // cannot pass by absence.
        interestIncomeOverRevenue: null,
        hasInsurancePremiumOrReserveLineItems: null,
        override: null,
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
