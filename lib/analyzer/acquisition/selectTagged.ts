import { latestAnnualFiscalYear } from "./history";
import type { CompanyFactsDocument, XbrlFactUnitRow } from "./secClient";
import type { TagCandidate, TagMapEntry, TagRef } from "./tagMap";

// ---------------------------------------------------------------------------
// Turning a companyfacts document into one value per mapping entry.
//
// This is a deterministic parse over tagged elements: same document, same
// mapping, same answer, no model anywhere. Every choice it makes is recorded
// on the result — which tag resolved, which period, which filing, and which
// summed components were absent — because §3.1 admits a derived figure only
// where its own inputs are recorded.
//
// THE SELECTION RULE IS PART OF THE MAPPING, not an implementation detail of
// reading it. §3.8.1 requires a FIXED, versioned mapping with the version
// recorded on the fact; if one version could resolve different tags depending
// on logic living outside the mapping, the version would no longer identify
// how the fact was obtained. Changing anything here that decides WHICH
// candidate wins therefore bumps TAG_MAPPING_VERSION exactly as adding a
// candidate does, and puts every previously acquired fact under the §3.8.1
// version review.
// ---------------------------------------------------------------------------

export interface ContributingTag {
  ref: TagRef;
  value: number;
  row: XbrlFactUnitRow;
}

export interface ResolvedTaggedValue {
  factId: string;
  /** In the filing's own units — USD or shares, never rescaled here. */
  value: number;
  unit: string;
  /** The period the figure describes: an instant, or a duration's end (§3.2). */
  asOfDate: string;
  periodStart: string | null;
  form: string;
  accession: string | null;
  /** When the filing carrying this figure was filed. */
  filedAt: string | null;
  /** Every tag that contributed, with its own row. The audit trail for §3.1. */
  contributingTags: ContributingTag[];
  /**
   * `plus` components that carried no row at this period. Recorded so the
   * absence is visible rather than silently summed as zero (§4.3).
   */
  absentComponents: TagRef[];
}

export type TagResolutionFailure =
  /** The mapped tag appears nowhere in this company's facts. */
  | { outcome: "NO_TAG_IN_FILINGS"; factId: string; tried: TagRef[] }
  /** The tag exists but carries no row of the period shape this entry wants. */
  | { outcome: "NO_PERIOD_MATCH"; factId: string; tried: TagRef[]; detail: string };

export type TagResolution =
  | { outcome: "RESOLVED"; value: ResolvedTaggedValue }
  | TagResolutionFailure;

const ELIGIBLE_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

// A fiscal year is not always 365 days (52/53-week filers, transition
// periods), and a quarter is not always 91. The bands are wide enough to admit
// real filings and narrow enough that a year can never be read as a quarter.
const ANNUAL_DAYS = { min: 300, max: 400 };
const QUARTER_DAYS = { min: 60, max: 120 };

function daysBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000;
}

function rowsFor(doc: CompanyFactsDocument, ref: TagRef, unit: string): XbrlFactUnitRow[] {
  const units = doc.facts?.[ref.ns]?.[ref.tag]?.units;
  if (!units) return [];
  return units[unit] ?? [];
}

/**
 * Whether a row's period matches what the entry asks for.
 *
 * The duration test is the load-bearing one. A quarterly operating-cash-flow
 * row read as an annual figure understates burn by four times and looks
 * entirely plausible in the report, so `duration` is checked rather than
 * inferred from whichever row is most recent.
 */
function periodMatches(entry: TagMapEntry, row: XbrlFactUnitRow): boolean {
  if (entry.period === "instant") {
    // An instant fact carries no start. XBRL sometimes emits one anyway on a
    // balance-sheet element; a row with a real duration is not an instant.
    if (row.start === undefined) return true;
    return daysBetween(row.start, row.end) <= 1;
  }

  if (row.start === undefined) return false;
  const days = daysBetween(row.start, row.end);
  const band = entry.duration === "quarter" ? QUARTER_DAYS : ANNUAL_DAYS;
  return days >= band.min && days <= band.max;
}

/**
 * Ranks rows so the newest wins, with an annual report preferred over a
 * quarterly one describing the same period end.
 *
 * A 10-K's figure is the audited one; where both exist for a date, that is the
 * one to carry.
 */
function betterThan(a: XbrlFactUnitRow, b: XbrlFactUnitRow): boolean {
  const byEnd = Date.parse(a.end) - Date.parse(b.end);
  if (byEnd !== 0) return byEnd > 0;

  const aAnnual = (a.form ?? "").startsWith("10-K") || (a.form ?? "").startsWith("20-F");
  const bAnnual = (b.form ?? "").startsWith("10-K") || (b.form ?? "").startsWith("20-F");
  if (aAnnual !== bAnnual) return aAnnual;

  // Same period, same form class: the later filing supersedes. Restatements
  // are retained as separate FactRecords upstream (§3.4); this only decides
  // which one is current.
  return Date.parse(a.filed ?? "1970-01-01") > Date.parse(b.filed ?? "1970-01-01");
}

