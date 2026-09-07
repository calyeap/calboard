import type { JudgmentKey } from "./decisions";

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
// FOR THE M8 CROSS-CHECK. NON-OPERATING INVESTMENTS has no options because no
// mock enumerates them and no fixture can supply them: the company's
// non-operating investments are carried as a single derived figure and the
// individual holdings behind it are not separately recorded. Composing a
// candidate list would put invented line items on the one screen whose purpose
// is checking figures against their sources, where they would read as filed
// data rather than as a reconstruction — which is why this is a stated gap
// rather than a synthetic list.
//
// This is the third item waiting on real acquisition, alongside
// NAMED_MATERIAL_FACT_IDS and §3.8's "any figure classified UNVERIFIED" limb
// (both in spotCheck.ts). All three should be re-read together when M8 lands.
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
