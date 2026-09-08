// ---------------------------------------------------------------------------
// §8.3 limit 1, and the §10.5 rows a [C] string could produce.
//
// The position (§10.6) is [S] output, computed deterministically from fields
// the analyzer already holds. [C] may restate it under §10.7 and may not
// author, vary, soften, qualify or reason toward one. That is a rule about
// COPY, so it can be checked on the copy.
//
// WHAT THIS DOES NOT CLAIM. A scan cannot certify that a sentence carries no
// verdict — limit 1 forbids one "phrased as a question that carries one", and
// no phrase list catches every insinuation. What it does is refuse the forms a
// verdict actually takes, so the failure has to be inventive rather than
// accidental. The rest is Calvin's read.
// ---------------------------------------------------------------------------

export type ProhibitionKind = "AUTHORED POSITION" | "VERDICT OR TARGET" | "PORTFOLIO ACTION";

export interface ProhibitionDefect {
  kind: ProhibitionKind;
  detail: string;
}

export class ProhibitedCopyError extends Error {
  readonly defects: ProhibitionDefect[];

  constructor(where: string, defects: ProhibitionDefect[]) {
    super(
      `${where}: [C] copy carries ${defects.length} prohibited pattern(s) — ` +
        defects.map((d) => `${d.kind} ("${d.detail}")`).join("; ") +
        `. §8.3 limit 1: [C] issues no verdict, no target and no recommendation, and may not author a position.`
    );
    this.name = "ProhibitedCopyError";
    this.defects = defects;
  }
}

// §10.6.1's four values, as tokens. Matched case-sensitively in upper case:
// the position is a label, and lower-case "fair" in "the fair-value range" is
// ordinary English that §10.3 uses itself.
const POSITION_TOKENS = /\b(CHEAP|FAIR|EXPENSIVE|INCONCLUSIVE)\b/g;

// Verdicts and targets. Phrases, not words — each of these is a claim about
// what the security is worth or what to do about it, and none of them has an
// innocent reading in report copy.
const VERDICT_PHRASES: RegExp[] = [
  /\bprice target\b/gi,
  /\btarget price\b/gi,
  /\bunder-?valued\b/gi,
  /\bover-?valued\b/gi,
  /\bfairly valued\b/gi,
  /\bworth buying\b/gi,
  /\bworth selling\b/gi,
  /\b(?:we|calboard|the analysis) recommends?\b/gi,
  /\bour recommendation\b/gi,
  /\ba (?:buy|sell)\b/gi,
  /\battractively priced\b/gi,
  /\bexpensively priced\b/gi,
];

// §10.6.4: the clause may say start, do not start, or wait for a better price,
// and may NEVER say trim, add, sell or hold — "those are statements about a
// position, and they need the position size and cost basis §1.4 forbids the
// analyzer from holding". Matched as phrases so ordinary uses of the same
// verbs ("acquisitions add to the noise") are untouched.
const PORTFOLIO_ACTION_PHRASES: RegExp[] = [
  /\btrim(?:ming)? (?:the |your |a )?position\b/gi,
  /\badd(?:ing)? to (?:the |your |a )?position\b/gi,
  /\bsell(?:ing)? (?:the |your |some |part of )?(?:position|shares|holding)\b/gi,
  /\bhold(?:ing)? (?:the |your )?position\b/gi,
  /\breduce (?:the |your )?(?:position|exposure|weight)\b/gi,
  /\bincrease (?:the |your )?(?:position|exposure|weight)\b/gi,
  /\b(?:over|under)weight\b/gi,
  /\bposition siz(?:e|ing)\b/gi,
  /\bcost basis\b/gi,
];

function collect(text: string, patterns: RegExp[], kind: ProhibitionKind, into: ProhibitionDefect[]): void {
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      into.push({ kind, detail: match[0].toLowerCase() });
    }
  }
}

/**
 * Every prohibited pattern in one piece of [C]-authored copy.
 *
 * Returns all of them, on the same reasoning as traceText: a report-back that
 * names one problem invites a resubmit loop that hides the others.
 */
export function scanProhibitedCopy(text: string): ProhibitionDefect[] {
  const defects: ProhibitionDefect[] = [];

  for (const match of text.matchAll(POSITION_TOKENS)) {
    defects.push({ kind: "AUTHORED POSITION", detail: match[0] });
  }
  collect(text, VERDICT_PHRASES, "VERDICT OR TARGET", defects);
  collect(text, PORTFOLIO_ACTION_PHRASES, "PORTFOLIO ACTION", defects);

  return defects;
}