function pickRow(rows: XbrlFactUnitRow[], entry: TagMapEntry): XbrlFactUnitRow | null {
  let best: XbrlFactUnitRow | null = null;
  for (const row of rows) {
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (!periodMatches(entry, row)) continue;
    if (best === null || betterThan(row, best)) best = row;
  }
  return best;
}

/**
 * Finds a `plus` component at EXACTLY the primary row's period.
 *
 * Same instant, or same start and end. This is not fussiness: summing this
 * year's cash with a prior year's short-term investments produces a figure
 * that foots to nothing and belongs to no date, and it would pass every
 * downstream check that only looks at magnitude.
 */
function componentAtSamePeriod(
  doc: CompanyFactsDocument,
  ref: TagRef,
  unit: string,
  primary: XbrlFactUnitRow
): XbrlFactUnitRow | null {
  let best: XbrlFactUnitRow | null = null;
  for (const row of rowsFor(doc, ref, unit)) {
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (row.end !== primary.end) continue;
    if ((row.start ?? null) !== (primary.start ?? null)) continue;
    if (best === null || betterThan(row, best)) best = row;
  }
  return best;
}

/**
 * Mapping order, with RETIRED candidates moved out of the way.
 *
 * The mapping's order is a decision — most-specific first — and this rule does
 * not re-derive it. It removes the one thing that order cannot express:
 * whether the candidate it puts first is still being reported. NVIDIA retired
 * RevenueFromContractWithCustomerExcludingAssessedTax after its FY2022 10-K
 * and kept filing under us-gaap:Revenues, which is candidate #2 of the same
 * entry. Taking the first candidate that yielded anything gave a §3.8 material
 * fact — the headline current-period revenue — a four-year-stale value of
 * $26.9bn against a real FY2026 $215.9bn, exempt from spot-check and heading
 * for a report (Defect D).
 *
 * "Current" is the filer's own latest reported annual fiscal year, taken
 * tag-blind by `latestAnnualFiscalYear`. That definition is not chosen here:
 * it is the one Defect D already ruled on for the comparator, and a second
 * copy of it that drifted would let acquisition and the comparator disagree
 * about the same filing. It is not the clock — every filer is months behind
 * the calendar between its year end and its 10-K — and it is not the chosen
 * tag, because asking the chosen tag how far it runs is the question that
 * produced the defect.
 *
 * TWO BOUNDS, both load-bearing rather than cautious:
 *
 *  1. Where NO candidate is current, the first still wins. A short window is a
 *     §3.7 disclosure for the comparator to make, not a reason to withhold the
 *     figure. Refusing would move the fact off the §3.8.1 exempt path and into
 *     the spot-check queue — changing WHICH facts are exempt rather than only
 *     which values they carry, which is a Command Center decision and not an
 *     acquisition fix.
 *  2. Where the filer has filed no annual figure at all, the rule is inert.
 *     There is nothing to measure retirement against, and absence of evidence
 *     is not evidence of retirement.
 *
 * The test is on the fiscal YEAR, not on the day. An instant carried on a
 * later 10-Q, or a 52/53-week year end drifting across a calendar boundary,
 * must not read as a different generation of the series.
 */
function preferCurrent<T extends { primary: XbrlFactUnitRow }>(
  picks: T[],
  filerCurrentFiscalYear: number | null
): T | null {
  if (picks.length === 0) return null;
  if (filerCurrentFiscalYear === null) return picks[0];

  const current = picks.filter(
    (p) => new Date(p.primary.end).getUTCFullYear() >= filerCurrentFiscalYear
  );
  return current.length > 0 ? current[0] : picks[0];
}

/**
 * Resolves one mapping entry against one company's facts.
 *
 * Candidates are tried in mapping order and the first that resolves wins,
 * EXCEPT that a candidate whose series has stopped being reported does not win
 * over one that is current (`preferCurrent`). The winner is recorded on the
 * result, so a run always says which tag it used rather than which ones it
 * might have used.
 */
