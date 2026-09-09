import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Calvin's authored calibration scenarios — three companies, approved
// 2026-09-09, recorded verbatim.
//
// WHY THIS IS NOT IN THE FIXTURES. `lib/analyzer/fixtures/msft.ts` and
// `oklo.ts` are VALIDATION fixtures: their golden tests reproduce the frozen,
// hash-verified mocks (`mock-report-msft.html`, `mock-report-oklo.html`).
// Writing revised scenarios into them would silently change what those tests
// assert they reproduce, so the authored set lives here instead and the
// fixtures are left exactly as they were.
//
// WHAT THIS MODULE IS NOT. It holds no threshold, no band, no cut-point and no
// classifier — no CHEAP / FAIR / EXPENSIVE appears anywhere in it, and a test
// asserts that it exports none. The classification is what a ruled threshold
// produces, and the thresholds are Calvin's to rule.
//
// ANCHORS ARE VERBATIM. Where Calvin authored an anchor for a scenario it is
// carried word for word. Where he did not, `writtenAnchor` is NULL rather than
// a paraphrase written to fill the field: an anchor nobody wrote is not an
// anchor, and the production `ScenarioDriverSet` type requires a non-empty one
// precisely so that a real Step 7 entry cannot skip it. This module records
// what was authored, which is a different job.
//
// SHARE-COUNT UNITS DIFFER PER COMPANY and are recorded explicitly, because
// the existing fixtures already disagree — MSFT's fixture counts shares in
// billions (7.4255) and OKLO's in millions (205). A bare number here would be
// a trap.
// ---------------------------------------------------------------------------

/**
 * A scenario's drivers.
 *
 * Two shapes, because two of these companies are not the same kind of thing.
 * OKLO's cases are pre-revenue economic cases and NOT mature-company growth
 * and margin — recording them as `revenueGrowthOrPath: 0` (which is what the
 * validation fixture does, for its own reasons) would state a 0% growth
 * assumption Calvin did not make.
 */
export type ScenarioDrivers =
  | {
      kind: "mature";
      /** A constant rate, or an explicit ten-entry year-by-year path. */
      revenueGrowthOrPath: Decimal | Decimal[];
      operatingMargin: Decimal;
      /** Reinvestment as a fraction of revenue. */
      reinvestmentCapitalIntensity: Decimal;
    }
  | {
      kind: "pre-revenue";
      /** What the case actually is. The economics live in the pre-revenue model, not in growth and margin. */
      describedBy: string;
    };

export interface AuthoredScenario {
  drivers: ScenarioDrivers;
  /** Post-financing count for this scenario, in the set's own `shareCountUnit`. */
  shareCount: Decimal;
  /** Calvin's own words. NULL where he authored none — never a paraphrase. */
  writtenAnchor: string | null;
}

export interface AuthoredScenarioSet {
  ticker: string;
  bear: AuthoredScenario;
  base: AuthoredScenario;
  bull: AuthoredScenario;
  shareCountUnit: "billions" | "millions";
  /**
   * The three per-share values Input A reads (§10.6.2, §10.2 section G).
   *
   * NULL on all three companies, and that is a finding rather than an
   * oversight — see `scenarioValuesUnavailable`.
   */
  scenarioValues: { bear: Decimal; base: Decimal; bull: Decimal } | null;
  /** Why there are none. Non-null exactly when `scenarioValues` is null. */
  scenarioValuesUnavailable: string | null;
  /** Notes travelling with the whole set. Calvin's words, verbatim. */
  notes: string[];
}

// The reason is the same on all three and is stated once. It is worth reading
// carefully, because "the analyst authored scenarios" and "the analyst
// authored scenario VALUES" are different claims and only the first is true.
//
// A scenario value is a per-share figure: it is the output of valuing the
// drivers, not one of the drivers. Deriving it needs
// `computeScenarioEnterpriseValue` plus an equity bridge (§4.4's judgment,
// unmade), a NOPAT tax rate (§7.1, undefined) and a chosen discount rate among
// 8/10/12% (§10.6.2 does not choose). None of the three is settled.
//
// The frozen mocks DO carry values for MSFT ($265/$510/$650) and OKLO
// ($3.10/$31/$48) — and those values belong to the mocks' OWN drivers, not to
// the revised ones below. MSFT's bull reinvestment moved 15% -> 20% and OKLO's
// share counts moved from a flat 205 to 205/250/275, so carrying the mock
// values across would pair a published number with drivers that no longer
// produce it. That is a worse failure than an honest null, because it would
// look right.
const VALUES_UNAVAILABLE =
  "Not authored, and not derivable. A scenario value is the output of valuing the drivers, " +
  "and deriving it requires §4.4's equity bridge (unmade), §7.1's NOPAT tax rate (undefined) " +
  "and a chosen discount rate among 8/10/12% (§10.6.2 does not choose). The frozen mocks' " +
  "values belong to the mocks' own drivers, which these revise, so they cannot be carried across.";

