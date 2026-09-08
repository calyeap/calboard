import type { JudgmentKey } from "./decisions";
import type { CandidateInvestment } from "./acquisition/acquire";
import { optionsFromCandidates } from "./acquisition/nonOperatingJudgment";

// ---------------------------------------------------------------------------
// §4.4's three judgments, as Screen 2 presents them.
//
// Design §198 states the principle these implement: "the human selects; the
// human never types a figure." §4.4's three judgments are selections among
// presented options, and design §152's JudgmentSelector "presents options WITH
// their resulting figures side by side" — the figure is the point, because
// §4.4's own guidance is to examine the size of the gap between the options.
//
// Every label, figure and note below is taken VERBATIM from
// mock-human-steps.html. None of it is composed here. Where the mock does not
// supply options, this file says so rather than inventing them.
//
// RESOLVED AT M8-a. NON-OPERATING INVESTMENTS used to have no options, because
// no mock enumerated them and no fixture could supply them: the company's
// non-operating investments were carried as a single derived figure with the
// individual holdings not separately recorded. Real filings DO supply them —
// Microsoft tags equity-method investments and equity securities without a
// readily determinable fair value as separate elements, each at book — so
// `judgmentsForRun` below fills the options from acquisition.
//
// The static entry keeps its null options and its gap text, and that is
// deliberate: it is what a filer who tags none still gets, and it is the
// honest answer in that case. What changed is that the list is no longer
// unavailable in principle, only unavailable for some companies.
//
// The software still does not choose. §4.4 calls this "a classification, not a
// reported line", and no tag says which investments are non-operating.
// ---------------------------------------------------------------------------

export interface JudgmentOption {
  /** The `.lab` line — what the choice is. */
  label: string;
  /** The `.fig` line — the figure this choice produces. */
  figure: string;
  /** The second `.lab`, where the mock carries one, naming what the figure is. */
  figureLabel?: string;
}

export interface ExcludedOption extends JudgmentOption {
  /** Why it is shown but not offered. */
  note: string;
}

export interface JudgmentDefinition {
  key: JudgmentKey;
  title: string;
  why: string;
  /**
   * Null where the options are not yet enumerable. Null is not "none" — it is
   * "this cannot be listed yet", and `gap` says why in the same register.
   */
  options: JudgmentOption[] | null;
  /**
   * An option shown so the analyst can see it was considered and refused. Not
   * selectable: there is no choice here to make.
   */
  excluded: ExcludedOption | null;
  /** The mock's closing `.note`, where it carries one. */
  note: string | null;
  /** Present only where `options` is null. */
  gap: string | null;
}

export const JUDGMENTS: readonly JudgmentDefinition[] = [
  {
    key: "ACCOUNTING-BASIS WINDOW",
    title: "Accounting-basis window",
    why: "Restate-all and shorten-window give different answers. Both are defensible once labelled. The mixed basis is not.",
    options: [
      {
        label: "Restated FY2016 — full ten-year window",
        figure: "13.8%",
        figureLabel: "revenue CAGR",
      },
      {
        label: "Shortened window — FY2017–FY2026, no restatement needed",
        figure: "14.7%",
        figureLabel: "revenue CAGR, nine years",
      },
    ],
    excluded: {
      label: "Mixed basis — the figure originally used",
      figure: "14.6%",
      note: "Not offered — inconsistent accounting basis across the window",
    },
    note: "Selection and its reason are recorded with the analysis and printed in report section J.",
    gap: null,
  },
  {
    key: "NON-OPERATING INVESTMENTS",
    title: "Which investments are non-operating",
    why: "A classification, not a reported line. Carried at book, with the direction of likely error stated.",
    // No mock renders this judgment's options, and none can be derived: the
    // company's non-operating investments are carried as a single figure, and
    // the individual holdings behind it are not separately recorded. Composing
    // a candidate list would put invented line items on the one screen whose
    // purpose is checking figures against their sources, where they would read
    // as filed data rather than as a reconstruction.
    options: null,
    excluded: null,
    note: null,
    gap: "The candidate line items are not enumerable yet. This company's non-operating investments are carried as a single figure, and the individual holdings behind it are not separately recorded — so there is nothing to offer as options that would not have been made up. Name the classification you are making; the selectable list, each item carried at book with the direction of likely error beside it, arrives with fact acquisition.",
  },
  {
    key: "MEDIAN-MARGIN NOPAT WINDOW",
    title: "Median-margin NOPAT window",
    why: "A choice of normalisation basis. Named median-margin NOPAT throughout the interface — never “normalised”.",
    options: [
      { label: "Ten-year median margin", figure: "38.0%" },
      { label: "Nine-year median margin, restatement-free window", figure: "39.1%" },
    ],
    excluded: null,
    note: null,
    gap: null,
  },
];

/**
 * The three judgments as THIS run presents them.
 *
 * NON-OPERATING INVESTMENTS gets its options from acquisition. Before M8-a it
 * had none, and the comment at the head of this file recorded why: the fixture
 * carried a single derived aggregate and the holdings behind it were not
 * separately recorded, so any list would have been invented. Real filings tag
 * the line items individually, so the list is now real.
 *
 * The gap text survives for a filer that tags none. That is not a defect in
 * acquisition — some companies genuinely hold no separately tagged investments
 * — and saying so is better than offering an empty select.
 */
export function judgmentsForRun(
  candidateNonOperatingInvestments: readonly CandidateInvestment[]
): readonly JudgmentDefinition[] {
  const options = optionsFromCandidates(candidateNonOperatingInvestments);

  return JUDGMENTS.map((judgment) => {
    if (judgment.key !== "NON-OPERATING INVESTMENTS" || options === null) return judgment;
    return {
      ...judgment,
      options,
      gap: null,
      note:
        "These are the investment line items this company tags separately, each " +
        "at its carrying value. Which of them are non-operating is a " +
        "classification, not a reported line — the software presents them and " +
        "does not choose. Book value is the floor for a holding carried at cost.",
    };
  });
}
