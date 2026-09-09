import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument, XbrlFactUnitRow } from "../../lib/analyzer/acquisition/secClient";
import { resolveEntry } from "../../lib/analyzer/acquisition/selectTagged";
import {
  tagMapEntry,
  TAG_MAPPING_VERSION,
  CANDIDATE_NON_OPERATING_INVESTMENT_TAGS,
} from "../../lib/analyzer/acquisition/tagMap";
import { CALIBRATION_SET } from "../../lib/analyzer/calibration/set";
import {
  determineNesting,
  LEASE_INCLUSIVE_DEBT_ELEMENTS as SHARED_LEASE_INCLUSIVE,
  type NestingDetermination,
} from "./nesting-evidence";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// PHASE A — BLAST RADIUS of the bridge-coherence ruling. MEASURE, DO NOT FIX.
//
//   npx tsx scripts/analyzer/bridge-coherence-blast-radius.ts
//   npx tsx scripts/analyzer/bridge-coherence-blast-radius.ts --offline
//
// Two invariants, applied to every construction that combines balance-sheet
// stocks:
//
//   I1  a lease counted more than once, or nesting unresolved
//   I2  mixed balance-sheet dates inside one bridge
//
// NO DATE TOLERANCE. Not nearest, not latest-per-component, not within-a-
// quarter, not interpolation. Two components at different dates fail I2, and
// how small the gap is does not enter into it.
//
// MATERIALITY IS NOT A REASON TO PASS NESTING UNCERTAINTY. A filer whose lease
// is $187k against a $700k debt total is treated exactly as a filer whose
// lease is billions: unresolved is unresolved.
//
// MARKET CAP IS THE EXCEPTION. Shares outstanding and price are a market
// value struck at the valuation date, not a statement stock, so they are
// excluded from the I2 test over balance-sheet claims and reported as their
// own dates. `treasury-method-dilution` is a DURATION fact by mapping and
// belongs to that same market-equity side (§3.5 takes most-recent shares plus
// dilution, deliberately, rather than a weighted-average diluted count).
//
// WHAT COUNTS AS NESTING EVIDENCE — the ruling admits three kinds, and this
// script implements only the ones obtainable from the companyfacts document
// acquisition actually reads:
//
//   E1  explicit issuer disclosure          — note text. NOT in companyfacts.
//   E2  same-date issuer component reconciliation — needs the dimensional
//       members that isolate the lease line. NOT in companyfacts, whose fact
//       rows carry no axis or member at all.
//   E3  reliable issuer-filed XBRL component or calculation relationship —
//       PARTLY available: where a filer tags the SAME instant under both a
//       plain debt element and a lease-inclusive combined element, the filer
//       has itself asserted that its debt total is a debt-and-capital-lease
//       total. That is the issuer's own tagging, not an arithmetic accident.
//
// EXPLICITLY NOT USED, per the ruling: tag names, arithmetic coincidence,
// historical assumptions, aggregator fields, inference from another company.
// The previous pass settled Union Pacific partly on the combined element
// SUMMING to the debt total, which is arithmetic coincidence and is not relied
// on here; UNP is re-derived below on E3 instead.
//
// CORRECTED 2026-09-09. This script previously admitted DEDUCTIVE
// IMPOSSIBILITY — a lease larger than the whole debt figure — as a route to
// establishing EXCLUSION, and flagged it as outside the three approved kinds.
// CalFinance has since ruled it out entirely: a lease exceeding the debt total
// proves only that the lease is not FULLY nested, and partial nesting stays
// mathematically possible. The branch is gone. Microsoft, which was the only
// company it rescued, is now determined on its own Note 13 disclosure instead
// (E1), which places the whole liability in other current and other long-term
// liabilities — so the conclusion survived and the reasoning changed.
//
// A missing finance-lease tag is likewise no longer read as "nothing to nest".
// It is UNKNOWN, per `nesting-evidence.ts`, which this script now shares with
// the other two harnesses.
//
// The MEASUREMENTS below — every date, every resolved figure, every bridge
// coherence test — are unchanged.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "bridge-coherence");

const ELIGIBLE_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

/**
 * Reported so the output says which lease-inclusive elements were looked for.
 * The determination itself is the shared one.
 */
const LEASE_INCLUSIVE_DEBT_ELEMENTS = SHARED_LEASE_INCLUSIVE;

interface Stock {
  factId: string;
  value: number | null;
  asOfDate: string | null;
  outcome: string;
}

interface CompanyResult {
  ticker: string;
  stocks: Stock[];
  marketSide: { factId: string; asOfDate: string | null; outcome: string }[];
  nesting: NestingDetermination;
  /** Bridge name -> the distinct dates its balance-sheet stocks landed on. */
  bridgeDates: { bridge: string; dates: Record<string, string>; coherent: boolean; missing: string[] }[];
  failsI1: boolean;
  failsI2: boolean;
}

