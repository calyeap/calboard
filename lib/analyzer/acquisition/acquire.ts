import Decimal from "decimal.js";
import type { CompanyFactsDocument } from "./secClient";
import {
  TAG_MAP,
  TAG_MAPPING_VERSION,
  UNMAPPED_FACTS,
  CANDIDATE_NON_OPERATING_INVESTMENT_TAGS,
  type TagMapEntry,
  type TagRef,
} from "./tagMap";
import {
  resolveEntry,
  resolvePriorPeriod,
  candidateInvestmentLineItems,
  type ResolvedTaggedValue,
} from "./selectTagged";
import {
  buildFallbackReport,
  type FallbackRecord,
  type FallbackReport,
} from "./fallback";
import type { CrossCheckFact } from "../crosschecks/types";
import type { FactRecord } from "../types";

// ---------------------------------------------------------------------------
// Acquisition. §3.1, §3.2, §3.8.1.
//
// Turns one company's XBRL facts and one price quote into the fact set the
// rest of the system runs on. Every record leaves here carrying all seven
// §3.2 fields, and every figure that could not be acquired through the mapping
// leaves as a FALLBACK RECORD naming which of §3.8.1's three reasons applied.
//
// What this module may not do, stated because it is the ruling the dispatch
// turns on: it may not read a table. There is no path from here to a model.
// Where a tag exists the mapping takes it; where none does, the fallback is
// RECORDED and the figure is not acquired. A figure invented here would be
// indistinguishable from a correct one, which is the whole reason §3 exists.
// ---------------------------------------------------------------------------

export interface PriceQuote {
  value: Decimal;
  /** ISO instant. §3.4: price carries its timestamp always, with no approximate state. */
  timestamp: string;
  /** The feed it came from, named precisely enough to re-fetch. */
  source: string;
}

export interface AcquisitionInput {
  ticker: string;
  cik: string;
  companyName: string;
  companyFacts: CompanyFactsDocument;
  /** Null where the quote could not be obtained; the fact is then absent, never estimated. */
  price: PriceQuote | null;
  /** Injected so a run is reproducible in tests. */
  acquiredAt?: string;
}

export interface CandidateInvestment {
  tag: string;
  value: Decimal;
  asOfDate: string;
  form: string;
}

export interface AcquisitionResult {
  ticker: string;
  cik: string;
  companyName: string;
  acquiredAt: string;
  tagMappingVersion: string;
  facts: FactRecord[];
  /** What the §3.8.2 suite runs on, built from the same acquisition. */
  crossCheckFacts: CrossCheckFact[];
  fallbackReport: FallbackReport;
  /**
   * §4.4's non-operating-investments judgment, as candidates only. Acquisition
   * presents these; it does not classify them.
   */
  candidateNonOperatingInvestments: CandidateInvestment[];
}

