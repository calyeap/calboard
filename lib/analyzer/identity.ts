import type { MarketDataProvider } from "../marketdata/provider";
import { lookupCrypto } from "../marketdata/cryptoSymbols";

// ---------------------------------------------------------------------------
// §2 Step 1 / §1.2 / §9.3.1 — identity resolution for the analyzer.
//
// This is a NARROWING of Calboard's existing invalid-symbol contract, not a
// replacement for it and not a change to it. The provider still returns the
// same four outcomes; what changes is that the analyzer accepts only a listed
// operating company. A fund, an index, or a currency or crypto pair returns
// UNSUPPORTED here — at resolution, not at Step 2, and not as a downstream
// failure on a fact set that was never going to exist.
//
// The portfolio side is untouched: ETFs remain valid holdings there. Nothing
// in this module is imported by the portfolio code, and it must stay that way.
// ---------------------------------------------------------------------------

export type AnalyzerIdentityOutcome = "RESOLVED" | "UNKNOWN" | "UNSUPPORTED" | "UNAVAILABLE";

export type AnalyzerIdentity =
  | { outcome: "RESOLVED"; ticker: string; companyName: string; resolvedAt: string }
  // The ticker resolved to something real that this analyzer does not cover.
  // `instrumentDescription` is what Screen 1 names as the reason for refusal.
  | { outcome: "UNSUPPORTED"; ticker: string; instrumentDescription: string }
  | { outcome: "UNKNOWN"; ticker: string }
  | { outcome: "UNAVAILABLE"; ticker: string };

/**
 * Resolves a ticker to one of the four Screen 1 states.
 *
 * No price is fetched, and none may be added here. §2: "No price renders on
 * Step 1" — showing it at entry would put an unsourced, untimestamped figure
 * on screen before the fact contract applies, and would open the run with the
 * number the analyst is trying not to anchor on. Price is acquired with the
 * fact set, carrying its timestamp (§3.4).
 *
 * No run is created here either. The run commits on the analyst's confirmation
 * of the resolved company (design:121), which is why this returns an identity
 * rather than a runId.
 */
export async function resolveAnalyzerIdentity(
  rawTicker: string,
  provider: MarketDataProvider
): Promise<AnalyzerIdentity> {
  const ticker = rawTicker.trim().toUpperCase();

  if (ticker === "") {
    return { outcome: "UNKNOWN", ticker };
  }

  // Crypto and FX are never resolved through the provider — cryptoSymbols is
  // the sole authority for crypto identity (provider.ts). Something recognised
  // here is a real instrument the analyzer does not cover, so it is UNSUPPORTED
  // rather than UNKNOWN: the analyst typed something that exists, and telling
  // them it is unknown would send them looking for a typo they did not make.
  const nonCompany = classifyNonCompanyInstrument(ticker);
  if (nonCompany !== null) {
    return { outcome: "UNSUPPORTED", ticker, instrumentDescription: nonCompany };
  }

  let resolution;
  try {
    resolution = await provider.resolveInstrument(ticker);
  } catch {
    // A failure to reach the provider is not proof the symbol is invalid
    // (provider.ts). Anything unclassified resolves to UNAVAILABLE, which is
    // the one non-resolved state that keeps the entry and offers Try again.
    return { outcome: "UNAVAILABLE", ticker };
  }

  switch (resolution.outcome) {
    case "resolved":
      // The narrowing. An ETF resolves perfectly well as an instrument and is
      // a valid portfolio holding; it is simply not something this analyzer
      // can value, and §1.2 confines the validated scope to listed operating
      // companies.
      if (resolution.assetClass === "etf") {
        return {
          outcome: "UNSUPPORTED",
          ticker,
          instrumentDescription: "a fund or index",
        };
      }
      return {
        outcome: "RESOLVED",
        ticker: resolution.symbol,
        companyName: resolution.name,
        // When the provider answered. Screen 1 shows it so the resolution
        // carries a timestamp like every other acquired thing (§3.4); it is
        // recorded here rather than at render, which would timestamp the
        // page view instead of the answer.
        resolvedAt: new Date().toISOString(),
      };

    case "unsupported":
      return {
        outcome: "UNSUPPORTED",
        ticker,
        instrumentDescription: "an instrument outside this analyzer's scope",
      };

    case "unknown":
      return { outcome: "UNKNOWN", ticker };

    case "unavailable":
      return { outcome: "UNAVAILABLE", ticker };
  }
}

// Quote-currency suffixes that make a ticker a currency or crypto PAIR rather
// than a company. Anchored to the end and matched against a specific list —
// deliberately not "contains a hyphen", which would refuse BRK-B, a listed
// operating company whose ticker this analyzer must accept.
const PAIR_SUFFIX_RE = /-(USD|USDT|USDC|EUR|GBP|JPY)$/;
// Yahoo's FX convention (EURUSD=X) and index convention (^GSPC).
const FX_RE = /=X$/;
const INDEX_RE = /^\^/;

/**
 * Names the instrument class when a ticker is recognisably not a listed
 * operating company, or null when it may be one.
 *
 * §1.2 puts funds, indices and currency or crypto pairs outside the validated
 * scope, and §2 requires the refusal at resolution. The provider returns
 * `unsupported` for many of these on its own; this catches the ones it would
 * otherwise resolve, and the crypto registry, which the provider never sees.
 */
function classifyNonCompanyInstrument(ticker: string): string | null {
  // The verified crypto registry, on the bare ticker it is keyed by.
  if (lookupCrypto(ticker) !== null) return "a cryptocurrency";

  if (PAIR_SUFFIX_RE.test(ticker)) {
    // BTC-USD, and any other pair written against a quote currency. Checked
    // against the registry's bare form so a supported coin is named as one.
    const base = ticker.replace(PAIR_SUFFIX_RE, "");
    return lookupCrypto(base) !== null ? "a cryptocurrency pair" : "a currency or crypto pair";
  }

  if (FX_RE.test(ticker)) return "a currency pair";
  if (INDEX_RE.test(ticker)) return "an index";

  return null;
}

/**
 * Whether a run may be committed from this identity. Only RESOLVED proceeds;
 * Begin analysis is disabled in all three other states with its reason stated.
 */
export function mayBeginAnalysis(identity: AnalyzerIdentity): boolean {
  return identity.outcome === "RESOLVED";
}

/**
 * Whether the entry is kept and Try again offered.
 *
 * UNAVAILABLE only. §9.3.1 and the Screen 1 contract distinguish a provider
 * failure — which says nothing about the ticker and is worth retrying — from
 * the two rejections, which are answers. Offering Try again on UNKNOWN or
 * UNSUPPORTED invites the analyst to retry something that will refuse them
 * identically every time.
 */
export function offersTryAgain(identity: AnalyzerIdentity): boolean {
  return identity.outcome === "UNAVAILABLE";
}

/**
 * The reason Begin analysis is disabled, for the three non-resolved states.
 * Returns null when the run may proceed.
 */
export function disabledReason(identity: AnalyzerIdentity): string | null {
  switch (identity.outcome) {
    case "RESOLVED":
      return null;
    case "UNKNOWN":
      return `${identity.ticker} did not resolve to a listed instrument.`;
    case "UNSUPPORTED":
      return `${identity.ticker} is ${identity.instrumentDescription}. This analyzer covers listed operating companies only.`;
    case "UNAVAILABLE":
      return "The identity service could not be reached, so this ticker has not been checked.";
  }
}
