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
// M8-a POPULATES LINKS. Acquisition resolves an EDGAR filing-index URL from the
// accession number carried on the tagged element, so a tag-mapped fact has a
// real `url` and the verification loop is closed for it. The two kinds that do
// not are a price, which came from a feed, and a figure computed here from
// other facts — neither has a filing to open, and unavailableReasonFor says
// which of the two it is rather than naming a milestone.
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
  /** Null where the fact has no document to open. Shown as such, not hidden. */
  url: string | null;
  /** Why this fact cannot be opened directly, when it cannot. */
  unavailableReason: string | null;
}

export function citationFor(fact: FactRecord): Citation {
  const tier = tierFor(fact);

  return {
    tier,
    label: labelFor(fact, tier),
    // Held as a resolver output rather than a stored field so that one function
    // decides linkability and every screen that renders a citation follows.
    url: fact.sourceUrl,
    unavailableReason: fact.sourceUrl === null ? unavailableReasonFor(fact, tier) : null,
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

function unavailableReasonFor(fact: FactRecord, tier: CitationTier): string {
  // A COMPUTED figure has no document, and never will. It is not a gap.
  if (fact.derivedFrom !== null && fact.derivedFrom.length > 0) {
    return "Nothing to open: this figure was worked out here from the facts named above. Open theirs to check it.";
  }

  switch (tier) {
    case "SECONDARY FEED":
      // Not a build limitation. This one stays unlinked, and saying so is the
      // point: a figure that cannot be checked against a filing is exactly the
      // kind the spot-check queues.
      return "An aggregator field has no filing document to open. Check it against the company filing directly.";
    case "FILING DOCUMENT":
      // A market quote reaches this tier: PRIMARY, no tag mapping, no filing.
      return "Nothing to open: this figure came from a price feed rather than a filing. Check it against the feed.";
    case "TAGGED ELEMENT":
      // Acquisition resolves a filing-index URL from the accession number, so a
      // tagged fact normally HAS a link and never reaches here. Reaching it
      // means the accession was missing from the tagged element itself.
      //
      // This used to read "Document retrieval arrives at milestone M8". This IS
      // milestone M8 and documents are fetched — promising a milestone that has
      // arrived is worse than admitting a gap, because it tells the analyst to
      // wait for something that already happened.
      return "No filing link could be resolved for this element — the accession number is missing from it. The citation above is what to look for.";
  }
}
