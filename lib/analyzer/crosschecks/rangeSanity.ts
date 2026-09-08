import { type CrossCheckFact, type CrossCheckResult, formatNumber } from "./types";

// ---------------------------------------------------------------------------
// §3.8.2 family 3 — RANGE SANITY.
//
// "That a figure lies within the range its own history and its units admit —
// a margin outside 0-100%, a share count moving by an order of magnitude
// between periods, a scale error of 10^3 or 10^6 against the prior period."
//
// Every test here is DEFINITIONAL rather than calibrated. That is deliberate:
// threshold calibration is milestone M8-c, and a band invented here would
// arrive with no observations behind it — the failure Appendix B already
// records for the +/-1% rate band. "An order of magnitude" and "10^3 or 10^6"
// are the spec's own words and need no calibration; a margin above 100% is
// arithmetically impossible, not improbable.
// ---------------------------------------------------------------------------

/** A ratio counts as a scale error when it is within this fraction of exactly 10^3 or 10^6. */
const SCALE_ERROR_PROXIMITY = 0.01;

const SCALE_FACTORS = [1e3, 1e6];

export function rangeSanityChecks(fact: CrossCheckFact): CrossCheckResult[] {
  const results: CrossCheckResult[] = [];

  if (fact.value === null) {
    return [
      {
        factId: fact.factId,
        family: "RANGE SANITY",
        check: "the figure lies within the range its units admit",
        outcome: "NOT APPLICABLE",
        detail: "The figure was not acquired, so there is no value to range-check.",
      },
    ];
  }

  // --- units domain -------------------------------------------------------
  if (fact.unit === "pure") {
    // Margins are held as fractions (0.468 = 46.8%). A value above 1 is a
    // units error — a percentage stored where a fraction belongs — and is
    // impossible as an operating margin whatever the company.
    //
    // The lower bound is deliberately NOT 0. A loss-making company has a
    // negative operating margin as a matter of fact, and OKLO's is around
    // -100x on near-zero revenue. Flagging that would be flagging the truth.
    const ok = fact.value <= 1;
    results.push({
      factId: fact.factId,
      family: "RANGE SANITY",
      check: "a ratio does not exceed 100%",
      outcome: ok ? "PASS" : "FAIL",
      detail:
        `${formatNumber(fact.value)} (${formatNumber(fact.value * 100)}%) against a ceiling of ` +
        `1.0. A value above 1 is a percentage stored where a fraction belongs. ` +
        `No floor is applied: a negative margin is a fact about a loss-making company.`,
    });
  } else {
    const ok = fact.unit !== "shares" || fact.value >= 0;
    results.push({
      factId: fact.factId,
      family: "RANGE SANITY",
      check: "the figure lies within the range its units admit",
      outcome: ok ? "PASS" : "FAIL",
      detail:
        fact.unit === "shares"
          ? `${formatNumber(fact.value)} shares — a share count below zero is impossible`
          : `${formatNumber(fact.value)} USD — a monetary figure admits either sign`,
    });
  }

  // --- against the prior period -------------------------------------------
  if (!fact.priorPeriod || fact.priorPeriod.value === 0) {
    results.push({
      factId: fact.factId,
      family: "RANGE SANITY",
      check: "no order-of-magnitude or 10^3 / 10^6 scale break against the prior period",
      outcome: "NOT APPLICABLE",
      detail: fact.priorPeriod
        ? "The prior period is zero; a ratio against it is undefined."
        : "No prior period was acquired for this figure.",
    });
    return results;
  }

  const ratio = fact.value / fact.priorPeriod.value;
  const absRatio = Math.abs(ratio);

  const scaleBreak = SCALE_FACTORS.find(
    (f) =>
      Math.abs(absRatio - f) / f <= SCALE_ERROR_PROXIMITY ||
      Math.abs(absRatio - 1 / f) * f <= SCALE_ERROR_PROXIMITY
  );

  // "A share count moving by an order of magnitude between periods" — applied
  // to SHARE COUNTS, which is the scope the spec gives it, and to nothing else.
  //
  // It was briefly applied to monetary figures too, on the reasoning that the
  // same logic held. It does not. Oklo's capex went from $0.35m to $33.2m
  // between FY2024 and FY2025 — a 94x move that is the company starting to
  // build, not a data error — and the check failed it. That is worse than a
  // false positive: §3.8.2's remedy is INCOMPLETE "until it is resolved by
  // re-acquisition", and re-acquiring a correct figure returns the same
  // number, so a legitimate step change would have blocked the output
  // permanently with no way for the analyst to clear it.
  //
  // A share count is different in kind: it moves by issuance and buyback, and
  // a tenfold move between consecutive periods without a split is a
  // transcription or units error rather than a business event. The 10^3/10^6
  // scale test below still covers every figure, and it is the one the spec
  // states without qualification.
  const orderOfMagnitude = fact.unit === "shares" && (absRatio >= 10 || absRatio <= 0.1);

  const failed = scaleBreak !== undefined || orderOfMagnitude;
  results.push({
    factId: fact.factId,
    family: "RANGE SANITY",
    check: "no order-of-magnitude or 10^3 / 10^6 scale break against the prior period",
    outcome: failed ? "FAIL" : "PASS",
    detail:
      `${fact.priorPeriod.asOfDate} ${formatNumber(fact.priorPeriod.value)} -> ` +
      `${fact.asOfDate} ${formatNumber(fact.value)}, ratio ${formatNumber(ratio)}` +
      (scaleBreak !== undefined
        ? ` — within 1% of a factor of ${formatNumber(scaleBreak)}, the signature of a units error`
        : orderOfMagnitude
          ? " — an order of magnitude or more"
          : ""),
  });

  return results;
}
