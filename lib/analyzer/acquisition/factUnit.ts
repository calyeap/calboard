import { TAG_MAP } from "./tagMap";

// ---------------------------------------------------------------------------
// The unit a fact's value is in.
//
// WHERE THE UNIT ACTUALLY COMES FROM. For every tag-mapped fact it is the
// mapping's own `unit`, and it is not a description — it is ENFORCED at
// acquisition. selectTagged.resolveEntry reads `units[entry.unit]` out of the
// XBRL document and nothing else, so a fact resolved as USD came from the
// document's USD series or it did not resolve at all. The mapping is fixed and
// versioned, and every fact it produces records that version.
//
// So this is the acquired unit, not the render layer guessing at one.
//
// A KNOWN LIMIT, stated rather than buried: the unit is looked up by fact id
// against the mapping IN FORCE NOW, not against the mapping version recorded on
// the fact. Those are the same for any run this build can produce. If a future
// mapping version changes a unit, a fact acquired under the old one would be
// formatted under the new one — detectable, because `tagMappingVersion` is on
// the fact, but not currently detected. Carrying the unit on the record itself
// would close that, and is a candidate for the M8 amendment cycle; it is not
// done here because it would add a field to the §3.2 record, which is a spec
// change this dispatch explicitly routes elsewhere.
// ---------------------------------------------------------------------------

export type FactUnit = "USD" | "shares" | "pure";

/**
 * Facts that are not tag-mapped, and where their unit comes from.
 *
 * Each is constructed in acquire.ts, so its unit is a consequence of code in
 * this layer rather than of a filing — and it is declared HERE, once, so
 * acquire.ts and the display layer cannot disagree about it. acquire.ts reads
 * this table when it builds the cross-check inputs; before this existed the
 * same units were written out a second time there.
 */
const UNMAPPED_FACT_UNITS: Record<string, FactUnit> = {
  // A market quote, in the currency the provider quotes.
  price: "USD",
  // operating income / revenue — USD over USD, so a bare ratio.
  "current-operating-margin": "pure",
  // total debt + finance leases - cash. All three USD.
  "net-debt": "USD",
  // operating cash flow - capex. Both USD.
  "cash-fcf": "USD",
  // The diluted-EPS reconciliation companions, acquired for the §3.8.2
  // treasury-method-dilution rule.
  "weighted-average-diluted-shares": "shares",
  "weighted-average-basic-shares": "shares",
};

const MAPPED_FACT_UNITS: Record<string, FactUnit> = Object.fromEntries(
  TAG_MAP.map((entry) => [entry.factId, entry.unit])
);

/**
 * Null for a fact this build does not know the unit of.
 *
 * Null means "render the exact value as it stands" — an unknown unit must never
 * be guessed at, because a figure formatted under the wrong unit is wrong in a
 * way that looks entirely plausible.
 */
export function factUnit(factId: string): FactUnit | null {
  return MAPPED_FACT_UNITS[factId] ?? UNMAPPED_FACT_UNITS[factId] ?? null;
}
