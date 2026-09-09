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
// SIZING THE EV DOUBLE-COUNT. A report, not a fix.
//
//   npx tsx scripts/analyzer/ev-double-count-sizing.ts
//   npx tsx scripts/analyzer/ev-double-count-sizing.ts --offline
//
// The §3.5 bridge in modules/enterpriseValue.ts computes
//
//   EV = marketCap + totalDebt + financeLeaseLiabilities − cash − nonOperating
//
// and `docs/lease-once-measurement.md` established that for at least one filer
// the figure `total-debt` acquires ALREADY CONTAINS that filer's finance lease.
// Where it does, the bridge adds the lease twice.
//
// THE ERROR IS EXACTLY THE NESTED LEASE AMOUNT, and that is why this script can
// size it without a price: the two lease terms are both additive, so the
// overstatement is the lease itself and marketCap cancels out of the
// difference. A price is needed only to express the error as a FRACTION of EV,
// and where no price is recorded this script says so instead of supplying one.
//
// TWO CONDITIONS make a company affected TODAY, and both are checked:
//
//   1. the lease is nested inside what `total-debt` resolved, AND
//   2. `finance-lease-liabilities` actually RESOLVES — because where it does
//      not, that REQUIRED input is missing and the bridge returns INCOMPLETE
//      (§5.2) rather than a number, so there is no EV for the defect to be
//      wrong by. A filer whose debt total quietly includes leases but which
//      tags no lease element adds nothing twice.
//
// This script rules NOTHING about how nesting should be determined for a filer
// that tags no combined element. That half is with CalFinance. Companies it
// cannot settle are reported as UNDETERMINED and counted in neither direction.
// ---------------------------------------------------------------------------

const OUT_DIR = join(".evidence", "ev-double-count");

const COMBINED = "LongTermDebtAndCapitalLeaseObligations";
const COMBINED_CURRENT = "LongTermDebtAndCapitalLeaseObligationsCurrent";

const ELIGIBLE_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F"]);

/**
 * Nesting determinations that came from reading the filing's own lease note.
 *
 * RECORDED, NOT DERIVED — and separated from the tag tests for that reason. A
 * verdict a human read out of a note must not be presentable as something the
 * tags established, so each carries the accession it was read from and this
 * script prints it as a note-read rather than folding it into the arithmetic.
 *
 * These are the filers whose tags could not settle the question and whose notes
 * did. None contributes to the sized total: all came back EXCLUDED.
 */
const NOTE_READ_VERDICTS: Record<string, { verdict: "EXCLUDED" | "NESTED"; accession: string; quote: string }> = {
  OKLO: {
    verdict: "EXCLUDED",
    accession: "0001628280-26-054571",
    quote: "Finance lease liability of $187 is included within other liabilities on the condensed consolidated balance sheets.",
  },
  RIVN: {
    verdict: "EXCLUDED",
    accession: "0001874178-26-000054",
    quote: "Balance sheet presents Long-term debt and Non-current lease liabilities as two separate lines.",
  },
  COST: {
    verdict: "EXCLUDED",
    accession: "0000909832-25-000101",
    quote:
      "Lease note, footnote (3) on long-term finance lease liabilities of $1,401: " +
      "\"Included in other long-term liabilities in the consolidated balance sheets.\" " +
      "Footnote (2), on the current portion: \"Included in other current liabilities.\" " +
      "Neither sits in Long-term debt, excluding current portion.",
  },
};

type Verdict = "NOTHING TO NEST" | "EXCLUDED" | "NESTED" | "UNDETERMINED";

