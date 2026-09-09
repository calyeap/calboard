import type { CompanyFactsDocument, XbrlFactUnitRow } from "../../lib/analyzer/acquisition/secClient";

// ---------------------------------------------------------------------------
// NESTING AND LEASE-AMOUNT STATES, under the later CalFinance rulings.
//
// Shared by the three measurement harnesses so they cannot drift apart, and so
// that the two rejected inferences are impossible to reintroduce in one of them
// without the others. HARNESS-ONLY: nothing here is imported by lib/, nothing
// here changes a mapping, and nothing here is acquired as a fact.
//
// TWO INFERENCES THE RULINGS REJECT, both of which the first pass made:
//
//  1. `finance lease > total debt` does NOT prove zero nesting. It proves only
//     that the lease is not FULLY nested. A lease of 66,594 against a debt
//     total of 40,294 could still have any amount up to 40,294 sitting inside
//     that total. The earlier harness classified this as EXCLUDED; it is
//     UNKNOWN unless issuer evidence places the liability.
//
//  2. A MISSING XBRL TAG IS NOT ZERO, and it is not "nothing to nest" either.
//     The earlier harness read tag absence as "no lease enters any bridge".
//     Lilly is the counter-example that shows the cost: it tags no
//     finance-lease liability and its 10-K states that its finance leases ARE
//     included in long-term debt. Absence of the tag concealed a nested lease
//     rather than indicating none.
//
// A lease amount may be treated as 0 only as DISCLOSED ZERO (an explicit zero,
// or an explicit statement of none) or REPORTED NIL (a complete, scoped issuer
// disclosure establishing that no material finance-lease liability is
// reported — used as 0 for a bridge, with provenance preserved as REPORTED
// NIL, never as an exact economic zero). Tag absence, partial disclosure,
// "primarily operating", an insignificant lease cost, or any statement not
// addressing the liability all leave it UNKNOWN.
// ---------------------------------------------------------------------------

export type NestingState =
  /** Issuer evidence establishes the lease sits inside the debt total. */
  | "NESTED"
  /** Nested per issuer evidence, but the issuer never states the amount. */
  | "NESTED-UNQUANTIFIED"
  /** Issuer evidence establishes the lease sits outside the debt total. */
  | "NOT NESTED"
  /** No approved evidence places the liability. The fail-closed answer. */
  | "UNKNOWN";

export type LeaseAmountState =
  /** A finance-lease liability resolved through the mapping. */
  | "TAGGED"
  /** Explicit zero, or an explicit issuer statement of none. */
  | "DISCLOSED ZERO"
  /** Complete, scoped disclosure that no material liability is reported. */
  | "REPORTED NIL"
  /** Not tagged and not established by disclosure. Never zero. */
  | "UNKNOWN";

export type EvidenceKind =
  | "E3 issuer element identity"
  | "recorded issuer disclosure"
  | "recorded issuer disclosure — insufficient"
  | "none available";

export interface NestingDetermination {
  state: NestingState;
  leaseAmount: LeaseAmountState;
  evidence: EvidenceKind;
  detail: string;
  /** Where a recorded determination came from, so it can be re-checked. */
  accession?: string;
}

/**
 * Elements whose us-gaap definition INCLUDES capital/finance lease
 * obligations. A filer tagging one of these at the same instant, with the same
 * value as its plain debt total, has itself asserted the total includes
 * leases — an issuer-filed XBRL relationship rather than an arithmetic
 * accident.
 */
export const LEASE_INCLUSIVE_DEBT_ELEMENTS = [
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "LongTermDebtAndCapitalLeaseObligations",
  "LongTermDebtAndCapitalLeaseObligationsCurrent",
  "DebtAndCapitalLeaseObligations",
] as const;

const ELIGIBLE_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

/**
 * Determinations read out of a filing's own disclosure by a human.
 *
 * RECORDED, NOT DERIVED, and deliberately separate from the tag tests: a
 * verdict read from a note must never be presentable as something the tags
 * established. Each carries the accession it was read from so a reviewer can
 * re-check it, which is what makes it a fact about a filing with a source
 * rather than a constant somebody typed.
 *
 * Reading a filing to review the mapping is a mapping-review activity, which
 * §3.8.1 rests the queue exemption on. No VALUE below is acquired from these
 * readings — they carry a classification and its source, nothing more.
 */
export const RECORDED_ISSUER_EVIDENCE: Readonly<
  Record<string, { state: NestingState; leaseAmount: LeaseAmountState; accession: string; quote: string }>
> = {
  MSFT: {
    state: "NOT NESTED",
    leaseAmount: "TAGGED",
    accession: "0001193125-26-323660",
    quote:
      "FY2026 Note 13, supplemental balance-sheet table: finance leases are stated as " +
      "Other current liabilities $4,290M + Other long-term liabilities $62,304M = " +
      "Total finance lease liabilities $66,594M, reconciling exactly to the acquired " +
      "figure and placing the whole liability outside long-term debt",
  },
  OKLO: {
    state: "NOT NESTED",
    leaseAmount: "TAGGED",
    accession: "0001628280-26-054571",
    quote:
      "\"Finance lease liability of $187 is included within other liabilities on the " +
      "condensed consolidated balance sheets.\" Not within long-term debt",
  },
  COST: {
    state: "NOT NESTED",
    leaseAmount: "TAGGED",
    accession: "0000909832-25-000101",
    quote:
      "Lease note footnote (3) on long-term finance lease liabilities of $1,401: " +
      "\"Included in other long-term liabilities in the consolidated balance sheets.\" " +
      "Footnote (2), current portion: \"Included in other current liabilities.\"",
  },
  RIVN: {
    state: "NOT NESTED",
    leaseAmount: "TAGGED",
    accession: "0001874178-26-000054",
    quote:
      "Balance sheet presents Long-term debt and Non-current lease liabilities as two " +
      "separate lines; the balance-sheet calculation linkbase makes LongTermDebtNoncurrent " +
      "and OperatingLeaseLiabilityNoncurrent disjoint sibling summands of Liabilities",
  },
  LLY: {
    state: "NESTED-UNQUANTIFIED",
    leaseAmount: "UNKNOWN",
    accession: "0000059478-25-000067",
    quote:
      "\"Finance leases are included in property and equipment, short-term borrowings and " +
      "current maturities of long-term debt, and long-term debt in our consolidated balance " +
      "sheets.\" The amount is never stated; \"not material\" is not an amount",
  },
};