function filingUrl(cik: string, accession: string | null): string | null {
  if (accession === null) return null;
  const plain = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${plain}/${accession}-index.htm`;
}

function describeTags(refs: readonly TagRef[]): string {
  return refs.map((r) => `${r.ns}:${r.tag}`).join(", ");
}

/**
 * One tagged fact record.
 *
 * verificationState is SPOT-CHECK NOT REQUIRED here because the fact came
 * through the mapping (§3.8.1). That is an ACQUISITION-TIME label and the run
 * re-derives it from the run's own decisions and cross-check outcomes
 * (spotCheck.deriveVerificationState) — this value is never what the screens
 * read.
 */
function taggedFactRecord(
  entry: TagMapEntry,
  resolved: ResolvedTaggedValue,
  cik: string,
  acquiredAt: string
): FactRecord {
  const summed = resolved.contributingTags.length > 1;

  return {
    id: entry.factId,
    name: entry.name,
    type: "FACT",
    value: new Decimal(resolved.value),
    // Identified "precisely enough to re-fetch" (§3.2): the form, the period,
    // the accession, and every tag that contributed.
    source:
      `${resolved.form} ${resolved.asOfDate} (accession ${resolved.accession ?? "unknown"}) · ` +
      `XBRL ${resolved.contributingTags.map((c) => `${c.ref.ns}:${c.ref.tag}`).join(" + ")}` +
      (summed ? " (summed)" : "") +
      (resolved.absentComponents.length > 0
        ? ` · not tagged at this period: ${describeTags(resolved.absentComponents)}`
        : ""),
    sourceUrl: filingUrl(cik, resolved.accession),
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "SPOT-CHECK NOT REQUIRED",
    asOfDate: resolved.periodStart
      ? `${resolved.periodStart} to ${resolved.asOfDate}`
      : resolved.asOfDate,
    retrievalTimestamp: acquiredAt,
    supersedesFactId: null,
    tagMappingVersion: TAG_MAPPING_VERSION,
    derivedFrom: null,
  };
}

/**
 * A figure computed from acquired facts rather than looked up.
 *
 * Queued, never exempt. §3.8.1 guard 1 puts "a deterministic parse" on the
 * queued side of the line: the exemption is granted by acquisition path, and a
 * calculation is not a tag lookup however deterministic it is. tagMappingVersion
 * is null, and null means queued.
 */
function derivedFactRecord(
  id: string,
  name: string,
  value: Decimal,
  fromFactIds: string[],
  asOfDate: string,
  acquiredAt: string
): FactRecord {
  return {
    id,
    name,
    type: "FACT",
    value,
    // Reader-facing: this string renders as the card's Document citation.
    // The components are named because §3.1 requires a derived figure's own
    // inputs to be recorded — the requirement is the contract's, the sentence
    // is the analyst's.
    source: `Computed from ${fromFactIds.join(", ")}, each acquired for this run`,
    sourceUrl: null,
    sourceClass: "PRIMARY",
    extractionType: "DETERMINISTIC/STRUCTURED",
    verificationState: "SPOT-CHECK PENDING",
    asOfDate,
    retrievalTimestamp: acquiredAt,
    supersedesFactId: null,
    tagMappingVersion: null,
    // §3.1's "inputs are themselves recorded", as data rather than as prose.
    derivedFrom: fromFactIds,
  };
}

export function acquire(input: AcquisitionInput): AcquisitionResult {
  const acquiredAt = input.acquiredAt ?? new Date().toISOString();
  const doc = input.companyFacts;

  const facts: FactRecord[] = [];
  const crossCheckFacts: CrossCheckFact[] = [];
  const fallbacks: FallbackRecord[] = [];
  const resolvedById = new Map<string, ResolvedTaggedValue>();

  // --- 1. everything the mapping covers ----------------------------------
  for (const entry of TAG_MAP) {
    const resolution = resolveEntry(doc, entry);

    if (resolution.outcome !== "RESOLVED") {
      fallbacks.push({
        factId: entry.factId,
        name: entry.name,
        reason:
          resolution.outcome === "NO_TAG_IN_FILINGS"
            ? "NO TAG EXISTS"
            : "TAG PRESENT BUT UNMAPPED IN VERSION IN FORCE",
        detail:
          resolution.outcome === "NO_TAG_IN_FILINGS"
            ? `None of ${describeTags(resolution.tried)} appears in this filer's XBRL facts.`
            : `${describeTags(resolution.tried)} is tagged, but ${resolution.detail}.`,
        tagMappingVersion: TAG_MAPPING_VERSION,
        valueAcquired: false,
      });
      continue;
    }

    resolvedById.set(entry.factId, resolution.value);
    facts.push(taggedFactRecord(entry, resolution.value, input.cik, acquiredAt));

    crossCheckFacts.push({
      factId: entry.factId,
      name: entry.name,
      value: resolution.value.value,
      unit: entry.unit,
      asOfDate: resolution.value.asOfDate,
      components: componentsFor(entry, doc, resolution.value),
      alsoStatedAs: alsoStatedFor(entry, doc, resolution.value),
      priorPeriod: resolvePriorPeriod(doc, entry, resolution.value),
    });
  }

  // --- 2. the price, which is not a filing element -----------------------
  if (input.price !== null) {
    facts.push({
      id: "price",
      name: "Price",
      type: "FACT",
      value: input.price.value,
      source: input.price.source,
      sourceUrl: null,
      sourceClass: "PRIMARY",
      extractionType: "DETERMINISTIC/STRUCTURED",
      // QUEUED, not exempt. §3.8.1 guard 1: a structured feed field with no tag
      // mapping is queued like any other. tagMappingVersion below is null and
      // that is the whole test.
      verificationState: "SPOT-CHECK PENDING",
      // §3.2 keeps these apart and §3.4 requires both: the as-of is when the
      // figure was TRUE (the quote's own timestamp, which "price carries
      // always"), the retrieval timestamp is when this run fetched it. Setting
      // both to the quote time would lose the staleness the second field
      // exists to expose.
      asOfDate: input.price.timestamp,
      retrievalTimestamp: acquiredAt,
      supersedesFactId: null,
      tagMappingVersion: null,
      // A feed value, not a computation.
      derivedFrom: null,
    });
    crossCheckFacts.push({
      factId: "price",
      name: "Price",
      value: input.price.value.toNumber(),
      unit: "USD",
      asOfDate: input.price.timestamp,
    });
  }

  // --- 3. derived figures whose own inputs are recorded (§3.1) -----------
  const revenue = resolvedById.get("current-revenue");
  const operatingIncome = resolvedById.get("operating-income");
  if (revenue && operatingIncome && revenue.value !== 0) {
    const margin = new Decimal(operatingIncome.value).div(revenue.value);
    facts.push(
      derivedFactRecord(
        "current-operating-margin",
        "Current operating margin",
        margin,
        ["operating-income", "current-revenue"],
        revenue.asOfDate,
        acquiredAt
      )
    );
    crossCheckFacts.push({
      factId: "current-operating-margin",
      name: "Current operating margin",
      value: margin.toNumber(),
      unit: "pure",
      asOfDate: revenue.asOfDate,
    });
  }

  const debt = resolvedById.get("total-debt");
  const leases = resolvedById.get("finance-lease-liabilities");
  const cash = resolvedById.get("cash-and-marketable-debt-securities");
  if (debt && leases && cash) {
    const netDebt = new Decimal(debt.value).plus(leases.value).minus(cash.value);
    facts.push(
      derivedFactRecord(
        "net-debt",
        "Net debt (including finance leases)",
        netDebt,
        ["total-debt", "finance-lease-liabilities", "cash-and-marketable-debt-securities"],
        debt.asOfDate,
        acquiredAt
      )
    );
    crossCheckFacts.push({
      factId: "net-debt",
      name: "Net debt (including finance leases)",
      value: netDebt.toNumber(),
      unit: "USD",
      asOfDate: debt.asOfDate,
    });
  }

  const ocf = resolvedById.get("operating-cash-flow");
  const capex = resolvedById.get("capex");
  if (ocf && capex) {
    const cashFcf = new Decimal(ocf.value).minus(capex.value);
    facts.push(
      derivedFactRecord(
        "cash-fcf",
        "Cash FCF",
        cashFcf,
        ["operating-cash-flow", "capex"],
        ocf.asOfDate,
        acquiredAt
      )
    );
    crossCheckFacts.push({
      factId: "cash-fcf",
      name: "Cash FCF",
      value: cashFcf.toNumber(),
      unit: "USD",
      asOfDate: ocf.asOfDate,
    });
  }

  // --- 4. reconciliation companions --------------------------------------
  // Not §3.8 material facts in their own right; acquired because the
  // treasury-method-dilution reconciliation rule needs both sides, and a rule
  // whose inputs are absent reports NOT APPLICABLE — a check that cannot fail.
  for (const [factId, tag] of [
    ["weighted-average-diluted-shares", "WeightedAverageNumberOfDilutedSharesOutstanding"],
    ["weighted-average-basic-shares", "WeightedAverageNumberOfSharesOutstandingBasic"],
  ] as const) {
    const companion: TagMapEntry = {
      factId,
      name: factId,
      period: "duration",
      duration: "annual",
      unit: "shares",
      candidates: [{ ref: { ns: "us-gaap", tag } }],
      basis: "reconciliation companion",
    };
    const r = resolveEntry(doc, companion);
    if (r.outcome === "RESOLVED") {
      crossCheckFacts.push({
        factId,
        name: factId,
        value: r.value.value,
        unit: "shares",
        asOfDate: r.value.asOfDate,
      });
    }
  }

  // --- 5. what the mapping deliberately does not cover --------------------
  for (const unmapped of UNMAPPED_FACTS) {
    // NOT_FILING is not a fallback: the price comes from a feed, and it is
    // acquired above. JUDGMENT is not a fallback either: §4.4 makes it the
    // analyst's classification, not an extraction gap.
    if (unmapped.reason !== "NO_TAG") continue;
    fallbacks.push({
      factId: unmapped.factId,
      name: unmapped.name,
      reason: "NO TAG EXISTS",
      detail: unmapped.basis,
      tagMappingVersion: TAG_MAPPING_VERSION,
      valueAcquired: false,
    });
  }

  const candidates = candidateInvestmentLineItems(
    doc,
    CANDIDATE_NON_OPERATING_INVESTMENT_TAGS
  ).map((c) => ({
    tag: `${c.ref.ns}:${c.ref.tag}`,
    value: new Decimal(c.value),
    asOfDate: c.asOfDate,
    form: c.form,
  }));

  return {
    ticker: input.ticker,
    cik: input.cik,
    companyName: input.companyName,
    acquiredAt,
    tagMappingVersion: TAG_MAPPING_VERSION,
    facts,
    crossCheckFacts,
    fallbackReport: buildFallbackReport(
      input.ticker,
      TAG_MAPPING_VERSION,
      acquiredAt,
      fallbacks,
      facts.length
    ),
    candidateNonOperatingInvestments: candidates,
  };
}

