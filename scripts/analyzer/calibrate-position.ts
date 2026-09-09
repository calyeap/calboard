import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument } from "../../lib/analyzer/acquisition/secClient";
import { acquire, type AcquisitionResult } from "../../lib/analyzer/acquisition/acquire";
import { analystInputsFor } from "../../lib/analyzer/acquisition/analystInputs";
import { annualSeries, operatingMarginSeries } from "../../lib/analyzer/acquisition/history";
import { TAG_MAP } from "../../lib/analyzer/acquisition/tagMap";
import { computeEnterpriseValue } from "../../lib/analyzer/modules/enterpriseValue";
import { computeReverseDcfGrid } from "../../lib/analyzer/modules/reverseDcf";
import { evaluateLeverage } from "../../lib/analyzer/gates";
import { activeProvider } from "../../lib/marketdata";
import { UNDEFINED_POLICY_CONSTANTS } from "../../lib/analyzer/policy";
import { CALIBRATION_SET, type CalibrationCompany } from "../../lib/analyzer/calibration/set";
import {
  achievedRevenueCagr,
  comparatorRecency,
  isUsable,
  priceLocationWithinRange,
  requiredGrowthCells,
  revenueSeries,
  type CalibrationObservation,
} from "../../lib/analyzer/calibration/inputs";
import type { FactRecord, SourcedValue } from "../../lib/analyzer/types";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// M8-c — the valuation-position calibration run.
//
//   npx tsx scripts/analyzer/calibrate-position.ts
//   npx tsx scripts/analyzer/calibrate-position.ts --offline    (captures only)
//
// Computes §10.6.2's two deterministic inputs on every company in
// CALIBRATION_SET, from real filings, and writes one report saying — per
// company — what came back and what blocked it.
//
// WHAT THIS SCRIPT DOES NOT DO, and must not be extended to do:
//
//   - It chooses no thresholds and writes no cut-point into `policy`.
//   - It classifies nothing. No CHEAP / FAIR / EXPENSIVE appears in its
//     output, because the classification is what a ruled threshold produces.
//   - It supplies no missing input. Where §4.4's judgment is unmade or Step 7's
//     scenarios were never authored, the company is reported blocked. Filling
//     either in to keep a company in the set would put a number with no author
//     into the evidence a threshold is ruled from, which is the Appendix B
//     failure the milestone exists to avoid repeating.
//
// It also runs an explicitly-labelled COUNTERFACTUAL pass, which produces no
// calibration observation and is reported in its own section: with the §4.4
// judgment resolved and the NOPAT tax rate set, how much further does each
// company get? That answers "what would unblock this" without pretending the
// unblocked figures are observations.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "m8c-calibration");

// The counterfactual's two settings. NEITHER IS A POLICY VALUE and neither is
// written anywhere but this file: 0.20 is the rate the recovered MSFT
// reference grid is consistent with (see reverseDcf.ts's header), used here
// only to see whether the grid would solve at all, and the §4.4 resolution
// takes every tagged candidate as non-operating, which is the analyst's call
// and not the software's.
const COUNTERFACTUAL_NOPAT_TAX_RATE = new Decimal("0.2");

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

function sourcedFrom(fact: FactRecord | undefined): SourcedValue<Decimal> | null {
  if (fact === undefined || fact.value === null) return null;
  const value = fact.value instanceof Decimal ? fact.value : new Decimal(String(fact.value));
  return {
    value,
    provenance: {
      sourceClass: fact.sourceClass,
      extractionType: fact.extractionType,
      verificationState: fact.verificationState,
    },
  };
}

interface CompanyRun {
  company: CalibrationCompany;
  loaded: Loaded;
  acquisition: AcquisitionResult;
  observation: CalibrationObservation;
  /** The counterfactual pass — reported, never an observation. */
  counterfactual: { evSolved: boolean; cellsSolved: number; note: string };
  /** Tag-mapping gaps seen on this company. REPORTED, never fixed here. */
  mappingGaps: string[];
}

/**
 * A real quote from the configured provider, or null.
 *
 * Acquired, never invented. A price is the one input price location cannot be
 * computed without, so a run that could not get one has to say so rather than
 * substitute a plausible number — and the report must be able to tell a
 * missing feed apart from a missing scenario range, which are different
 * failures with different fixes.
 */
