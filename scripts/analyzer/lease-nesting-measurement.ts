import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument, XbrlFactUnitRow } from "../../lib/analyzer/acquisition/secClient";
import { resolveEntry } from "../../lib/analyzer/acquisition/selectTagged";
import { tagMapEntry, TAG_MAPPING_VERSION } from "../../lib/analyzer/acquisition/tagMap";
import { CALIBRATION_SET } from "../../lib/analyzer/calibration/set";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// THE LEASE-ONCE MEASUREMENT.
//
//   npx tsx scripts/analyzer/lease-nesting-measurement.ts
//   npx tsx scripts/analyzer/lease-nesting-measurement.ts --offline
//
// The CalFinance invested-capital ruling requires that operating and finance
// lease liabilities be included EXACTLY ONCE. That requirement cannot be
// checked by reading the mapping: it depends on whether the tag that actually
// WINS for `total-debt` at each filer already contains that filer's lease
// obligations. The acquisition pass found Oklo's total debt resolving through
// LongTermDebtNoncurrent rather than the obvious tag, so what an entry is
// NAMED is not evidence of what it holds.
//
// This script measures that, per company, BEFORE any construction is written.
// It computes nothing about invested capital and it changes no mapping.
//
// WHAT MAKES A VERDICT. Only determinate tests — no tolerances and no
// thresholds. Every value in an XBRL fact unit is an exact filed figure, so a
// near-miss is a different quantity rather than a rounding artefact, and a
// tolerance here would be an invented cut-point deciding a ruling question.
//
//   NOTHING TO NEST   the filer tags no finance lease liability at all.
//   EXCLUDED          nesting is arithmetically impossible (the lease exceeds
//                     the entire debt figure), or the filer tags BOTH the
//                     lease-inclusive combined element and the plain one and
//                     the difference between them IS the lease.
//   NESTED            the filer tags the lease-inclusive combined element and
//                     its two halves sum to exactly what `total-debt`
//                     resolved — so the figure the mapping calls total debt is
//                     this filer's debt-AND-capital-lease total.
//   UNDETERMINED      none of the above settles it. Deliberately NOT a pass:
//                     the fail-closed direction (§5.3) is to report that the
//                     tags cannot answer, leaving the filing's own lease note
//                     to be read by a human — a mapping-review activity, not
//                     acquisition.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "lease-nesting");

/** The us-gaap element defined to INCLUDE capital/finance lease obligations. */
const COMBINED = "LongTermDebtAndCapitalLeaseObligations";
const COMBINED_CURRENT = "LongTermDebtAndCapitalLeaseObligationsCurrent";

const ELIGIBLE_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

type Verdict = "NOTHING TO NEST" | "EXCLUDED" | "NESTED" | "UNDETERMINED";

interface Measurement {
  ticker: string;
  totalDebt: number | null;
  wonVia: string;
  contributing: string;
  asOfDate: string;
  form: string;
  financeLease: number | null;
  financeLeaseVia: string;
  combined: number | null;
  combinedCurrent: number | null;
  verdict: Verdict;
  why: string;
}

/**
 * The latest eligible instant row for a tag AT one date.
 *
 * Pinned to the date `total-debt` resolved on, never to the newest row
 * available. Comparing this period's debt against last period's lease would
 * produce a verdict about a balance sheet that never existed.
 */
function instantAt(doc: CompanyFactsDocument, tag: string, at: string): XbrlFactUnitRow | null {
  const rows = doc.facts?.["us-gaap"]?.[tag]?.units?.["USD"];
  if (!rows) return null;
  let best: XbrlFactUnitRow | null = null;
  for (const row of rows) {
    if (row.start !== undefined) continue;
    if (row.end !== at) continue;
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (
      best === null ||
      Date.parse(row.filed ?? "1970-01-01") > Date.parse(best.filed ?? "1970-01-01")
    ) {
      best = row;
    }
  }
  return best;
}

/**
 * The filer's finance lease liability at that instant.
 *
 * The total where tagged; otherwise the two halves, which some filers tag
 * without a total. A filer tagging NEITHER reports no finance lease, and that
 * is returned as null — never as zero, per Section 4.3.
 */
