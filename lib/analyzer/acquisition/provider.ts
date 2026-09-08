import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { secClientFromEnv, cikForTicker } from "./secClient";
import type { CompanyFactsDocument, SubmissionsDocument } from "./secClient";
import { acquire, type AcquisitionResult, type PriceQuote } from "./acquire";
import { runCrossChecks, assertEveryInputReported, type CrossCheckReport } from "../crosschecks/run";

// ---------------------------------------------------------------------------
// Where a run's facts come from.
//
// One function, so there is exactly one answer to "what did this run acquire
// and from where". The result carries its own provenance note, which is
// rendered to the analyst rather than kept in a log — a run must never be
// ambiguous about whether it touched the network.
//
// FAIL-CLOSED on configuration: with no SEC_USER_AGENT this raises rather than
// quietly reading the committed capture. A silent fall back to captured data
// would make a stale fact set indistinguishable from a fresh one, which is the
// §3.4 staleness question answered wrongly by default.
// ---------------------------------------------------------------------------

export interface AcquiredCompany {
  acquisition: AcquisitionResult;
  companyFacts: CompanyFactsDocument;
  crossChecks: CrossCheckReport;
  /** Fact ids a cross-check failed on — forced into the queue (§3.8.2). */
  crossCheckFailedFactIds: Set<string>;
  sicDescription: string | null;
  provenanceNote: string;
}

export type AcquisitionSource = "EDGAR" | "CAPTURE";

interface CacheEntry {
  at: number;
  value: AcquiredCompany;
}

// A run's facts are fetched once and reused for the life of the process. EDGAR
// publishes a rate ceiling and a report page re-rendering on every navigation
// would spend the budget on figures that cannot have changed.
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Test seam and cache reset. Never called by application code. */
export function __resetAcquisitionCache(): void {
  cache.clear();
}

export function captureFor(ticker: string): CompanyFactsDocument | null {
  const path = join(
    process.cwd(),
    "lib",
    "analyzer",
    "acquisition",
    "captures",
    `${ticker.toLowerCase()}-companyfacts.json`
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CompanyFactsDocument;
}

export interface AcquireOptions {
  price: PriceQuote | null;
  /**
   * CAPTURE reads the committed capture instead of calling EDGAR. Explicit and
   * never a fallback: the caller asks for it, and the provenance note says so.
   */
  source?: AcquisitionSource;
  acquiredAt?: string;
}

export async function acquireCompany(
  ticker: string,
  options: AcquireOptions
): Promise<AcquiredCompany> {
  const key = `${ticker.toUpperCase()}|${options.source ?? "EDGAR"}|${options.price?.timestamp ?? "no-price"}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.value;

  const value =
    options.source === "CAPTURE"
      ? fromCapture(ticker, options)
      : await fromEdgar(ticker, options);

  cache.set(key, { at: Date.now(), value });
  return value;
}

function assemble(
  ticker: string,
  cik: string,
  companyName: string,
  companyFacts: CompanyFactsDocument,
  sicDescription: string | null,
  provenanceNote: string,
  options: AcquireOptions
): AcquiredCompany {
  const acquisition = acquire({
    ticker: ticker.toUpperCase(),
    cik,
    companyName,
    companyFacts,
    price: options.price,
    acquiredAt: options.acquiredAt,
  });

  const crossChecks = runCrossChecks(acquisition.ticker, acquisition.crossCheckFacts, {
    ranAt: acquisition.acquiredAt,
  });
  // Raises rather than returning a partial report. §3.8.2 wants an outcome for
  // every input; a suite that skipped one has a defect, not a finding.
  assertEveryInputReported(crossChecks);

  return {
    acquisition,
    companyFacts,
    crossChecks,
    crossCheckFailedFactIds: new Set(crossChecks.failedFactIds),
    sicDescription,
    provenanceNote,
  };
}

function fromCapture(ticker: string, options: AcquireOptions): AcquiredCompany {
  const doc = captureFor(ticker);
  if (doc === null) throw new Error(`No committed capture for ${ticker}`);
  const meta = (doc as CompanyFactsDocument & { __capture?: { cik?: string; capturedAt?: string } })
    .__capture;

  return assemble(
    ticker,
    meta?.cik ?? String(doc.cik).padStart(10, "0"),
    doc.entityName,
    doc,
    null,
    `Committed SEC capture, taken ${meta?.capturedAt ?? "at an unrecorded time"}. ` +
      `Real filing data, not live — figures are as at the capture, not as at now.`,
    options
  );
}

async function fromEdgar(ticker: string, options: AcquireOptions): Promise<AcquiredCompany> {
  const client = secClientFromEnv();
  const directory = await client.companyTickers();
  const found = cikForTicker(directory, ticker);
  if (found === null) {
    throw new Error(`${ticker} is not in the SEC ticker directory`);
  }

  const companyFacts = await client.companyFacts(found.cik);

  let sicDescription: string | null = null;
  try {
    const submissions = (await client.submissions(found.cik)) as SubmissionsDocument & {
      sicDescription?: string;
    };
    sicDescription = submissions.sicDescription ?? null;
  } catch {
    // Gate 0 fails closed on a missing classification (§5.3, §6.1). A failed
    // lookup leaves it null; it must never default to something classifiable.
    sicDescription = null;
  }

  return assemble(
    ticker,
    found.cik,
    found.title,
    companyFacts,
    sicDescription,
    `Live SEC EDGAR, fetched ${new Date().toISOString()}`,
    options
  );
}

/** A price quote in the shape acquisition wants. */
export function priceQuote(value: Decimal, timestamp: string, source: string): PriceQuote {
  return { value, timestamp, source };
}