async function fetchPrice(ticker: string): Promise<{ value: Decimal; timestamp: string; source: string } | null> {
  try {
    const provider = activeProvider();
    const point = await provider.fetchLatestEod(ticker, "equity");
    return { value: new Decimal(point.adjustedClose), timestamp: point.date, source: provider.sourceName };
  } catch {
    return null;
  }
}

/**
 * The ten-year median operating margin, built the same way companyInputs.ts
 * builds it — from the single-tag revenue and operating-income series. Present
 * here so the harness does not report a blocker of its own making: passing
 * null would have the report blame `medianMargin` on every company when the
 * real run computes it.
 */
function medianMargin(doc: CompanyFactsDocument): SourcedValue<Decimal> | null {
  const operatingIncomeTags = TAG_MAP.find((e) => e.factId === "operating-income")?.candidates;
  if (operatingIncomeTags === undefined) return null;
  const series = operatingMarginSeries(revenueSeries(doc), annualSeries(doc, operatingIncomeTags));
  const values = (series?.years ?? []).map((y) => new Decimal(y.margin)).sort((a, b) => a.comparedTo(b));
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  const value = values.length % 2 === 1 ? values[mid] : values[mid - 1].plus(values[mid]).dividedBy(2);
  return {
    value,
    provenance: { sourceClass: "PRIMARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "SPOT-CHECK PENDING" },
  };
}

async function runOne(company: CalibrationCompany, offline: boolean): Promise<CompanyRun> {
  const loaded = offline ? loadCapture(company.ticker) : await loadLive(company.ticker);
  const price = offline ? null : await fetchPrice(company.ticker);

  const acquisition = acquire({
    ticker: company.ticker.toUpperCase(),
    cik: loaded.cik,
    companyName: loaded.companyName,
    companyFacts: loaded.companyFacts,
    price,
  });

  const byId = new Map(acquisition.facts.map((f) => [f.id, f]));
  const get = (id: string) => sourcedFrom(byId.get(id));

  // --- what the tag mapping did and did not reach on this filer ------------
  const mappingGaps: string[] = [];
  for (const id of ["total-debt", "finance-lease-liabilities", "cash-and-marketable-debt-securities", "treasury-method-dilution", "shares-outstanding", "current-revenue", "operating-income"]) {
    if (get(id) === null) mappingGaps.push(id);
  }

  // --- Input A — price location --------------------------------------------
  const bundle = analystInputsFor(company.ticker);

  // EV first: leverage is computed against it, and a suppressed leverage gate
  // suppresses the range, which is what removes the price-location input.
  const ev = computeEnterpriseValue({
    sharesOutstanding: get("shares-outstanding"),
    treasuryMethodDilution: get("treasury-method-dilution"),
    price: get("price"),
    totalDebt: get("total-debt"),
    financeLeaseLiabilities: get("finance-lease-liabilities"),
    cashAndMarketableDebtSecurities: get("cash-and-marketable-debt-securities"),
    // §4.4 is a judgment, not a tagged line. Null is the honest value on a run
    // no analyst has classified, and it is left null deliberately.
    nonOperatingEquityInvestmentsAtBook: null,
    nonOperatingInvestmentsErrorDirection: null,
  });

  const leverage = evaluateLeverage({
    totalDebt: get("total-debt")?.value ?? null,
    financeLeaseLiabilities: get("finance-lease-liabilities")?.value ?? null,
    cashAndMarketableDebtSecurities: get("cash-and-marketable-debt-securities")?.value ?? null,
    enterpriseValue: ev.suppressed ? null : ev.value.enterpriseValue,
    operatingLeaseLiabilities: get("operating-lease-liabilities")?.value ?? null,
    leveredResidualExceptionApplies: false,
  });

  const priceLocation = priceLocationWithinRange({
    scenarioValues: bundle?.inputs.scenarioValues ?? null,
    currentPrice: price?.value ?? null,
    rangeSuppressedBy: leverage.result === "PASS" ? null : leverage.result,
  });

  // --- Input B — required versus achieved ----------------------------------
  const series = revenueSeries(loaded.companyFacts);
  // How far this filer has reported, and whether a live series sat unread
  // beside the chosen one. Without it a comparator cannot be computed at all
  // (defect D): the M8-c run returned NVDA at 31.25% over a window that ended
  // four years before the price, and said nothing.
  const recency =
    series === null
      ? { currentFiscalYear: 0, reachedBy: null }
      : comparatorRecency(loaded.companyFacts, series);
  const achievedTenYear = achievedRevenueCagr(series, 10, recency);
  const achievedFiveYear = achievedRevenueCagr(series, 5, recency);

  const grid = computeReverseDcfGrid({
    baseYearRevenue: get("current-revenue"),
    targetEnterpriseValue: ev.suppressed ? null : { value: ev.value.enterpriseValue, provenance: ev.qualification.provenanceTokens },
    currentMargin: get("current-operating-margin"),
    medianMargin: medianMargin(loaded.companyFacts),
    gate1State: null,
    // RONIC is not acquired in this mapping version — companyInputs.ts holds
    // both five-year deltas at null — so the ladder has no cells at all.
    ronicCells: [],
    lagBiasDirection: "conservative",
    configuredStressMarginLevel: UNDEFINED_POLICY_CONSTANTS.stressMarginLevel,
    configuredNopatTaxRate: UNDEFINED_POLICY_CONSTANTS.nopatTaxRate,
  });
  const required = requiredGrowthCells(grid);

  const partial = { ticker: company.ticker, shape: company.shape, priceLocation, achievedTenYear, achievedFiveYear, required };
  const observation: CalibrationObservation = { ...partial, usable: isUsable(partial) };

  // --- the counterfactual, labelled ----------------------------------------
  const candidateTotal = acquisition.candidateNonOperatingInvestments.reduce((a, c) => a.plus(c.value), new Decimal(0));
  const evCf = computeEnterpriseValue({
    sharesOutstanding: get("shares-outstanding"),
    treasuryMethodDilution: get("treasury-method-dilution"),
    price: { value: new Decimal(1), provenance: { sourceClass: "SECONDARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "SPOT-CHECK PENDING" } },
    totalDebt: get("total-debt"),
    financeLeaseLiabilities: get("finance-lease-liabilities"),
    cashAndMarketableDebtSecurities: get("cash-and-marketable-debt-securities"),
    nonOperatingEquityInvestmentsAtBook: {
      value: candidateTotal,
      provenance: { sourceClass: "PRIMARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "SPOT-CHECK PENDING" },
    },
    nonOperatingInvestmentsErrorDirection: "understates",
  });
  const gridCf = computeReverseDcfGrid({
    baseYearRevenue: get("current-revenue"),
    targetEnterpriseValue: evCf.suppressed ? null : { value: evCf.value.enterpriseValue, provenance: evCf.qualification.provenanceTokens },
    currentMargin: get("current-operating-margin"),
    medianMargin: medianMargin(loaded.companyFacts),
    gate1State: null,
    ronicCells: [],
    lagBiasDirection: "conservative",
    configuredStressMarginLevel: null,
    configuredNopatTaxRate: COUNTERFACTUAL_NOPAT_TAX_RATE,
  });
  const cellsSolvedCf = gridCf.filter((c) => !c.fiveYearGrowth.suppressed).length;

  return {
    company,
    loaded,
    acquisition,
    observation,
    counterfactual: {
      evSolved: !evCf.suppressed,
      cellsSolved: cellsSolvedCf,
      note: evCf.suppressed
        ? `EV still INCOMPLETE with §4.4 resolved: ${evCf.cause}`
        : `EV computes with §4.4 resolved; reverse-DCF cells solved: ${cellsSolvedCf}/9`,
    },
    mappingGaps,
  };
}

function loadCapture(ticker: string): Loaded {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
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

function pct(value: Decimal): string {
  return `${value.mul(100).toFixed(2)}%`;
}

function report(runs: CompanyRun[], failures: { ticker: string; error: string }[]): string {
  const lines: string[] = [];
  const usable = runs.filter((r) => r.observation.usable);

  lines.push("CALBOARD M8-c — VALUATION-POSITION CALIBRATION RUN");
  lines.push(`Ran:      ${new Date().toISOString()}`);
  lines.push(`Set:      ${CALIBRATION_SET.length} companies`);
  lines.push(`Usable:   ${usable.length} (both §10.6.2 inputs present)`);
  lines.push(`Blocked:  ${runs.length - usable.length} acquired but missing an input`);
  lines.push(`Errored:  ${failures.length} could not be acquired at all`);
  lines.push("");
  lines.push("A company is USABLE only where BOTH inputs are present. §10.6.2 requires");
  lines.push("positive agreement from both, so one input alone contributes no observation.");
  lines.push("");

  lines.push("=".repeat(72));
  lines.push("PER COMPANY");
  lines.push("=".repeat(72));

  for (const run of runs) {
    const o = run.observation;
    lines.push("");
    lines.push(`${o.ticker} — ${o.shape}`);
    lines.push(`  source: ${run.loaded.provenance}`);
    lines.push(`  facts acquired: ${run.acquisition.facts.length}, mapping version ${run.acquisition.tagMappingVersion}`);
    lines.push(`  USABLE FOR CALIBRATION: ${o.usable ? "YES" : "NO"}`);

    lines.push("  INPUT A — price location within the scenario range:");
    if (o.priceLocation.value !== null) {
      lines.push(`      ${pct(o.priceLocation.value)} of the way from bear to bull`);
    } else {
      for (const reason of o.priceLocation.blockedBy) lines.push(`      BLOCKED: ${reason}`);
    }

    lines.push("  INPUT B — required versus achieved growth:");
    lines.push("    achieved (the §10.6.2 comparator fact):");
    for (const [label, input] of [["10-year", o.achievedTenYear], ["5-year", o.achievedFiveYear]] as const) {
      if (input.value !== null) {
        const a = input.value;
        lines.push(
          `      ${label} revenue CAGR ${pct(a.cagr)}  [${a.tag}, FY${a.window.fromFiscalYear}→FY${a.window.toFiscalYear}]`
        );
        // The window never travels separately from the figure it belongs to.
        if (a.staleWindowDisclosure !== null) {
          lines.push(`        STALE WINDOW: ${a.staleWindowDisclosure}`);
        }
      } else {
        for (const reason of input.blockedBy) lines.push(`      ${label} BLOCKED: ${reason}`);
      }
    }
    lines.push("    required (M7 implied growth, all nine cells):");
    if (o.required.value !== null) {
      for (const cell of o.required.value) {
        lines.push(`      ${cell.marginLevel}@${cell.rate}: 5yr ${pct(cell.fiveYearGrowth)}, 10yr CAGR ${pct(cell.tenYearCagr)}`);
      }
    } else {
      for (const reason of o.required.blockedBy) lines.push(`      BLOCKED: ${reason}`);
    }

    if (run.mappingGaps.length > 0) {
      lines.push(`  TAG-MAPPING GAPS (reported, not fixed — bumping the mapping puts every`);
      lines.push(`  previously acquired fact under §3.8.1 review, which Command Center rules):`);
      for (const gap of run.mappingGaps) lines.push(`      no tagged value reached for: ${gap}`);
    }

    lines.push(`  COUNTERFACTUAL (no observation): ${run.counterfactual.note}`);
  }

  if (failures.length > 0) {
    lines.push("");
    lines.push("=".repeat(72));
    lines.push("COULD NOT BE ACQUIRED");
    lines.push("=".repeat(72));
    for (const f of failures) lines.push(`  ${f.ticker}: ${f.error}`);
  }

  lines.push("");
  lines.push("=".repeat(72));
  lines.push("THRESHOLDS");
  lines.push("=".repeat(72));
  lines.push("None. This run computes inputs and does not choose cut-points; no policy");
  lines.push("constant was written and the position renderer remains disabled.");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const runs: CompanyRun[] = [];
  const failures: { ticker: string; error: string }[] = [];

  for (const company of CALIBRATION_SET) {
    try {
      runs.push(await runOne(company, offline));
      console.log(`${company.ticker}: acquired`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ ticker: company.ticker, error });
      console.log(`${company.ticker}: FAILED — ${error}`);
    }
  }

  const text = report(runs, failures);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "calibration-report.txt");
  writeFileSync(path, text, "utf8");

  const usable = runs.filter((r) => r.observation.usable).length;
  console.log("");
  console.log(`Usable for calibration: ${usable} of ${CALIBRATION_SET.length}`);
  console.log(`  -> ${path}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