function financeLeaseAt(
  doc: CompanyFactsDocument,
  at: string
): { value: number; via: string } | null {
  const total = instantAt(doc, "FinanceLeaseLiability", at);
  if (total !== null) return { value: total.val, via: "FinanceLeaseLiability" };

  const current = instantAt(doc, "FinanceLeaseLiabilityCurrent", at);
  const noncurrent = instantAt(doc, "FinanceLeaseLiabilityNoncurrent", at);
  if (current === null && noncurrent === null) return null;

  const parts: string[] = [];
  if (current !== null) parts.push("FinanceLeaseLiabilityCurrent");
  if (noncurrent !== null) parts.push("FinanceLeaseLiabilityNoncurrent");
  return { value: (current?.val ?? 0) + (noncurrent?.val ?? 0), via: parts.join(" + ") };
}

function verdictFor(
  totalDebt: number,
  financeLease: number | null,
  combined: number | null,
  combinedCurrent: number | null
): { verdict: Verdict; why: string } {
  if (financeLease === null) {
    return {
      verdict: "NOTHING TO NEST",
      why: "the filer tags no finance lease liability, in any of the three elements",
    };
  }
  if (financeLease > totalDebt) {
    return {
      verdict: "EXCLUDED",
      why:
        `nesting is impossible: the finance lease (${financeLease}) exceeds the whole ` +
        `total-debt figure (${totalDebt})`,
    };
  }
  if (combined !== null && combinedCurrent !== null && combined + combinedCurrent === totalDebt) {
    return {
      verdict: "NESTED",
      why:
        `${COMBINED} (${combined}) + ${COMBINED_CURRENT} (${combinedCurrent}) = ${totalDebt}, ` +
        `exactly what total-debt resolved. The figure the mapping calls total debt IS this ` +
        `filer's debt-and-capital-lease total, so the finance lease (${financeLease}) is inside it`,
    };
  }
  if (combined !== null && combined - totalDebt === financeLease) {
    return {
      verdict: "EXCLUDED",
      why:
        `${COMBINED} (${combined}) minus total-debt (${totalDebt}) is the finance lease ` +
        `(${financeLease}), so the plain element excludes it`,
    };
  }
  return {
    verdict: "UNDETERMINED",
    why:
      "the filer reports a finance lease but tags nothing that places it relative to the " +
      "debt total; the tags cannot answer and the filing's lease note has to be read",
  };
}

interface Loaded {
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
    companyName: found.title,
    companyFacts: await client.companyFacts(found.cik),
    provenance: `live EDGAR, fetched ${new Date().toISOString()}`,
  };
}

