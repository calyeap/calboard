// ---------------------------------------------------------------------------
// M8-c — the calibration set.
//
// The companies the valuation-position thresholds would be ruled from, chosen
// to span DIFFERENT COMPANY SHAPES rather than to optimise around the two the
// system already carries fixtures for.
//
// The set is DATA and lives apart from the harness that runs it, for the same
// reason the tag mapping is data: a reviewer must be able to see what was
// calibrated on without reading the code that calibrated it, and a later
// session must not be able to quietly drop the shapes that came back awkward.
//
// NOTHING HERE IS A THRESHOLD. This file records which companies were looked
// at and why each shape is in the set. The cut-points are Calvin's to rule and
// are not written anywhere in this milestone.
// ---------------------------------------------------------------------------

export interface CalibrationCompany {
  ticker: string;
  /** The shape this company is in the set to represent. */
  shape: string;
  /** Why this shape has to be in a calibration set at all. */
  why: string;
}

export const CALIBRATION_SET: readonly CalibrationCompany[] = [
  {
    ticker: "MSFT",
    shape: "Megacap software — high margin, long history, net cash",
    why: "The system's own reference case. In the set as the control, not as the thing to fit: a threshold set that only works here has been fitted to one company.",
  },
  {
    ticker: "OKLO",
    shape: "Pre-revenue — value is a described-success distribution, not a range",
    why: "The only shape where price can sit at or above the top of the described-success range. Also the recorded total-debt mapping gap.",
  },
  {
    ticker: "NVDA",
    shape: "Hypergrowth — achieved growth far above any plausible required growth",
    why: "The set's upper bound on the required-versus-achieved gap. Appendix B was calibrated on this company alone, which is the failure being corrected.",
  },
  {
    ticker: "KO",
    shape: "Consumer staple — low single-digit growth, stable margin, levered",
    why: "The low-growth end. A threshold band tuned on software reads almost any staple as expensive.",
  },
  {
    ticker: "UNP",
    shape: "Capital-intensive rail — heavy debt, steady returns",
    why: "Tests the leverage precondition, which is upstream of the range and therefore upstream of price location.",
  },
  {
    ticker: "COST",
    shape: "Retail — very high revenue, very thin margin",
    why: "A margin an order of magnitude below the software cases; the reverse DCF's margin levels behave differently here.",
  },
  {
    ticker: "XOM",
    shape: "Cyclical commodity — margin and revenue both swing with price",
    why: "Achieved history is not a trend here. A ten-year CAGR that spans a commodity cycle is a different kind of comparator.",
  },
  {
    ticker: "INTC",
    shape: "Declining incumbent — falling margin, loss-making years",
    why: "The only shape where achieved growth is negative and margin history is deteriorating rather than stable.",
  },
  {
    ticker: "LLY",
    shape: "Pharma — high multiple on accelerating revenue",
    why: "High required growth against genuinely high achieved growth; the case most likely to sit near a CHEAP/FAIR boundary in either direction.",
  },
  {
    ticker: "RIVN",
    shape: "Loss-making, capital-intensive, early revenue",
    why: "Negative operating margin with real revenue — between OKLO's pre-revenue shape and a going concern, and not covered by either fixture.",
  },
];
