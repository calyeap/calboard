import { POLICY } from "./policy";
import { ASSET_BASED_SECTORS, RESERVE_BASED_INDUSTRIES } from "./gates";
import type { Gate0Result } from "./types";

// ---------------------------------------------------------------------------
// Design §5.1's gate band — the Gate 0 block, DERIVED from Gate 0's output.
//
// THE DEFECT THIS REPLACES. The profile screen printed
//
//     <h3>Gate 0 — supported profile</h3>
//
// as a literal, above the gate's INPUTS, and never called `evaluateGate0` at
// all. It reads as a verdict and is not one — and it said "supported profile"
// over a bank. The report, meanwhile, reads the real output. Two surfaces, two
// sources, one of them the input to the function the other displays.
//
// The fix is the one the verification state already needed: derive from the
// decision rather than travelling beside the fact. The screen calls the gate.
//
// WHY CALLING THE GATE HERE IS NOT A §2 BREACH. §2's ordering rule forbids a
// CALCULATION MODULE running before the human has completed Step 2. Gate 0 is
// Step 3, the screen's own subject ("Steps 3–5 — Gates and triggers,
// read-only"), and it is a pure function of inputs already acquired. No
// valuation arithmetic is reachable from here.
//
// Design §5.1 requires the block to carry "result, and the four classification
// tests with their evaluated values. Where it failed, the §6.1 explanation copy
// is shown, because the reason is not obvious."
// ---------------------------------------------------------------------------

/** The block's heading: what Gate 0 actually returned. */
export function gate0Heading(gate0: Gate0Result): string {
  return gate0.result === "PASS"
    ? "Gate 0 — supported profile"
    : `Gate 0 — ${gate0.result}`;
}

export interface Gate0TestRow {
  label: string;
  /** The evaluated value, or NOT ACQUIRED — never blank (§9.5's register). */
  value: string;
  /** Whether this test is the one that fired the refusal. */
  fired: boolean;
}

const NOT_ACQUIRED = "NOT ACQUIRED";

/**
 * §6.1's four classification tests, each with the value Gate 0 evaluated.
 *
 * All four, because the screen used to print two — and printed the same value
 * for both, since sector and industry were mapped from one field. The two that
 * were hard-coded null did not appear anywhere, so nothing on screen could have
 * shown an analyst that Gate 0 was refusing on inputs no run ever supplied.
 *
 * `NOT ACQUIRED` rather than a blank or a dash: a reader has to be able to tell
 * "evaluated, did not fire" from "never acquired", because those are the two
 * different reasons Gate 0 refuses and §6.1 gives them different state names.
 */
export function gate0TestRows(gate0: Gate0Result): Gate0TestRow[] {
  const t = gate0.evaluatedTests;
  const threshold = POLICY.gate0InterestIncomeOverRevenueThreshold;

  return [
    {
      label: "Sector classification",
      value: t.sectorClassification ?? NOT_ACQUIRED,
      fired:
        t.sectorClassification !== null && ASSET_BASED_SECTORS.has(t.sectorClassification),
    },
    {
      label: "Industry classification",
      value: t.industryClassification ?? NOT_ACQUIRED,
      fired:
        t.industryClassification !== null &&
        RESERVE_BASED_INDUSTRIES.has(t.industryClassification),
    },
    {
      label: `Interest income as % of revenue (refuses above ${threshold.mul(100).toFixed(0)}%)`,
      value:
        t.interestIncomeOverRevenue === null
          ? NOT_ACQUIRED
          : `${t.interestIncomeOverRevenue.mul(100).toFixed(1)}%`,
      fired:
        t.interestIncomeOverRevenue !== null && t.interestIncomeOverRevenue.greaterThan(threshold),
    },
    {
      label: "Insurance premium or policy-reserve line items",
      value:
        t.hasInsurancePremiumOrReserveLineItems === null
          ? NOT_ACQUIRED
          : t.hasInsurancePremiumOrReserveLineItems
            ? "Present"
            : "None reported",
      fired: t.hasInsurancePremiumOrReserveLineItems === true,
    },
  ];
}

/**
 * §6.1's explanation copy, where the gate refused. Null where it passed.
 *
 * §6.1 asks for this in so many words — "carry this into the interface copy,
 * because it is not obvious" — and the reason is that the refusal looks like
 * pedantry until you see why the numbers would be meaningless. No remedy is
 * named, on §6.5's rule: "naming a remedy that does not exist is how a safety
 * test comes to be ignored."
 */
export function gate0ExplanationIfFailed(gate0: Gate0Result): string | null {
  if (gate0.result === "PASS") return null;

  if (gate0.result === "UNSUPPORTED PROFILE — CLASSIFICATION UNAVAILABLE") {
    return (
      "The gate fails closed: a company it cannot classify is unsupported, never " +
      "mature-profitable by default. Absence of a classification is not evidence that " +
      "this company is an ordinary operating business, so the valuation outputs are " +
      "suppressed rather than computed on a guess. The tests above show which input " +
      "was not acquired."
    );
  }

  // §6.1's own words for why an asset-based company is refused.
  return (
    "For a bank or an insurer, debt is funding rather than capital structure — so the EV " +
    "bridge, EBITDA, free cash flow and PVGO are all arithmetically computable and none of " +
    "them means anything. A property-casualty insurer with low reported debt and stable " +
    "operating cash flow passes every other test in the methodology into the " +
    "mature-profitable row and produces a full page of correct, meaningless numbers. " +
    "The asset-based row is not validated in v1, so the valuation outputs are suppressed."
  );
}
