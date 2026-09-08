// ---------------------------------------------------------------------------
// §3.8.1 — the fallback register.
//
// "AI extraction is a documented fallback, permitted only where no tag exists
// for that figure, where the tag is present but unmapped in the version in
// force, or where the tagged value fails the §3.8.2 cross-checks."
//
// Three reasons and no fourth. Every fallback records which one applied, and
// milestone M8 reports them AS A LIST OF FACTS, never as a count — "a fallback
// rate that climbs quietly is the failure this record exists to make visible,
// and a bare number cannot be acted on".
// ---------------------------------------------------------------------------

export const FALLBACK_REASONS = [
  /** §3.8.1 condition 1 — the figure is not a tagged element in this filer's filings. */
  "NO TAG EXISTS",
  /** §3.8.1 condition 2 — the tag is in the filings but this mapping version cannot take it. */
  "TAG PRESENT BUT UNMAPPED IN VERSION IN FORCE",
  /** §3.8.1 condition 3 — the tagged value was acquired and then failed a §3.8.2 cross-check. */
  "TAGGED VALUE FAILED A CROSS-CHECK",
] as const;

export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export interface FallbackRecord {
  factId: string;
  name: string;
  reason: FallbackReason;
  /**
   * What was actually tried, so the reason can be checked rather than taken on
   * trust. The tags the mapping offered, or the cross-check that failed.
   */
  detail: string;
  /** The mapping version in force when the fallback was decided (§3.8.1). */
  tagMappingVersion: string;
  /**
   * Whether a value was in fact obtained by AI extraction.
   *
   * FALSE THROUGHOUT MILESTONE M8-a, and deliberately. §3.8.1 PERMITS AI
   * extraction on these three conditions; it does not require this milestone
   * to perform it, and M8-a's scope excludes the [C] layer. So a fallback here
   * records the boundary and stops: the figure is not acquired, which makes it
   * a missing input, which returns INCOMPLETE for its REQUIRED dependents
   * (§5.2). That is the fail-closed direction (§5.3).
   *
   * The field exists rather than being assumed, because the alternative —
   * leaving it implicit — is how "we did not extract this" would later be read
   * as "there was nothing to extract".
   */
  valueAcquired: false;
}

/**
 * The §3.8.1 report. A list of facts, with the reason on each.
 *
 * `total` is present for a reader's convenience and is NOT the report. The
 * spec is explicit that a count cannot be acted on, so every renderer of this
 * object shows `records`; nothing may show `total` alone.
 */
export interface FallbackReport {
  ticker: string;
  tagMappingVersion: string;
  acquiredAt: string;
  records: FallbackRecord[];
  /** Facts acquired through the mapping — the denominator the rate is read against. */
  taggedFactCount: number;
  total: number;
}

export function buildFallbackReport(
  ticker: string,
  tagMappingVersion: string,
  acquiredAt: string,
  records: FallbackRecord[],
  taggedFactCount: number
): FallbackReport {
  return {
    ticker,
    tagMappingVersion,
    acquiredAt,
    records,
    taggedFactCount,
    total: records.length,
  };
}

/**
 * Renders the fallback report as text for the acceptance artefact.
 *
 * Every fact is named. There is deliberately no summarised or truncated form:
 * the one thing this report must not do is present a number where the list
 * belongs.
 */
export function formatFallbackReport(report: FallbackReport): string {
  const lines: string[] = [];
  lines.push(`FALLBACK REPORT — ${report.ticker}  (§3.8.1)`);
  lines.push(`Tag mapping version: ${report.tagMappingVersion}`);
  lines.push(`Acquired at:         ${report.acquiredAt}`);
  lines.push(
    `Acquired through the mapping: ${report.taggedFactCount}   Fell back: ${report.total}`
  );
  lines.push("");

  if (report.records.length === 0) {
    lines.push("No fact fell back. Every mapped figure was acquired as a tagged element.");
    return lines.join("\n");
  }

  for (const r of report.records) {
    lines.push(`- ${r.factId} — ${r.name}`);
    lines.push(`    reason:  ${r.reason}`);
    lines.push(`    detail:  ${r.detail}`);
    lines.push(
      `    value:   NOT ACQUIRED — no AI extraction runs in this milestone, so this ` +
        `input is missing and its REQUIRED dependents return INCOMPLETE (§5.2).`
    );
  }
  return lines.join("\n");
}
