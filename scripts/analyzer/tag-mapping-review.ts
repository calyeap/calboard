import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument } from "../../lib/analyzer/acquisition/secClient";
import { resolveEntry } from "../../lib/analyzer/acquisition/selectTagged";
import { annualSeries, latestAnnualFiscalYear } from "../../lib/analyzer/acquisition/history";
import { TAG_MAP, TAG_MAPPING_VERSION, type TagMapEntry } from "../../lib/analyzer/acquisition/tagMap";
import { CALIBRATION_SET } from "../../lib/analyzer/calibration/set";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// THE §3.8.1 VERSION REVIEW, as a harness rather than as a claim.
//
//   npx tsx scripts/analyzer/tag-mapping-review.ts
//   npx tsx scripts/analyzer/tag-mapping-review.ts --offline   (captures only)
//
// §3.8.1 exempts a tag-mapped fact from the spot-check queue, and rests that
// exemption on the mapping's OWN VERSION REVIEW — "not by an analyst confirming
// one figure at a time". A version bump without a review therefore removes the
// control the exemption depends on. This script is what makes the review a
// measurement instead of a paragraph: it re-resolves every mapped fact for
// every calibration company under BOTH the previous mapping version and the
// current one, and reports every difference.
//
// HOW THE "BEFORE" SIDE IS OBTAINED, because a reconstruction that drifted
// from the real previous behaviour would make this whole file decorative:
//
//   - The previous SELECTION rule was "the first candidate that resolves
//     wins". It is reproduced exactly, without a second copy of the resolver,
//     by calling the REAL `resolveEntry` once per candidate with a
//     single-candidate entry and taking the first that resolves. With one
//     candidate there is nothing for the recency rule to reorder, so each such
//     call is the old rule's answer for that candidate by construction.
//   - The previous CANDIDATE LIST is the current one minus `ADDED_IN_VERSION`
//     below, which is this review's own record of what the bump added.
//
// The script asserts nothing about whether a change is good. It says what
// moved; the document beside it (docs/tag-mapping-version-review.md) is where
// each movement is explained.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "tag-mapping-review");

/**
 * Candidates introduced by the version under review, as (factId, tag) pairs.
 *
 * Used ONLY to reconstruct the previous mapping for the diff. It is not read
 * by acquisition and changes no behaviour; it is the review's record of its
 * own subject. Emptying it makes this script a pure selection-rule diff, which
 * is what it was run as before any candidate was added.
 */
const ADDED_IN_VERSION: { factId: string; tag: string }[] = [
  { factId: "total-debt", tag: "LongTermDebtNoncurrent" },
];

function previousEntry(entry: TagMapEntry): TagMapEntry {
  const added = new Set(
    ADDED_IN_VERSION.filter((a) => a.factId === entry.factId).map((a) => a.tag)
  );
  return { ...entry, candidates: entry.candidates.filter((c) => !added.has(c.ref.tag)) };
}

interface Resolution {
  tag: string;
  value: number;
  asOfDate: string;
  form: string;
  /** Components summed onto the primary, so a composition change is visible. */
  contributing: string;
}

function describe(entry: TagMapEntry, doc: CompanyFactsDocument): Resolution | null {
  const r = resolveEntry(doc, entry);
  if (r.outcome !== "RESOLVED") return null;
  return {
    tag: `${r.value.contributingTags[0].ref.ns}:${r.value.contributingTags[0].ref.tag}`,
    value: r.value.value,
    asOfDate: r.value.asOfDate,
    form: r.value.form,
    contributing: r.value.contributingTags.map((c) => c.ref.tag).join(" + "),
  };
}

/**
 * What the PREVIOUS version resolved: first-candidate-that-resolves, over the
 * previous candidate list. Each candidate is put through the real resolver on
 * its own, so the only thing reconstructed here is the ORDER of the attempts.
 */
function describePrevious(entry: TagMapEntry, doc: CompanyFactsDocument): Resolution | null {
  const prev = previousEntry(entry);
  for (const candidate of prev.candidates) {
    const single: TagMapEntry = { ...prev, candidates: [candidate] };
    const one = describe(single, doc);
    if (one !== null) return one;
  }
  return null;
}

function seriesPrevious(doc: CompanyFactsDocument, entry: TagMapEntry): string | null {
  for (const candidate of previousEntry(entry).candidates) {
    const s = annualSeries(doc, [candidate]);
    if (s !== null) return summariseSeries(s);
  }
  return null;
}

function summariseSeries(s: NonNullable<ReturnType<typeof annualSeries>>): string {
  const years = s.observations.map((o) => o.fiscalYear);
  return `${s.tag} ${years.length}y FY${years[0]}-FY${years[years.length - 1]} last=${s.observations[s.observations.length - 1].value}`;
}

interface Loaded {
  cik: string;
  companyName: string;
  companyFacts: CompanyFactsDocument;
  provenance: string;
}