// ---------------------------------------------------------------------------
// Footing inputs. Each entry below names the tagged parts that must sum to the
// acquired total, or the other place the same quantity is stated.
//
// Declared here rather than in tagMap.ts because these are not acquisition
// paths — nothing is acquired through them. They exist only to give the
// footing family something to test, and a family with nothing to test is the
// formality the negative tests exist to refuse.
// ---------------------------------------------------------------------------

const FOOTING_COMPONENTS: Record<string, TagRef[]> = {
  "total-debt": [
    { ns: "us-gaap", tag: "LongTermDebtCurrent" },
    { ns: "us-gaap", tag: "LongTermDebtNoncurrent" },
  ],
  "finance-lease-liabilities": [
    { ns: "us-gaap", tag: "FinanceLeaseLiabilityCurrent" },
    { ns: "us-gaap", tag: "FinanceLeaseLiabilityNoncurrent" },
  ],
  "operating-lease-liabilities": [
    { ns: "us-gaap", tag: "OperatingLeaseLiabilityCurrent" },
    { ns: "us-gaap", tag: "OperatingLeaseLiabilityNoncurrent" },
  ],
};

const ALSO_STATED: Record<string, { ref: TagRef; where: string; toleranceFraction: number }[]> = {
  "shares-outstanding": [
    {
      ref: { ns: "us-gaap", tag: "CommonStockSharesOutstanding" },
      where: "balance sheet share count",
      // The cover page is struck weeks after period end, so the two disagree by
      // ordinary issuance. The tolerance absorbs that and nothing larger —
      // a transcription or scale error is orders of magnitude out, not 2%.
      toleranceFraction: 0.02,
    },
  ],
};

