import type { CompanyFactsDocument, XbrlFactUnitRow } from "./secClient";
import type { TagCandidate } from "./tagMap";

// ---------------------------------------------------------------------------
// The historical series the gates and triggers need, taken from the same
// tagged elements as everything else.
//
// §3.7 governs what may be done with these: "Ten-year history is computed ON A
// CONSISTENT ACCOUNTING BASIS. Where an accounting standard changed within the
// window, either use restated figures for every year or shorten the window —
// and RECORD WHICH WAS DONE, because the two give different answers."
//
// So this module returns the series WITH the window it actually covers and the
// tag each year came from, and it never stitches two different revenue tags
// into one series. A series assembled from RevenueFromContractWithCustomer for
// the recent years and Revenues for the older ones is precisely the mixed
// basis §3.7 refuses — and it is the easy thing to write by accident, because
// both tags are present and each covers part of the window.
// ---------------------------------------------------------------------------

export interface AnnualObservation {
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  value: number;
  accession: string | null;
}

export interface AnnualSeries {
  /** The single tag every observation came from. Never mixed. */
  tag: string;
  /** Chronological, oldest first. */
  observations: AnnualObservation[];
}

const ANNUAL_DAYS = { min: 300, max: 400 };
const QUARTER_DAYS = { min: 60, max: 120 };
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "40-F"]);
const ALL_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