export function resolveEntry(doc: CompanyFactsDocument, entry: TagMapEntry): TagResolution {
  const tried = entry.candidates.map((c) => c.ref);
  let sawTagButNoPeriod = false;

  // Every candidate that resolves at all, in mapping order. The list is built
  // before a winner is chosen because retirement can only be judged by
  // comparing the candidates against the filer, which the old first-hit loop
  // had no position to do.
  const picks: { candidate: TagCandidate; primary: XbrlFactUnitRow }[] = [];

  for (const candidate of entry.candidates) {
    const rows = rowsFor(doc, candidate.ref, entry.unit);
    if (rows.length === 0) continue;

    const primary = pickRow(rows, entry);
    if (primary === null) {
      // The tag exists for this filer but carries nothing of the period shape
      // asked for — a different situation from the tag being absent, and the
      // two produce different §3.8.1 fallback reasons.
      sawTagButNoPeriod = true;
      continue;
    }
    picks.push({ candidate, primary });
  }

  const won = preferCurrent(picks, latestAnnualFiscalYear(doc));

  if (won !== null) {
    const { candidate, primary } = won;
    const ref = candidate.ref;
    const contributing: ContributingTag[] = [{ ref, value: primary.val, row: primary }];
    const absent: TagRef[] = [];
    let total = primary.val;

    for (const plusRef of candidate.plus ?? []) {
      const row = componentAtSamePeriod(doc, plusRef, entry.unit, primary);
      if (row === null) {
        absent.push(plusRef);
        continue;
      }
      contributing.push({ ref: plusRef, value: row.val, row });
      total += row.val;
    }

    return {
      outcome: "RESOLVED",
      value: {
        factId: entry.factId,
        value: total,
        unit: entry.unit,
        asOfDate: primary.end,
        periodStart: primary.start ?? null,
        form: primary.form ?? "",
        accession: primary.accn ?? null,
        filedAt: primary.filed ?? null,
        contributingTags: contributing,
        absentComponents: absent,
      },
    };
  }

  if (sawTagButNoPeriod) {
    return {
      outcome: "NO_PERIOD_MATCH",
      factId: entry.factId,
      tried,
      detail:
        entry.period === "instant"
          ? "the tag carries no instant row in an eligible filing"
          : `the tag carries no ${entry.duration ?? "annual"} duration row in an eligible filing`,
    };
  }
  return { outcome: "NO_TAG_IN_FILINGS", factId: entry.factId, tried };
}

/**
 * The period immediately before the one a resolution landed on, for the same
 * tag and the same period shape.
 *
 * Range sanity needs a comparator that is genuinely the prior period — not
 * merely an older row. A 10-Q from two years ago compared against this year's
 * 10-K would report a scale break that is really a gap in the series, so the
 * search is for the latest eligible row strictly older than the resolved one.
 */
export function resolvePriorPeriod(
  doc: CompanyFactsDocument,
  entry: TagMapEntry,
  resolved: ResolvedTaggedValue
): { value: number; asOfDate: string } | null {
  const primaryRef = resolved.contributingTags[0]?.ref;
  if (!primaryRef) return null;

  // The prior period must be assembled from the SAME candidate that won, or
  // the ratio compares a sum against one of its own parts and reports a break
  // that is really a change of composition.
  const candidate: TagCandidate | undefined = entry.candidates.find(
    (c) => c.ref.ns === primaryRef.ns && c.ref.tag === primaryRef.tag
  );

  const resolvedEnd = Date.parse(resolved.asOfDate);
  let best: XbrlFactUnitRow | null = null;

  for (const row of rowsFor(doc, primaryRef, entry.unit)) {
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (!periodMatches(entry, row)) continue;
    if (Date.parse(row.end) >= resolvedEnd) continue;
    if (best === null || betterThan(row, best)) best = row;
  }

  if (best === null) return null;

  let total = best.val;
  for (const plusRef of candidate?.plus ?? []) {
    const row = componentAtSamePeriod(doc, plusRef, entry.unit, best);
    if (row !== null) total += row.val;
  }

  return { value: total, asOfDate: best.end };
}

/**
 * Book values for the §4.4 non-operating-investments judgment.
 *
 * Candidates, not a mapping. Each is returned with its own tag and period so
 * the analyst sees what they are classifying; nothing here is acquired as a
 * fact, and no selection is made.
 */
export function candidateInvestmentLineItems(
  doc: CompanyFactsDocument,
  refs: readonly TagRef[]
): { ref: TagRef; value: number; asOfDate: string; form: string }[] {
  const out: { ref: TagRef; value: number; asOfDate: string; form: string }[] = [];
  const instantEntry: TagMapEntry = {
    factId: "candidate",
    name: "candidate",
    period: "instant",
    unit: "USD",
    candidates: [],
    basis: "",
  };

  for (const ref of refs) {
    const row = pickRow(rowsFor(doc, ref, "USD"), instantEntry);
    if (row === null) continue;
    out.push({ ref, value: row.val, asOfDate: row.end, form: row.form ?? "" });
  }
  return out;
}