async function loadLive(ticker: string): Promise<Loaded> {
  const client = secClientFromEnv();
  const directory = await client.companyTickers();
  const found = cikForTicker(directory, ticker);
  if (found === null) throw new Error(`${ticker} is not in the SEC ticker directory`);
  return {
    cik: found.cik,
    companyName: found.title,
    companyFacts: await client.companyFacts(found.cik),
    provenance: `live EDGAR, fetched ${new Date().toISOString()}`,
  };
}

function loadCapture(ticker: string): Loaded {
  const path = join("lib", "analyzer", "acquisition", "captures", `${ticker.toLowerCase()}-companyfacts.json`);
  if (!existsSync(path)) throw new Error(`No capture for ${ticker} at ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    cik: raw.__capture?.cik ?? String(raw.cik).padStart(10, "0"),
    companyName: raw.entityName,
    companyFacts: raw as CompanyFactsDocument,
    provenance: `committed capture (${path})`,
  };
}

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(3)}bn`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
  return String(n);
}

function show(r: Resolution | null, unit: string): string {
  if (r === null) return "NOT ACQUIRED";
  const v = unit === "USD" ? money(r.value) : r.value.toLocaleString("en-US");
  const summed = r.contributing.includes("+") ? ` [${r.contributing}]` : "";
  return `${v} @ ${r.asOfDate} (${r.tag}${summed})`;
}

interface Change {
  ticker: string;
  factId: string;
  kind: "VALUE CHANGED" | "NOW ACQUIRED" | "NO LONGER ACQUIRED";
  before: string;
  after: string;
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const lines: string[] = [];
  const changes: Change[] = [];
  const exemptDelta: string[] = [];
  /** factId -> tickers where the mapping still reaches nothing. */
  const gapsByFact = new Map<string, string[]>();
  /** Facts still stale after the rule, because nothing current could replace them. */
  const staleResidue: string[] = [];

  lines.push("CALBOARD — TAG MAPPING VERSION REVIEW (§3.8.1)");
  lines.push(`Ran:             ${new Date().toISOString()}`);
  lines.push(`Version now:     ${TAG_MAPPING_VERSION}`);
  lines.push(`Candidates added in this version: ${ADDED_IN_VERSION.length === 0 ? "none (selection-rule change only)" : ADDED_IN_VERSION.map((a) => `${a.factId} <- us-gaap:${a.tag}`).join("; ")}`);
  lines.push("");
  lines.push("Every mapped fact, re-resolved for every calibration company under the");
  lines.push("previous mapping version and under this one. BEFORE is the real resolver");
  lines.push("driven one candidate at a time in mapping order, which is what the previous");
  lines.push("first-candidate-that-resolves rule did by construction.");
  lines.push("");

  for (const company of CALIBRATION_SET) {
    let loaded: Loaded;
    try {
      loaded = offline ? loadCapture(company.ticker) : await loadLive(company.ticker);
    } catch (err) {
      lines.push("=".repeat(74));
      lines.push(`${company.ticker} — COULD NOT LOAD: ${err instanceof Error ? err.message : String(err)}`);
      lines.push("");
      continue;
    }

    const doc = loaded.companyFacts;
    lines.push("=".repeat(74));
    lines.push(`${company.ticker} — ${loaded.companyName} (CIK ${loaded.cik})`);
    lines.push(`  ${loaded.provenance}`);
    lines.push(`  filer's latest reported annual fiscal year: ${latestAnnualFiscalYear(doc) ?? "NONE — the rule is inert here"}`);
    lines.push("");

    const stillMissing: string[] = [];

    for (const entry of TAG_MAP) {
      const before = describePrevious(entry, doc);
      const after = describe(entry, doc);

      const sameValue = before?.value === after?.value && before?.asOfDate === after?.asOfDate && before?.tag === after?.tag;
      if (before === null && after === null) {
        // Not a change, but the answer to "which gaps remain" — the question
        // step 2 of the pass exists to ask before any candidate is added.
        stillMissing.push(entry.factId);
        continue;
      }

      if (sameValue) {
        lines.push(`  ${entry.factId.padEnd(38)} unchanged   ${show(after, entry.unit)}`);
        continue;
      }

      const kind: Change["kind"] =
        before === null ? "NOW ACQUIRED" : after === null ? "NO LONGER ACQUIRED" : "VALUE CHANGED";

      lines.push(`  ${entry.factId.padEnd(38)} ${kind}`);
      lines.push(`      before: ${show(before, entry.unit)}`);
      lines.push(`      after:  ${show(after, entry.unit)}`);

      changes.push({
        ticker: company.ticker,
        factId: entry.factId,
        kind,
        before: show(before, entry.unit),
        after: show(after, entry.unit),
      });

      // §3.8.1 BOUNDARY. A fact that starts or stops resolving moves across the
      // exempt/queued line, which is a different kind of change from a value
      // moving, and the dispatch makes it a Command Center matter.
      if (kind !== "VALUE CHANGED") {
        exemptDelta.push(`${company.ticker} ${entry.factId}: ${kind}`);
      }
    }

    lines.push("");
    lines.push(
      `  STILL NOT ACQUIRED under this version (${stillMissing.length}): ${stillMissing.length === 0 ? "none" : stillMissing.join(", ")}`
    );

    // THE RESIDUE THE RULE CANNOT REACH, and the reason it is printed.
    //
    // preferCurrent can only move a retired candidate out of the way when
    // another candidate is current. Where an entry has one candidate — or
    // where every candidate stopped together — the figure is still stale and
    // is still acquired, deliberately: refusing would move the fact across the
    // §3.8.1 boundary. So the staleness does not disappear, it becomes
    // MEASURABLE, and a review that did not print it would be reporting the
    // half of the problem the fix happened to solve.
    const filerYear = latestAnnualFiscalYear(doc);
    if (filerYear !== null) {
      for (const entry of TAG_MAP) {
        const r = describe(entry, doc);
        if (r === null) continue;
        const year = new Date(r.asOfDate).getUTCFullYear();
        if (year >= filerYear) continue;
        const line = `${company.ticker} ${entry.factId}: ${show(r, entry.unit)} — ${filerYear - year} fiscal years behind FY${filerYear}, and no other mapped candidate is current`;
        staleResidue.push(line);
        lines.push(`  STALE, NO RESCUER: ${line}`);
      }
    }
    for (const factId of stillMissing) gapsByFact.set(factId, [...(gapsByFact.get(factId) ?? []), company.ticker]);

    // The two series the history and the comparator are built from.
    lines.push("");
    for (const factId of ["current-revenue", "operating-income"]) {
      const entry = TAG_MAP.find((e) => e.factId === factId)!;
      const before = seriesPrevious(doc, entry);
      const built = annualSeries(doc, entry.candidates);
      const after = built === null ? null : summariseSeries(built);
      const label = `series(${factId})`;
      if (before === after) {
        lines.push(`  ${label.padEnd(38)} unchanged   ${after ?? "NONE"}`);
      } else {
        lines.push(`  ${label.padEnd(38)} SERIES CHANGED`);
        lines.push(`      before: ${before ?? "NONE"}`);
        lines.push(`      after:  ${after ?? "NONE"}`);
      }
    }
    lines.push("");
  }

  lines.push("=".repeat(74));
  lines.push("SUMMARY");
  lines.push("=".repeat(74));
  lines.push(`Facts whose resolution changed: ${changes.length}`);
  for (const c of changes) {
    lines.push(`  ${c.ticker} ${c.factId} — ${c.kind}`);
    lines.push(`      ${c.before}  ->  ${c.after}`);
  }
  lines.push("");
  lines.push("REMAINING GAPS — where the mapping still reaches nothing, by fact.");
  lines.push("This is the list a candidate addition would have to be justified against;");
  lines.push("a gap that the selection rule closed must not also be 'fixed' by adding a");
  lines.push("tag, because every addition carries §3.8.1 review burden forever.");
  for (const [factId, tickers] of [...gapsByFact.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${factId.padEnd(38)} ${tickers.length}/${CALIBRATION_SET.length}  ${tickers.join(", ")}`);
  }
  lines.push("");
  lines.push("STALE WITH NO RESCUER — what the selection rule could not reach:");
  if (staleResidue.length === 0) {
    lines.push("  NONE. Every acquired fact reaches its filer's latest reported year.");
  } else {
    for (const s of staleResidue) lines.push(`  ${s}`);
    lines.push("");
    lines.push("  These are NOT fixed by this bump and are not claimed to be. Each is a");
    lines.push("  single-candidate entry whose one tag the filer stopped reporting; the");
    lines.push("  figure is carried rather than withheld because withholding it would");
    lines.push("  move the fact across the §3.8.1 boundary.");
  }
  lines.push("");
  lines.push("§3.8.1 BOUNDARY — facts that started or stopped being acquired at all:");
  if (exemptDelta.length === 0) {
    lines.push("  NONE. Every fact acquired before is still acquired, and no fact");
    lines.push("  became acquired that was not. The bump changes values only, so no");
    lines.push("  fact moved between the exempt and the queued side of §3.8.1.");
  } else {
    for (const d of exemptDelta) lines.push(`  ${d}`);
    lines.push("");
    lines.push("  Each line above moves a fact ACROSS the §3.8.1 boundary and must be");
    lines.push("  read as such, not as a value change.");
  }
  lines.push("");

  const text = lines.join("\n");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "review.txt");
  writeFileSync(path, text, "utf8");
  console.log(`Resolution changes: ${changes.length}`);
  console.log(`Boundary changes:   ${exemptDelta.length}`);
  console.log(`  -> ${path}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
