import Decimal from "decimal.js";
import { config } from "dotenv";
import { secClientFromEnv, cikForTicker } from "../../lib/analyzer/acquisition/secClient";
import type { CompanyFactsDocument } from "../../lib/analyzer/acquisition/secClient";
import { acquire } from "../../lib/analyzer/acquisition/acquire";
import { annualSeries, operatingMarginSeries } from "../../lib/analyzer/acquisition/history";
import { TAG_MAP } from "../../lib/analyzer/acquisition/tagMap";
import { computeEnterpriseValue } from "../../lib/analyzer/modules/enterpriseValue";
import { computeReverseDcfGrid } from "../../lib/analyzer/modules/reverseDcf";
import { computeReinvestmentRonic } from "../../lib/analyzer/modules/reinvestmentRonic";
import { activeProvider } from "../../lib/marketdata";
import { revenueSeries } from "../../lib/analyzer/calibration/inputs";
import type { DiscountRate, FactRecord, SourcedValue } from "../../lib/analyzer/types";

config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// The M8-c gate check, run BEFORE any scenario work.
//
//   npx tsx scripts/analyzer/check-reverse-dcf.ts
//
// One question: with §4.4's non-operating-investments judgment supplied and
// the NOPAT tax rate set, do M7's nine reverse-DCF cells solve for MSFT and
// NVDA? If they do not, §10.6.2's Input B is unavailable and no company can
// produce a valuation position, whatever scenarios an analyst authors.
//
// The check is staged so the ANSWER AND ITS CAUSE are separable, because
// "0 of 9" on its own does not say what to fix:
//
//   Stage 1  as the run stands today
//   Stage 2  + §4.4 resolved                (EV computes)
//   Stage 3  + NOPAT tax rate set           (margin rows resolve)
//   Stage 4  + RONIC supplied as a PROBE    (isolates the last dependency)
//
// EVERY STAGE AFTER 1 IS A COUNTERFACTUAL AND PRODUCES NO OBSERVATION. Stage
// 4's RONIC is an arbitrary probe value, not a measurement and not a derived
// one: its only purpose is to answer "is RONIC the last thing missing, or is
// something else missing behind it?" — a question about the dependency graph,
// which a probe answers and a real figure would not answer any better. No
// solved growth rate from stage 4 is reported as a number, precisely so it
// cannot be mistaken for one.
//
// WHAT THIS SCRIPT MUST NOT BE EXTENDED TO DO: define invested capital. The
// missing half of RONIC is the trailing five-year change in invested capital,
// and no frozen artefact defines what invested capital is — the spec (§7.2 M5)
// and calboard-valuation-methodology.md (§3.3) both name it as a REQUIRED
// input with one qualifier ("including lease-funded assets") and no
// construction, and calfinance-methodology-v2.md does not mention it at all.
// Supplying a formula here would be inventing methodology inside a
// calculation, which is what stopped the previous pass.
// ---------------------------------------------------------------------------

const TICKERS = ["MSFT", "NVDA"];

// Not a policy value and written nowhere but this file: the rate the recovered
// MSFT reference grid is consistent with (see reverseDcf.ts's header).
const COUNTERFACTUAL_NOPAT_TAX_RATE = new Decimal("0.2");

// An arbitrary probe. NOT a measurement, NOT derived from any filing, and
// deliberately a round number so it cannot be mistaken for a computed RONIC.
// Stage 4 reports only whether cells solve, never what they solved to.
const PROBE_RONIC = new Decimal("0.178");

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

function probeRonicCells(value: Decimal | null) {
  return ([0.08, 0.1, 0.12] as DiscountRate[]).map((rate) => ({
    rate,
    state: (value === null ? "RONIC NOT MEANINGFUL" : "CLEAN") as "RONIC NOT MEANINGFUL" | "CLEAN",
    value,
  }));
}

/**
 * The five-year change in NOPAT, from the operating-income series and a NOPAT
 * tax rate. Reported to show WHICH HALF of RONIC is actually missing: this
 * half is mechanical once a tax rate exists, the other half is not defined
 * anywhere.
 */
