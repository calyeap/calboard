import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument, SubmissionsDocument } from "../../lib/analyzer/acquisition/secClient";
import { acquire } from "../../lib/analyzer/acquisition/acquire";
import { formatFallbackReport } from "../../lib/analyzer/acquisition/fallback";
import {
  runCrossChecks,
  formatCrossCheckReport,
  assertEveryInputReported,
  constrainedAndPassedFactIds,
} from "../../lib/analyzer/crosschecks/run";
import {
  queuedFacts,
  exemptFacts,
  derivedExemptFacts,
  materialityOf,
} from "../../lib/analyzer/spotCheck";
import { evaluateCompleteness } from "../../lib/analyzer/requiredInputs";
import { annualSeries, operatingMarginSeries, filedAnnualYearsCount } from "../../lib/analyzer/acquisition/history";
import { TAG_MAP } from "../../lib/analyzer/acquisition/tagMap";

const revenueTags = TAG_MAP.find((e) => e.factId === "current-revenue")!.candidates;
const operatingIncomeTags = TAG_MAP.find((e) => e.factId === "operating-income")!.candidates;

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// The M8-a acceptance run.
//
// Acquires a company's fact set from EDGAR, runs the §3.8.2 cross-checks over
// every input, and writes the two reports the dispatch treats as the
// acceptance artefacts: the §3.8.1 fallback list and the §3.8.2 cross-check
// outcomes.
//
//   npx tsx scripts/analyzer/acquire-run.ts MSFT OKLO
//   npx tsx scripts/analyzer/acquire-run.ts --offline MSFT   (uses the captures)
//
// --offline reads the committed captures instead of calling EDGAR. Those are
// real filing data, not fixtures, and the report says which was used — a run
// must never be ambiguous about whether it touched the network.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "m8a-acquisition");

interface Loaded {
  cik: string;
  companyName: string;
  companyFacts: CompanyFactsDocument;
  sicDescription: string | null;
  provenance: string;
}

