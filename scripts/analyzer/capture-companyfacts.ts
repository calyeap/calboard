import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import {
  TAG_MAP,
  CANDIDATE_NON_OPERATING_INVESTMENT_TAGS,
} from "../../lib/analyzer/acquisition/tagMap";
import { INSURANCE_PREMIUM_OR_RESERVE_TAGS } from "../../lib/analyzer/acquisition/gate0Inputs";
import type { CompanyFactsDocument } from "../../lib/analyzer/acquisition/secClient";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Captures a REAL companyfacts document, trimmed to the tags this mapping
// touches, so the acquisition tests run against real filings without hitting
// EDGAR on every `npm test`.
//
// This is a capture, not a fixture: no figure in the output was written by
// hand, and the file records when it was taken and from which endpoint. That
// is the distinction the milestone turns on — the M5/M7 fixtures were
// reconstructions of a mock's displayed outputs, and these are the filings.
//
//   npx tsx scripts/analyzer/capture-companyfacts.ts MSFT OKLO
// ---------------------------------------------------------------------------

const EXTRA_TAGS: { ns: "us-gaap" | "dei"; tag: string }[] = [
  // §6.1's Gate 0 tests. Retained so offline mode can evaluate the gate at all:
  // the capture is trimmed to the tags this mapping touches, and a trim that
  // dropped these left the suite unable to reproduce the live gate.
  //
  // The insurance list is the presence test — every element of it, because
  // "absent" is the answer the gate reads and a trimmed-away element would
  // read as absent for the wrong reason.
  ...INSURANCE_PREMIUM_OR_RESERVE_TAGS.map((tag) => ({ ns: "us-gaap" as const, tag })),
  { ns: "us-gaap", tag: "InterestIncomeOperating" },
  { ns: "us-gaap", tag: "InterestAndDividendIncomeOperating" },
  { ns: "us-gaap", tag: "InterestIncomeExpenseNet" },
  // Footing components.
  { ns: "us-gaap", tag: "LongTermDebtCurrent" },
  { ns: "us-gaap", tag: "LongTermDebtNoncurrent" },
  { ns: "us-gaap", tag: "FinanceLeaseLiabilityCurrent" },
  { ns: "us-gaap", tag: "FinanceLeaseLiabilityNoncurrent" },
  { ns: "us-gaap", tag: "OperatingLeaseLiabilityCurrent" },
  { ns: "us-gaap", tag: "OperatingLeaseLiabilityNoncurrent" },
  // Reconciliation companions.
  { ns: "us-gaap", tag: "WeightedAverageNumberOfDilutedSharesOutstanding" },
  { ns: "us-gaap", tag: "WeightedAverageNumberOfSharesOutstandingBasic" },
  // The "also stated as" pair for the share count.
  { ns: "us-gaap", tag: "CommonStockSharesOutstanding" },
];

function wantedTags(): Set<string> {
  const wanted = new Set<string>();
  for (const entry of TAG_MAP) {
    for (const candidate of entry.candidates) {
      wanted.add(`${candidate.ref.ns}:${candidate.ref.tag}`);
      for (const ref of candidate.plus ?? []) wanted.add(`${ref.ns}:${ref.tag}`);
    }
  }
  for (const ref of CANDIDATE_NON_OPERATING_INVESTMENT_TAGS) wanted.add(`${ref.ns}:${ref.tag}`);
  for (const ref of EXTRA_TAGS) wanted.add(`${ref.ns}:${ref.tag}`);
  return wanted;
}

/**
 * Keeps only the tags the mapping touches, and only rows whose own period ends
 * on or after `sinceYear`.
 *
 * The window is filtered on the row's PERIOD END, never on EDGAR's `fy` field:
 * `fy` names the filing the fact appeared in, so a FY2016 comparative inside a
 * FY2026 10-K carries fy=2026. Trimming on `fy` would keep that row while
 * dropping the filing it was originally reported in, which silently changes
 * which basis the history is on — exactly the mixed-basis window §3.7 refuses.
 *
 * The window must be wide enough for the ten-year history §4.2 asks for, or
 * Gate 1 reads a capture artefact as a short filing record.
 */
function trim(doc: CompanyFactsDocument, keep: Set<string>, sinceYear: number): CompanyFactsDocument {
  const facts: CompanyFactsDocument["facts"] = {};

  for (const ns of Object.keys(doc.facts ?? {})) {
    for (const tag of Object.keys(doc.facts[ns])) {
      if (!keep.has(`${ns}:${tag}`)) continue;
      const src = doc.facts[ns][tag];
      const units: Record<string, typeof src.units[string]> = {};
      for (const unit of Object.keys(src.units)) {
        const rows = src.units[unit].filter(
          (r) => new Date(r.end).getUTCFullYear() >= sinceYear
        );
        if (rows.length > 0) units[unit] = rows;
      }
      if (Object.keys(units).length === 0) continue;
      facts[ns] ??= {};
      facts[ns][tag] = { label: src.label ?? null, units };
    }
  }

  return { cik: doc.cik, entityName: doc.entityName, facts };
}

async function main(): Promise<void> {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    throw new Error("Usage: tsx scripts/analyzer/capture-companyfacts.ts MSFT OKLO");
  }

  const client = secClientFromEnv();
  const directory = await client.companyTickers();
  const outDir = join("lib", "analyzer", "acquisition", "captures");
  mkdirSync(outDir, { recursive: true });

  for (const ticker of tickers) {
    const found = cikForTicker(directory, ticker);
    if (found === null) throw new Error(`${ticker} is not in the SEC ticker directory`);

    const doc = await client.companyFacts(found.cik);
    // Twelve years: the ten §4.2 wants, plus the two a ten-year CAGR and a
    // period-over-period comparator need at the far end of the window.
    const trimmed = trim(doc, wantedTags(), new Date().getFullYear() - 12);

    // The classification, captured alongside the facts.
    //
    // Without it, offline mode had no classification at all, Gate 0 failed
    // closed on every captured run, and the suite could never reach the
    // populated case — "a test environment that cannot reproduce the live one
    // is a check that cannot fail." This is the same submissions endpoint the
    // live path reads, taken at the same moment as the facts beside it.
    const submissions = await client.submissions(found.cik);

    const capture = {
      __capture: {
        endpoint: `https://data.sec.gov/api/xbrl/companyfacts/CIK${found.cik}.json`,
        submissionsEndpoint: `https://data.sec.gov/submissions/CIK${found.cik}.json`,
        capturedAt: new Date().toISOString(),
        ticker: ticker.toUpperCase(),
        cik: found.cik,
        sic: submissions.sic ?? null,
        sicDescription: submissions.sicDescription ?? null,
        note:
          "Real SEC XBRL company facts, trimmed to the tags calboard's tag mapping " +
          "touches and to periods ending in the last twelve calendar years. Every " +
          "retained row is exactly as EDGAR returned it; nothing here was written " +
          "by hand. The SIC code and description are from the submissions endpoint " +
          "at the same capture time, so Gate 0 evaluates offline exactly as it " +
          "does live.",
      },
      ...trimmed,
    };

    const path = join(outDir, `${ticker.toLowerCase()}-companyfacts.json`);
    writeFileSync(path, JSON.stringify(capture, null, 2) + "\n", "utf8");

    const tagCount = Object.values(trimmed.facts).reduce(
      (n, tags) => n + Object.keys(tags).length,
      0
    );
    console.log(`${ticker}: CIK ${found.cik} — ${tagCount} tags captured -> ${path}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