function instantAt(doc: CompanyFactsDocument, tag: string, at: string): XbrlFactUnitRow | null {
  const rows = doc.facts?.["us-gaap"]?.[tag]?.units?.["USD"];
  if (!rows) return null;
  let best: XbrlFactUnitRow | null = null;
  for (const row of rows) {
    if (row.start !== undefined) continue;
    if (row.end !== at) continue;
    if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
    if (best === null || Date.parse(row.filed ?? "1970-01-01") > Date.parse(best.filed ?? "1970-01-01")) {
      best = row;
    }
  }
  return best;
}

function resolveStock(doc: CompanyFactsDocument, factId: string): Stock {
  const entry = tagMapEntry(factId);
  if (entry === null) return { factId, value: null, asOfDate: null, outcome: "NOT IN MAPPING" };
  const res = resolveEntry(doc, entry);
  if (res.outcome !== "RESOLVED") return { factId, value: null, asOfDate: null, outcome: res.outcome };
  return { factId, value: res.value.value, asOfDate: res.value.asOfDate, outcome: "RESOLVED" };
}

/**
 * The non-operating investment CANDIDATES, each with its own instant.
 *
 * They are not one acquired fact — §4.4 has the analyst classify among them —
 * but whichever are chosen enter the EV bridge as a balance-sheet claim, so
 * their dates are part of the coherence question. Reported as the set of
 * distinct dates the candidates sit on.
 */
function candidateInvestmentDates(doc: CompanyFactsDocument): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of CANDIDATE_NON_OPERATING_INVESTMENT_TAGS) {
    const rows = doc.facts?.[ref.ns]?.[ref.tag]?.units?.["USD"];
    if (!rows) continue;
    let best: XbrlFactUnitRow | null = null;
    for (const row of rows) {
      if (row.start !== undefined) continue;
      if (!ELIGIBLE_FORMS.has(row.form ?? "")) continue;
      if (best === null || Date.parse(row.end) > Date.parse(best.end)) best = row;
    }
    if (best !== null) out[ref.tag] = best.end;
  }
  return out;
}

interface Loaded {
  companyName: string;
  companyFacts: CompanyFactsDocument;
}

async function loadLive(ticker: string): Promise<Loaded> {
  const client = secClientFromEnv();
  const directory = await client.companyTickers();
  const found = cikForTicker(directory, ticker);
  if (found === null) throw new Error(`${ticker} is not in the SEC ticker directory`);
  return { companyName: found.title, companyFacts: await client.companyFacts(found.cik) };
}