function loadCapture(ticker: string): Loaded {
  const path = join("lib", "analyzer", "acquisition", "captures", `${ticker.toLowerCase()}-companyfacts.json`);
  if (!existsSync(path)) throw new Error(`No capture for ${ticker} at ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    cik: raw.__capture?.cik ?? String(raw.cik).padStart(10, "0"),
    companyName: raw.entityName,
    companyFacts: raw as CompanyFactsDocument,
    sicDescription: null,
    provenance: `committed capture (${path}), taken ${raw.__capture?.capturedAt ?? "unknown"}`,
  };
}

async function loadLive(ticker: string): Promise<Loaded> {
  const client = secClientFromEnv();
  const directory = await client.companyTickers();
  const found = cikForTicker(directory, ticker);
  if (found === null) throw new Error(`${ticker} is not in the SEC ticker directory`);

  const companyFacts = await client.companyFacts(found.cik);
  let sicDescription: string | null = null;
  try {
    const submissions = (await client.submissions(found.cik)) as SubmissionsDocument & {
      sicDescription?: string;
    };
    sicDescription = submissions.sicDescription ?? null;
  } catch {
    // Gate 0 fails closed on a missing classification (§5.3) — a failed
    // lookup must leave it null, never default to something classifiable.
    sicDescription = null;
  }

  return {
    cik: found.cik,
    companyName: found.title,
    companyFacts,
    sicDescription,
    provenance: `live EDGAR, fetched ${new Date().toISOString()}`,
  };
}

async function runOne(ticker: string, offline: boolean): Promise<void> {
  const loaded = offline ? loadCapture(ticker) : await loadLive(ticker);

  const result = acquire({
    ticker: ticker.toUpperCase(),
    cik: loaded.cik,
    companyName: loaded.companyName,
    companyFacts: loaded.companyFacts,
    // No price feed is called here. The price is a market quote acquired with
    // the run in the application flow; this script is about the filing facts,
    // and inventing a price to make the report look fuller would be the exact
    // failure §3.1 prohibits.
    price: null,
  });

  const crossChecks = runCrossChecks(result.ticker, result.crossCheckFacts, {
    ranAt: result.acquiredAt,
  });
  // Raises rather than reporting a shorter list — §3.8.2 wants an outcome for
  // every input, and a suite that quietly skips one is not a control.
  assertEveryInputReported(crossChecks);

  const failed = new Set(crossChecks.failedFactIds);
  const evidence = {
    crossCheckConstrainedFactIds: constrainedAndPassedFactIds(crossChecks),
  };
  const queued = queuedFacts(result.facts, failed, evidence);
  const exempt = exemptFacts(result.facts, failed);
  const derivedExempt = derivedExemptFacts(result.facts, failed, evidence);

  // Not every §4.2 REQUIRED input is a FactRecord. The history series, the
  // filed-year count and Gate 0's classification lookups are acquired too, and
  // reporting them MISSING because they are not in `facts` would be exactly
  // the "false INCOMPLETEs" §4.1 warns a global list produces.
  const derivedAvailable = new Set<string>();
  const margins = operatingMarginSeries(
    annualSeries(loaded.companyFacts, revenueTags),
    annualSeries(loaded.companyFacts, operatingIncomeTags)
  );
  if (margins !== null) derivedAvailable.add("operating-margin-history");
  if (filedAnnualYearsCount(loaded.companyFacts) > 0) {
    derivedAvailable.add("filed-annual-years-count");
  }
  if (loaded.sicDescription !== null) {
    derivedAvailable.add("sector-classification");
    derivedAvailable.add("industry-classification");
  }

  const completeness = evaluateCompleteness({
    availableFactIds: new Set([...result.facts.map((f) => f.id), ...derivedAvailable]),
    crossCheckFailedFactIds: failed,
  });

  mkdirSync(OUT_DIR, { recursive: true });

  const header =
    `CALBOARD M8-a — ACQUISITION RUN\n` +
    `Ticker:   ${result.ticker}  (CIK ${result.cik}, ${result.companyName})\n` +
    `Source:   ${loaded.provenance}\n` +
    `Mapping:  ${result.tagMappingVersion}\n` +
    `Acquired: ${result.acquiredAt}\n`;

  const fallback = `${header}\n${formatFallbackReport(result.fallbackReport)}\n`;
  const crossCheck = `${header}\n${formatCrossCheckReport(crossChecks)}\n`;

  const queueLines: string[] = [];
  queueLines.push(header);
  queueLines.push(`STEP 2 QUEUE — ${result.ticker}  (§3.8, §3.8.1)`);
  queueLines.push("");
  const materialityContext = {
    exemptFactIds: new Set(exempt.map((f) => f.id)),
    crossCheckConstrainedFactIds: evidence.crossCheckConstrainedFactIds,
  };

  queueLines.push(`Queued for spot-check: ${queued.length}`);
  for (const fact of queued) {
    const reason = failed.has(fact.id)
      ? "FORCED BY A FAILED CROSS-CHECK (§3.8.2)"
      : materialityOf(fact, materialityContext).reason;
    queueLines.push(`  - ${fact.id} — ${fact.name}`);
    queueLines.push(`        why queued: ${reason}`);
    queueLines.push(`        value:      ${String(fact.value)}`);
    queueLines.push(`        as-of:      ${fact.asOfDate}`);
  }
  queueLines.push("");
  queueLines.push(`Shown but exempt (tag-mapped, §3.8.1): ${exempt.length}`);
  for (const fact of exempt) {
    queueLines.push(`  - ${fact.id} — ${fact.name}  [${fact.tagMappingVersion}]`);
  }
  queueLines.push("");
  queueLines.push(
    `Shown but exempt (derived, components exempt, cross-checked — 8 Sept ruling): ${derivedExempt.length}`
  );
  for (const fact of derivedExempt) {
    queueLines.push(`  - ${fact.id} — ${fact.name}`);
    queueLines.push(`        derived from: ${(fact.derivedFrom ?? []).join(", ")}`);
  }

  queueLines.push("");
  queueLines.push(`§4.4 NON-OPERATING INVESTMENTS — candidate line items, for the analyst to classify:`);
  if (result.candidateNonOperatingInvestments.length === 0) {
    queueLines.push("  (none tagged for this filer)");
  } else {
    for (const c of result.candidateNonOperatingInvestments) {
      queueLines.push(
        `  - ${c.tag} = ${c.value.toFixed(0)} at book, ${c.asOfDate} (${c.form})`
      );
    }
  }
  queueLines.push("");
  queueLines.push("§4.2 COMPLETENESS PER OUTPUT");
  for (const output of completeness) {
    queueLines.push(`  [${output.state}] ${output.label}`);
    for (const b of output.blockedBy) {
      queueLines.push(`        ${b.reason}: ${b.factId}`);
    }
  }

  const base = join(OUT_DIR, result.ticker.toLowerCase());
  writeFileSync(`${base}-fallback-report.txt`, fallback, "utf8");
  writeFileSync(`${base}-crosscheck-report.txt`, crossCheck, "utf8");
  writeFileSync(`${base}-queue-and-completeness.txt`, queueLines.join("\n") + "\n", "utf8");

  const counts = { PASS: 0, FAIL: 0, "NOT APPLICABLE": 0 };
  for (const r of crossChecks.results) counts[r.outcome] += 1;

  console.log(
    `${result.ticker}: ${result.facts.length} facts acquired · ` +
      `${result.fallbackReport.total} fell back · ` +
      `${queued.length} queued / ${exempt.length} exempt · ` +
      `cross-checks ${counts.PASS} pass / ${counts.FAIL} fail / ${counts["NOT APPLICABLE"]} n-a`
  );
  console.log(`  -> ${base}-fallback-report.txt`);
  console.log(`  -> ${base}-crosscheck-report.txt`);
  console.log(`  -> ${base}-queue-and-completeness.txt`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const tickers = args.filter((a) => !a.startsWith("--"));
  if (tickers.length === 0) {
    throw new Error("Usage: tsx scripts/analyzer/acquire-run.ts [--offline] MSFT OKLO");
  }
  for (const ticker of tickers) await runOne(ticker, offline);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
