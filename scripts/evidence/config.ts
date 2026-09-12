// scripts/evidence/config.ts

export const WIDTHS = [720, 1024, 1440] as const;

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

/** Frozen artefacts, byte-exact. A missing file is a STOP, never a hash. */
export const FROZEN_HASHES: Readonly<Record<string, string>> = {
  "calboard-stock-analyzer-v1-spec.md":
    "6a9cf282ce3808d0ebdedb3af71ebd0b3dfdfea3697cdaf9a17bbbd0298caf61",
  "calboard-stock-analyzer-v1-design.md":
    "49be40cafc1a07ccb093267acfc1bb86a5e71c34c531b9a911ec821aeed8150b",
  "mock-screen1-entry.html":
    "700db080c61144007a6686b9a98906361db767d1868c348cf71b37c91cfb376e",
  "mock-human-steps.html":
    "2f9e741bb770c7ee2dca5c68315e1a64e5ed9b9c4287e1b5de422f1f55dd6f1c",
  "mock-report-msft.html":
    "4c7547cb23dfe6a6ef6d9eb53cab11180b81319b2fb681715ff11057118fb629",
  "mock-report-oklo.html":
    "fc6de075e6c84f4ba2b720d669985b4f43534f4a7ae77e658c725122d4d9476f",
  "calboard-valuation-methodology.md":
    "a4a39e33717993fe9558f263009cec3814555765ac69c69728d99354d4a5ec7c",
  "calfinance-methodology-v2.md":
    "0fd8e205fe4cfbee6d934a4f3cfe9ebc017d2f18a5f0e4bb3f19825f7725635c",
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
  "s2-facts-msft-undecided": "Fact acquisition and spot-check",
  "s2-facts-msft": "Fact acquisition and spot-check",
  "s3-profile-msft": "PROFILE CONFIRMATION",
  "s2-facts-oklo-undecided": "Fact acquisition and spot-check",
  "s2-facts-oklo": "Fact acquisition and spot-check",
  "s3-profile-oklo": "PROFILE CONFIRMATION",
};

export const TARGETS: readonly string[] = Object.keys(STATE_MARKERS);

/**
 * The suffix marking a target as the undecided (pre-decision) Screen 2
 * capture, e.g. `s2-facts-msft-undecided`. Shared by `drive.ts` (which builds
 * the target name) and `run.ts` (which decides whether to run
 * `checkContinueGated` against it) so the two stay in lockstep — a drifted
 * copy in either place would silently skip the gate check with no error.
 */
export const UNDECIDED_SUFFIX = "-undecided";

/** Screen 1 tickers, matching the manual capture this runner replaces. */
export const TICKERS = { resolved: "MSFT", unknown: "ZXQY", unsupported: "SPY" } as const;

/**
 * Every check this runner is required to execute, by the step name the check
 * itself reports.
 *
 * Declared here rather than derived from the results, which is the whole
 * point: a required check that never ran produces no result to derive from,
 * so a list built from results can never notice its own absence. Comparing
 * this declaration against what actually ran is what turns a silently skipped
 * check into an explicit gap (§5.6).
 *
 * The step names are constant per check rather than per target — one target
 * failing `no console or page errors` names the same step as any other — so
 * this list stays the length of the check set, not the target set.
 */
export const REQUIRED_CHECK_STEPS: readonly string[] = [
  "frozen artefacts match their SHA-256",
  "app reachable and serving Screen 1",
  "analyzer run table present",
  "every requested target rendered at every width",
  "no document or card overflow",
  "expected font family declared on .cb-analyzer",
  "no console or page errors",
  "every requested state appeared",
  "Continue to gates disabled with a reason on the undecided capture",
];
