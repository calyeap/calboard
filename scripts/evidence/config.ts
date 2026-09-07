// scripts/evidence/config.ts

export const WIDTHS = [720, 1024, 1440] as const;

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

/** Frozen artefacts, byte-exact. A missing file is a STOP, never a hash. */
export const FROZEN_HASHES: Readonly<Record<string, string>> = {
  "calboard-stock-analyzer-v1-spec.md":
    "16e601522aa6f8e128e39e31216827106db40ec976463d0b1f53baf129347174",
  "calboard-stock-analyzer-v1-design.md":
    "5625ca48c0cfd631b637b36c6fbbadae02f3065397bab7c4d7da6a1dca925016",
  "mock-screen1-entry.html":
    "217eb87fab3eb9deb33e51180ca83ebf09df26525fefd9455e5fa05202df5bdc",
  "mock-human-steps.html":
    "2f9e741bb770c7ee2dca5c68315e1a64e5ed9b9c4287e1b5de422f1f55dd6f1c",
  "mock-report-msft.html":
    "35f382a109ffbeb9b048b8f6d532564e80fc26c00b8c1d6ea8345b7e17fbf870",
  "mock-report-oklo.html":
    "fc6de075e6c84f4ba2b720d669985b4f43534f4a7ae77e658c725122d4d9476f",
};

/** Proves the reachability gate got Screen 1 and not merely a 200. */
export const SCREEN1_MARKUP_MARKER = "Ticker entry and identity resolution";

/**
 * The marker each target must show for its state to count as reached.
 *
 * These strings are the application's own words — `stateNameFor` in
 * app/components/AnalyzerEntry.tsx and the Step 2 / Step 6 section heads — so a
 * page that loads without reaching the state fails rather than being captured
 * as though it had.
 */
export const STATE_MARKERS: Readonly<Record<string, string>> = {
  "s1-resolved": "Listed operating company",
  "s1-unknown": "Unknown — no provider evidence for ZXQY",
  "s1-unsupported": "Unsupported — not an operating company",
  "s2-facts-msft": "Fact acquisition and spot-check",
  "s3-profile-msft": "PROFILE CONFIRMATION",
  "s2-facts-oklo": "Fact acquisition and spot-check",
  "s3-profile-oklo": "PROFILE CONFIRMATION",
};

export const TARGETS: readonly string[] = Object.keys(STATE_MARKERS);

/** Screen 1 tickers, matching the manual capture this runner replaces. */
export const TICKERS = { resolved: "MSFT", unknown: "ZXQY", unsupported: "SPY" } as const;
