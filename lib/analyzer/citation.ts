import type { FactRecord } from "./types";

// ---------------------------------------------------------------------------
// §3.8's presentation requirement: each queued fact is shown "with a direct
// link or citation sufficient to check it against the source document".
//
// This is a RESOLVER over fact metadata, not a stored URL. The tier is decided
// by acquisition path, the same axis §3.8.1 uses for the queue exemption,
// because what makes a figure checkable differs by how it was acquired: a
// tagged element is checked by its tag, a model-read figure by the document
// and line it was read from, and an aggregator field cannot be checked against
// a filing at all — which is itself the thing worth showing.
//
// M7 populates no links. FactRecord.sourceUrl is null in both fixtures and
// document retrieval arrives at M8, so `url` is null throughout and the label
// carries the citation. M7 acceptance may NOT claim the verification loop
// works: it claims the loop is built and the citation is rendered.
// ---------------------------------------------------------------------------

export type CitationTier =
  /** Acquired through a fixed, versioned tag mapping — checkable by its tag. */
  | "TAGGED ELEMENT"
  /** Read out of a filing by a model — checkable against the document and line. */
  | "FILING DOCUMENT"
  /** An aggregator field with no filing behind it — not checkable against one. */
  | "SECONDARY FEED";

export interface Citation {
  tier: CitationTier;
  /** What to look for. Always present, whether or not a link is. */
  label: string;
  /** Null until M8 fetches documents. A null link is shown as such, not hidden. */
  url: string | null;
  /** Why this fact cannot be opened directly, when it cannot. */
  unavailableReason: string | null;
}

export function citationFor(fact: FactRecord): Citation {
  const tier = tierFor(fact);

  return {
    tier,
    label: labelFor(fact, tier),
    // Populated at M8. Held as a resolver output rather than a stored field so
    // that when documents arrive, one function changes and every screen that
    // renders a citation follows.
    url: fact.sourceUrl,
    unavailableReason: fact.sourceUrl === null ? unavailableReasonFor(tier) : null,
  };
}

function tierFor(fact: FactRecord): CitationTier {
  if (typeof fact.tagMappingVersion === "string" && fact.tagMappingVersion.length > 0) {
    return "TAGGED ELEMENT";
  }
  if (fact.sourceClass === "SECONDARY") {
    return "SECONDARY FEED";
  }
  return "FILING DOCUMENT";
}

function labelFor(fact: FactRecord, tier: CitationTier): string {
  switch (tier) {
    case "TAGGED ELEMENT":
      return `${fact.source} · mapping ${fact.tagMappingVersion}`;
    case "SECONDARY FEED":
      return `${fact.source} — no filing document behind this figure`;
    case "FILING DOCUMENT":
      return fact.source;
  }
}

function unavailableReasonFor(tier: CitationTier): string {
  switch (tier) {
    case "SECONDARY FEED":
      // Not a build limitation. This one stays unlinked after M8, and saying
      // so is the point: a figure that cannot be checked against a filing is
      // exactly the kind §3.8 queues.
      return "An aggregator field has no filing document to open. Check it against the company filing directly.";
    case "TAGGED ELEMENT":
    case "FILING DOCUMENT":
      return "Document retrieval arrives at milestone M8. The citation above is what to look for.";
  }
}