function days(row: XbrlFactUnitRow): number | null {
  if (row.start === undefined) return null;
  return (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
}

/**
 * The fiscal year a row's own period belongs to, taken from the period end.
 *
 * NOT `row.fy`. EDGAR's `fy` and `fp` describe the FILING the fact appeared
 * in, not the period the fact covers — so the FY2026 10-K carries fy=2026 /
 * fp=FY on its FY2024, FY2025 and FY2026 comparatives alike. Grouping by `fy`
 * therefore collapses three years of history into one and silently keeps
 * whichever row happened to be last, which is how a seven-year series came
 * back with the wrong figure in its most recent year.
 *
 * The period end is unambiguous and belongs to the fact.
 */
function fiscalYearOf(row: XbrlFactUnitRow): number {
  return new Date(row.end).getUTCFullYear();
}

/** One entry per distinct reported period, later filings superseding earlier. */
function latestByPeriod(rows: XbrlFactUnitRow[]): Map<string, XbrlFactUnitRow> {
  const byPeriod = new Map<string, XbrlFactUnitRow>();
  for (const row of rows) {
    const key = `${row.start}|${row.end}`;
    const held = byPeriod.get(key);
    if (held === undefined || (row.filed ?? "") > (held.filed ?? "")) byPeriod.set(key, row);
  }
  return byPeriod;
}

/**
 * The longest single-tag annual series available.
 *
 * Candidates are tried in order and the FIRST that yields any annual
 * observation wins — the same precedence the mapping uses, so the series and
 * the current-period fact come from the same tag wherever both exist. The
 * alternative, picking whichever tag gives the longest history, would let the
 * headline revenue figure and the history that contextualises it come from
 * different elements.
 */
export function annualSeries(
  doc: CompanyFactsDocument,
  candidates: readonly TagCandidate[]
): AnnualSeries | null {
  // Only the candidate's primary tag is used. A history series is never
  // assembled from a tag plus its components: the composition of a summed
  // figure can change across the window, and a series that silently switches
  // basis part-way is the mixed basis §3.7 refuses.
  for (const { ref } of candidates) {
    const rows = (doc.facts?.[ref.ns]?.[ref.tag]?.units?.USD ?? []).filter((row) => {
      if (!ANNUAL_FORMS.has(row.form ?? "")) return false;
      const d = days(row);
      return d !== null && d >= ANNUAL_DAYS.min && d <= ANNUAL_DAYS.max;
    });

    const byPeriod = latestByPeriod(rows);
    if (byPeriod.size === 0) continue;

    // One observation per fiscal year, keyed off the fact's own period end.
    // Where two periods land in the same calendar year (a fiscal-year-end
    // change), the later one wins and the earlier is dropped rather than
    // producing two entries for one year.
    const byYear = new Map<number, XbrlFactUnitRow>();
    for (const row of byPeriod.values()) {
      const fy = fiscalYearOf(row);
      const held = byYear.get(fy);
      if (held === undefined || Date.parse(row.end) > Date.parse(held.end)) byYear.set(fy, row);
    }

    const observations = [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([fiscalYear, row]) => ({
        fiscalYear,
        periodStart: row.start as string,
        periodEnd: row.end,
        value: row.val,
        accession: row.accn ?? null,
      }));

    return { tag: `${ref.ns}:${ref.tag}`, observations };
  }

  return null;
}

export interface MarginSeries {
  revenueTag: string;
  operatingIncomeTag: string;
  /** Fiscal years where BOTH sides are present, chronological. */
  years: { fiscalYear: number; margin: number; revenue: number; operatingIncome: number }[];
}

/**
 * The operating-margin history, computed year by year from two acquired
 * series.
 *
 * Only years where BOTH the revenue and the operating-income observation exist
 * produce a margin. A year with one side missing is dropped rather than
 * carried forward or interpolated — §5.1: "an unverifiable figure is never
 * replaced by an estimate. Not by a model's recollection, not by a peer
 * average, not by a prior period carried forward, not by an interpolation."
 */
export function operatingMarginSeries(
  revenue: AnnualSeries | null,
  operatingIncome: AnnualSeries | null
): MarginSeries | null {
  if (revenue === null || operatingIncome === null) return null;

  const incomeByFy = new Map(operatingIncome.observations.map((o) => [o.fiscalYear, o]));
  const years: MarginSeries["years"] = [];

  for (const rev of revenue.observations) {
    const inc = incomeByFy.get(rev.fiscalYear);
    if (inc === undefined || rev.value === 0) continue;
    years.push({
      fiscalYear: rev.fiscalYear,
      margin: inc.value / rev.value,
      revenue: rev.value,
      operatingIncome: inc.value,
    });
  }

  if (years.length === 0) return null;
  return {
    revenueTag: revenue.tag,
    operatingIncomeTag: operatingIncome.tag,
    years,
  };
}

/**
 * Every fiscal year this filer carries a full-year figure for, under any tag.
 *
 * Deliberately tag-blind. Two callers read it for different questions — how
 * much history exists, and how far the history runs — and both must agree on
 * what counts as a filed year. A second copy of the eligibility rule that
 * drifted from this one would make Gate 1 and the comparator disagree about
 * the same filing.
 */
function annualFiscalYears(doc: CompanyFactsDocument): Set<number> {
  const years = new Set<number>();
  for (const ns of Object.keys(doc.facts ?? {})) {
    for (const tag of Object.keys(doc.facts[ns])) {
      for (const unit of Object.keys(doc.facts[ns][tag].units)) {
        for (const row of doc.facts[ns][tag].units[unit]) {
          if (!ANNUAL_FORMS.has(row.form ?? "")) continue;
          const d = days(row);
          if (d === null || d < ANNUAL_DAYS.min || d > ANNUAL_DAYS.max) continue;
          // The fact's own period, not the filing's (see fiscalYearOf).
          years.add(fiscalYearOf(row));
        }
      }
    }
  }
  return years;
}

/**
 * The most recent fiscal year this filer has reported an annual figure for.
 *
 * This is the period a comparator window has to reach (§10.6.2). It is taken
 * from the filer's own filings rather than from the clock, because "current"
 * for a comparator means "as far as this company has reported", not "today" —
 * every filer is some months behind the calendar between its year end and its
 * 10-K, and a clock-based test would call all of them stale.
 *
 * Tag-blind on purpose. Asking the chosen revenue tag how far it runs is the
 * question that produced the defect: it can only ever answer "as far as I go".
 *
 * Null where the filer has no full-year figure under any tag at all.
 */
export function latestAnnualFiscalYear(doc: CompanyFactsDocument): number | null {
  let latest: number | null = null;
  for (const year of annualFiscalYears(doc)) {
    if (latest === null || year > latest) latest = year;
  }
  return latest;
}

/**
 * How many annual reports this filer has on record.
 *
 * Gate 1's only input (§4.2). Counted from distinct fiscal years carrying a
 * full-year figure in an annual form, not from the number of filings — an
 * amended 10-K is not another year of history.
 */
export function filedAnnualYearsCount(doc: CompanyFactsDocument): number {
  return annualFiscalYears(doc).size;
}

export interface QuarterObservation {
  periodStart: string;
  periodEnd: string;
  value: number;
}

/**
 * Discrete quarterly observations, newest last.
 *
 * "Discrete" is the load-bearing word: a 10-Q's year-to-date row is excluded
 * by the duration band, so the run-rate module never receives a six- or
 * nine-month figure labelled as a quarter.
 */
export function quarterlySeries(
  doc: CompanyFactsDocument,
  candidates: readonly TagCandidate[]
): QuarterObservation[] {
  for (const { ref } of candidates) {
    const rows = (doc.facts?.[ref.ns]?.[ref.tag]?.units?.USD ?? []).filter((row) => {
      if (!ALL_FORMS.has(row.form ?? "")) return false;
      const d = days(row);
      return d !== null && d >= QUARTER_DAYS.min && d <= QUARTER_DAYS.max;
    });

    const byPeriod = latestByPeriod(rows);
    if (byPeriod.size === 0) continue;

    return [...byPeriod.values()]
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
      .map((row) => ({
        periodStart: row.start as string,
        periodEnd: row.end,
        value: row.val,
      }));
  }
  return [];
}