interface Row {
  ticker: string;
  totalDebt: number | null;
  financeLease: number | null;
  cash: number | null;
  verdict: Verdict;
  verdictSource: "tags" | "note-read" | "none";
  /** Dollars the bridge overstates EV by. Null where not affected or unknown. */
  overstatement: number | null;
  evCompletesToday: boolean;
  evBlockers: string[];
  leaseTagsFiled: string[];
  /** The bridge's two debt-side inputs came off different balance sheets. */
  dateMismatch: boolean;
  debtDate: string | null;
  leaseDate: string | null;
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

/**
 * Every us-gaap element this filer files whose name mentions a lease.
 *
 * The census exists so that "no finance lease reported" is a measured claim
 * rather than the absence of the three elements this code happens to look at.
 * A filer carrying its finance lease under an element nobody thought to check
 * would otherwise read as unaffected.
 */
function leaseTagsFiled(doc: CompanyFactsDocument): string[] {
  const tags = Object.keys(doc.facts?.["us-gaap"] ?? {});
  return tags.filter((t) => /Lease/i.test(t)).sort();
}

function financeLeaseAt(doc: CompanyFactsDocument, at: string) {
  const total = instantAt(doc, "FinanceLeaseLiability", at);
  if (total !== null) return { value: total.val, via: "FinanceLeaseLiability" };
  const current = instantAt(doc, "FinanceLeaseLiabilityCurrent", at);
  const noncurrent = instantAt(doc, "FinanceLeaseLiabilityNoncurrent", at);
  if (current === null && noncurrent === null) return null;
  return {
    value: (current?.val ?? 0) + (noncurrent?.val ?? 0),
    via: [current && "FinanceLeaseLiabilityCurrent", noncurrent && "FinanceLeaseLiabilityNoncurrent"]
      .filter(Boolean)
      .join(" + "),
  };
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

function recordedPrices(): Record<string, { close: number; date: string }> {
  const path = join("lib", "analyzer", "acquisition", "captures", "prices.json");
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const out: Record<string, { close: number; date: string }> = {};
  for (const [k, v] of Object.entries<{ close: number; date: string }>(raw)) {
    if (k.startsWith("__")) continue;
    out[k] = { close: v.close, date: v.date };
  }
  return out;
}

const usd = (n: number | null) =>
  n === null ? "—" : `$${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const prices = recordedPrices();
  const rows: Row[] = [];
  const lines: string[] = [];

  lines.push("CALBOARD — EV DOUBLE-COUNT SIZING");
  lines.push(`Ran:             ${new Date().toISOString()}`);
  lines.push(`Mapping version: ${TAG_MAPPING_VERSION}  (unchanged by this script)`);
  lines.push(`Source:          ${offline ? "captures" : "live EDGAR"}`);
  lines.push("");
  lines.push("How much does the §3.5 EV bridge overstate enterprise value TODAY, because it");
  lines.push("adds finance leases that the total-debt figure already contains? A report. No");
  lines.push("fix, no mapping change, no ruling on undetermined filers.");
  lines.push("");

  const debtEntry = tagMapEntry("total-debt");
  const leaseEntry = tagMapEntry("finance-lease-liabilities");
  const cashEntry = tagMapEntry("cash-and-marketable-debt-securities");
  const sharesEntry = tagMapEntry("shares-outstanding");
  const dilutionEntry = tagMapEntry("treasury-method-dilution");
  if (!debtEntry || !leaseEntry || !cashEntry || !sharesEntry || !dilutionEntry) {
    throw new Error("an EV input is missing from the mapping");
  }

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
    const debt = resolveEntry(doc, debtEntry);
    const lease = resolveEntry(doc, leaseEntry);
    const cash = resolveEntry(doc, cashEntry);
    const shares = resolveEntry(doc, sharesEntry);
    const dilution = resolveEntry(doc, dilutionEntry);

    // Which of the seven REQUIRED EV inputs are missing today (§4.2).
    const blockers: string[] = [];
    if (shares.outcome !== "RESOLVED") blockers.push("shares outstanding");
    if (dilution.outcome !== "RESOLVED") blockers.push("treasury-method dilution");
    if (debt.outcome !== "RESOLVED") blockers.push("total debt");
    if (lease.outcome !== "RESOLVED") blockers.push("finance lease liabilities");
    if (cash.outcome !== "RESOLVED") blockers.push("cash and marketable debt securities");
    if (prices[company.ticker] === undefined) blockers.push("price");
    // §4.4 judgment, never acquired by the mapping. Absent unless an analyst
    // recorded one for this company, which no calibration run does.
    blockers.push("non-operating equity investments (§4.4 judgment, unrecorded)");

    const leaseTags = leaseTagsFiled(doc);

    if (debt.outcome !== "RESOLVED") {
      rows.push({
        ticker: company.ticker,
        totalDebt: null,
        financeLease: null,
        cash: null,
        verdict: "UNDETERMINED",
        verdictSource: "none",
        overstatement: null,
        evCompletesToday: false,
        evBlockers: blockers,
        leaseTagsFiled: leaseTags,
        dateMismatch: false,
        debtDate: null,
        leaseDate: null,
      });
      lines.push(`${company.ticker} — ${loaded.companyName}`);
      lines.push(`   total-debt NOT ACQUIRED (${debt.outcome}) — no EV today, nothing to overstate`);
      lines.push("");
      continue;
    }

    const at = debt.value.asOfDate;
    const combined = instantAt(doc, COMBINED, at);
    const combinedCurrent = instantAt(doc, COMBINED_CURRENT, at);

    // The BRIDGE'S OWN inputs, not a probe of what the filer happens to tag at
    // the debt date. `NOTHING TO NEST` has to mean "the bridge adds no lease",
    // and that is a question about what `finance-lease-liabilities` RESOLVES —
    // Costco tags no finance lease at its debt date and resolves $1,479M at
    // an earlier one, so an instant-pinned probe called it unaffected while
    // the bridge was adding the lease all along.
    const leaseValue = lease.outcome === "RESOLVED" ? lease.value.value : null;
    const leaseDate = lease.outcome === "RESOLVED" ? lease.value.asOfDate : null;
    const dateMismatch = leaseDate !== null && leaseDate !== at;

    // Same-instant figures, for the arithmetic tests only. A test comparing
    // this period's debt against another period's lease would be answering a
    // different question, so where the lease is absent at the debt date the
    // arithmetic tests simply do not run.
    const leaseAtDebtDate = financeLeaseAt(doc, at);

    let verdict: Verdict;
    let verdictSource: Row["verdictSource"] = "tags";
    const noteRead = NOTE_READ_VERDICTS[company.ticker];
    if (leaseValue === null) {
      verdict = "NOTHING TO NEST";
    } else if (leaseValue > debt.value.value) {
      // Both figures here are the bridge's own inputs, which is what makes
      // this a statement about the bridge rather than about the filer.
      verdict = "EXCLUDED";
    } else if (
      combined !== null &&
      combinedCurrent !== null &&
      combined.val + combinedCurrent.val === debt.value.value
    ) {
      verdict = "NESTED";
    } else if (
      combined !== null &&
      leaseAtDebtDate !== null &&
      combined.val - debt.value.value === leaseAtDebtDate.value
    ) {
      verdict = "EXCLUDED";
    } else if (noteRead !== undefined) {
      verdict = noteRead.verdict;
      verdictSource = "note-read";
    } else {
      verdict = "UNDETERMINED";
      verdictSource = "none";
    }

    // Affected today needs BOTH: the lease nested inside what total-debt
    // resolved, and the lease input actually resolving so the bridge adds it a
    // second time.
    const overstatement = verdict === "NESTED" && leaseValue !== null ? leaseValue : null;

    rows.push({
      ticker: company.ticker,
      totalDebt: debt.value.value,
      financeLease: leaseValue,
      cash: cash.outcome === "RESOLVED" ? cash.value.value : null,
      verdict,
      verdictSource,
      overstatement,
      evCompletesToday: blockers.length === 0,
      evBlockers: blockers,
      leaseTagsFiled: leaseTags,
      dateMismatch,
      debtDate: at,
      leaseDate,
    });

    lines.push(`${company.ticker} — ${loaded.companyName}`);
    lines.push(`   total-debt            ${usd(debt.value.value)}  @${at} via ${debt.value.contributingTags[0].ref.tag}`);
    lines.push(`   finance-lease input   ${leaseValue !== null ? usd(leaseValue) : `NOT ACQUIRED (${lease.outcome})`}`);
    lines.push(`   cash input            ${cash.outcome === "RESOLVED" ? usd(cash.value.value) : `NOT ACQUIRED (${cash.outcome})`}`);
    lines.push(`   lease elements filed  ${leaseTags.length === 0 ? "none" : leaseTags.join(", ")}`);
    if (dateMismatch) {
      lines.push(`   *** MIXED DATES: debt struck @${at}, lease struck @${leaseDate} — the bridge`);
      lines.push(`       is combining two different balance sheets ***`);
    }
    lines.push(`   nesting verdict       ${verdict}${verdictSource === "note-read" ? "  (from the filing's lease note, not the tags)" : ""}`);
    if (verdictSource === "note-read") {
      const nr = NOTE_READ_VERDICTS[company.ticker];
      lines.push(`      read from ${nr.accession}: "${nr.quote}"`);
    }
    if (overstatement !== null) {
      const netDebt =
        cash.outcome === "RESOLVED"
          ? debt.value.value + (leaseValue ?? 0) - cash.value.value
          : null;
      lines.push(`   *** EV OVERSTATED BY ${usd(overstatement)} TODAY ***`);
      if (netDebt !== null && netDebt !== 0) {
        lines.push(`       as a share of the net-debt bridge (${usd(netDebt)}): ${((overstatement / netDebt) * 100).toFixed(2)}%`);
      }
      const price = prices[company.ticker];
      if (price === undefined) {
        lines.push(`       as a share of EV: NOT COMPUTED — no price is recorded for ${company.ticker},`);
        lines.push(`       and supplying one to make a percentage look complete is not available here.`);
      }
    } else if (verdict === "NESTED" && leaseValue === null) {
      lines.push(`   nested, but the finance-lease input does not resolve — the bridge adds`);
      lines.push(`   nothing a second time, and returns INCOMPLETE for the missing REQUIRED input`);
    }
    lines.push(`   EV completes today?   ${blockers.length === 0 ? "yes" : `no — missing: ${blockers.join("; ")}`}`);
    lines.push("");
  }

  const affected = rows.filter((r) => r.overstatement !== null);
  const undetermined = rows.filter((r) => r.verdict === "UNDETERMINED");

  lines.push("=".repeat(78));
  lines.push("ANSWER");
  lines.push("=".repeat(78));
  lines.push("");
  lines.push(`Affected today: ${affected.length === 0 ? "none" : affected.map((r) => `${r.ticker} (${usd(r.overstatement)})`).join(", ")}`);
  lines.push(`Total overstatement across the set: ${usd(affected.reduce((a, r) => a + (r.overstatement ?? 0), 0))}`);
  lines.push("");
  lines.push("Not affected, and why:");
  for (const r of rows.filter((r) => r.overstatement === null)) {
    const why =
      r.verdict === "NOTHING TO NEST"
        ? "finance-lease input does not resolve, so the bridge adds no lease at all"
        : r.verdict === "EXCLUDED"
          ? `lease is outside the debt total (${r.verdictSource === "note-read" ? "note-read" : "from tags"})`
          : "undetermined — counted in neither direction";
    lines.push(`   ${r.ticker.padEnd(6)} ${why}`);
  }
  lines.push("");
  if (undetermined.length > 0) {
    lines.push(`STILL UNDETERMINED: ${undetermined.map((r) => r.ticker).join(", ")}`);
    lines.push("These are not zero and not affected — they are unmeasured, and how to settle");
    lines.push("them is the half of the question that is with CalFinance.");
    lines.push("");
  }
  const mixed = rows.filter((r) => r.dateMismatch);
  if (mixed.length > 0) {
    lines.push("SEPARATE DEFECT FOUND WHILE SIZING THIS ONE — MIXED-DATE BRIDGE.");
    lines.push("Each mapping entry resolves to its own latest eligible row, and nothing");
    lines.push("requires the debt-side inputs to come off the SAME balance sheet:");
    for (const r of mixed) {
      lines.push(`   ${r.ticker.padEnd(6)} debt @${r.debtDate}  lease @${r.leaseDate}`);
    }
    lines.push("This is not the double-count, and ruling on nesting does not fix it. It is");
    lines.push("reported here because sizing the one exposed the other.");
    lines.push("");
  }
  lines.push("A NOTE ON WHAT 'TODAY' MEANS. The overstatement above is the arithmetic the");
  lines.push("bridge performs whenever it runs. It is reported separately from whether EV");
  lines.push("renders for a given company right now, because the two are different claims");
  lines.push("and the §4.4 non-operating-investments judgment is unrecorded for every");
  lines.push("company in this set — so no calibration EV completes regardless of this defect.");

  const text = lines.join("\n");
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "sizing.txt");
  writeFileSync(path, text, "utf8");
  console.log(text);
  console.log(`\nWritten to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