function loadCapture(ticker: string): Loaded {
  const path = join("lib", "analyzer", "acquisition", "captures", `${ticker.toLowerCase()}-companyfacts.json`);
  if (!existsSync(path)) throw new Error(`No capture for ${ticker} at ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { companyName: raw.entityName ?? ticker, companyFacts: raw as CompanyFactsDocument };
}

/**
 * The constructions that combine balance-sheet stocks, and which stocks each
 * one takes. Market-cap inputs are deliberately absent: they are the ruling's
 * named exception.
 */
const BRIDGES: { bridge: string; stocks: string[]; where: string }[] = [
  {
    bridge: "EV bridge",
    stocks: ["total-debt", "finance-lease-liabilities", "cash-and-marketable-debt-securities"],
    where: "modules/enterpriseValue.ts:55",
  },
  {
    bridge: "net debt",
    stocks: ["total-debt", "finance-lease-liabilities", "cash-and-marketable-debt-securities"],
    where: "acquisition/acquire.ts:287",
  },
  {
    bridge: "leverage ratio",
    stocks: ["total-debt", "finance-lease-liabilities", "cash-and-marketable-debt-securities"],
    where: "gates.ts:178",
  },
  {
    bridge: "leverage operating-lease memo",
    stocks: [
      "total-debt",
      "finance-lease-liabilities",
      "operating-lease-liabilities",
      "cash-and-marketable-debt-securities",
    ],
    where: "gates.ts:185",
  },
  {
    bridge: "invested capital (per the ruling, not yet built)",
    stocks: [
      "total-debt",
      "finance-lease-liabilities",
      "operating-lease-liabilities",
      "cash-balance",
    ],
    where: "not implemented",
  },
];

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const results: CompanyResult[] = [];
  const lines: string[] = [];

  lines.push("CALBOARD — PHASE A, BRIDGE-COHERENCE BLAST RADIUS");
  lines.push(`Ran:              ${new Date().toISOString()}`);
  lines.push(`Mapping version:  ${TAG_MAPPING_VERSION}  (unchanged by this script)`);
  lines.push(`Source:           ${offline ? "captures" : "live EDGAR"}`);
  lines.push("");
  lines.push("MEASURE ONLY. Nothing is fixed, no mapping changes, no version bump.");
  lines.push("");

  const STOCK_IDS = [
    "total-debt",
    "finance-lease-liabilities",
    "operating-lease-liabilities",
    "cash-and-marketable-debt-securities",
    "cash-balance",
  ];

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
    const stocks = STOCK_IDS.map((id) => resolveStock(doc, id));
    const byId = new Map(stocks.map((s) => [s.factId, s]));
    const marketSide = ["shares-outstanding", "treasury-method-dilution"].map((id) => {
      const s = resolveStock(doc, id);
      return { factId: id, asOfDate: s.asOfDate, outcome: s.outcome };
    });

    const debtStock = byId.get("total-debt")!;
    const leaseStock = byId.get("finance-lease-liabilities")!;
    const nesting = determineNesting(
      doc,
      company.ticker,
      { value: debtStock.value, asOfDate: debtStock.asOfDate },
      leaseStock.value
    );

    const bridgeDates = BRIDGES.map(({ bridge, stocks: needed }) => {
      const dates: Record<string, string> = {};
      const missing: string[] = [];
      for (const id of needed) {
        const s = byId.get(id);
        if (s === undefined || s.asOfDate === null) missing.push(id);
        else dates[id] = s.asOfDate;
      }
      const distinct = new Set(Object.values(dates));
      return { bridge, dates, coherent: distinct.size <= 1, missing };
    });

    const failsI1 =
      nesting.state === "UNKNOWN" ||
      nesting.state === "NESTED-UNQUANTIFIED" ||
      nesting.leaseAmount === "UNKNOWN" ||
      nesting.state === "NESTED";
    const failsI2 = bridgeDates.some((b) => !b.coherent);

    results.push({ ticker: company.ticker, stocks, marketSide, nesting, bridgeDates, failsI1, failsI2 });

    lines.push("─".repeat(78));
    lines.push(`${company.ticker} — ${loaded.companyName}`);
    lines.push("   balance-sheet stocks, with the date each landed on:");
    for (const s of stocks) {
      lines.push(
        `      ${s.factId.padEnd(38)} ${s.outcome === "RESOLVED" ? `@${s.asOfDate}` : s.outcome}`
      );
    }
    const candidates = candidateInvestmentDates(doc);
    lines.push(
      `      non-operating candidates (§4.4)         ${
        Object.keys(candidates).length === 0
          ? "none tagged"
          : Object.entries(candidates).map(([t, d]) => `${t}@${d}`).join(", ")
      }`
    );
    lines.push("   market-equity side (the ruling's exception — its own dates):");
    for (const m of marketSide) {
      lines.push(`      ${m.factId.padEnd(38)} ${m.outcome === "RESOLVED" ? `@${m.asOfDate}` : m.outcome}`);
    }
    lines.push(`   I1 nesting: ${nesting.state}  [${nesting.evidence}]`);
    lines.push(`      ${nesting.detail}`);
    lines.push("   I2 date coherence, per bridge:");
    for (const b of bridgeDates) {
      const distinct = [...new Set(Object.values(b.dates))];
      lines.push(
        `      ${b.bridge.padEnd(46)} ${b.coherent ? "coherent" : "*** MIXED ***"}  ` +
          `${distinct.join(" | ")}${b.missing.length ? `  (missing: ${b.missing.join(", ")})` : ""}`
      );
    }
    lines.push("");
  }

  // --- the answer ---------------------------------------------------------
  lines.push("=".repeat(78));
  lines.push("BLAST RADIUS");
  lines.push("=".repeat(78));
  lines.push("");
  lines.push("Per company, which invariant makes it INCOMPLETE:");
  lines.push("");
  lines.push("ticker  I1 nesting            lease amount    I2 dates    verdict");
  for (const r of results) {
    const verdict =
      r.failsI1 || r.failsI2 ? "INCOMPLETE" : "can produce a coherent bridge";
    lines.push(
      `${r.ticker.padEnd(7)} ${r.nesting.state.padEnd(21)} ${r.nesting.leaseAmount.padEnd(15)} ${(r.failsI2 ? "MIXED" : "ok").padEnd(11)} ${verdict}`
    );
  }
  lines.push("");

  const producible = results.filter((r) => !r.failsI1 && !r.failsI2);
  lines.push(`Companies that could still produce a coherent EV bridge: ${producible.length === 0 ? "NONE" : producible.map((r) => r.ticker).join(", ")}`);
  lines.push("");
  lines.push("UNKNOWN is the fail-closed answer: not zero, and not non-nested. A missing");
  lines.push("finance-lease tag lands there, and so does a lease merely exceeding the debt");
  lines.push("total — which disproves FULL nesting only. Note the ways of being INCOMPLETE");
  lines.push("differ, and the count should not be read as one number: a filer with no lease");
  lines.push("input at all was INCOMPLETE before any of this, and one whose nesting is");
  lines.push("unresolved becomes INCOMPLETE because of the ruling.");

  const text = lines.join("\n");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "blast-radius.txt");
  writeFileSync(path, text, "utf8");
  console.log(text);
  console.log(`\nWritten to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