function fiveYearDeltaNopat(doc: CompanyFactsDocument, taxRate: Decimal): { value: Decimal; window: string } | string {
  const tags = TAG_MAP.find((e) => e.factId === "operating-income")?.candidates;
  if (tags === undefined) return "operating-income is missing from the tag mapping";
  const series = annualSeries(doc, tags);
  if (series === null) return "no single-tag annual operating-income series";
  const obs = series.observations;
  if (obs.length === 0) return `${series.tag} carries no annual observations`;
  const to = obs[obs.length - 1];
  const from = obs.find((o) => o.fiscalYear === to.fiscalYear - 5);
  if (from === undefined) return `${series.tag} carries no FY${to.fiscalYear - 5} observation`;
  const afterTax = new Decimal(1).minus(taxRate);
  return {
    value: new Decimal(to.value).mul(afterTax).minus(new Decimal(from.value).mul(afterTax)),
    window: `${series.tag}, FY${from.fiscalYear}→FY${to.fiscalYear}`,
  };
}

async function main(): Promise<void> {
  const client = secClientFromEnv();
  const directory = await client.companyTickers();

  console.log("CALBOARD M8-c — REVERSE-DCF GATE CHECK");
  console.log(`Ran: ${new Date().toISOString()}`);
  console.log("");
  console.log("Question: with §4.4 supplied, do M7's nine cells solve for MSFT and NVDA?");
  console.log("Stages 2-4 are COUNTERFACTUAL and produce no observation.");
  console.log("");

  for (const ticker of TICKERS) {
    const found = cikForTicker(directory, ticker);
    if (found === null) {
      console.log(`${ticker}: not in the SEC ticker directory`);
      continue;
    }
    const companyFacts = await client.companyFacts(found.cik);

    let price: { value: Decimal; timestamp: string; source: string } | null = null;
    try {
      const point = await activeProvider().fetchLatestEod(ticker, "equity");
      price = { value: new Decimal(point.adjustedClose), timestamp: point.date, source: activeProvider().sourceName };
    } catch (err) {
      price = null;
    }

    const acquisition = acquire({
      ticker,
      cik: found.cik,
      companyName: found.title,
      companyFacts,
      price,
    });
    const byId = new Map(acquisition.facts.map((f) => [f.id, f]));
    const get = (id: string) => sourcedFrom(byId.get(id));

    console.log("=".repeat(72));
    console.log(`${ticker} — ${found.title} (CIK ${found.cik})`);
    console.log(`  mapping ${acquisition.tagMappingVersion}, ${acquisition.facts.length} facts`);
    console.log(`  price: ${price === null ? "UNAVAILABLE" : `${price.value.toFixed(2)} (${price.source}, ${price.timestamp})`}`);

    const evBase = {
      sharesOutstanding: get("shares-outstanding"),
      treasuryMethodDilution: get("treasury-method-dilution"),
      price: get("price"),
      totalDebt: get("total-debt"),
      financeLeaseLiabilities: get("finance-lease-liabilities"),
      cashAndMarketableDebtSecurities: get("cash-and-marketable-debt-securities"),
    };

    // Stage 1 — as the run stands: §4.4 unmade, tax rate unset.
    const ev1 = computeEnterpriseValue({
      ...evBase,
      nonOperatingEquityInvestmentsAtBook: null,
      nonOperatingInvestmentsErrorDirection: null,
    });

    // Stages 2-4 — §4.4 resolved by taking every tagged candidate as
    // non-operating. That is the analyst's call, made here only to see how far
    // the calculation gets.
    const candidateTotal = acquisition.candidateNonOperatingInvestments.reduce((a, c) => a.plus(c.value), new Decimal(0));
    const ev2 = computeEnterpriseValue({
      ...evBase,
      nonOperatingEquityInvestmentsAtBook: {
        value: candidateTotal,
        provenance: { sourceClass: "PRIMARY", extractionType: "DETERMINISTIC/STRUCTURED", verificationState: "SPOT-CHECK PENDING" },
      },
      nonOperatingInvestmentsErrorDirection: "understates",
    });

    const target = ev2.suppressed ? null : { value: ev2.value.enterpriseValue, provenance: ev2.qualification.provenanceTokens };

    const gridFor = (taxRate: Decimal | null, ronic: Decimal | null) =>
      computeReverseDcfGrid({
        baseYearRevenue: get("current-revenue"),
        targetEnterpriseValue: target,
        currentMargin: get("current-operating-margin"),
        medianMargin: medianMargin(companyFacts),
        gate1State: null,
        ronicCells: probeRonicCells(ronic),
        lagBiasDirection: "conservative",
        configuredStressMarginLevel: null,
        configuredNopatTaxRate: taxRate,
      });

    const solved = (grid: ReturnType<typeof gridFor>) => grid.filter((c) => !c.fiveYearGrowth.suppressed).length;
    const firstCause = (grid: ReturnType<typeof gridFor>) => {
      const cell = grid.find((c) => c.fiveYearGrowth.suppressed);
      if (cell === undefined || !cell.fiveYearGrowth.suppressed) return "none";
      return `${cell.fiveYearGrowth.state} — ${cell.fiveYearGrowth.cause}`;
    };

    // The real RONIC path, unchanged: what the acquisition actually supplies.
    const realRonic = computeReinvestmentRonic(
      {
        capex: get("capex"),
        acquisitions: null,
        financeLeaseRouAdditions: get("finance-lease-rou-additions"),
        depreciationAndAmortization: get("depreciation-and-amortisation"),
        deltaNwc: null,
        deltaRevenue: null,
      },
      { fiveYearDeltaNopat: null, fiveYearDeltaInvestedCapital: null, lagBiasDirection: "conservative" }
    );

    const grid1 = gridFor(null, null);
    const grid3 = gridFor(COUNTERFACTUAL_NOPAT_TAX_RATE, null);
    const grid4 = gridFor(COUNTERFACTUAL_NOPAT_TAX_RATE, PROBE_RONIC);

    console.log("");
    console.log("  STAGE 1 — as the run stands today");
    console.log(`     enterprise value: ${ev1.suppressed ? `${ev1.state} — ${ev1.cause}` : ev1.value.enterpriseValue.toFixed(0)}`);
    console.log(`     cells solved: ${solved(grid1)}/9`);
    console.log(`     cause: ${firstCause(grid1)}`);

    console.log("");
    console.log("  STAGE 2 — COUNTERFACTUAL: §4.4 resolved");
    console.log(`     candidate non-operating investments: ${acquisition.candidateNonOperatingInvestments.length}, total ${candidateTotal.toFixed(0)}`);
    console.log(`     enterprise value: ${ev2.suppressed ? `${ev2.state} — ${ev2.cause}` : ev2.value.enterpriseValue.toFixed(0)}`);

    console.log("");
    console.log("  STAGE 3 — COUNTERFACTUAL: §4.4 resolved + NOPAT tax rate 0.20");
    console.log(`     cells solved: ${solved(grid3)}/9`);
    console.log(`     cause: ${firstCause(grid3)}`);

    console.log("");
    console.log("  STAGE 4 — COUNTERFACTUAL PROBE: the above + a RONIC value supplied");
    console.log(`     cells solved: ${solved(grid4)}/9`);
    console.log(`     cause: ${firstCause(grid4)}`);
    console.log("     (values withheld deliberately — this stage answers a dependency");
    console.log("      question, and its RONIC is an arbitrary probe, not a measurement)");

    console.log("");
    console.log("  WHAT RONIC ACTUALLY NEEDS — the two halves, separately");
    console.log(`     ladder as acquired: ${realRonic.ronic.suppressed ? `${realRonic.ronic.state} — ${realRonic.ronic.cause}` : "computed"}`);
    const dNopat = fiveYearDeltaNopat(companyFacts, COUNTERFACTUAL_NOPAT_TAX_RATE);
    if (typeof dNopat === "string") {
      console.log(`     five-year ΔNOPAT: BLOCKED — ${dNopat}`);
    } else {
      console.log(`     five-year ΔNOPAT: ${dNopat.value.toFixed(0)} [${dNopat.window}] — mechanical once a tax rate exists`);
    }
    console.log("     five-year Δinvested capital: UNDEFINED — no frozen artefact defines");
    console.log("       invested capital. Not computed here; defining it would be inventing");
    console.log("       methodology inside a calculation.");
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