function pct(value: string): Decimal {
  return new Decimal(value).dividedBy(100);
}

/** NVDA's ten-year revenue paths, as authored: percentages, years 1-10. */
const NVDA_PATHS = {
  bear: ["75", "10", "-12", "5", "6", "5", "4", "4", "3.5", "3"],
  base: ["85", "25", "15", "10", "8", "7", "6", "5", "4", "3"],
  bull: ["90", "35", "25", "18", "15", "12", "9", "7", "5", "3"],
} as const;

const NVDA_SHARES = new Decimal("24.1");

export const NVDA_SCENARIOS: AuthoredScenarioSet = {
  ticker: "NVDA",
  shareCountUnit: "billions",
  bear: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: NVDA_PATHS.bear.map(pct),
      operatingMargin: pct("50"),
      reinvestmentCapitalIntensity: pct("12"),
    },
    shareCount: NVDA_SHARES,
    writtenAnchor:
      "The bear carries BOTH margin reversion and a revenue-decline year, deliberately, per Trigger A and B.",
  },
  base: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: NVDA_PATHS.base.map(pct),
      operatingMargin: pct("60"),
      reinvestmentCapitalIntensity: pct("17"),
    },
    shareCount: NVDA_SHARES,
    writtenAnchor: null,
  },
  bull: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: NVDA_PATHS.bull.map(pct),
      operatingMargin: pct("64"),
      reinvestmentCapitalIntensity: pct("22"),
    },
    shareCount: NVDA_SHARES,
    writtenAnchor: null,
  },
  scenarioValues: null,
  scenarioValuesUnavailable: VALUES_UNAVAILABLE,
  notes: [
    "The bear carries BOTH margin reversion and a revenue-decline year, deliberately, per Trigger A and B.",
  ],
};

const MSFT_SHARES = new Decimal("7.4255");

export const MSFT_SCENARIOS: AuthoredScenarioSet = {
  ticker: "MSFT",
  shareCountUnit: "billions",
  bear: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: pct("10.0"),
      operatingMargin: pct("41.8"),
      reinvestmentCapitalIntensity: pct("15"),
    },
    shareCount: MSFT_SHARES,
    writtenAnchor: "AI and infrastructure spend remains necessary.",
  },
  base: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: pct("13.7"),
      operatingMargin: pct("46.8"),
      reinvestmentCapitalIntensity: pct("15"),
    },
    shareCount: MSFT_SHARES,
    writtenAnchor: null,
  },
  bull: {
    drivers: {
      kind: "mature",
      revenueGrowthOrPath: pct("18.5"),
      operatingMargin: pct("46.8"),
      reinvestmentCapitalIntensity: pct("20"),
    },
    shareCount: MSFT_SHARES,
    writtenAnchor: null,
  },
  scenarioValues: null,
  scenarioValuesUnavailable: VALUES_UNAVAILABLE,
  notes: [
    "Bear reinvestment deliberately does NOT fall with the weaker outcome — Calvin's anchor is that AI and infrastructure spend remains necessary. Do not \"correct\" it.",
    "Where the implementation takes a scalar growth rate, these use the existing fixed path shape; the quoted rate is not assumed to persist unchanged for ten years.",
  ],
};

export const OKLO_SCENARIOS: AuthoredScenarioSet = {
  ticker: "OKLO",
  shareCountUnit: "millions",
  bear: {
    drivers: { kind: "pre-revenue", describedBy: "wind-down / cash-return" },
    shareCount: new Decimal(205),
    writtenAnchor: "wind-down / cash-return",
  },
  base: {
    drivers: { kind: "pre-revenue", describedBy: "8 GW back-loaded reference" },
    shareCount: new Decimal(250),
    writtenAnchor: "8 GW back-loaded reference",
  },
  bull: {
    drivers: { kind: "pre-revenue", describedBy: "8 GW steady ramp" },
    shareCount: new Decimal(275),
    writtenAnchor: "8 GW steady ramp",
  },
  scenarioValues: null,
  scenarioValuesUnavailable: VALUES_UNAVAILABLE,
  notes: [
    "OKLO — pre-revenue economic cases, NOT mature-company growth and margin.",
    "Share counts rise with success because stronger deployment needs more funding. Do not flatten them.",
  ],
};

export const AUTHORED_SCENARIOS: AuthoredScenarioSet[] = [MSFT_SCENARIOS, NVDA_SCENARIOS, OKLO_SCENARIOS];

/** Null for any company Calvin has not authored scenarios for. */
export function authoredScenariosFor(ticker: string): AuthoredScenarioSet | null {
  return AUTHORED_SCENARIOS.find((s) => s.ticker === ticker.toUpperCase()) ?? null;
}