function valueAtSameInstant(
  doc: CompanyFactsDocument,
  ref: TagRef,
  unit: string,
  end: string
): number | null {
  const rows = doc.facts?.[ref.ns]?.[ref.tag]?.units?.[unit];
  if (!rows) return null;
  let best: number | null = null;
  let bestFiled = "";
  for (const row of rows) {
    if (row.end !== end) continue;
    if (row.start !== undefined && row.start !== end) continue;
    const filed = row.filed ?? "";
    if (best === null || filed > bestFiled) {
      best = row.val;
      bestFiled = filed;
    }
  }
  return best;
}

function componentsFor(
  entry: TagMapEntry,
  doc: CompanyFactsDocument,
  resolved: ResolvedTaggedValue
): { name: string; value: number }[] | undefined {
  // A summed entry foots against its own contributing tags first — that is the
  // arithmetic acquisition itself performed, and it must be shown.
  if (resolved.contributingTags.length > 1) {
    return resolved.contributingTags.map((c) => ({
      name: `${c.ref.ns}:${c.ref.tag}`,
      value: c.value,
    }));
  }

  const refs = FOOTING_COMPONENTS[entry.factId];
  if (!refs) return undefined;

  const parts: { name: string; value: number }[] = [];
  for (const ref of refs) {
    const value = valueAtSameInstant(doc, ref, entry.unit, resolved.asOfDate);
    // A partial breakdown cannot foot. Returning what was found would produce
    // a guaranteed failure that says nothing about the acquisition.
    if (value === null) return undefined;
    parts.push({ name: `${ref.ns}:${ref.tag}`, value });
  }
  return parts;
}

function alsoStatedFor(
  entry: TagMapEntry,
  doc: CompanyFactsDocument,
  resolved: ResolvedTaggedValue
): { where: string; value: number; toleranceFraction?: number }[] | undefined {
  const specs = ALSO_STATED[entry.factId];
  if (!specs) return undefined;

  const out: { where: string; value: number; toleranceFraction?: number }[] = [];
  for (const spec of specs) {
    // Deliberately NOT pinned to the resolved instant: the cover-page count and
    // the balance-sheet count belong to different dates by design, and that is
    // exactly the pair §3.8.2 wants compared.
    const rows = doc.facts?.[spec.ref.ns]?.[spec.ref.tag]?.units?.[entry.unit];
    if (!rows || rows.length === 0) continue;
    let latest = rows[0];
    for (const row of rows) {
      if (Date.parse(row.end) > Date.parse(latest.end)) latest = row;
    }
    out.push({
      where: spec.where,
      value: latest.val,
      toleranceFraction: spec.toleranceFraction,
    });
  }
  return out.length > 0 ? out : undefined;
}
