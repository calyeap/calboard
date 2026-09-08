import { config } from "dotenv";
config({ path: ".env.local" });

// Integration tests TRUNCATE tables in beforeEach hooks. Refuse to run
// unless DATABASE_URL is pointed at an isolated *_test database — otherwise
// a plain `npm run test` would silently wipe the dev database (which, from
// Task 11 onward, holds the user's real, irreplaceable financial ledger).
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set — refusing to run integration tests against the dev database"
  );
}
const dbName = new URL(url).pathname.slice(1);
if (!/_test$/.test(dbName)) {
  throw new Error(
    `Refusing to TRUNCATE '${dbName}' — TEST_DATABASE_URL must point at a *_test database`
  );
}
process.env.DATABASE_URL = url;

import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia. ThemeContext reads it on mount in
// every jsdom test that renders anything under ThemeProvider, not just
// ThemeContext's own tests, so this needs to be a global default (light,
// i.e. "not dark") rather than a per-test mock. Node-environment (DB
// integration) tests never touch `window`, hence the guard.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

// The analyzer acquires its facts from SEC EDGAR (milestone M8-a). Tests run
// against the committed captures instead: real filing data, taken once by
// scripts/analyzer/capture-companyfacts.ts, so the suite neither depends on
// the SEC being reachable nor spends EDGAR's published rate budget on every
// run. Offline mode also fetches no price quote.
//
// This is set HERE rather than defaulted in gate.ts on purpose: application
// code must fail closed on a live acquisition failure, never fall back to
// captured data that would look fresh and be months old.
process.env.ANALYZER_OFFLINE = "1";