/**
 * Filings whose disclosure was read and found INSUFFICIENT.
 *
 * Recorded so that UNKNOWN says why, and so the reason is reviewable. These are
 * the cases where the binding constraint is what the issuer chose to disclose,
 * not Calboard's access to it — no route reaches a determination the filing
 * does not contain.
 */
export const RECORDED_INSUFFICIENT_DISCLOSURE: Readonly<
  Record<string, { accession: string; quote: string }>
> = {
  NVDA: {
    accession: "0001045810-26-000021",
    quote:
      "\"Our lease obligations primarily consist of operating leases\" — 12 occurrences of " +
      "\"operating lease\", none of \"finance lease\" or \"capital lease\". \"Primarily\" does " +
      "not address the liability, so this is neither DISCLOSED ZERO nor REPORTED NIL",
  },
  KO: {
    accession: "0001628280-26-010047",
    quote:
      "The lease note never mentions finance or capital leases — 21 occurrences of " +
      "\"operating lease\", zero of either other term. No statement addresses the liability",
  },
  INTC: {
    accession: "0000050863-26-000011",
    quote:
      "No leases note at all in the latest 10-K. Finance lease payments ($133M undiscounted), " +
      "finance leased assets ($453M in PP&E) and finance-lease principal payments ($105M) are " +
      "disclosed, but the liability is never stated separately and its balance-sheet location " +
      "is never given — partial disclosure, so UNKNOWN",
  },
};

function instantAt(doc: CompanyFactsDocument, tag: string, at: string): XbrlFactUnitRow | null {
  const rows = doc.facts?.["us-gaap"]?.[tag]?.units?.["USD"];
  if (!rows) return null;
  let best: XbrlFactUnitRow | null = null;
  for (const row of rows) {
    if (row.start !== undefined) continue;
    if (row.end !== at) continue;
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (best === null || Date.parse(row.filed ?? "1970-01-01") > Date.parse(best.filed ?? "1970-01-01")) {
      best = row;
    }
  }
  return best;
}

/**
 * The nesting determination for one company, under the later rulings.
 *
 * Order matters. The issuer's own XBRL relationship is checked first because it
 * is machine-checkable and re-verifiable; a recorded human reading of the
 * filing comes next; and everything else is UNKNOWN. There is deliberately no
 * branch for `lease > debt` and no branch that reads a missing tag as nil.
 *
 * `leaseValue` is what the mapping RESOLVED — the figure a bridge would
 * actually add — and null means it did not resolve, which is UNKNOWN and never
 * zero.
 */
export function determineNesting(
  doc: CompanyFactsDocument,
  ticker: string,
  debt: { value: number | null; asOfDate: string | null },
  leaseValue: number | null
): NestingDetermination {
  const recorded = RECORDED_ISSUER_EVIDENCE[ticker];
  const insufficient = RECORDED_INSUFFICIENT_DISCLOSURE[ticker];

  // E3 — the issuer's own element identity, at the same instant. Checked even
  // where a recorded reading exists, because a machine-checkable relationship
  // is the stronger evidence and a disagreement between the two is worth
  // surfacing rather than hiding behind a precedence rule.
  if (debt.value !== null && debt.asOfDate !== null) {
    for (const element of LEASE_INCLUSIVE_DEBT_ELEMENTS) {
      const row = instantAt(doc, element, debt.asOfDate);
      if (row !== null && row.val === debt.value) {
        return {
          state: "NESTED",
          leaseAmount: leaseValue === null ? "UNKNOWN" : "TAGGED",
          evidence: "E3 issuer element identity",
          detail:
            `the filer tags the same instant (${debt.asOfDate}) and the same value ` +
            `(${debt.value}) under us-gaap:${element}, whose definition includes capital ` +
            `lease obligations — the issuer has asserted its debt total is a ` +
            `debt-and-capital-lease total`,
        };
      }
    }
  }

  if (recorded !== undefined) {
    return {
      state: recorded.state,
      leaseAmount: recorded.leaseAmount,
      evidence: "recorded issuer disclosure",
      detail: recorded.quote,
      accession: recorded.accession,
    };
  }

  if (insufficient !== undefined) {
    return {
      state: "UNKNOWN",
      leaseAmount: "UNKNOWN",
      evidence: "recorded issuer disclosure — insufficient",
      detail: insufficient.quote,
      accession: insufficient.accession,
    };
  }

  return {
    state: "UNKNOWN",
    leaseAmount: leaseValue === null ? "UNKNOWN" : "TAGGED",
    evidence: "none available",
    detail:
      leaseValue === null
        ? "no finance-lease liability resolved and no issuer disclosure was read; a missing " +
          "tag is not zero and not an absence of leases, so both the amount and the nesting " +
          "are UNKNOWN"
        : "a finance-lease liability resolved but nothing places it relative to the debt " +
          "total: no lease-inclusive debt element at this instant, and no recorded issuer " +
          "disclosure. Note that a lease exceeding the debt total would NOT settle this — it " +
          "disproves full nesting only",
  };
}
