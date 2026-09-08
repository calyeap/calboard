import Decimal from "decimal.js";
import type { CandidateInvestment } from "./acquire";
import type { NonOperatingInvestmentSelection } from "./companyInputs";
import type { JudgmentOption } from "../judgments";

// ---------------------------------------------------------------------------
// §4.4's second judgment: WHICH INVESTMENTS ARE NON-OPERATING.
//
// This was one of the three items waiting on real acquisition. Before M8-a the
// judgment had NO OPTIONS, because the fixture carried a single derived
// aggregate and the individual holdings behind it were not separately
// recorded — judgments.ts said so rather than inventing a list.
//
// Real filings do supply the line items. Microsoft tags equity-method
// investments and equity securities without a readily determinable fair value
// as separate elements, each with its own book value. Those are the candidates
// the analyst classifies.
//
// What has NOT changed, and must not: the software still does not choose. §4.4
// calls this "a classification, not a reported line", and no tag says which of
// a company's investments are non-operating. Acquisition presents the line
// items with their carrying values; the analyst selects; §3.5's requirement to
// state the direction of the likely error beside the carrying value rides on
// the selection.
// ---------------------------------------------------------------------------

/**
 * The tagged line items, as selectable options.
 *
 * One option per candidate, plus a NONE option — a company with no
 * non-operating investments is a real answer, and without it the analyst
 * would have to leave the judgment unmade to express it, which is a different
 * state entirely (INCOMPLETE rather than "classified as nil").
 */
export function optionsFromCandidates(
  candidates: readonly CandidateInvestment[]
): JudgmentOption[] | null {
  if (candidates.length === 0) return null;

  const options: JudgmentOption[] = candidates.map((c) => ({
    label: c.tag,
    figure: formatBillions(c.value),
    figureLabel: `at book, ${c.asOfDate} (${c.form})`,
  }));

  options.push({
    label: "None of these are non-operating",
    figure: formatBillions(new Decimal(0)),
    figureLabel: "carried at book",
  });

  return options;
}

/**
 * Turns a recorded selection back into the figure the EV bridge takes.
 *
 * The stored selection is the option LABEL, which for a candidate is its tag.
 * Resolving by tag rather than by index means a mapping change that reorders
 * the candidates cannot silently re-point an already-recorded judgment at a
 * different line item.
 *
 * Returns null for a selection that matches nothing — a judgment recorded
 * against a candidate this run did not acquire is not a judgment about this
 * run, and EV stays INCOMPLETE rather than using a figure from elsewhere.
 */
export function selectionToNonOperatingInvestments(
  selection: string | null | undefined,
  candidates: readonly CandidateInvestment[]
): NonOperatingInvestmentSelection | null {
  if (selection == null || selection.trim() === "") return null;

  if (selection.startsWith("None of these")) {
    return {
      tags: [],
      value: new Decimal(0),
      // Nothing carried, so no carrying value can be wrong in either
      // direction. §3.5's error-direction statement has no subject here.
      errorDirection: null,
    };
  }

  const chosen = candidates.filter((c) => selection.split(" + ").includes(c.tag));
  if (chosen.length === 0) return null;

  return {
    tags: chosen.map((c) => c.tag),
    value: chosen.reduce((acc, c) => acc.plus(c.value), new Decimal(0)),
    // Book value is the floor for an appreciated holding and can sit above a
    // written-down one; §3.5 requires the direction be stated, and
    // "understates" is the direction for a carrying value held at cost. It is
    // recorded as a statement about the measurement basis, not an estimate of
    // the gap.
    errorDirection: "understates",
  };
}

function formatBillions(value: Decimal): string {
  const billions = value.dividedBy(1_000_000_000);
  return `$${billions.toFixed(1)}B`;
}