function loadCapture(ticker: string): Loaded {
  const path = join(
    "lib",
    "analyzer",
    "acquisition",
    "captures",
    `${ticker.toLowerCase()}-companyfacts.json`
  );
  if (!existsSync(path)) throw new Error(`No capture for ${ticker} at ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    companyName: raw.entityName ?? ticker,
    companyFacts: raw as CompanyFactsDocument,
    provenance: `capture at ${path}`,
  };
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const measurements: Measurement[] = [];
  const lines: string[] = [];

  lines.push("CALBOARD — LEASE-ONCE MEASUREMENT");
  lines.push(`Ran:              ${new Date().toISOString()}`);
  lines.push(`Mapping version:  ${TAG_MAPPING_VERSION}  (unchanged by this script)`);
  lines.push(`Source:           ${offline ? "captures" : "live EDGAR"}`);
  lines.push("");
  lines.push("Does the tag that WINS for total-debt already contain the filer's lease");
  lines.push("obligations? Measured per company before any invested-capital construction is");
  lines.push("written, because the ruling requires lease liabilities to be included exactly");
  lines.push("once and the mapping cannot be asked.");
  lines.push("");

  const debtEntry = tagMapEntry("total-debt");
  if (debtEntry === null) throw new Error("total-debt is not in the mapping");

  for (const company of CALIBRATION_SET) {
    let loaded: Loaded;
    try {
      loaded = offline ? loadCapture(company.ticker) : await loadLive(company.ticker);
    } catch (err) {
      lines.push(`${company.ticker}: NOT MEASURED — ${(err as Error).message}`);
      lines.push("");
      continue;
    }

    const doc = loaded.companyFacts;
    const resolution = resolveEntry(doc, debtEntry);

    if (resolution.outcome !== "RESOLVED") {
      measurements.push({
        ticker: company.ticker,
        totalDebt: null,
        wonVia: "—",
        contributing: "—",
        asOfDate: "—",
        form: "—",
        financeLease: null,
        financeLeaseVia: "—",
        combined: null,
        combinedCurrent: null,
        verdict: "UNDETERMINED",
        why: `total-debt did not resolve (${resolution.outcome}), so there is no figure to test a lease against`,
      });
      lines.push(`${company.ticker} — ${loaded.companyName}`);
      lines.push(`   total-debt:    NOT ACQUIRED (${resolution.outcome})`);
      lines.push(`   VERDICT:       UNDETERMINED`);
      lines.push("");
      continue;
    }

    const resolved = resolution.value;
    const at = resolved.asOfDate;
    const lease = financeLeaseAt(doc, at);
    const combined = instantAt(doc, COMBINED, at);
    const combinedCurrent = instantAt(doc, COMBINED_CURRENT, at);
    const contributing = resolved.contributingTags
      .map((t) => `${t.ref.tag}=${t.value}`)
      .join(" + ");

    const { verdict, why } = verdictFor(
      resolved.value,
      lease?.value ?? null,
      combined?.val ?? null,
      combinedCurrent?.val ?? null
    );

    measurements.push({
      ticker: company.ticker,
      totalDebt: resolved.value,
      wonVia: resolved.contributingTags[0].ref.tag,
      contributing,
      asOfDate: at,
      form: resolved.form,
      financeLease: lease?.value ?? null,
      financeLeaseVia: lease?.via ?? "—",
      combined: combined?.val ?? null,
      combinedCurrent: combinedCurrent?.val ?? null,
      verdict,
      why,
    });

    lines.push(`${company.ticker} — ${loaded.companyName}`);
    lines.push(`   source:        ${loaded.provenance}`);
    lines.push(`   total-debt:    ${resolved.value}  @${at} [${resolved.form}]`);
    lines.push(`   won via:       ${resolved.contributingTags[0].ref.tag}`);
    lines.push(`   contributing:  ${contributing}`);
    lines.push(
      `   finance lease: ${lease === null ? "not tagged" : `${lease.value} via ${lease.via}`}`
    );
    lines.push(
      `   ${COMBINED}: ${combined?.val ?? "not tagged"}  (current ${combinedCurrent?.val ?? "not tagged"})`
    );
    lines.push(`   VERDICT:       ${verdict}`);
    lines.push(`   because:       ${why}`);
    lines.push("");
  }

  lines.push("=".repeat(78));
  lines.push("SUMMARY");
  lines.push("=".repeat(78));
  for (const m of measurements) {
    lines.push(`${m.ticker.padEnd(6)} ${m.verdict.padEnd(16)} total-debt via ${m.wonVia}`);
  }
  lines.push("");

  const nested = measurements.filter((m) => m.verdict === "NESTED");
  const undetermined = measurements.filter((m) => m.verdict === "UNDETERMINED");

  lines.push(`NESTED:       ${nested.length === 0 ? "none" : nested.map((m) => m.ticker).join(", ")}`);
  lines.push(
    `UNDETERMINED: ${undetermined.length === 0 ? "none" : undetermined.map((m) => m.ticker).join(", ")}`
  );
  lines.push("");
  if (nested.length > 0) {
    lines.push("A NESTED company means the existing `total-debt` mapping does not carry one");
    lines.push("meaning across the set: it excludes lease obligations for some filers and");
    lines.push("includes them for others. Adding a lease term on top of it counts those leases");
    lines.push("twice for the nested filers — and the Section 3.5 EV bridge, which already adds");
    lines.push("total debt and finance leases, is doing exactly that today.");
  }

  const text = lines.join("\n");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "measurement.txt");
  writeFileSync(path, text, "utf8");
  console.log(text);
  console.log(`\nWritten to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
