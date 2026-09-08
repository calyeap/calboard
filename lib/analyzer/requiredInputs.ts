// ---------------------------------------------------------------------------
// §4 — REQUIRED vs OPTIONAL, per output.
//
// §4.1 is explicit about the shape: "A field is REQUIRED *for a given output*.
// ... The software holds a dependency map from each output to its required
// inputs, and evaluates completeness per output. Implementing this as a single
// global 'required fields' list will produce either false INCOMPLETEs or false
// completeness. It must be a map."
//
// This file is that map, transcribed from the §4.2 table. It computes nothing
// and decides nothing beyond which outputs have lost a REQUIRED input.
// ---------------------------------------------------------------------------

export interface OutputGroup {
  id: string;
  /** The §4.2 row label, so the map can be read against the spec line by line. */
  label: string;
  requires: string[];
}

/**
 * §4.2, in order. Fact ids match the acquisition layer's own ids.
 *
 * Where a §4.2 row names an input this milestone does not yet acquire (the
 * ten-year history series, the analyst's policy constants, the pre-revenue
 * engineering inputs), the id appears anyway. Leaving it out would make the
 * map claim completeness it has not established, which is the "false
 * completeness" §4.1 names.
 */
export const OUTPUT_GROUPS: readonly OutputGroup[] = [
  {
    id: "enterprise-value",
    label: "Enterprise value and every EV-based multiple",
    requires: [
      "shares-outstanding",
      "treasury-method-dilution",
      "price",
      "total-debt",
      "finance-lease-liabilities",
      "cash-and-marketable-debt-securities",
      "non-operating-equity-investments",
    ],
  },
  {
    id: "leverage-precondition",
    label: "Leverage precondition test",
    requires: [
      "total-debt",
      "finance-lease-liabilities",
      "cash-and-marketable-debt-securities",
      "enterprise-value",
    ],
  },
  {
    id: "gate-0",
    label: "Gate 0",
    requires: [
      "sector-classification",
      "interest-income",
      "current-revenue",
      "primary-statement-line-items",
      "industry-classification",
    ],
  },
  {
    id: "gate-1",
    label: "Gate 1",
    requires: ["filed-annual-years-count"],
  },
  {
    id: "triggers-a-b",
    label: "Trigger A / B",
    requires: ["operating-margin-history"],
  },
  {
    id: "ronic",
    label: "RONIC",
    requires: ["five-year-change-in-nopat", "five-year-change-in-invested-capital"],
  },
  {
    id: "reinvestment",
    label: "Reinvestment",
    requires: [
      "capex",
      "acquisitions",
      "finance-lease-rou-additions",
      "depreciation-and-amortisation",
      "change-in-net-working-capital",
    ],
  },
  {
    id: "fcf-definitions",
    label: "All three FCF definitions",
    requires: [
      "operating-cash-flow",
      "capex",
      "finance-lease-rou-additions",
      "nopat",
      "depreciation-and-amortisation",
      "change-in-net-working-capital",
      "sbc",
    ],
  },
  {
    id: "pe",
    label: "P/E",
    requires: ["price", "eps", "pre-tax-income", "non-operating-items"],
  },
  {
    id: "steady-state-ev-pvgo",
    label: "Steady-state EV and PVGO",
    requires: ["median-margin-nopat", "discount-rate", "enterprise-value"],
  },
  {
    id: "reverse-dcf",
    label: "Diagnostic reverse DCF",
    requires: ["base-year-revenue", "ronic", "margin-levels", "policy-constants"],
  },
  {
    id: "own-history-percentile",
    label: "Own-history percentile",
    requires: ["ten-year-multiple-history-consistent-basis"],
  },
  {
    id: "pre-revenue",
    label: "Pre-revenue module",
    requires: [
      "share-count",
      "cash-balance",
      "quarterly-burn",
      "capex-per-unit-of-capacity",
      "capacity-ramp",
      "construction-lead",
      "project-debt-share-and-cost",
    ],
  },
  {
    id: "valuation-position",
    label: "§10.6 valuation position and action clause",
    requires: ["price", "scenario-range", "m7-implied-growth", "achieved-history-comparator"],
  },
];

/**
 * §4.2 names some inputs by the role they play in an output; acquisition names
 * them by the quantity they are. Where those are the SAME figure, the alias
 * says so.
 *
 * Only genuine identities belong here. "Base-year revenue" IS the current
 * period's revenue and "share count" IS shares outstanding. Nothing that
 * merely feeds another quantity is aliased to it — aliasing `nopat` to
 * `operating-income` would claim an input exists when only its pre-tax
 * ancestor does, which is the "false completeness" §4.1 names.
 */
const INPUT_ALIASES: Record<string, string> = {
  "base-year-revenue": "current-revenue",
  "share-count": "shares-outstanding",
  "margin-levels": "current-operating-margin",
};

function isAvailable(factId: string, available: ReadonlySet<string>): boolean {
  if (available.has(factId)) return true;
  const alias = INPUT_ALIASES[factId];
  return alias !== undefined && available.has(alias);
}

export type UnusableReason =
  | "MISSING"
  | "NOT CONFIRMED"
  | "CROSS-CHECK FAILED";

export interface OutputCompleteness {
  outputId: string;
  label: string;
  state: "COMPLETE" | "INCOMPLETE";
  /** The REQUIRED inputs that are unusable, each with why. Empty when COMPLETE. */
  blockedBy: { factId: string; reason: UnusableReason }[];
}

export interface CompletenessInput {
  /** Fact ids that were acquired and carry a value. */
  availableFactIds: ReadonlySet<string>;
  /** Facts a human decided they could not verify (§3.8.4). */
  notConfirmedFactIds?: ReadonlySet<string>;
  /**
   * Facts a §3.8.2 cross-check failed on. §3.8.2: "where the fact is REQUIRED
   * [it] returns INCOMPLETE for its dependents until it is resolved by
   * RE-ACQUISITION". So a failed fact is unusable even though it has a value —
   * the value is not corrected, it is not used.
   */
  crossCheckFailedFactIds?: ReadonlySet<string>;
}

/**
 * Evaluates completeness per output.
 *
 * Returns a state for every output group, always — including the complete
 * ones. §5.5 requires every state to be visible at the point of use, and a
 * function that returned only the failures would leave the caller unable to
 * tell "this output is fine" from "this output was never evaluated".
 */
export function evaluateCompleteness(input: CompletenessInput): OutputCompleteness[] {
  const notConfirmed = input.notConfirmedFactIds ?? new Set<string>();
  const failed = input.crossCheckFailedFactIds ?? new Set<string>();

  return OUTPUT_GROUPS.map((group) => {
    const blockedBy: { factId: string; reason: UnusableReason }[] = [];

    for (const factId of group.requires) {
      // Ordered most-severe first so a fact that is both missing and unchecked
      // reports the reason that actually blocks re-acquisition.
      if (!isAvailable(factId, input.availableFactIds)) {
        blockedBy.push({ factId, reason: "MISSING" });
      } else if (notConfirmed.has(factId)) {
        blockedBy.push({ factId, reason: "NOT CONFIRMED" });
      } else if (failed.has(factId)) {
        blockedBy.push({ factId, reason: "CROSS-CHECK FAILED" });
      }
    }

    return {
      outputId: group.id,
      label: group.label,
      state: blockedBy.length === 0 ? "COMPLETE" : "INCOMPLETE",
      blockedBy,
    };
  });
}

/** The outputs a given fact would take down if it became unusable. */
export function dependentsOf(factId: string): OutputGroup[] {
  return OUTPUT_GROUPS.filter((g) => g.requires.includes(factId));
}
